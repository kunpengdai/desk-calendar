const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, safeStorage, nativeImage, screen, powerMonitor } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GoogleClient, AuthError, EVENTS_SCOPE, authorize, parseClientFile } = require('./google');
const { demoEvents, demoTasks } = require('./demo');

const DEMO = process.argv.includes('--demo');
const SMOKE = process.argv.includes('--smoke');
const REFRESH_MS = 5 * 60 * 1000;
// 示例模式使用独立的临时配置目录，不读写真实账号数据。
app.setPath('userData', DEMO ? fs.mkdtempSync(path.join(os.tmpdir(), 'desk-calendar-demo-')) : path.join(app.getPath('appData'), 'desk-calendar'));

const files = {
  prefs: () => path.join(app.getPath('userData'), 'prefs.json'),
  secrets: () => path.join(app.getPath('userData'), 'secrets.bin'),
};
const DEFAULT_PREFS = { view: 'month', pinned: false, opacity: 100, autoStart: true, tasksCollapsed: false, bounds: null };

let win, tray, refreshTimer, authAbort = null, quitting = false;
let prefs = { ...DEFAULT_PREFS };
let secrets = { client: null, tokens: null };
let google = null;
let status = { account: '', lastSync: null, error: '', authorizing: false };
const cache = { events: new Map(), tasks: [] };
let demoTaskList = demoTasks();
let demoEventList = null;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- 存储 ----------
function loadPrefs() {
  try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(files.prefs(), 'utf8')) }; } catch {}
}
function savePrefs() { fs.writeFileSync(files.prefs(), JSON.stringify(prefs, null, 2)); }

function loadSecrets() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    secrets = { client: null, tokens: null, ...JSON.parse(safeStorage.decryptString(fs.readFileSync(files.secrets()))) };
  } catch {}
}
function saveSecrets() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存登录信息。');
  fs.writeFileSync(files.secrets(), safeStorage.encryptString(JSON.stringify(secrets)));
}

function buildClient() {
  google = secrets.client && secrets.tokens?.refresh_token
    ? new GoogleClient({ client: secrets.client, tokens: secrets.tokens, onTokens: tokens => { secrets.tokens = tokens; try { saveSecrets(); } catch {} } })
    : null;
}

// ---------- 状态 ----------
function publicState() {
  return {
    demo: DEMO, connected: DEMO || Boolean(google), hasClient: Boolean(secrets.client),
    // 旧版登录只有只读权限：令牌记录了 scope 且不含编辑日程权限时，需要重新登录。
    canEdit: DEMO || Boolean(google && (!secrets.tokens?.scope || secrets.tokens.scope.includes(EVENTS_SCOPE))),
    authorizing: status.authorizing, account: DEMO ? 'demo@example.com' : status.account,
    lastSync: status.lastSync, error: status.error, prefs: { ...prefs, bounds: undefined },
  };
}
function notifyRenderer(channel = 'state-changed') { if (win && !win.isDestroyed()) win.webContents.send(channel); }

function handleError(error) {
  if (error instanceof AuthError) {
    secrets.tokens = null; try { saveSecrets(); } catch {}
    buildClient();
  }
  status.error = error.message || String(error);
  notifyRenderer();
}

// ---------- 数据 ----------
async function getEvents(timeMin, timeMax) {
  if (DEMO) return (demoEventList ||= demoEvents());
  if (!google) return [];
  const key = `${timeMin}|${timeMax}`;
  try {
    const result = await google.events(timeMin, timeMax);
    cache.events.set(key, result.events);
    if (cache.events.size > 12) cache.events.delete(cache.events.keys().next().value);
    status.account = result.account || status.account;
    status.lastSync = Date.now(); status.error = '';
    return result.events;
  } catch (error) {
    handleError(error);
    return cache.events.get(key) || [];
  }
}

