const { dayKey, parseKey, addDays, monthGrid, weekDays, occursOn, eventsOn, layoutDay, layoutAllDay, lunarLabel } = window.CalendarCore;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const HOUR = 48; // 日视图每小时的高度（px）
const tr = window.I18N.t;
const isZh = () => window.I18N.getLang() === 'zh';

// 日期格式随语言变化，切换语言时重新创建
let timeFmt, longFmt, weekdayFmt, dayFmt, monthFmt, monthDayFmt;
function setupFormats() {
  const loc = window.I18N.locale();
  timeFmt = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  longFmt = new Intl.DateTimeFormat(loc, { month: 'long', day: 'numeric', weekday: 'long' });
  weekdayFmt = new Intl.DateTimeFormat(loc, { weekday: 'short' });
  dayFmt = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', weekday: 'short' });   // 10月23日周五 / Fri, Oct 23
  monthFmt = new Intl.DateTimeFormat(loc, { year: 'numeric', month: isZh() ? 'long' : 'short' }); // 2026年10月 / Oct 2026
  monthDayFmt = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric' });                // 10月19日 / Oct 19
}

// 切换语言：填入静态文案、重建日期格式、月视图星期表头
function applyLanguage(lang) {
  window.I18N.setLang(lang);
  window.I18N.applyDom(document);
  setupFormats();
  const monday = weekDays('2026-10-19')[0];
  $('#weekdays').replaceChildren(...Array.from({ length: 7 }, (_, i) => el('span', null,
    isZh() ? weekdayFmt.format(addDays(monday, i)).replace('周', '') : weekdayFmt.format(addDays(monday, i)))));
}

let app = null;              // 主进程状态
let view = 'month';
let selected = dayKey(new Date());
let events = [], tasks = [];
let loadedRange = '';
let taskFilter = 'all';
let loadToken = 0, toastTimer;

// ---------- 工具 ----------
async function call(promise) { const r = await promise; if (!r.ok) throw new Error(r.error); return r.data; }
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }
function toast(message) { const t = $('#toast'); t.textContent = message; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }
const report = error => toast(error.message || tr('err.generic'));
const todayKey = () => dayKey(new Date());
const shortDate = key => { const d = parseKey(key); return `${d.getMonth() + 1}/${d.getDate()}`; };

function rangeFor(key) {
  const d = parseKey(key), grid = monthGrid(d.getFullYear(), d.getMonth());
  return { timeMin: grid[0].toISOString(), timeMax: addDays(grid[41], 1).toISOString() };
}

// 有完成时间的任务转成时间轴上的条目（占 30 分钟），和日程一起参与重叠分列。
const TASK_COLOR = '#81c995';
// 任务在日历上的日期：截止日期；已完成但没有截止日期的，用完成那天。
const taskDay = t => t.due || (t.completed && t.completedAt ? dayKey(new Date(t.completedAt)) : null);
const tasksOn = key => tasks.filter(t => taskDay(t) === key);
function taskEvents() {
  return tasks.filter(t => t.due && t.time).map(t => {
    const [h, m] = t.time.split(':').map(Number), start = parseKey(t.due);
    start.setHours(h, m, 0, 0);
    return { id: `task:${t.id}`, title: `✓ ${t.title}`, allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 30 * 60000).toISOString(), color: TASK_COLOR, location: '', task: t };
  });
}
const timelineItems = () => [...events, ...taskEvents()];
const openItem = item => (item.task ? openTask(item.task) : openEvent(item));

// 能否拖动：未完成的任务；可写日历上的日程（且已授予编辑权限）。
const canDrag = item => (item.task ? !item.task.completed : Boolean(item.editable && app?.canEdit));

// 时间轴条目的通用设置：点击打开详情（拖动结束时忽略这次点击），可拖动的加上调整结束时间的把手。
function decorateBlock(block, item, key, col) {
  Object.assign(block, { _item: item, _day: key, _col: col });
  block.classList.toggle('pending', Boolean(item.pending || item.task?.pending));
  block.addEventListener('click', () => { if (block._dragged) { block._dragged = false; return; } openItem(item); });
  if (!canDrag(item)) return;
  block.classList.add('draggable');
  if (!item.task) block.append(el('span', 'resize-handle'));
}

function eventTimeLabel(event, key) {
  if (event.task) return `⏰ ${event.task.time}`;
  if (event.allDay) return tr('time.allDay');
  const s = new Date(event.start), e = new Date(event.end);
  const from = dayKey(s) === key ? timeFmt.format(s) : tr('time.prevDay');
  const to = dayKey(e) === key || (e - parseKey(key)) === 864e5 ? timeFmt.format(e) : tr('time.nextDay');
  return `${from} – ${to}`;
}

