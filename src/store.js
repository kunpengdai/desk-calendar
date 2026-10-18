// 离线优先的数据层：
// - snapshot：最近一次从 Google 拉到的数据（持久化到本机，启动时先用它显示）
// - outbox：还没同步到 Google 的修改（按顺序保存，持久化）
// - 界面看到的数据 = snapshot 叠加 outbox
// 网络正常时修改直接写入 Google；连不上时进入 outbox，恢复网络后按顺序补传。
const { parseKey, addDays, dayKey } = require('./renderer/calendar-core');

const isNetworkError = e => e?.name === 'NetworkError';
const isAuthError = e => e?.name === 'AuthError';
const isGone = e => e?.status === 404 || e?.status === 410;

function eventSpan(e) {
  if (e.allDay) {
    const end = e.endKey > e.startKey ? e.endKey : dayKey(addDays(parseKey(e.startKey), 1));
    return [parseKey(e.startKey).getTime(), parseKey(end).getTime()];
  }
  const start = Date.parse(e.start), end = Date.parse(e.end);
  return [start, Math.max(end, start + 1)];
}
const overlaps = (e, lo, hi) => { const [s, end] = eventSpan(e); return s < hi && end > lo; };

function applyEventInput(e, input) {
  const next = { ...e };
  for (const key of ['title', 'location', 'description']) if (input[key] !== undefined) next[key] = input[key];
  if (input.allDay === true) Object.assign(next, { allDay: true, startKey: input.startKey, endKey: input.endKey, start: null, end: null });
  else if (input.start && input.end) Object.assign(next, { allDay: false, start: input.start, end: input.end, startKey: null, endKey: null });
  return next;
}

const sameEvent = (e, op) => e.calendarId === op.calendarId && e.eventId === op.eventId;

// 把待同步的修改按顺序叠加到快照上；被修改过的条目标记 pending。
function overlay(events, tasks, outbox) {
  let ev = events.slice(), ts = tasks.slice();
  for (const op of outbox) {
    switch (op.type) {
      case 'event:create': ev.push({ ...op.local, pending: true }); break;
      case 'event:update': ev = ev.map(e => (sameEvent(e, op) ? { ...applyEventInput(e, op.input), pending: true } : e)); break;
      case 'event:delete': ev = ev.filter(e => !sameEvent(e, op)); break;
      case 'task:create': ts.push({ ...op.local, pending: true }); break;
      case 'task:done': ts = ts.map(t => (t.id === op.taskId ? { ...t, completed: op.done, completedAt: op.completedAt, pending: true } : t)); break;
      case 'task:reschedule': ts = ts.map(t => (t.id === op.taskId ? { ...t, due: op.due, time: op.time, pending: true } : t)); break;
      case 'task:delete': ts = ts.filter(t => t.id !== op.taskId && t.parent !== op.taskId); break;
      default: break;
    }
  }
  return { events: ev, tasks: ts };
}

class DataStore {
  constructor({ load = () => null, save = () => {}, timeZone = 'UTC', onChange = () => {}, onError = () => {}, now = () => Date.now() } = {}) {
    Object.assign(this, { saveFn: save, timeZone, onChange, onError, now });
    const saved = load() || {};
    this.snapshot = { events: {}, tasks: [], lists: [], calendars: [], account: '', ...(saved.snapshot || {}) };
    this.outbox = saved.outbox || [];
    this.idMap = saved.idMap || {};     // 离线新建条目的临时 ID → Google 返回的真实 ID
    this.seq = saved.seq || 0;
    this.lastSync = saved.lastSync || null;
    this.client = null;
    this.offline = false;
    this.error = '';
    this.flushing = null;
  }

  setClient(client) { this.client = client; }

  clear() {
    this.snapshot = { events: {}, tasks: [], lists: [], calendars: [], account: '' };
    Object.assign(this, { outbox: [], idMap: {}, lastSync: null, offline: false, error: '' });
    this.persist();
  }

  persist() {
    try { this.saveFn({ snapshot: this.snapshot, outbox: this.outbox, idMap: this.idMap, seq: this.seq, lastSync: this.lastSync }); }
    catch (error) { this.error = `无法保存本地缓存：${error.message}`; }
  }

  status() {
    return { offline: this.offline, pending: this.outbox.length, lastSync: this.lastSync, error: this.error, account: this.snapshot.account };
  }

  // ---------- 读取 ----------
  cached(timeMin, timeMax) {
    const view = overlay(Object.values(this.snapshot.events), this.snapshot.tasks, this.outbox);
    if (!timeMin || !timeMax) return view;
    const lo = Date.parse(timeMin), hi = Date.parse(timeMax);
    return { events: view.events.filter(e => overlaps(e, lo, hi)), tasks: view.tasks };
  }