async function getTasks(timeMin, timeMax) {
  if (DEMO) return demoTaskList;
  if (!google) return [];
  try {
    cache.tasks = await google.tasks(timeMin, timeMax);
    status.lastSync = Date.now(); status.error = '';
  } catch (error) { handleError(error); }
  return cache.tasks;
}

// ---------- 日程编辑 ----------
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DEMO_CALENDARS = [
  { id: 'demo', title: '我的日历', color: '#8ab4f8', primary: true },
  { id: 'work', title: '工作', color: '#c58af9', primary: false },
];

function writableCalendars() {
  if (DEMO) return DEMO_CALENDARS;
  if (!google) return [];
  return google.writableCalendars();
}

// 校验并整理来自界面的日程输入；partial=true 时用于修改（字段可缺省）。
function cleanEventInput(input, partial) {
  if (!input || typeof input !== 'object') throw new Error('日程无效。');
  const out = {};
  if (input.title !== undefined || !partial) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new Error('请输入日程标题。');
    if (title.length > 1024) throw new Error('标题太长。');
    out.title = title;
  }
  for (const key of ['location', 'description']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > 8000) throw new Error('内容无效。');
      out[key] = input[key];
    }
  }
  if (input.allDay) {
    if (!DATE_KEY.test(input.startKey || '') || !DATE_KEY.test(input.endKey || '') || input.endKey <= input.startKey) throw new Error('日期无效。');
    Object.assign(out, { allDay: true, startKey: input.startKey, endKey: input.endKey });
  } else if (input.start !== undefined || input.end !== undefined || !partial) {
    const start = new Date(input.start), end = new Date(input.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('时间无效。');
    if (end <= start) throw new Error('结束时间必须晚于开始时间。');
    Object.assign(out, { allDay: false, start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}

function applyDemoEvent(event, input) {
  const next = { ...event, ...input };
  if (input.allDay === true) Object.assign(next, { start: null, end: null });
  if (input.allDay === false) Object.assign(next, { startKey: null, endKey: null });
  return next;
}

async function createEvent(calendarId, input) {
  const data = cleanEventInput(input, false);
  if (DEMO) {
    const cal = DEMO_CALENDARS.find(c => c.id === calendarId) || DEMO_CALENDARS[0];
    const id = `demo-ev-${Date.now()}`;
    const event = applyDemoEvent({ id: `${cal.id}:${id}`, eventId: id, calendarId: cal.id, calendar: cal.title, color: cal.color, editable: true, recurring: false, link: '', location: '', description: '', startKey: null, endKey: null, start: null, end: null }, data);
    demoEventList = [...(demoEventList ||= demoEvents()), event];
    return event;
  }
  if (!google) throw new Error('尚未登录 Google。');
  const event = await google.createEvent(String(calendarId), data, TIME_ZONE);
  cache.events.clear();
  return event;
}

async function updateEvent(calendarId, eventId, input) {
  const data = cleanEventInput(input, true);
  if (DEMO) {
    const list = demoEventList ||= demoEvents();
    const old = list.find(e => e.calendarId === calendarId && e.eventId === eventId);
    if (!old) throw new Error('日程不存在。');
    if (!old.editable) throw new Error('没有修改这个日历的权限（只读日历）。');
    const event = applyDemoEvent(old, data);
    demoEventList = list.map(e => (e === old ? event : e));
    return event;
  }
  if (!google) throw new Error('尚未登录 Google。');
  const event = await google.updateEvent(String(calendarId), String(eventId), data, TIME_ZONE);
  cache.events.clear();
  return event;
}

async function deleteEvent(calendarId, eventId) {
  if (DEMO) {
    demoEventList = (demoEventList ||= demoEvents()).filter(e => !(e.calendarId === calendarId && e.eventId === eventId));
    return true;
  }
  if (!google) throw new Error('尚未登录 Google。');
  await google.deleteEvent(String(calendarId), String(eventId));
  cache.events.clear();
  return true;
}

// 拖动任务：修改截止日期和完成时间。
async function rescheduleTask(listId, taskId, input) {
  const due = DATE_KEY.test(input?.due || '') ? input.due : null;
  const time = due && /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.time || '') ? input.time : null;
  const notes = typeof input?.notes === 'string' ? input.notes : '';
  if (DEMO) {
    demoTaskList = demoTaskList.map(t => (t.id === taskId ? { ...t, due, time } : t));
    return demoTaskList.find(t => t.id === taskId);
  }
  if (!google) throw new Error('尚未登录 Google。');
  const task = await google.updateTaskSchedule(listId, taskId, { due, time, notes });
  cache.tasks = cache.tasks.map(t => (t.id === taskId ? task : t));
  return task;
}

// 删除任务（Google Tasks 会一并删除它的子任务，本地也同步移除）。
async function deleteTask(listId, taskId) {
  const keep = list => list.filter(t => t.id !== taskId && t.parent !== taskId);
  if (DEMO) { demoTaskList = keep(demoTaskList); return true; }
  if (!google) throw new Error('尚未登录 Google。');
  await google.deleteTask(listId, taskId);
  cache.tasks = keep(cache.tasks);
  return true;
}

async function taskLists() {
  if (DEMO) return [...new Set(demoTaskList.map(t => t.listTitle).concat('工作', '生活', '个人'))].map(title => ({ id: title, title }));
  if (!google) return [];
  return google.lists || google.taskLists();
}

async function createTask(input) {
  if (!input || typeof input !== 'object') throw new Error('任务无效。');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new Error('请输入任务名称。');
  if (title.length > 1024) throw new Error('任务名称太长。');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(input.due || '') ? input.due : null;
  const time = due && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '') ? input.time : null;
  const listId = typeof input.listId === 'string' ? input.listId : '';
  if (DEMO) {
    const task = { id: `demo-${Date.now()}`, listId: listId || '工作', listTitle: listId || '工作', title, notes: '', due, time, parent: null, position: '0', link: 'https://tasks.google.com/' };
    demoTaskList = [...demoTaskList, task];
    return task;
  }
  if (!google) throw new Error('尚未登录 Google。');
  const task = await google.createTask({ listId, title, due, time });
  cache.tasks = [...cache.tasks, task];
  return task;
}

// 完成 / 恢复任务：任务保留在列表中，只更新完成状态，日历上显示为划掉。
async function setTaskDone(listId, taskId, done) {
  const mark = list => list.map(t => (t.id === taskId ? { ...t, completed: done, completedAt } : t));
  let completedAt = done ? new Date().toISOString() : null;
  if (DEMO) { demoTaskList = mark(demoTaskList); return completedAt; }
  if (!google) throw new Error('尚未登录 Google。');
  completedAt = await google.setTaskDone(listId, taskId, done);
  cache.tasks = mark(cache.tasks);
  return completedAt;
}

// ---------- 授权 ----------
async function importClient() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '选择 Google OAuth 客户端 JSON（桌面应用）', properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return publicState();
  const client = parseClientFile(fs.readFileSync(filePaths[0], 'utf8'));
  if (secrets.client?.clientId !== client.clientId) secrets.tokens = null;
  secrets.client = client;
  saveSecrets(); buildClient();
  return publicState();
}

