// 日程编辑：新建 / 编辑 / 删除，以及日视图、周视图时间轴上的拖动
// （拖动日程改时间、拖底边改结束时间、在空白处点击或拖出一段时间新建日程）。
// 依赖 app.js 中的全局函数和状态（events、tasks、render、HOUR 等）。
const SNAP = 15; // 拖动对齐到 15 分钟
let writableCals = [];
let editing = null; // 正在编辑的日程；null 表示新建

const pad2 = n => String(n).padStart(2, '0');
const hhmm = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function combine(key, time) { const d = parseKey(key); const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0); return d; }
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60000);

async function loadWritableCalendars() {
  try { writableCals = await call(desk.writableCalendars()); } catch (error) { report(error); }
}

function needEditPermission() {
  if (app?.canEdit) return false;
  toast(tr('note.needScope'));
  return true;
}

// ---------- 编辑对话框 ----------
async function openEditor({ event = null, start = null, end = null, allDay = false } = {}) {
  if (!app?.connected || needEditPermission()) return;
  if (!writableCals.length) await loadWritableCalendars();
  if (!event && !writableCals.length) { toast(tr('editor.noWritable')); return; }
  editing = event;
  $('#editor-heading').textContent = tr(event ? 'editor.edit' : 'editor.new');
  $('#ev-error').textContent = '';

  const picker = $('#ev-calendar');
  picker.replaceChildren(...writableCals.map(c => { const o = el('option', null, c.title); o.value = c.id; return o; }));
  if (event && !writableCals.some(c => c.id === event.calendarId)) { const o = el('option', null, event.calendar); o.value = event.calendarId; picker.append(o); }
  picker.value = event ? event.calendarId : writableCals[0].id;
  picker.disabled = Boolean(event); // 编辑时不支持换日历
  $('#ev-title').value = event?.title || '';
  $('#ev-location').value = event?.location || '';
  $('#ev-description').value = event?.description || '';
  $('#ev-recurring').hidden = !event?.recurring;

  if (event) allDay = event.allDay;
  if (allDay) {
    const startKey = event ? event.startKey : dayKey(start || parseKey(selected));
    const lastKey = event ? dayKey(addDays(parseKey(event.endKey), -1)) : startKey;
    setEditorDates(startKey, '09:00', lastKey < startKey ? startKey : lastKey, '10:00');
  } else {
    if (event) { start = new Date(event.start); end = new Date(event.end); }
    if (!start) {
      // 默认：所选日期的下一个整点（不是今天则 9 点），持续 1 小时
      const now = new Date();
      start = selected === todayKey() ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(now.getHours() + 1, 23)) : combine(selected, '09:00');
    }
    end = end || addMinutes(start, 60);
    setEditorDates(dayKey(start), hhmm(start), dayKey(end), hhmm(end));
  }
  $('#ev-allday').checked = allDay;
  syncAllDay();
  $('#editor').showModal();
  $('#ev-title').focus();
}

function setEditorDates(startKey, startTime, endKey, endTime) {
  $('#ev-start-date').value = startKey; $('#ev-start-time').value = startTime;
  $('#ev-end-date').value = endKey; $('#ev-end-time').value = endTime;
}

function syncAllDay() {
  const allDay = $('#ev-allday').checked;
  $('#ev-start-time').hidden = allDay; $('#ev-end-time').hidden = allDay;
  $('#ev-start-time').required = !allDay; $('#ev-end-time').required = !allDay;
}

function editorInput() {
  const startKey = $('#ev-start-date').value, endKeyIncl = $('#ev-end-date').value;
  const input = { title: $('#ev-title').value.trim(), location: $('#ev-location').value.trim(), description: $('#ev-description').value };
  if (!input.title) throw new Error(tr('err.titleRequired'));
  if (!startKey || !endKeyIncl) throw new Error(tr('err.dateRequired'));
  if ($('#ev-allday').checked) {
    if (endKeyIncl < startKey) throw new Error(tr('err.endDateBeforeStart'));
    return { ...input, allDay: true, startKey, endKey: dayKey(addDays(parseKey(endKeyIncl), 1)) };
  }
  const start = combine(startKey, $('#ev-start-time').value), end = combine(endKeyIncl, $('#ev-end-time').value);
  if (end <= start) throw new Error(tr('err.endAfterStart'));
  return { ...input, allDay: false, start: start.toISOString(), end: end.toISOString() };
}

