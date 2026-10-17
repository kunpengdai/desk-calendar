const test = require('node:test');
const assert = require('node:assert');
const { GoogleClient, AuthError, authorize, parseClientFile, normalizeEvent, normalizeTask } = require('../src/google');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body });
const client = { clientId: 'cid', clientSecret: 'secret' };

test('parseClientFile accepts desktop credentials and rejects web ones', () => {
  assert.deepStrictEqual(parseClientFile(JSON.stringify({ installed: { client_id: 'a', client_secret: 'b' } })), { clientId: 'a', clientSecret: 'b' });
  assert.throws(() => parseClientFile(JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } })), /桌面应用/);
  assert.throws(() => parseClientFile('nope'), /JSON/);
});

test('normalizeEvent handles all-day, timed and HTML descriptions', () => {
  const cal = { id: 'me@x.com', summary: 'Me', backgroundColor: '#123456' };
  const a = normalizeEvent({ id: '1', summary: 'Trip', start: { date: '2026-10-20' }, end: { date: '2026-10-22' } }, cal);
  assert.deepStrictEqual([a.allDay, a.startKey, a.endKey, a.color], [true, '2026-10-20', '2026-10-22', '#123456']);
  const t = normalizeEvent({ id: '2', start: { dateTime: '2026-10-17T09:00:00+08:00' }, end: { dateTime: '2026-10-17T10:00:00+08:00' }, description: 'a<br>b &amp; <b>c</b>' }, cal);
  assert.strictEqual(t.title, '（无标题）');
  assert.strictEqual(t.allDay, false);
  assert.strictEqual(t.description, 'a\nb & c');
});

test('normalizeTask keeps only the due date', () => {
  const task = normalizeTask({ id: 't', title: 'Buy', due: '2026-10-18T00:00:00.000Z' }, { id: 'L', title: 'List' });
  assert.strictEqual(task.due, '2026-10-18');
  assert.strictEqual(task.listTitle, 'List');
});

test('client refreshes expired tokens, follows pages and flags completed tasks', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', auth: options.headers?.Authorization });
    if (url.includes('oauth2.googleapis.com/token')) return json(200, { access_token: 'fresh', expires_in: 3600 });
    if (url.includes('/users/@me/lists')) return json(200, { items: [{ id: 'L1', title: '工作' }] });
    if (url.includes('/lists/L1/tasks') && !url.includes('pageToken')) return json(200, { items: [{ id: 'a', title: 'A', due: '2026-10-20T00:00:00.000Z' }, { id: 'x', title: 'Done', status: 'completed' }], nextPageToken: 'p2' });
    if (url.includes('pageToken=p2')) return json(200, { items: [{ id: 'b', title: 'B' }, { id: 'e', title: '  ' }] });
    return json(404, {});
  };
  let saved;
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'old', expires_at: 0 }, fetchImpl, onTokens: t => { saved = t; } });
  const tasks = await g.tasks();
  assert.deepStrictEqual(tasks.map(t => [t.id, t.completed]), [['a', false], ['x', true], ['b', false]]); // 有日期的排前面，其余保持读取顺序
  assert.strictEqual(calls[0].method, 'POST');                      // 先刷新令牌
  assert.ok(calls.slice(1).every(c => c.auth === 'Bearer fresh'));
  assert.strictEqual(saved.refresh_token, 'r');                     // 保留原刷新令牌
});