async function connect() {
  if (DEMO) throw new Error('示例模式不能登录，请用 npm start 正常启动。');
  if (!secrets.client) throw new Error('请先导入 OAuth 客户端 JSON 文件。');
  authAbort?.abort();
  authAbort = new AbortController();
  status.authorizing = true; status.error = ''; notifyRenderer();
  try {
    const tokens = await authorize({ client: secrets.client, openUrl: url => shell.openExternal(url), signal: authAbort.signal });
    secrets.tokens = tokens; saveSecrets(); buildClient();
    cache.events.clear(); cache.tasks = [];
    if (win) { win.show(); win.focus(); }
  } finally {
    status.authorizing = false; authAbort = null; notifyRenderer();
  }
  return publicState();
}

function disconnect() {
  authAbort?.abort();
  secrets.tokens = null; saveSecrets(); buildClient();
  cache.events.clear(); cache.tasks = [];
  status = { account: '', lastSync: null, error: '', authorizing: false };
  return publicState();
}

// ---------- 偏好 ----------
function applyPrefs() {
  if (!win) return;
  win.setAlwaysOnTop(prefs.pinned, 'floating');
  win.setOpacity(prefs.opacity / 100);
  if (!DEMO) {
    // 便携版 EXE 每次运行会解压到临时目录，开机启动必须指向原始 EXE（PORTABLE_EXECUTABLE_FILE）；
    // 从源码运行时用 electron.exe + 项目路径。每次启动都重写一次，EXE 被移动后也能自动更新。
    app.setLoginItemSettings({
      openAtLogin: prefs.autoStart, name: 'DeskCalendar',
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    });
  }
  rebuildTray();
}