function dueLabel(due, time) {
  if (!due) return { text: tr('due.none'), cls: '' };
  const t = todayKey(), at = time ? ` ${time}` : '';
  if (due < t) return { text: tr('due.overdue', { date: `${shortDate(due)}${at}` }), cls: 'overdue' };
  if (due === t) {
    const late = time && time < timeFmt.format(new Date());
    return { text: `${tr('due.today')}${at}`, cls: late ? 'overdue' : 'today' };
  }
  if (due === dayKey(addDays(new Date(), 1))) return { text: `${tr('due.tomorrow')}${at}`, cls: '' };
  return { text: `${shortDate(due)}${at}`, cls: '' };
}

const sortTasks = list => list.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99'));

// ---------- 数据 ----------
async function load(force = false) {
  if (!app?.connected) { events = []; tasks = []; render(); return; }
  const { timeMin, timeMax } = rangeFor(selected), key = `${timeMin}|${timeMax}`;
  if (!force && key === loadedRange) { render(); return; }
  const token = ++loadToken;
  // 先用本地缓存立即显示，再联网更新
  if (key !== loadedRange) {
    try {
      const cached = await call(desk.cached(timeMin, timeMax));
      if (token === loadToken) { events = cached.events; tasks = cached.tasks; loadedRange = key; render(); }
    } catch { /* 没有缓存时直接等联网结果 */ }
  }
  $('#refresh-btn').classList.add('spin');
  try {
    const [ev, ts] = await Promise.all([call(desk.events(timeMin, timeMax)), call(desk.tasks(timeMin, timeMax))]);
    if (token !== loadToken) return;
    events = ev; tasks = ts; loadedRange = key;
    if (force) recentlyDone.clear();
    if (force || !$('#nt-list').options.length) loadTaskLists();
    app = await call(desk.state());
  } catch (error) { report(error); }
  finally { if (token === loadToken) $('#refresh-btn').classList.remove('spin'); }
  render();
}

async function refreshState(initial = false) {
  app = await call(desk.state());
  if (initial) view = app.prefs.view;
  // 语言变化（设置里切换或跟随系统）：重新填文案并重绘
  if (initial || app.lang !== window.I18N.getLang()) { applyLanguage(app.lang); if (!initial) render(); }
  renderChrome();
}

// 后台补传完成（离线新建的条目换成了真实 ID 等）：从本地缓存重新读取并重绘
async function reloadFromCache() {
  if (!loadedRange || drag) return;
  const [timeMin, timeMax] = loadedRange.split('|');
  try {
    const cached = await call(desk.cached(timeMin, timeMax));
    events = cached.events; tasks = cached.tasks;
    app = await call(desk.state());
    render();
  } catch (error) { report(error); }
}

// ---------- 渲染 ----------
function render() {
  renderChrome();
  const connected = app?.connected;
  $('#welcome').hidden = connected;
  $('#month-view').hidden = !connected || view !== 'month';
  $('#week-view').hidden = !connected || view !== 'week';
  $('#day-view').hidden = !connected || view !== 'day';
  $('#tasks').hidden = !connected;
  if (!connected) return;
  if (view === 'month') { renderMonth(); renderAgenda(); } else if (view === 'week') renderWeek(); else renderDay();
  syncTaskForm();
  renderTasks();
}