  markOnline() {
    const wasOffline = this.offline;
    this.offline = false;
    this.error = '';
    this.lastSync = this.now();
    if (wasOffline) this.onChange('online');
  }

  fail(error) {
    if (isNetworkError(error)) this.offline = true;
    else { this.error = error.message || String(error); this.onError(error); }
    this.onChange('state');
  }

  async fetchEvents(timeMin, timeMax) {
    if (this.client) {
      try {
        const fresh = await this.client.events(timeMin, timeMax);
        const lo = Date.parse(timeMin), hi = Date.parse(timeMax);
        // 用新数据替换这个时间范围内的快照（范围内已被删除的日程随之消失）
        for (const [id, e] of Object.entries(this.snapshot.events)) if (overlaps(e, lo, hi)) delete this.snapshot.events[id];
        for (const e of fresh.events) this.snapshot.events[e.id] = e;
        if (fresh.account) this.snapshot.account = fresh.account;
        this.markOnline();
        this.persist();
        if (this.outbox.length) this.flush();
      } catch (error) { this.fail(error); }
    }
    return this.cached(timeMin, timeMax).events;
  }

  async fetchTasks(timeMin, timeMax) {
    if (this.client) {
      try {
        this.snapshot.tasks = await this.client.tasks(timeMin, timeMax);
        this.markOnline();
        this.persist();
        if (this.outbox.length) this.flush();
      } catch (error) { this.fail(error); }
    }
    return this.cached().tasks;
  }

  async cachedList(key, load) {
    if (this.client) {
      try { this.snapshot[key] = await load(); this.persist(); }
      catch (error) { if (!isNetworkError(error)) throw error; this.offline = true; }
    }
    return this.snapshot[key];
  }
  taskLists() { return this.cachedList('lists', () => this.client.taskLists()); }
  writableCalendars() { return this.cachedList('calendars', () => this.client.writableCalendars()); }

  // ---------- 修改 ----------
  resolve(id) { return this.idMap[id] || id; }
  tempId() { this.seq += 1; return `local-${this.now().toString(36)}-${this.seq}`; }

  async write(op) {
    if (!this.client) throw new Error('尚未登录 Google。');
    // 队列为空时直接写入 Google；队列里还有修改时排在后面，保证顺序
    if (!this.outbox.length && !this.offline) {
      try { const result = await this.runOp(op); this.markOnline(); this.persist(); return result; }
      catch (error) { if (!isNetworkError(error)) throw error; this.offline = true; }
    }
    this.outbox.push(op);
    this.persist();
    this.onChange('data'); // 界面重读缓存，显示“待同步”标记
    this.flush(); // 后台尝试补传；仍然连不上就留在队列里
    return this.localResult(op);
  }

  localResult(op) {
    const view = this.cached();
    switch (op.type) {
      case 'event:create': case 'task:create': return { ...op.local, pending: true };
      case 'event:update': return view.events.find(e => sameEvent(e, op));
      case 'task:done': return op.completedAt;
      case 'task:reschedule': return view.tasks.find(t => t.id === op.taskId);
      default: return true;
    }
  }

  createEvent(calendarId, input) {
    const eventId = this.tempId();
    const cal = this.snapshot.calendars.find(c => c.id === calendarId) || { title: '', color: '#8ab4f8' };
    const local = applyEventInput({
      id: `${calendarId}:${eventId}`, eventId, calendarId, calendar: cal.title, color: cal.color, editable: true, recurring: false,
      link: '', location: '', description: '', allDay: false, startKey: null, endKey: null, start: null, end: null,
    }, input);
    return this.write({ type: 'event:create', calendarId, eventId, input, local });
  }
  updateEvent(calendarId, eventId, input) { return this.write({ type: 'event:update', calendarId, eventId: this.resolve(eventId), input }); }
  deleteEvent(calendarId, eventId) { return this.write({ type: 'event:delete', calendarId, eventId: this.resolve(eventId) }); }

  createTask({ listId, title, due, time }) {
    const list = this.snapshot.lists.find(l => l.id === listId) || this.snapshot.lists[0] || { id: '@default', title: '' };
    const id = this.tempId();
    const local = { id, listId: list.id, listTitle: list.title, title, notes: '', due, time, completed: false, completedAt: null, parent: null, position: '', link: 'https://tasks.google.com/' };
    return this.write({ type: 'task:create', listId: list.id, input: { title, due, time }, local });
  }
  setTaskDone(listId, taskId, done) {
    return this.write({ type: 'task:done', listId, taskId: this.resolve(taskId), done, completedAt: done ? new Date(this.now()).toISOString() : null });
  }
  rescheduleTask(listId, taskId, { due, time, notes }) { return this.write({ type: 'task:reschedule', listId, taskId: this.resolve(taskId), due, time, notes }); }
  deleteTask(listId, taskId) { return this.write({ type: 'task:delete', listId, taskId: this.resolve(taskId) }); }