function setPrefs(value) {
  if (!value || typeof value !== 'object') throw new Error('设置无效。');
  if (['month', 'week', 'day'].includes(value.view)) prefs.view = value.view;
  for (const key of ['pinned', 'autoStart', 'tasksCollapsed']) if (typeof value[key] === 'boolean') prefs[key] = value[key];
  if (Number.isFinite(value.opacity)) prefs.opacity = Math.min(100, Math.max(40, Math.round(value.opacity)));
  savePrefs(); applyPrefs();
  return publicState();
}

const OPEN_HOSTS = new Set(['calendar.google.com', 'www.google.com', 'tasks.google.com', 'console.cloud.google.com', 'developers.google.com', 'myaccount.google.com']);
function openExternal(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !OPEN_HOSTS.has(parsed.hostname)) throw new Error('不支持打开这个链接。');
  return shell.openExternal(parsed.toString());
}

// ---------- IPC ----------
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message || String(error) }; }
  });
  handle('state', publicState);
  handle('events', (timeMin, timeMax) => {
    if (typeof timeMin !== 'string' || typeof timeMax !== 'string') throw new Error('时间范围无效。');
    return getEvents(timeMin, timeMax);
  });
  handle('tasks', (timeMin, timeMax) => getTasks(typeof timeMin === 'string' ? timeMin : null, typeof timeMax === 'string' ? timeMax : null));
  handle('task:set-done', (listId, taskId, done) => setTaskDone(String(listId), String(taskId), Boolean(done)));
  handle('task:lists', taskLists);
  handle('task:create', createTask);
  handle('task:delete', (listId, taskId) => deleteTask(String(listId), String(taskId)));
  handle('task:reschedule', (listId, taskId, input) => rescheduleTask(String(listId), String(taskId), input));
  handle('calendars:writable', writableCalendars);
  handle('event:create', (calendarId, input) => createEvent(String(calendarId), input));
  handle('event:update', (calendarId, eventId, input) => updateEvent(String(calendarId), String(eventId), input));
  handle('event:delete', (calendarId, eventId) => deleteEvent(String(calendarId), String(eventId)));
  handle('auth:import', importClient);
  handle('auth:connect', connect);
  handle('auth:cancel', () => { authAbort?.abort(); return publicState(); });
  handle('auth:disconnect', disconnect);
  handle('prefs', setPrefs);
  handle('open', openExternal);
  handle('window:hide', () => win.hide());
  handle('window:fit-width', width => fitWidth(Number(width)));
}