function renderChrome() {
  const now = new Date();
  $('#today-label').textContent = dayFmt.format(now);
  const d = parseKey(selected);
  const week = weekDays(selected), [w0, w6] = [week[0], week[6]];
  // 周标题：同月只写一次月份（10月19日 – 25日 / Oct 19 – 25）
  const weekEnd = w6.getMonth() !== w0.getMonth() ? monthDayFmt.format(w6) : isZh() ? `${w6.getDate()}日` : String(w6.getDate());
  $('#title').textContent = view === 'month' ? monthFmt.format(d) : view === 'week' ? `${monthDayFmt.format(w0)} – ${weekEnd}` : dayFmt.format(d);
  const labels = { month: ['nav.prevMonth', 'nav.nextMonth'], week: ['nav.prevWeek', 'nav.nextWeek'], day: ['nav.prevDay', 'nav.nextDay'] }[view];
  $('#prev').setAttribute('aria-label', tr(labels[0]));
  $('#next').setAttribute('aria-label', tr(labels[1]));
  $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  if (!app) return;
  const p = app.prefs;
  $('#pin-btn').setAttribute('aria-pressed', String(p.pinned));
  $('#pref-pinned').checked = p.pinned;
  $('#pref-autostart').checked = p.autoStart;
  $('#pref-opacity').value = p.opacity;
  $('#pref-lang').value = p.lang || 'auto';
  $('#opacity-out').textContent = `${p.opacity}%`;
  $('#tasks').classList.toggle('collapsed', p.tasksCollapsed);
  $('#tasks-toggle').setAttribute('aria-expanded', String(!p.tasksCollapsed));

  let text;
  const demo = app.demo ? tr('status.demoPrefix') : '';
  if (app.authorizing) text = tr('status.authorizing');
  else if (app.offline) text = `${demo}${tr('status.offline')}${app.pending ? tr('status.offlinePending', { n: app.pending }) : ''}`;
  else if (app.pending) text = `${demo}${tr('status.syncing', { n: app.pending })}`;
  else if (app.error) text = `${demo}⚠ ${app.error}`;
  else if (app.demo) text = tr('status.demo');
  else if (!app.connected) text = tr('status.signedOut');
  else text = `${app.account || tr('status.signedIn')}${app.lastSync ? tr('status.synced', { time: timeFmt.format(new Date(app.lastSync)) }) : ''}`;
  $('#status-text').textContent = text;
  $('#status-text').title = text;
  $('#status-text').classList.toggle('error', Boolean(app.error));

  $('#account-status').textContent = app.demo ? tr('account.demo') : app.connected ? tr('account.signedIn', { account: app.account || tr('account.googleAccount') }) : app.hasClient ? tr('account.hasClient') : tr('account.setup');
  $('#setup-steps').hidden = app.connected;
  $('#import-btn').textContent = tr(app.hasClient ? 'btn.importChange' : 'btn.import');
  $('#import-btn').hidden = app.demo;
  $('#connect-btn').hidden = app.connected || app.authorizing;
  $('#connect-btn').disabled = !app.hasClient;
  $('#cancel-btn').hidden = !app.authorizing;
  $('#disconnect-btn').hidden = !app.connected || app.demo;
}

function renderMonth() {
  const d = parseKey(selected), month = d.getMonth(), today = todayKey();
  const frag = document.createDocumentFragment();
  for (const date of monthGrid(d.getFullYear(), month)) {
    const key = dayKey(date), cell = el('button', 'cell');
    cell.classList.toggle('outside', date.getMonth() !== month);
    cell.classList.toggle('weekend', date.getDay() === 0 || date.getDay() === 6);
    cell.classList.toggle('today', key === today);
    cell.classList.toggle('selected', key === selected);
    cell.setAttribute('aria-label', longFmt.format(date));
    cell.append(el('span', 'num', date.getDate()));
    const dots = el('span', 'dots');
    const dayEvents = events.filter(e => occursOn(e, key));
    for (const e of dayEvents.slice(0, 3)) { const dot = el('i', 'dot'); dot.style.background = e.color; dots.append(dot); }
    if (dayEvents.length > 3) dots.append(el('i', 'more', '+'));
    const dayTasks = tasksOn(key);
    if (dayTasks.length) dots.append(el('i', `dot task-dot${dayTasks.every(t => t.completed) ? ' done' : ''}`));
    cell.append(dots);
    cell.addEventListener('click', () => select(key));
    cell.addEventListener('dblclick', () => { select(key); setView('day'); });
    frag.append(cell);
  }
  $('#grid').replaceChildren(frag);
}

function renderAgenda() {
  const list = eventsOn(events, selected);
  const dayTasks = sortTasks(tasksOn(selected));
  const doneCount = dayTasks.filter(t => t.completed).length;
  $('#agenda-title').textContent = selected === todayKey() ? tr('agenda.today') : longFmt.format(parseKey(selected));
  $('#agenda-count').textContent = [list.length && tr('agenda.events', { n: list.length }), dayTasks.length && tr('agenda.tasksDone', { done: doneCount, total: dayTasks.length })].filter(Boolean).join(' · ');
  const box = $('#agenda-list'); box.replaceChildren();
  if (!list.length && !dayTasks.length) { box.append(el('p', 'empty', tr('agenda.empty'))); return; }
  // 当天到期的任务排在日程后面，可直接勾选完成。
  const taskRows = [];
  for (const task of dayTasks) {
    const row = el('div', `agenda-item agenda-task${task.completed ? ' done' : ''}${task.pending ? ' pending' : ''}`);
    const check = checkButton(task, row);
    const body = el('button', 'a-body');
    body.append(el('span', 'a-title', task.title), el('span', 'a-meta', task.listTitle));
    body.addEventListener('click', () => openTask(task));
    row.append(el('span', 'a-time', task.time ? `⏰ ${task.time}` : tr('agenda.task')), check, body);
    taskRows.push(row);
  }
  const now = Date.now();
  for (const e of list) {
    const item = el('button', 'agenda-item');
    item.classList.toggle('pending', Boolean(e.pending));
    item.style.setProperty('--c', e.color);
    const time = el('span', 'a-time', eventTimeLabel(e, selected));
    const body = el('span', 'a-body');
    body.append(el('span', 'a-title', e.title));
    if (e.location) body.append(el('span', 'a-meta', e.location));
    item.append(time, body);
    if (!e.allDay && new Date(e.start) <= now && new Date(e.end) > now) item.append(el('span', 'live', tr('live')));
    item.addEventListener('click', () => openEvent(e));
    box.append(item);
  }
  box.append(...taskRows);
}

