// Google OAuth（桌面应用 + PKCE + 本机回环回调）以及 Calendar / Tasks REST 封装。
const crypto = require('node:crypto');
const http = require('node:http');
const { t } = require('./renderer/i18n');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',  // 读取日历列表和日程
  'https://www.googleapis.com/auth/calendar.events',    // 新建 / 修改 / 删除日程
  'https://www.googleapis.com/auth/tasks',
];
const EVENTS_SCOPE = SCOPES[1];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; }
}

// 连不上 Google（断网、超时、连接被重置、服务器 5xx / 限流）：可以稍后重试的错误。
class NetworkError extends Error {
  constructor(message, cause) { super(message); this.name = 'NetworkError'; this.cause = cause; }
}

async function safeFetch(fetchImpl, url, options) {
  try { return await fetchImpl(url, options); }
  catch (error) { throw new NetworkError(t('err.network'), error); }
}

function httpError(status, message) {
  if (status >= 500 || status === 429) return new NetworkError(t('err.unavailable', { status }));
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseClientFile(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(t('err.badJson')); }
  if (json.web) throw new Error(t('err.webClient'));
  const c = json.installed;
  if (!c || typeof c.client_id !== 'string' || typeof c.client_secret !== 'string') {
    throw new Error(t('err.noDesktopClient'));
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

const base64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const CALLBACK_PAGE = message => `<!doctype html><meta charset="utf-8"><title>DeskCalendar</title>
<body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;background:#14181c;color:#e9ecef;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${message}</h2><p style="color:#8b949e">${t('auth.close')}</p></div></body>`;

// 打开系统浏览器授权，在 127.0.0.1 随机端口接收回调，用授权码 + PKCE 换取令牌。
function authorize({ client, openUrl, fetchImpl = fetch, signal, timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    let redirectUri, settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); server.close();
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(new Error(t('err.authCancelled')));
    const timer = setTimeout(() => finish(new Error(t('err.authTimeout'))), timeoutMs);

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (url.searchParams.get('state') !== state) { res.end(CALLBACK_PAGE(t('auth.stateFailed'))); return finish(new Error(t('err.authState'))); }
      if (error || !code) { res.end(CALLBACK_PAGE(t('auth.notCompleted'))); return finish(new Error(error === 'access_denied' ? t('err.accessDenied') : t('err.authFailed', { error: error || t('auth.noCode') }))); }
      res.end(CALLBACK_PAGE(t('auth.success')));
      try {
        const tokens = await tokenRequest(fetchImpl, {
          code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code',
          client_id: client.clientId, client_secret: client.clientSecret,
        });
        if (!tokens.refresh_token) throw new Error(t('err.noRefresh'));
        finish(null, tokens);
      } catch (e) { finish(e); }
    });

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    server.on('error', e => finish(e));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const params = new URLSearchParams({
        client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256',
        state, access_type: 'offline', prompt: 'consent',
      });
      Promise.resolve(openUrl(`${AUTH_URL}?${params}`)).catch(e => finish(e));
    });
  });
}