  // 新建成功后，把后续修改中的临时 ID 换成真实 ID
  remap(kind, tempId, realId) {
    this.idMap[tempId] = realId;
    for (const op of this.outbox) {
      if (kind === 'event' && op.eventId === tempId) op.eventId = realId;
      if (kind === 'task' && op.taskId === tempId) op.taskId = realId;
    }
  }

  // 对 Google 执行一项修改，并把结果写回快照
  async runOp(op) {
    const c = this.client, snap = this.snapshot;
    const replaceTask = (id, task) => { snap.tasks = snap.tasks.some(t => t.id === id) ? snap.tasks.map(t => (t.id === id ? task : t)) : [...snap.tasks, task]; };
    switch (op.type) {
      case 'event:create': {
        const real = await c.createEvent(op.calendarId, op.input, this.timeZone);
        snap.events[real.id] = real;
        this.remap('event', op.eventId, real.eventId);
        return real;
      }
      case 'event:update': {
        const key = `${op.calendarId}:${op.eventId}`;
        try {
          const real = await c.updateEvent(op.calendarId, op.eventId, op.input, this.timeZone);
          delete snap.events[key];
          snap.events[real.id] = real;
          return real;
        } catch (error) { if (!isGone(error)) throw error; delete snap.events[key]; return null; }
      }
      case 'event:delete': {
        try { await c.deleteEvent(op.calendarId, op.eventId); } catch (error) { if (!isGone(error)) throw error; }
        delete snap.events[`${op.calendarId}:${op.eventId}`];
        return true;
      }
      case 'task:create': {
        const real = await c.createTask({ listId: op.listId, ...op.input });
        snap.tasks = [...snap.tasks, real];
        this.remap('task', op.local.id, real.id);
        return real;
      }
      case 'task:done': {
        try {
          const completedAt = await c.setTaskDone(op.listId, op.taskId, op.done);
          snap.tasks = snap.tasks.map(t => (t.id === op.taskId ? { ...t, completed: op.done, completedAt } : t));
          return completedAt;
        } catch (error) { if (!isGone(error)) throw error; snap.tasks = snap.tasks.filter(t => t.id !== op.taskId); return null; }
      }
      case 'task:reschedule': {
        const old = snap.tasks.find(t => t.id === op.taskId);
        const real = await c.updateTaskSchedule(op.listId, op.taskId, { due: op.due, time: op.time, notes: op.notes });
        replaceTask(op.taskId, { ...real, completed: old ? old.completed : real.completed, completedAt: old ? old.completedAt : real.completedAt });
        return snap.tasks.find(t => t.id === op.taskId);
      }
      case 'task:delete': {
        try { await c.deleteTask(op.listId, op.taskId); } catch (error) { if (!isGone(error)) throw error; }
        snap.tasks = snap.tasks.filter(t => t.id !== op.taskId && t.parent !== op.taskId);
        return true;
      }
      default: throw new Error(`未知操作：${op.type}`);
    }
  }

  // 按顺序补传队列。网络错误时停下等下次；其他错误（如条目已无权限修改）放弃该项并提示。
  flush() {
    // 补传进行中又被调用（例如刚加入新的修改）：等这一轮结束后再补传一轮
    if (this.flushing) { this.flushAgain = true; return this.flushing; }
    if (!this.client || !this.outbox.length) return Promise.resolve();
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        while (this.outbox.length) {
          const op = this.outbox[0];
          try {
            await this.runOp(op);
            this.markOnline();
          } catch (error) {
            if (isNetworkError(error)) { this.offline = true; break; }
            if (isAuthError(error)) { this.fail(error); this.flushAgain = false; break; }
            this.error = `一项离线修改无法同步，已放弃：${error.message}`;
          }
          this.outbox.shift();
          this.persist();
        }
      } while (this.flushAgain && this.outbox.length);
    })().finally(() => { this.flushing = null; this.persist(); this.onChange('data'); });
    return this.flushing;
  }

  // 定时检查：有待同步的修改就补传；离线时探测网络是否恢复
  async checkConnection() {
    if (!this.client) return;
    if (this.outbox.length) return this.flush();
    if (!this.offline) return;
    try { await this.client.taskLists(); this.markOnline(); } catch { /* 仍然离线 */ }
  }
}

module.exports = { DataStore, overlay, applyEventInput, overlaps, isNetworkError };