function renderDay(scroll = false) {
  const allDayEvents = eventsOn(events, selected).filter(e => e.allDay);
  const dueTasks = tasksOn(selected).filter(t => !(t.due && t.time));
  const allday = $('#allday'); allday.replaceChildren();
  allday.hidden = !allDayEvents.length && !dueTasks.length;
  for (const e of allDayEvents) {
    const chip = el('button', `chip${e.pending ? ' pending' : ''}`, e.title); chip.style.setProperty('--c', e.color); chip.title = e.title;
    chip.addEventListener('click', () => openEvent(e)); allday.append(chip);
  }
  for (const t of dueTasks) {
    const chip = el('button', `chip task-chip${t.completed ? ' done' : ''}${t.pending ? ' pending' : ''}`, `✓ ${t.title}`); chip.title = t.title;
    chip.addEventListener('click', () => openTask(t)); allday.append(chip);
  }

  const timeline = $('#timeline'), scroller = $('#timeline-scroll'), keep = scroller.scrollTop;
  timeline.replaceChildren();
  timeline.style.height = `${24 * HOUR}px`;
  for (let h = 0; h < 24; h++) {
    const row = el('div', 'hour'); row.style.top = `${h * HOUR}px`;
    row.append(el('span', null, `${String(h).padStart(2, '0')}:00`));
    timeline.append(row);
  }
  for (const b of layoutDay(timelineItems(), selected)) {
    const e = b.event, block = el('button', 'block');
    block.style.setProperty('--c', e.color);
    block.style.top = `${b.top / 60 * HOUR}px`;
    block.style.height = `${Math.max(18, (b.bottom - b.top) / 60 * HOUR - 2)}px`;
    block.style.left = `calc(48px + (100% - 52px) * ${b.column} / ${b.columns})`;
    block.style.width = `calc((100% - 52px) / ${b.columns} - 3px)`;
    block.dataset.columns = String(b.columns);
    block.classList.toggle('task-block', Boolean(e.task));
    block.classList.toggle('done', Boolean(e.task?.completed));
    block.classList.toggle('short', b.bottom - b.top < 40);
    block.append(el('span', 'b-title', e.title), el('span', 'b-time', `${eventTimeLabel(e, selected)}${e.location ? ` · ${e.location}` : ''}`));
    block.title = `${e.title}\n${eventTimeLabel(e, selected)}`;
    decorateBlock(block, e, selected, 0);
    timeline.append(block);
  }
  if (selected === todayKey()) {
    const now = new Date(), line = el('div', 'now-line');
    line.style.top = `${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR}px`;
    timeline.append(line);
  }
  if (scroll) {
    // 今天滚到当前时间，其他日期滚到第一个日程，没有日程则从 8 点开始。
    const marker = timeline.querySelector('.now-line') || timeline.querySelector('.block');
    scroller.scrollTop = marker ? Math.max(0, parseFloat(marker.style.top) - HOUR * 1.5) : 8 * HOUR;
  } else scroller.scrollTop = keep;
}

// 周视图：表头（星期 + 日期 + 农历）、全天栏（跨天长条 + 到期任务）、7 列时间网格。
const WEEK_GUTTER = 40;
const colLeft = (index, fraction = 0) => `calc(${WEEK_GUTTER}px + (100% - ${WEEK_GUTTER}px) * ${(index + fraction) / 7})`;
const colWidth = (fraction, minus) => `calc((100% - ${WEEK_GUTTER}px) * ${fraction / 7} - ${minus}px)`;