// ---------- 窗口 / 托盘 ----------
function trayIcon() {
  const size = 32, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inside = x >= 3 && x < 29 && y >= 4 && y < 29;
    const header = inside && y < 11;
    const cell = inside && !header && (x - 6) % 6 < 3 && (y - 14) % 5 < 3 && x >= 6 && x < 27 && y >= 14 && y < 27;
    const c = header ? [66, 133, 244, 255] : cell ? [66, 133, 244, 255] : inside ? [240, 244, 248, 255] : [0, 0, 0, 0];
    px.set([c[2], c[1], c[0], c[3]], (y * size + x) * 4);
  }
  return nativeImage.createFromBitmap(px, { width: size, height: size });
}

// 周视图需要更宽的窗口：不够宽时向屏幕内侧加宽（保持靠近的屏幕边缘不动）。
function fitWidth(minWidth) {
  if (!win || !Number.isFinite(minWidth)) return;
  const b = win.getBounds(), area = screen.getDisplayMatching(b).workArea;
  const width = Math.min(Math.max(b.width, minWidth), area.width);
  if (width === b.width) return;
  const nearRight = b.x + b.width / 2 > area.x + area.width / 2;
  let x = nearRight ? b.x + b.width - width : b.x;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  win.setBounds({ ...b, x, width }, false);
}

function showWindow() { if (!win) return; win.show(); win.focus(); }

function rebuildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示日历', click: showWindow },
    { label: '立即刷新', click: () => notifyRenderer('refresh') },
    { type: 'separator' },
    { label: '窗口置顶', type: 'checkbox', checked: prefs.pinned, click: item => setPrefs({ pinned: item.checked }) },
    { label: '开机启动', type: 'checkbox', checked: prefs.autoStart, enabled: !DEMO, click: item => setPrefs({ autoStart: item.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
}

function initialBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 400, height = Math.min(780, area.height - 40);
  const saved = prefs.bounds;
  const fits = saved && screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x >= a.x - 20 && saved.y >= a.y - 20 && saved.x + saved.width <= a.x + a.width + 20 && saved.y + saved.height <= a.y + a.height + 20);
  return fits ? saved : { width, height, x: area.x + area.width - width - 24, y: area.y + 20 };
}

async function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(), minWidth: 340, minHeight: 520,
    frame: false, backgroundColor: '#15191e', show: false, skipTaskbar: true,
    title: 'DeskCalendar', icon: trayIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (SMOKE) win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'error' || level === 'warning') console.error(`[renderer ${level}] ${message} (${path.basename(sourceId || '')}:${lineNumber})`);
  });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  let boundsTimer;
  const remember = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { prefs.bounds = win.getBounds(); try { savePrefs(); } catch {} }, 400); };
  win.on('moved', remember); win.on('resized', remember);

  tray = new Tray(trayIcon());
  tray.setToolTip('DeskCalendar · Google 日历');
  tray.on('click', showWindow);
  applyPrefs();

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!SMOKE) win.show(); else win.showInactive();

  refreshTimer = setInterval(() => notifyRenderer('refresh'), REFRESH_MS);
  powerMonitor.on('resume', () => notifyRenderer('refresh'));
  if (SMOKE) runSmoke();
}