async function tokenRequest(fetchImpl, body) {
  const res = await safeFetch(fetchImpl, TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new AuthError(t('err.authExpired'));
    throw httpError(res.status, t('err.tokenFailed', { error: data.error_description || data.error || res.status }));
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, scope: data.scope, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
}

// 日历描述可能是 HTML，转成纯文本显示。
function htmlToText(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// 统一的事件结构：全天日程用 startKey/endKey（endKey 不含当天），定时日程用 ISO start/end。
function normalizeEvent(item, calendar) {
  const allDay = Boolean(item.start?.date);
  return {
    id: `${calendar.id}:${item.id}`,
    title: item.summary || t('untitled.event'),
    allDay,
    startKey: allDay ? item.start.date : null,
    endKey: allDay ? (item.end?.date || item.start.date) : null,
    start: allDay ? null : item.start?.dateTime,
    end: allDay ? null : (item.end?.dateTime || item.start?.dateTime),
    location: item.location || '',
    description: htmlToText(item.description || ''),
    link: item.htmlLink || '',
    calendar: calendar.summaryOverride || calendar.summary || '',
    color: calendar.backgroundColor || '#8ab4f8',
    calendarId: calendar.id,
    eventId: item.id,
    editable: ['owner', 'writer'].includes(calendar.accessRole),
    recurring: Boolean(item.recurringEventId),
  };
}

// 日程输入 → Calendar API 资源。只包含传入的字段，便于 PATCH 局部修改。
// 全天：startKey / endKey（endKey 不含当天）；定时：start / end（ISO 时间）。
function eventResource(input, timeZone) {
  const body = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.location !== undefined) body.location = input.location;
  if (input.description !== undefined) body.description = input.description;
  if (input.allDay) {
    body.start = { date: input.startKey, dateTime: null };
    body.end = { date: input.endKey, dateTime: null };
  } else if (input.start && input.end) {
    body.start = { dateTime: input.start, timeZone, date: null };
    body.end = { dateTime: input.end, timeZone, date: null };
  }
  return body;
}

// Tasks API 不保存截止时间，时间写在备注第一行：“⏰ 15:30”。
const TIME_MARK = /^⏰\s*([01]?\d|2[0-3]):([0-5]\d)[ \t]*(?:\r?\n|$)/;

function splitNotes(notes) {
  const match = TIME_MARK.exec(notes || '');
  if (!match) return { time: null, notes: notes || '' };
  return { time: `${match[1].padStart(2, '0')}:${match[2]}`, notes: notes.slice(match[0].length) };
}
const joinNotes = (time, notes) => (time ? `⏰ ${time}${notes ? `\n${notes}` : ''}` : notes || '');

function normalizeTask(item, list) {
  const { time, notes } = splitNotes(item.notes);
  return {
    id: item.id, listId: list.id, listTitle: list.title || '',
    title: item.title || t('untitled.task'), notes,
    // Tasks API 只保存日期，due 固定为 UTC 零点，直接取日期部分。
    due: item.due ? item.due.slice(0, 10) : null,
    time: item.due ? time : null,
    completed: item.status === 'completed',
    completedAt: item.status === 'completed' ? (item.completed || null) : null,
    parent: item.parent || null, position: item.position || '',
    link: item.webViewLink || 'https://tasks.google.com/',
  };
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99')
    || a.listTitle.localeCompare(b.listTitle) || a.position.localeCompare(b.position));
}

class GoogleClient {
  constructor({ client, tokens, fetchImpl = fetch, onTokens = () => {} }) {
    Object.assign(this, { client, tokens, fetchImpl, onTokens });
  }

  async accessToken(force = false) {
    if (!force && this.tokens.access_token && this.tokens.expires_at > Date.now() + 60_000) return this.tokens.access_token;
    const fresh = await tokenRequest(this.fetchImpl, {
      grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token,
      client_id: this.client.clientId, client_secret: this.client.clientSecret,
    });
    this.tokens = { ...this.tokens, ...fresh, refresh_token: fresh.refresh_token || this.tokens.refresh_token };
    this.onTokens(this.tokens);
    return this.tokens.access_token;
  }