function renderWeek(scroll = false) {
  const days = weekDays(selected), keys = days.map(dayKey), today = todayKey();

  const head = $('#wk-head'); head.replaceChildren(el('span', 'wk-corner'));
  days.forEach((date, i) => {
    const cell = el('button', 'wk-day');
    cell.classList.toggle('today', keys[i] === today);
    cell.classList.toggle('selected', keys[i] === selected);
    cell.classList.toggle('weekend', i >= 5);
    cell.setAttribute('aria-label', tr('week.openDay', { date: longFmt.format(date) }));
    // 农历只在中文界面显示
    const lunar = isZh() ? lunarLabel(date) : '';
    cell.append(el('span', 'wk-dow', isZh() ? weekdayFmt.format(date).replace('周', '') : weekdayFmt.format(date)), el('span', 'wk-num', date.getDate()), el('span', `wk-lunar${lunar.endsWith('月') ? ' month' : ''}`, lunar));
    cell.addEventListener('click', () => { select(keys[i]); setView('day'); });
    head.append(cell);
  });

  // 全天栏：全天日程 + 有截止日期的任务（作为单日条目）
  const items = [
    ...events.filter(e => e.allDay),
    ...tasks.filter(t => !(t.due && t.time) && taskDay(t) >= keys[0] && taskDay(t) <= keys[6])
      .map(t => ({ task: t, title: `✓ ${t.title}`, startKey: taskDay(t), endKey: taskDay(t) })),
  ];
  const { segments, rows } = layoutAllDay(items, days);
  const lane = $('#wk-allday'); lane.replaceChildren();
  lane.hidden = !rows;
  lane.style.height = `${rows * 22 + 6}px`;
  for (const s of segments) {
    const { item } = s, bar = el('button', `wk-bar${item.task ? ' task-chip' : ''}`, item.title);
    if (!item.task) bar.style.setProperty('--c', item.color);
    bar.classList.toggle('before', s.before);
    bar.classList.toggle('after', s.after);
    bar.classList.toggle('done', Boolean(item.task?.completed));
    bar.classList.toggle('pending', Boolean(item.pending || item.task?.pending));
    bar.style.left = colLeft(s.start);
    bar.style.width = colWidth(s.span, 3);
    bar.style.top = `${s.row * 22 + 2}px`;
    bar.title = item.title;
    bar.addEventListener('click', () => item.task ? openTask(item.task) : openEvent(item));
    lane.append(bar);
  }

  const grid = $('#wk-grid'), scroller = $('#wk-scroll'), keep = scroller.scrollTop;
  grid.replaceChildren();
  grid.style.height = `${24 * HOUR}px`;
  for (let h = 0; h < 24; h++) {
    const row = el('div', 'hour wk-hour'); row.style.top = `${h * HOUR}px`;
    if (h) row.append(el('span', null, `${String(h).padStart(2, '0')}:00`));
    grid.append(row);
  }
  for (let i = 0; i < 7; i++) {
    const col = el('div', 'wk-col'); col.style.left = colLeft(i); col.style.width = colWidth(1, 0);
    col.classList.toggle('today', keys[i] === today);
    grid.append(col);
  }
  keys.forEach((key, i) => {
    for (const b of layoutDay(timelineItems(), key)) {
      const e = b.event, block = el('button', 'block wk-block');
      block.style.setProperty('--c', e.color);
      block.style.top = `${b.top / 60 * HOUR}px`;
      block.style.height = `${Math.max(16, (b.bottom - b.top) / 60 * HOUR - 2)}px`;
      block.style.left = colLeft(i, b.column / b.columns);
      block.style.width = colWidth(1 / b.columns, 2);
      block.dataset.columns = String(b.columns);
      block.classList.toggle('task-block', Boolean(e.task));
      block.classList.toggle('done', Boolean(e.task?.completed));
      block.classList.toggle('short', b.bottom - b.top < 45);
      block.append(el('span', 'b-title', e.title), el('span', 'b-time', eventTimeLabel(e, key)));
      block.title = `${e.title}\n${eventTimeLabel(e, key)}${e.location ? `\n${e.location}` : ''}`;
      decorateBlock(block, e, key, i);
      grid.append(block);
    }
  });
  const todayIndex = keys.indexOf(today);
  if (todayIndex >= 0) {
    const now = new Date(), line = el('div', 'now-line wk-now');
    line.style.top = `${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR}px`;
    line.style.left = colLeft(todayIndex);
    line.style.width = colWidth(1, 0);
    grid.append(line);
  }
  if (scroll) {
    // 本周含今天则滚到当前时间，否则滚到本周最早的日程，没有日程从 8 点开始。
    const nowLine = grid.querySelector('.now-line');
    const earliest = Math.min(...[...grid.querySelectorAll('.block')].map(b => parseFloat(b.style.top)));
    const target = nowLine ? parseFloat(nowLine.style.top) : Number.isFinite(earliest) ? earliest : 8 * HOUR + HOUR * 1.5;
    scroller.scrollTop = Math.max(0, target - HOUR * 1.5);
  } else scroller.scrollTop = keep;
}