// ---------- 冒烟测试（示例模式下驱动真实界面并截图） ----------
async function runSmoke() {
  const out = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(out, { recursive: true });
  const js = code => win.webContents.executeJavaScript(code);
  const snap = async name => fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  try {
    const result = await js(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
      const assert = (v, m) => { if (!v) throw new Error(m); };
      for (let i = 0; i < 50 && !$$('.task').length; i++) await wait(100);
      assert(!window.require && !window.process, 'renderer isolation');
      assert($$('.cell').length === 42, 'month grid has 42 cells');
      assert($$('.cell .dot').length > 0, 'month grid shows event dots');
      assert($$('.agenda-item').length >= 4, 'agenda lists today events');
      assert($$('.task').length === 5, 'tasks rendered');
      const monthTitle = $('#title').textContent;
      $('#next').click(); await wait(150);
      assert($('#title').textContent !== monthTitle, 'month navigation');
      $('#today').click(); await wait(150);
      $('.agenda-item').click(); assert($('#detail').open, 'event detail opens'); $('#detail-close').click();
      $('.task .check').click(); await wait(250);
      assert($$('.task').length === 5 && $$('.task.done').length === 1, 'completed task stays, struck through');
      assert(getComputedStyle($('.task.done .t-title')).textDecorationStyle === 'dashed', 'dashed strikethrough');
      assert($$('.agenda-task.done').length >= 2, 'completed tasks stay in month agenda');
      const doneRow = $('.agenda-task.done'); doneRow.querySelector('.check').click(); await wait(250);
      assert($$('.agenda-task.done').length >= 1 && (await desk.tasks()).data.filter(t => t.completed).length === 3, 'completed task can be reopened');
      [...$$('.agenda-task')].find(r => r.textContent.includes('晨跑')).querySelector('.check').click(); await wait(250);
      assert((await desk.tasks()).data.filter(t => t.completed).length === 4, 'task completed again');
      $('#nt-title').value = '测试新任务'; $('#nt-time').value = '16:30';
      $('#new-task').requestSubmit(); await wait(350);
      assert($$('.task').length === 7, 'new task added via form');
      assert([...$$('.agenda-task')].some(r => r.textContent.includes('测试新任务') && r.textContent.includes('16:30')), 'new task shown in month agenda');
      assert($('#nt-title').value === '', 'form cleared after adding');
      const rowOf = title => [...$$('.task')].find(r => r.querySelector('.t-title').textContent === title);
      const delBtn = rowOf('整理读书笔记').querySelector('.t-del');
      delBtn.click(); await wait(50);
      assert(rowOf('整理读书笔记') && delBtn.classList.contains('confirm'), 'task delete asks for confirmation');
      delBtn.click(); await wait(250);
      assert(!rowOf('整理读书笔记') && !(await desk.tasks()).data.some(t => t.title === '整理读书笔记'), 'task deleted from list');
      rowOf('预订机票').querySelector('.task-body').click(); await wait(100);
      assert($('#detail').open && !$('#detail-delete').hidden && $('#detail-edit').hidden, 'task details show delete');
      $('#detail-delete').click(); await wait(50); $('#detail-delete').click(); await wait(300);
      assert(!rowOf('预订机票') && !$('#detail').open && !(await desk.tasks()).data.some(t => t.title === '预订机票'), 'task deleted from details');
      $('[data-view=week]').click(); await wait(300);
      assert($$('.wk-day').length === 7 && $$('.wk-col').length === 7, 'week view has 7 columns');
      assert([...$$('.wk-lunar')].every(n => n.textContent), 'lunar dates shown');
      assert($$('.wk-bar').length >= 3, 'all-day lane shows spanning bars and tasks');
      assert($$('.wk-bar.after').length >= 1, 'bar continuing into next week is marked');
      assert($$('.wk-block').length >= 6, 'timed events on week grid');
      assert($$('#wk-grid .task-block').length === 3, 'timed tasks drawn on week grid');
      assert($$('.wk-bar.done').length >= 2 && $$('#wk-grid .block.done').length === 1, 'completed tasks struck through on week view');
      assert($('.wk-now'), 'now line in week view');
      assert(window.innerWidth >= 590, 'window widened for week view');
      const weekTitle = $('#title').textContent;
      $('#next').click(); await wait(200);
      assert($('#title').textContent !== weekTitle, 'week navigation');
      $('#today').click(); await wait(250);
      assert((await desk.state()).data.prefs.view === 'week', 'week preference saved');
      $$('.wk-day')[0].click(); await wait(250);
      assert(!$('#day-view').hidden, 'header click opens day view');
      $('#today').click(); await wait(200);
      $('[data-view=month]').click(); await wait(150);
      $('[data-view=day]').click(); await wait(250);
      assert($$('#timeline .hour').length === 24, 'day timeline has 24 hours');
      assert($$('#timeline .block').length === 8, 'timed events + timed tasks on timeline');
      assert($$('#timeline .task-block').length === 3, 'timed tasks drawn on day timeline');
      assert($$('#timeline .block.done').length === 1 && $$('.allday .chip.done').length >= 1, 'completed tasks struck through on day view');
      assert([...$$('#timeline .block')].some(b => b.dataset.columns === '2'), 'overlapping events split into columns');
      assert($('#timeline .now-line'), 'now line on today');
      assert($$('.allday .chip').length >= 2, 'all-day row shows events and tasks');
      const dayTitle = $('#title').textContent;
      $('#prev').click(); await wait(150);
      assert($('#title').textContent !== dayTitle, 'day navigation');
      $('#today').click(); await wait(250);
      assert((await desk.state()).data.prefs.view === 'day', 'view preference saved');

      // ---- 日程编辑：新建 / 拖动 / 调整 / 拖出新建 / 只读 / 删除 ----
      const fire = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
      const dragBy = async (node, dx, dy) => {
        const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(8, r.height / 2);
        fire(node, 'pointerdown', x, y); fire(window, 'pointermove', x + dx / 2, y + dy / 2); fire(window, 'pointermove', x + dx, y + dy);
        fire(window, 'pointerup', x + dx, y + dy); await wait(300);
      };
      const eventsNow = async () => (await desk.events('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).data;
      const byTitle = async title => (await eventsNow()).find(e => e.title === title);
      const blockOf = title => [...$$('#timeline .block')].find(b => b.querySelector('.b-title').textContent === title);
      const hm = iso => new Date(iso).toTimeString().slice(0, 5);

      $('#new-event-btn').click(); await wait(200);
      assert($('#editor').open, 'new event dialog opens');
      $('#ev-title').value = '新日程测试'; $('#ev-start-time').value = '18:00'; $('#ev-end-time').value = '19:00';
      $('#editor-form').requestSubmit(); await wait(300);
      assert(!$('#editor').open && blockOf('新日程测试'), 'new event created and shown on timeline');
      assert(hm((await byTitle('新日程测试')).start) === '18:00', 'new event saved with chosen time');

      await dragBy(blockOf('晨会'), 0, 48);   // 下移 1 小时
      let moved = await byTitle('晨会');
      assert(hm(moved.start) === '10:30' && hm(moved.end) === '11:00', 'drag moves event by one hour');
      assert(!$('#detail').open, 'drag does not open details');
      await dragBy(blockOf('晨会').querySelector('.resize-handle'), 0, 24);   // 结束时间 +30 分钟
      moved = await byTitle('晨会');
      assert(hm(moved.start) === '10:30' && hm(moved.end) === '11:30', 'drag bottom edge changes end time');
      await dragBy([...$$('#timeline .task-block')].find(b => b.textContent.includes('确认发布清单')), 0, 48);
      assert((await desk.tasks()).data.find(t => t.title === '确认发布清单').time === '16:00', 'drag moves timed task');

      const tl = $('#timeline').getBoundingClientRect();
      fire($('#timeline'), 'pointerdown', tl.left + 200, tl.top + 20 * 48 + 2);
      fire(window, 'pointermove', tl.left + 200, tl.top + 21 * 48);
      fire(window, 'pointermove', tl.left + 200, tl.top + 21.5 * 48);
      fire(window, 'pointerup', tl.left + 200, tl.top + 21.5 * 48); await wait(300);
      assert($('#editor').open && $('#ev-start-time').value === '20:00' && $('#ev-end-time').value === '21:30', 'drag on empty space opens editor with that range');
      $('#ev-cancel').click(); await wait(100);

      blockOf('新日程测试').click(); await wait(100);
      assert($('#detail').open && !$('#detail-edit').hidden && !$('#detail-delete').hidden, 'editable event shows edit/delete');
      $('#detail-edit').click(); await wait(150);
      assert($('#editor').open && $('#ev-title').value === '新日程测试', 'edit opens editor with event data');
      $('#ev-title').value = '新日程测试（改）'; $('#editor-form').requestSubmit(); await wait(300);
      assert(await byTitle('新日程测试（改）'), 'event edited');
      blockOf('新日程测试（改）').click(); await wait(100);
      $('#detail-delete').click(); await wait(50);
      assert($('#detail').open && $('#detail-delete').textContent.includes('确认'), 'delete asks for confirmation');
      $('#detail-delete').click(); await wait(300);
      assert(!(await byTitle('新日程测试（改）')) && !blockOf('新日程测试（改）'), 'event deleted');

      $('[data-view=week]').click(); await wait(300);
      const holiday = [...$$('.wk-bar')].find(b => b.textContent.includes('重阳节'));
      holiday.click(); await wait(100);
      assert($('#detail').open && $('#detail-edit').hidden && $('#detail-delete').hidden && !$('#detail-note').hidden, 'read-only calendar cannot be edited');
      $('#detail-close').click();
      const wkBlock = [...$$('#wk-grid .block')].find(b => b.querySelector('.b-title').textContent === '午餐');
      const colW = ($('#wk-grid').getBoundingClientRect().width - 40) / 7;
      const lunchDay = (await byTitle('午餐')).start;
      const dir = (new Date().getDay() + 6) % 7 === 0 ? 1 : -1;   // 周一往后拖，其他往前拖
      await dragBy(wkBlock, dir * colW, 0);
      assert(new Date((await byTitle('午餐')).start).getDate() === new Date(new Date(lunchDay).getTime() + dir * 864e5).getDate(), 'week view drag moves event to another day');
      $('[data-view=day]').click(); await wait(250);
      return 'ok';
    })()`);
    await snap('day.png');
    await js(`document.querySelector('#timeline-scroll').scrollTop = 9 * 48; new Promise(r => setTimeout(r, 100))`);
    await snap('day-morning.png');
    await js(`document.querySelector('[data-view=week]').click(); new Promise(r => setTimeout(r, 400))`);
    await snap('week.png');
    await js(`(() => {
      const g = document.querySelector('#wk-grid'), r = g.getBoundingClientRect(), x = r.left + 40 + (r.width - 40) / 7 * 6.5;
      document.querySelector('#wk-scroll').scrollTop = 13 * 48;
      const y0 = r.top - 0 + 14 * 48, fire = (t, type, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: g.getBoundingClientRect().top + y, button: 0 }));
      fire(g, 'pointerdown', 14 * 48 + 2); fire(window, 'pointermove', 15 * 48); fire(window, 'pointermove', 15.5 * 48); fire(window, 'pointerup', 15.5 * 48);
      document.querySelector('#ev-title').value = '和朋友喝咖啡';
      return new Promise(r => setTimeout(r, 300));
    })()`);
    await snap('editor.png');
    await js(`document.querySelector('#ev-cancel').click()`);
    await js(`document.querySelector('[data-view=month]').click(); new Promise(r => setTimeout(r, 300))`);
    await snap('month.png');
    await js(`document.querySelector('#settings-btn').click(); new Promise(r => setTimeout(r, 200))`);
    await snap('settings.png');
    console.log(`SMOKE PASS (${result}) → ${out}`);
    app.exit(0);
  } catch (error) {
    console.error('SMOKE FAIL:', error.message);
    app.exit(1);
  }
}

// ---------- 启动 ----------
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadPrefs(); if (!DEMO) loadSecrets(); buildClient(); registerIpc();
    return createWindow();
  }).catch(error => { console.error(error); app.exit(1); });
  app.on('before-quit', () => { quitting = true; clearInterval(refreshTimer); authAbort?.abort(); });
  app.on('window-all-closed', () => {});
}