  async request(url, options = {}, retried = false) {
    const token = await this.accessToken(retried);
    const res = await safeFetch(this.fetchImpl, url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 && !retried) return this.request(url, options, true);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      if (res.status === 403 && reason === 'accessNotConfigured') throw new Error(t('err.apiDisabled'));
      if (res.status === 403 && (reason === 'insufficientPermissions' || /insufficient authentication scopes/i.test(data.error?.message || ''))) {
        throw new Error(t('err.needScope'));
      }
      if (res.status === 403 && reason === 'forbidden') throw new Error(t('err.readOnly'));
      throw httpError(res.status, t('err.api', { status: res.status, message: data.error?.message || res.statusText }));
    }
    return data;
  }

  async paged(url, params) {
    const items = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) });
      const data = await this.request(`${url}?${query}`);
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }

  async calendars() {
    const list = await this.paged(`${CALENDAR_API}/users/me/calendarList`, { minAccessRole: 'reader', maxResults: '250' });
    this.calendarList = list.filter(c => c.selected !== false && !c.hidden);
    return this.calendarList;
  }

  // 可以写入的日历（自己的或有编辑权限的），主日历排第一。
  async writableCalendars() {
    const list = this.calendarList || await this.calendars();
    return list.filter(c => ['owner', 'writer'].includes(c.accessRole))
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
      .map(c => ({ id: c.id, title: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#8ab4f8', primary: Boolean(c.primary) }));
  }

  async calendarById(id) {
    const list = this.calendarList || await this.calendars();
    return list.find(c => c.id === id) || { id, summary: '', accessRole: 'writer' };
  }

  async createEvent(calendarId, input, timeZone) {
    const created = await this.request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST', body: JSON.stringify(eventResource(input, timeZone)),
    });
    return normalizeEvent(created, await this.calendarById(calendarId));
  }

  async updateEvent(calendarId, eventId, input, timeZone) {
    const updated = await this.request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH', body: JSON.stringify(eventResource(input, timeZone)),
    });
    return normalizeEvent(updated, await this.calendarById(calendarId));
  }

  async deleteEvent(calendarId, eventId) {
    await this.request(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    return true;
  }

  async events(timeMin, timeMax) {
    const calendars = await this.calendars();
    const results = await Promise.all(calendars.map(async calendar => {
      const items = await this.paged(`${CALENDAR_API}/calendars/${encodeURIComponent(calendar.id)}/events`, {
        timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      });
      return items.filter(i => i.status !== 'cancelled').map(i => normalizeEvent(i, calendar));
    }));
    const account = calendars.find(c => c.primary)?.id || '';
    return { account, events: results.flat() };
  }

  async taskLists() {
    const lists = await this.paged(`${TASKS_API}/users/@me/lists`, { maxResults: '100' });
    this.lists = lists.map(l => ({ id: l.id, title: l.title || '' }));
    return this.lists;
  }

  // 未完成的任务全部读取；已完成的只读取与日历范围相关的（截止日期或完成时间落在范围内），
  // 用来在日历上显示完成记录。已清除（hidden）的已完成任务也包含在内。
  async tasks(timeMin, timeMax) {
    const lists = await this.taskLists();
    const results = await Promise.all(lists.map(async list => {
      const url = `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks`;
      const queries = [this.paged(url, { showCompleted: 'false', showHidden: 'false', maxResults: '100' })];
      if (timeMin && timeMax) {
        const widen = (iso, days) => new Date(new Date(iso).getTime() + days * 864e5).toISOString();
        const done = { showCompleted: 'true', showHidden: 'true', maxResults: '100' };
        queries.push(
          this.paged(url, { ...done, dueMin: widen(timeMin, -1), dueMax: widen(timeMax, 1) }),
          this.paged(url, { ...done, completedMin: timeMin, completedMax: timeMax }),
        );
      }
      const seen = new Map();
      for (const item of (await Promise.all(queries)).flat()) {
        if (item.deleted || !item.title?.trim() || seen.has(item.id)) continue;
        seen.set(item.id, normalizeTask(item, list));
      }
      return [...seen.values()];
    }));
    return sortTasks(results.flat());
  }

  async createTask({ listId, title, due, time, notes = '' }) {
    const lists = this.lists || await this.taskLists();
    const list = lists.find(l => l.id === listId) || lists[0];
    if (!list) throw new Error(t('err.noTaskList'));
    const body = { title, notes: joinNotes(due ? time : null, notes), ...(due ? { due: `${due}T00:00:00.000Z` } : {}) };
    const created = await this.request(`${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks`, { method: 'POST', body: JSON.stringify(body) });
    return normalizeTask(created, list);
  }

  // 修改任务的截止日期和完成时间（时间写在备注第一行）。notes 是去掉时间标记后的备注。
  async updateTaskSchedule(listId, taskId, { due, time, notes }) {
    const lists = this.lists || await this.taskLists();
    const list = lists.find(l => l.id === listId) || { id: listId, title: '' };
    const updated = await this.request(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH', body: JSON.stringify({ due: due ? `${due}T00:00:00.000Z` : null, notes: joinNotes(due ? time : null, notes || '') }),
    });
    return normalizeTask(updated, list);
  }

  async deleteTask(listId, taskId) {
    await this.request(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    return true;
  }

  // done=true 标记完成，false 恢复为未完成。返回 Google 记录的完成时间（未完成时为 null）。
  async setTaskDone(listId, taskId, done) {
    const updated = await this.request(`${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH', body: JSON.stringify(done ? { status: 'completed' } : { status: 'needsAction', completed: null }),
    });
    return done ? (updated.completed || new Date().toISOString()) : null;
  }
}

module.exports = { SCOPES, EVENTS_SCOPE, eventResource, AuthError, NetworkError, GoogleClient, authorize, parseClientFile, normalizeEvent, normalizeTask, sortTasks, splitNotes, joinNotes };