function renderTasks() {
  const t = todayKey();
  // “全部 / 今天及逾期”只列未完成的；“所选日期”列出当天全部任务，已完成的划掉显示。
  // 刚在本次会话中勾选完成的任务保留在列表里（划掉），方便误点后恢复，下次刷新后才隐藏。
  const open = tasks.filter(task => !task.completed || recentlyDone.has(task.id));
  const filtered = taskFilter === 'selected' ? sortTasks(tasksOn(selected))
    : open.filter(task => taskFilter === 'all' || (task.due && task.due <= t));
  $('#tasks-count').textContent = tasks.filter(task => !task.completed).length || '';
  $$('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === taskFilter)));
  $('[data-filter=selected]').textContent = selected === t ? tr('tasks.selectedToday') : tr('tasks.selectedDate', { date: shortDate(selected) });
  const box = $('#task-list'); box.replaceChildren();
  if (!filtered.length) { box.append(el('p', 'empty', tr(taskFilter === 'selected' ? 'tasks.emptyDay' : open.length ? 'tasks.emptyFilter' : 'tasks.allDone'))); return; }
  for (const task of filtered) {
    const row = el('div', `task${task.completed ? ' done' : ''}${task.pending ? ' pending' : ''}`);
    const check = checkButton(task, row);
    const body = el('button', 'task-body');
    body.append(el('span', 't-title', task.title), el('span', 't-meta', `${task.listTitle}${task.notes ? tr('tasks.hasNotes') : ''}`));
    body.addEventListener('click', () => openTask(task));
    const due = task.completed ? { text: tr('tasks.done'), cls: 'done' } : dueLabel(task.due, task.time);
    const del = el('button', 't-del', '🗑'); del.title = tr('tasks.delete'); del.setAttribute('aria-label', tr('tasks.deleteAria', { title: task.title }));
    del.addEventListener('click', () => confirmThen(del, tr('tasks.confirmShort'), () => removeTask(task)));
    row.append(check, body, el('span', `t-due ${due.cls}`, due.text), del);
    box.append(row);
  }
}

// ---------- 交互 ----------
function select(key) {
  const changedMonth = key.slice(0, 7) !== selected.slice(0, 7);
  selected = key;
  if (changedMonth) load(); else render();
}

async function setView(next) {
  if (next === view) return;
  view = next;
  if (view === 'week') await desk.fitWidth(600); // 周视图需要更宽的窗口
  render();
  scrollToFocus();
  try { app = await call(desk.setPrefs({ view })); } catch (error) { report(error); }
}

function scrollToFocus() {
  if (view === 'day') renderDay(true);
  else if (view === 'week') renderWeek(true);
}

function step(direction) {
  const d = parseKey(selected);
  if (view === 'month') {
    const target = new Date(d.getFullYear(), d.getMonth() + direction, 1);
    // 切换到今天所在的月份时直接选中今天，否则选中 1 号。
    select(target.getFullYear() === new Date().getFullYear() && target.getMonth() === new Date().getMonth() ? todayKey() : dayKey(target));
  } else {
    select(dayKey(addDays(d, direction * (view === 'week' ? 7 : 1))));
    scrollToFocus();
  }
}

// 勾选框：未完成 → 完成；已完成 → 恢复为未完成。
function checkButton(task, row) {
  const check = el('button', 'check');
  check.title = tr(task.completed ? 'tasks.reopen' : 'tasks.markDone');
  check.setAttribute('aria-label', `${check.title}：${task.title}`);
  check.addEventListener('click', () => toggleTask(task, row));
  return check;
}

// 两步确认：第一次点击按钮进入确认状态（3 秒内有效），再点一次才执行。
function confirmThen(button, label, action) {
  if (button.classList.contains('confirm')) { clearTimeout(button._timer); button.classList.remove('confirm'); action(); return; }
  const original = button.textContent;
  button.classList.add('confirm'); button.textContent = label;
  button._timer = setTimeout(() => { button.classList.remove('confirm'); button.textContent = original; }, 3000);
}

async function removeTask(task) {
  try {
    await call(desk.deleteTask(task.listId, task.id));
    tasks = tasks.filter(t => t.id !== task.id && t.parent !== task.id);
    recentlyDone.delete(task.id);
    render();
    toast(tr('toast.taskDeleted', { title: task.title }));
  } catch (error) { report(error); }
}

const recentlyDone = new Set();
async function toggleTask(task, row) {
  const done = !task.completed;
  row?.classList.toggle('done', done);
  try {
    const completedAt = await call(desk.setTaskDone(task.listId, task.id, done));
    tasks = tasks.map(t => (t.id === task.id ? { ...t, completed: done, completedAt } : t));
    if (done) recentlyDone.add(task.id); else recentlyDone.delete(task.id);
    render();
    toast(tr(done ? 'toast.taskDone' : 'toast.taskReopened', { title: task.title }));
  } catch (error) { row?.classList.toggle('done', !done); report(error); }
}

let detailAction = null;
let detailEvent = null, detailTask = null;
function openDetail({ kind, title, time, meta, notes, link, task, event }) {
  $('#detail-kind').textContent = kind;
  $('#detail-title').textContent = title;
  $('#detail-time').textContent = time;
  $('#detail-meta').textContent = meta;
  $('#detail-notes').textContent = notes;
  $('#detail-open').hidden = !link;
  detailAction = link;
  $('#detail-complete').hidden = !task;
  $('#detail-complete').textContent = tr(task?.completed ? 'detail.reopen' : 'detail.complete');
  $('#detail-complete').onclick = task ? () => { $('#detail').close(); toggleTask(task, null); } : null;
  // 日程：可写日历显示“编辑 / 删除”（逻辑在 editing.js）
  detailEvent = event || null;
  const editable = Boolean(event?.editable && app?.canEdit);
  detailTask = task || null;
  $('#detail-edit').hidden = !editable;
  $('#detail-delete').hidden = !editable && !task;   // 任务总是可以删除
  $('#detail-delete').textContent = tr('detail.delete');
  $('#detail-delete').classList.remove('confirm');
  const note = event && !event.editable ? tr('note.readOnly') : event?.editable && !app?.canEdit ? tr('note.needScope') : event?.recurring ? tr('note.recurring') : '';
  $('#detail-note').textContent = note;
  $('#detail-note').hidden = !note;
  $('#detail-open').className = editable ? 'secondary' : 'primary';
  $('#detail').showModal();
}

function openEvent(e) {
  let time;
  if (e.allDay) {
    const last = dayKey(addDays(parseKey(e.endKey), -1));
    time = last > e.startKey ? `${longFmt.format(parseKey(e.startKey))} – ${longFmt.format(parseKey(last))} · ${tr('detail.allDay')}` : `${longFmt.format(parseKey(e.startKey))} · ${tr('detail.allDay')}`;
  } else {
    const s = new Date(e.start), end = new Date(e.end);
    time = dayKey(s) === dayKey(end) ? `${longFmt.format(s)} ${timeFmt.format(s)} – ${timeFmt.format(end)}` : `${longFmt.format(s)} ${timeFmt.format(s)} – ${longFmt.format(end)} ${timeFmt.format(end)}`;
  }
  openDetail({ kind: tr('kind.event'), title: e.title, time, meta: [e.location, e.calendar].filter(Boolean).join(' · '), notes: e.description, link: e.link || 'https://calendar.google.com/calendar/r', event: e });
}

function openTask(t) {
  const due = t.due ? tr('detail.due', { date: `${longFmt.format(parseKey(t.due))}${t.time ? ` ${t.time}` : ''}` }) : tr('detail.noDue');
  const done = t.completed && t.completedAt ? `　${tr('detail.completedAt', { date: `${longFmt.format(new Date(t.completedAt))} ${timeFmt.format(new Date(t.completedAt))}` })}` : t.completed ? `　${tr('detail.completed')}` : '';
  openDetail({ kind: tr(t.completed ? 'kind.taskDone' : 'kind.task'), title: t.title, time: due + done, meta: t.listTitle, notes: t.notes, link: t.link, task: t });
}

// ---------- 新建任务 ----------
// 截止日期默认跟随日历上选中的日期；用户手动改过日期后不再跟随，直到添加完成。
let dateTouched = false;
function syncTaskForm() {
  if (!dateTouched) $('#nt-date').value = selected;
  $('#nt-time').disabled = !$('#nt-date').value;
  if ($('#nt-time').disabled) $('#nt-time').value = '';
}

async function loadTaskLists() {
  try {
    const lists = await call(desk.taskLists());
    const picker = $('#nt-list'), current = picker.value;
    picker.replaceChildren(...lists.map(l => { const o = el('option', null, l.title); o.value = l.id; return o; }));
    if (lists.some(l => l.id === current)) picker.value = current;
    picker.hidden = lists.length <= 1;
  } catch (error) { report(error); }
}

async function addTask(event) {
  event.preventDefault();
  const title = $('#nt-title').value.trim();
  if (!title) return;
  $('#nt-add').disabled = true;
  try {
    const task = await call(desk.createTask({ title, due: $('#nt-date').value || null, time: $('#nt-time').value || null, listId: $('#nt-list').value }));
    tasks = sortTasks([...tasks, task]);
    $('#nt-title').value = ''; $('#nt-time').value = ''; dateTouched = false;
    render();
    toast(tr('toast.taskAdded', { title: `${task.title}${task.due ? ` (${shortDate(task.due)}${task.time ? ` ${task.time}` : ''})` : ''}` }));
  } catch (error) { report(error); }
  finally { $('#nt-add').disabled = false; $('#nt-title').focus(); }
}

function bind() {
  $('#new-task').addEventListener('submit', addTask);
  $('#nt-date').addEventListener('change', () => { dateTouched = true; syncTaskForm(); });
  $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => { taskFilter = b.dataset.filter; renderTasks(); }));
  $('#prev').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));
  $('#today').addEventListener('click', () => { select(todayKey()); scrollToFocus(); });
  $('#refresh-btn').addEventListener('click', () => load(true));
  $('#hide-btn').addEventListener('click', () => desk.hide());
  $('#pin-btn').addEventListener('click', () => updatePrefs({ pinned: !app.prefs.pinned }));
  $('#settings-btn').addEventListener('click', () => { $('#auth-error').textContent = ''; $('#settings').showModal(); });
  $$('[data-open-settings]').forEach(b => b.addEventListener('click', () => $('#settings').showModal()));
  $('#settings-close').addEventListener('click', () => $('#settings').close());
  $('#detail-close').addEventListener('click', () => $('#detail').close());
  $('#detail-open').addEventListener('click', () => detailAction && call(desk.open(detailAction)).catch(report));
  $('#open-gcal').addEventListener('click', () => call(desk.open('https://calendar.google.com/calendar/r')).catch(report));
  $$('[data-url]').forEach(b => b.addEventListener('click', () => call(desk.open(b.dataset.url)).catch(report)));
  $('#tasks-toggle').addEventListener('click', () => updatePrefs({ tasksCollapsed: !app.prefs.tasksCollapsed }));
  $('#pref-pinned').addEventListener('change', e => updatePrefs({ pinned: e.target.checked }));
  $('#pref-autostart').addEventListener('change', e => updatePrefs({ autoStart: e.target.checked }));
  $('#pref-opacity').addEventListener('input', e => { $('#opacity-out').textContent = `${e.target.value}%`; });
  $('#pref-opacity').addEventListener('change', e => updatePrefs({ opacity: Number(e.target.value) }));
  $('#pref-lang').addEventListener('change', e => updatePrefs({ lang: e.target.value }).then(() => refreshState()));

  $('#import-btn').addEventListener('click', () => authAction(desk.importClient()));
  $('#connect-btn').addEventListener('click', async () => {
    await authAction(desk.connect());
    if (app.connected) { $('#settings').close(); toast(tr('toast.signedIn')); load(true); }
  });
  $('#cancel-btn').addEventListener('click', () => authAction(desk.cancelConnect()));
  $('#disconnect-btn').addEventListener('click', async () => { await authAction(desk.disconnect()); loadedRange = ''; load(); });

  desk.onStateChanged(() => refreshState().catch(report));
  desk.onRefresh(() => load(true));
  desk.onDataChanged(() => reloadFromCache());
  // 系统报告网络恢复时立即尝试补传
  window.addEventListener('online', () => desk.syncNow().then(() => load(true)).catch(report));
  // 每 30 秒更新当前时间线；跨过零点时若正在看“今天”则跟随到新的一天。
  let lastToday = todayKey();
  setInterval(() => {
    const t = todayKey();
    if (t !== lastToday) { const follow = selected === lastToday; lastToday = t; if (follow) { select(t); return; } }
    if (app?.connected) { if (view === 'day') renderDay(); else if (view === 'week') renderWeek(); else renderAgenda(); renderChrome(); }
  }, 30_000);
}

async function authAction(promise) {
  $('#auth-error').textContent = '';
  try { app = await call(promise); } catch (error) { $('#auth-error').textContent = error.message; app = await call(desk.state()); }
  renderChrome(); render();
}

async function updatePrefs(value) {
  try { app = await call(desk.setPrefs(value)); renderChrome(); } catch (error) { report(error); }
}

(async function start() {
  bind();
  try {
    await refreshState(true);
    await load(true);
    scrollToFocus();
  } catch (error) { report(error); }
})();