async function saveEditor(ev) {
  ev.preventDefault();
  $('#ev-error').textContent = '';
  let input;
  try { input = editorInput(); } catch (error) { $('#ev-error').textContent = error.message; return; }
  $('#ev-save').disabled = true;
  try {
    const old = editing;
    const saved = old
      ? await call(desk.updateEvent(old.calendarId, old.eventId, input))
      : await call(desk.createEvent($('#ev-calendar').value, input));
    events = old ? events.map(e => (e.id === old.id ? saved : e)) : [...events, saved];
    $('#editor').close();
    render();
    toast(tr(old ? 'toast.eventSaved' : 'toast.eventAdded', { title: saved.title }));
  } catch (error) { $('#ev-error').textContent = error.message; }
  finally { $('#ev-save').disabled = false; }
}

// ---------- 详情对话框中的编辑 / 删除 ----------
let deleteTimer;
async function deleteFromDetail() {
  const event = detailEvent, task = detailTask, button = $('#detail-delete');
  if (!event && !task) return;
  if (!button.classList.contains('confirm')) {
    // 第一次点击只进入确认状态，3 秒内再点一次才删除
    button.classList.add('confirm'); button.textContent = tr('detail.confirmDelete');
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { button.classList.remove('confirm'); button.textContent = tr('detail.delete'); }, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  if (task) { $('#detail').close(); await removeTask(task); return; }
  button.disabled = true;
  try {
    await call(desk.deleteEvent(event.calendarId, event.eventId));
    events = events.filter(e => e.id !== event.id);
    $('#detail').close();
    render();
    toast(tr('toast.eventDeleted', { title: event.title }));
  } catch (error) { report(error); }
  finally { button.disabled = false; }
}

// ---------- 时间轴拖动 ----------
let drag = null;

function geometry(container) {
  const rect = container.getBoundingClientRect(), week = container.id === 'wk-grid';
  const gutter = week ? WEEK_GUTTER : 48, right = week ? 0 : 4, cols = week ? 7 : 1;
  return { container, rect, week, gutter, cols, colW: (rect.width - gutter - right) / cols };
}
const colAt = (g, x) => clamp(Math.floor((x - g.rect.left - g.gutter) / g.colW), 0, g.cols - 1);
const snapMinutes = (g, y, round = Math.round) => clamp(round((y - g.rect.top) / HOUR * 60 / SNAP) * SNAP, 0, 1440);
const dayForCol = (g, col) => (g.week ? dayKey(weekDays(selected)[col]) : selected);

function onPointerDown(ev) {
  if (ev.button !== 0 || drag) return;
  const g = geometry(ev.currentTarget);
  const block = ev.target.closest('.block');
  if (block) {
    if (!block.classList.contains('draggable')) return;
    const item = block._item;
    drag = {
      kind: 'block', mode: ev.target.classList.contains('resize-handle') ? 'resize' : 'move', g, block, item,
      x0: ev.clientX, y0: ev.clientY, start: new Date(item.start), end: new Date(item.end), col0: block._col,
      top0: parseFloat(block.style.top), height0: parseFloat(block.style.height), moved: false,
    };
  } else {
    if (ev.clientX - g.rect.left < g.gutter || !app?.connected) return;
    const col = colAt(g, ev.clientX), m0 = snapMinutes(g, ev.clientY, Math.floor);
    drag = { kind: 'create', g, col, day: dayForCol(g, col), m0, m1: m0 + 60, x0: ev.clientX, y0: ev.clientY, moved: false, ghost: null };
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 4) return;
  drag.moved = true;
  if (drag.kind === 'block') previewBlock(ev); else previewCreate(ev);
}

function previewBlock(ev) {
  const d = drag, delta = Math.round((ev.clientY - d.y0) / HOUR * 60 / SNAP) * SNAP;
  const dayDelta = d.g.week && d.mode === 'move' ? colAt(d.g, ev.clientX) - d.col0 : 0;
  if (d.mode === 'move') {
    d.newStart = addDays(addMinutes(d.start, delta), dayDelta);
    d.newEnd = addDays(addMinutes(d.end, delta), dayDelta);
    d.block.style.top = `${d.top0 + delta / 60 * HOUR}px`;
    if (d.g.week) { d.block.style.left = colLeft(d.col0 + dayDelta); d.block.style.width = colWidth(1, 2); }
    else { d.block.style.left = 'calc(48px)'; d.block.style.width = 'calc(100% - 55px)'; }
  } else {
    d.newStart = d.start;
    d.newEnd = new Date(Math.max(addMinutes(d.end, delta).getTime(), addMinutes(d.start, SNAP).getTime()));
    d.block.style.height = `${Math.max(16, d.height0 + (d.newEnd - d.end) / 3600000 * HOUR)}px`;
  }
  d.block.classList.add('dragging');
  const label = d.block.querySelector('.b-time');
  if (label) label.textContent = d.item.task ? `⏰ ${hhmm(d.newStart)}` : `${hhmm(d.newStart)} – ${hhmm(d.newEnd)}`;
}

function previewCreate(ev) {
  const d = drag, m = snapMinutes(d.g, ev.clientY);
  d.m1 = Math.max(m, d.m0 + SNAP);
  if (m < d.m0) { d.m1 = d.m0 + SNAP; d.m0 = Math.max(0, m); }
  if (!d.ghost) { d.ghost = el('div', 'create-ghost'); d.g.container.append(d.ghost); }
  d.ghost.style.top = `${d.m0 / 60 * HOUR}px`;
  d.ghost.style.height = `${(d.m1 - d.m0) / 60 * HOUR}px`;
  if (d.g.week) { d.ghost.style.left = colLeft(d.col); d.ghost.style.width = colWidth(1, 2); }
  d.ghost.textContent = `${pad2(Math.floor(d.m0 / 60))}:${pad2(d.m0 % 60)} – ${pad2(Math.floor(d.m1 / 60) % 24)}:${pad2(d.m1 % 60)}`;
}

async function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  const d = drag; drag = null;
  if (!d) return;
  if (d.kind === 'create') {
    // 点击空白处：新建 1 小时；拖出一段：用拖出的时间
    const start = combine(d.day, '00:00');
    const from = addMinutes(start, d.m0), to = addMinutes(start, d.moved ? d.m1 : d.m0 + 60);
    await openEditor({ start: from, end: to });
    const ghost = d.ghost;
    if (ghost) { if ($('#editor').open) $('#editor').addEventListener('close', () => ghost.remove(), { once: true }); else ghost.remove(); }
    return;
  }
  if (!d.moved) return; // 普通点击，交给 click 打开详情
  d.block._dragged = true;
  setTimeout(() => { d.block._dragged = false; }, 0);
  if (!d.newStart || (d.newStart.getTime() === d.start.getTime() && d.newEnd.getTime() === d.end.getTime())) { render(); return; }
  if (d.item.task) await moveTask(d.item.task, d.newStart); else await moveEvent(d.item, d.newStart, d.newEnd);
}