test('client retries once on 401 and maps invalid_grant to AuthError', async () => {
  let apiHits = 0;
  const fetchImpl = async url => {
    if (url.includes('/token')) return json(200, { access_token: 'new', expires_in: 3600 });
    apiHits++;
    return apiHits === 1 ? json(401, {}) : json(200, { items: [] });
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  await g.tasks();
  assert.strictEqual(apiHits, 2);

  const revoked = new GoogleClient({ client, tokens: { refresh_token: 'r', expires_at: 0 }, fetchImpl: async () => json(400, { error: 'invalid_grant' }) });
  await assert.rejects(revoked.tasks(), AuthError);
});

test('events merges visible calendars and drops cancelled instances', async () => {
  const fetchImpl = async url => {
    if (url.includes('/calendarList')) return json(200, { items: [
      { id: 'me@x.com', primary: true, summary: 'Me', backgroundColor: '#111' },
      { id: 'hidden', summary: 'Hidden', selected: false },
      { id: 'team', summary: 'Team', backgroundColor: '#222' },
    ] });
    if (url.includes('/calendars/me%40x.com/events')) return json(200, { items: [{ id: '1', summary: 'Mine', start: { date: '2026-10-17' }, end: { date: '2026-10-18' } }, { id: '2', status: 'cancelled', start: { date: '2026-10-17' } }] });
    if (url.includes('/calendars/team/events')) {
      assert.ok(url.includes('singleEvents=true'));
      return json(200, { items: [{ id: '3', summary: 'Standup', start: { dateTime: '2026-10-17T09:00:00Z' }, end: { dateTime: '2026-10-17T09:15:00Z' } }] });
    }
    throw new Error(`unexpected ${url}`);
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  const { account, events } = await g.events('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
  assert.strictEqual(account, 'me@x.com');
  assert.deepStrictEqual(events.map(e => [e.title, e.color]), [['Mine', '#111'], ['Standup', '#222']]);
});

test('authorize runs the loopback + PKCE flow end to end', async () => {
  let tokenBody;
  const fetchImpl = async (url, options) => {
    if (url.includes('/token')) { tokenBody = new URLSearchParams(options.body); return json(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }); }
    return fetch(url, options); // 回调请求走真实的本机 HTTP
  };
  const tokens = await authorize({
    client, fetchImpl,
    openUrl: async url => {
      const auth = new URL(url);
      assert.strictEqual(auth.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(auth.searchParams.get('scope').includes('tasks'));
      const redirect = new URL(auth.searchParams.get('redirect_uri'));
      assert.strictEqual(redirect.hostname, '127.0.0.1');
      redirect.searchParams.set('code', 'the-code');
      redirect.searchParams.set('state', auth.searchParams.get('state'));
      setTimeout(() => fetch(redirect), 10);
    },
  });
  assert.strictEqual(tokens.refresh_token, 'r');
  assert.strictEqual(tokenBody.get('code'), 'the-code');
  assert.ok(tokenBody.get('code_verifier').length >= 43);
});

test('authorize rejects a callback with the wrong state', async () => {
  await assert.rejects(authorize({
    client, fetchImpl: fetch,
    openUrl: async url => {
      const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'x'); redirect.searchParams.set('state', 'forged');
      setTimeout(() => fetch(redirect), 10);
    },
  }), /状态校验失败/);
});

test('authorize can be cancelled', async () => {
  const controller = new AbortController();
  const pending = authorize({ client, openUrl: () => setTimeout(() => controller.abort(), 10), signal: controller.signal });
  await assert.rejects(pending, /取消/);
});

test('task time is stored in the first line of notes', () => {
  const { splitNotes, joinNotes } = require('../src/google');
  assert.deepStrictEqual(splitNotes('⏰ 9:05\n带上发票'), { time: '09:05', notes: '带上发票' });
  assert.deepStrictEqual(splitNotes('⏰ 18:30'), { time: '18:30', notes: '' });
  assert.deepStrictEqual(splitNotes('没有时间'), { time: null, notes: '没有时间' });
  assert.deepStrictEqual(splitNotes('⏰ 25:00'), { time: null, notes: '⏰ 25:00' });
  assert.strictEqual(joinNotes('15:00', ''), '⏰ 15:00');
  assert.strictEqual(joinNotes(null, 'x'), 'x');
  const task = normalizeTask({ id: 't', title: 'Call', due: '2026-10-18T00:00:00.000Z', notes: '⏰ 15:00\nabc' }, { id: 'L', title: 'List' });
  assert.deepStrictEqual([task.due, task.time, task.notes], ['2026-10-18', '15:00', 'abc']);
  const undated = normalizeTask({ id: 'u', title: 'X', notes: '⏰ 15:00' }, { id: 'L', title: 'List' });
  assert.strictEqual(undated.time, null);   // 没有日期时忽略时间
});

test('createTask posts title, due date and time-in-notes to the chosen list', async () => {
  let posted;
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/users/@me/lists')) return json(200, { items: [{ id: 'L1', title: '工作' }, { id: 'L2', title: '生活' }] });
    if (url.includes('/lists/L2/tasks') && options.method === 'POST') {
      posted = JSON.parse(options.body);
      return json(200, { id: 'new', title: posted.title, due: posted.due, notes: posted.notes });
    }
    throw new Error(`unexpected ${options.method} ${url}`);
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  const task = await g.createTask({ listId: 'L2', title: '买菜', due: '2026-10-18', time: '18:30' });
  assert.deepStrictEqual(posted, { title: '买菜', notes: '⏰ 18:30', due: '2026-10-18T00:00:00.000Z' });
  assert.deepStrictEqual([task.id, task.listTitle, task.due, task.time], ['new', '生活', '2026-10-18', '18:30']);
});

test('tasks(range) also fetches completed tasks by due date and completion time, without duplicates', async () => {
  const queries = [];
  const fetchImpl = async url => {
    if (url.includes('/users/@me/lists')) return json(200, { items: [{ id: 'L1', title: '工作' }] });
    const q = new URL(url).searchParams;
    queries.push(Object.fromEntries(q));
    if (q.get('showCompleted') === 'false') return json(200, { items: [{ id: 'open', title: 'Open', due: '2026-10-20T00:00:00.000Z' }] });
    if (q.get('dueMin')) return json(200, { items: [{ id: 'd1', title: 'Due done', status: 'completed', completed: '2026-10-16T03:00:00.000Z', due: '2026-10-16T00:00:00.000Z' }] });
    if (q.get('completedMin')) return json(200, { items: [
      { id: 'd1', title: 'Due done', status: 'completed', completed: '2026-10-16T03:00:00.000Z', due: '2026-10-16T00:00:00.000Z' },
      { id: 'n1', title: 'No due done', status: 'completed', completed: '2026-10-15T09:00:00.000Z', hidden: true },
      { id: 'gone', title: 'Deleted', status: 'completed', deleted: true },
    ] });
    throw new Error(url);
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  const tasks = await g.tasks('2026-09-27T16:00:00.000Z', '2026-11-08T16:00:00.000Z');
  assert.deepStrictEqual(tasks.map(t => [t.id, t.completed]), [['d1', true], ['open', false], ['n1', true]]);
  assert.strictEqual(tasks[0].completedAt, '2026-10-16T03:00:00.000Z');
  const done = queries.filter(q => q.showCompleted === 'true');
  assert.strictEqual(done.length, 2);
  assert.ok(done.every(q => q.showHidden === 'true'));
  assert.deepStrictEqual(done.find(q => q.completedMin), { showCompleted: 'true', showHidden: 'true', maxResults: '100', completedMin: '2026-09-27T16:00:00.000Z', completedMax: '2026-11-08T16:00:00.000Z' });
});

test('setTaskDone completes and reopens tasks', async () => {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push([options.method, JSON.parse(options.body)]);
    return json(200, { id: 't', completed: options.body.includes('"completed"}') ? '2026-10-17T08:00:00.000Z' : undefined });
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  assert.strictEqual(await g.setTaskDone('L', 't', true), '2026-10-17T08:00:00.000Z');
  assert.strictEqual(await g.setTaskDone('L', 't', false), null);
  assert.deepStrictEqual(bodies, [['PATCH', { status: 'completed' }], ['PATCH', { status: 'needsAction', completed: null }]]);
});

test('eventResource builds timed and all-day bodies and supports partial patches', () => {
  const { eventResource } = require('../src/google');
  assert.deepStrictEqual(eventResource({ title: 'A', allDay: false, start: '2026-10-17T01:00:00.000Z', end: '2026-10-17T02:00:00.000Z' }, 'Asia/Shanghai'), {
    summary: 'A', start: { dateTime: '2026-10-17T01:00:00.000Z', timeZone: 'Asia/Shanghai', date: null }, end: { dateTime: '2026-10-17T02:00:00.000Z', timeZone: 'Asia/Shanghai', date: null },
  });
  assert.deepStrictEqual(eventResource({ allDay: true, startKey: '2026-10-18', endKey: '2026-10-19' }), {
    start: { date: '2026-10-18', dateTime: null }, end: { date: '2026-10-19', dateTime: null },
  });
  assert.deepStrictEqual(eventResource({ title: '只改标题' }), { summary: '只改标题' });
});

test('event create / move / delete call the Calendar API on the right calendar', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push([method, url.replace('https://www.googleapis.com/calendar/v3', ''), options.body ? JSON.parse(options.body) : null]);
    if (url.includes('/calendarList')) return json(200, { items: [
      { id: 'me@x.com', primary: true, summary: 'Me', accessRole: 'owner', backgroundColor: '#111' },
      { id: 'team', summary: 'Team', accessRole: 'writer' },
      { id: 'holidays', summary: 'Holidays', accessRole: 'reader' },
    ] });
    if (method === 'POST') return json(200, { id: 'e1', summary: 'New', start: { dateTime: '2026-10-17T10:00:00+08:00' }, end: { dateTime: '2026-10-17T11:00:00+08:00' } });
    if (method === 'PATCH') return json(200, { id: 'e1', summary: 'New', start: { dateTime: '2026-10-17T12:00:00+08:00' }, end: { dateTime: '2026-10-17T13:00:00+08:00' } });
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
    throw new Error(url);
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  const writable = await g.writableCalendars();
  assert.deepStrictEqual(writable.map(c => c.id), ['me@x.com', 'team']);   // 只读日历不在列表中，主日历在前
  const created = await g.createEvent('me@x.com', { title: 'New', allDay: false, start: '2026-10-17T02:00:00.000Z', end: '2026-10-17T03:00:00.000Z' }, 'Asia/Shanghai');
  assert.deepStrictEqual([created.eventId, created.calendarId, created.editable, created.color], ['e1', 'me@x.com', true, '#111']);
  const moved = await g.updateEvent('me@x.com', 'e1', { start: '2026-10-17T04:00:00.000Z', end: '2026-10-17T05:00:00.000Z' }, 'Asia/Shanghai');
  assert.strictEqual(moved.start, '2026-10-17T12:00:00+08:00');
  assert.strictEqual(await g.deleteEvent('me@x.com', 'e1'), true);
  const writes = calls.filter(c => c[0] !== 'GET');
  assert.deepStrictEqual(writes.map(c => [c[0], c[1]]), [['POST', '/calendars/me%40x.com/events'], ['PATCH', '/calendars/me%40x.com/events/e1'], ['DELETE', '/calendars/me%40x.com/events/e1']]);
  assert.deepStrictEqual(Object.keys(writes[1][2]), ['start', 'end']);   // 拖动只修改时间
});

test('missing edit scope gives a re-login hint', async () => {
  const fetchImpl = async () => json(403, { error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } });
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  await assert.rejects(g.deleteEvent('c', 'e'), /重新登录/);
});

test('updateTaskSchedule rewrites due date and the time line in notes', async () => {
  let body;
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/users/@me/lists')) return json(200, { items: [{ id: 'L1', title: '工作' }] });
    body = JSON.parse(options.body);
    return json(200, { id: 't', title: 'T', due: body.due, notes: body.notes });
  };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  const task = await g.updateTaskSchedule('L1', 't', { due: '2026-10-19', time: '08:15', notes: '带电脑' });
  assert.deepStrictEqual(body, { due: '2026-10-19T00:00:00.000Z', notes: '⏰ 08:15\n带电脑' });
  assert.deepStrictEqual([task.due, task.time, task.notes, task.listTitle], ['2026-10-19', '08:15', '带电脑', '工作']);
});

test('deleteTask sends DELETE for the task', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { calls.push([options.method, url]); return { ok: true, status: 204, json: async () => { throw new Error('no body'); } }; };
  const g = new GoogleClient({ client, tokens: { refresh_token: 'r', access_token: 'ok', expires_at: Date.now() + 3600e3 }, fetchImpl });
  assert.strictEqual(await g.deleteTask('L 1', 't1'), true);
  assert.deepStrictEqual(calls, [['DELETE', 'https://tasks.googleapis.com/tasks/v1/lists/L%201/tasks/t1']]);
});