async function moveEvent(old, start, end) {
  const before = events;
  events = events.map(e => (e.id === old.id ? { ...e, start: start.toISOString(), end: end.toISOString() } : e));
  render();
  try {
    const saved = await call(desk.updateEvent(old.calendarId, old.eventId, { start: start.toISOString(), end: end.toISOString() }));
    events = events.map(e => (e.id === old.id ? saved : e));
    render();
    toast(`${old.title} → ${shortDate(dayKey(start))} ${hhmm(start)} – ${hhmm(end)}`);
  } catch (error) { events = before; render(); report(error); }
}

async function moveTask(task, start) {
  const before = tasks, due = dayKey(start), time = hhmm(start);
  tasks = tasks.map(t => (t.id === task.id ? { ...t, due, time } : t));
  render();
  try {
    const saved = await call(desk.rescheduleTask(task.listId, task.id, { due, time, notes: task.notes }));
    tasks = tasks.map(t => (t.id === task.id ? { ...saved, completed: t.completed, completedAt: t.completedAt } : t));
    render();
    toast(`${task.title} → ${shortDate(due)} ${time}`);
  } catch (error) { tasks = before; render(); report(error); }
}

// ---------- 绑定 ----------
$('#new-event-btn').addEventListener('click', () => openEditor());
$('#editor-form').addEventListener('submit', saveEditor);
$('#editor-close').addEventListener('click', () => $('#editor').close());
$('#ev-cancel').addEventListener('click', () => $('#editor').close());
$('#ev-allday').addEventListener('change', syncAllDay);
// 开始日期改了，结束日期跟着保持原来的间隔
$('#ev-start-date').addEventListener('change', e => {
  const prev = e.target.dataset.prev || e.target.defaultValue;
  if (prev && $('#ev-end-date').value) {
    const gap = (parseKey($('#ev-end-date').value) - parseKey(prev)) / 864e5;
    $('#ev-end-date').value = dayKey(addDays(parseKey(e.target.value), Math.max(0, Math.round(gap))));
  }
  e.target.dataset.prev = e.target.value;
});
$('#ev-start-date').addEventListener('focus', e => { e.target.dataset.prev = e.target.value; });
$('#detail-edit').addEventListener('click', () => { const event = detailEvent; $('#detail').close(); openEditor({ event }); });
$('#detail-delete').addEventListener('click', deleteFromDetail);
for (const id of ['#timeline', '#wk-grid']) $(id).addEventListener('pointerdown', onPointerDown);
window.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) { window.removeEventListener('pointermove', onPointerMove); drag.ghost?.remove(); drag = null; render(); } });
