// 示例数据（--demo），以今天为基准生成，便于不登录时预览界面。
const { dayKey, addDays } = require('./renderer/calendar-core');
const { t } = require('./renderer/i18n');

function at(base, days, hour, minute = 0) {
  const d = addDays(base, days); d.setHours(hour, minute, 0, 0); return d.toISOString();
}

function demoEvents() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const blue = '#8ab4f8', green = '#81c995', orange = '#fcad70', purple = '#c58af9';
  const timed = (id, title, days, h1, m1, h2, m2, color, location = '') => ({
    id, title, allDay: false, startKey: null, endKey: null, start: at(today, days, h1, m1), end: at(today, days, h2, m2),
    location, description: t('demo.descEvent'), link: '', calendar: t('demo.calendar'), color,
  });
  const allDay = (id, title, days, length, color) => ({
    id, title, allDay: true, startKey: dayKey(addDays(today, days)), endKey: dayKey(addDays(today, days + length)),
    start: null, end: null, location: '', description: t('demo.descAllDay'), link: '', calendar: t('demo.calendar'), color,
  });
  return [
    timed('d1', t('demo.standup'), 0, 9, 30, 10, 0, blue, t('demo.roomA')),
    timed('d2', t('demo.review'), 0, 10, 0, 11, 30, purple, t('demo.online')),
    timed('d3', t('demo.designSync'), 0, 10, 30, 11, 0, green),
    timed('d4', t('demo.lunch'), 0, 12, 0, 13, 0, orange),
    timed('d5', t('demo.weekly'), 0, 16, 0, 17, 15, blue),
    timed('d6', t('demo.gym'), 1, 19, 0, 20, 0, green, t('demo.gymPlace')),
    timed('d7', t('demo.clientCall'), 2, 14, 0, 14, 45, purple),
    timed('d8', t('demo.dentist'), -3, 15, 0, 16, 0, orange),
    timed('d9', t('demo.bookClub'), 5, 20, 0, 21, 30, green),
    allDay('a1', t('demo.trip'), 3, 2, orange),
    allDay('a2', t('demo.momBirthday'), 9, 1, purple),
    allDay('a3', t('demo.release'), 0, 1, blue),
    allDay('a4', t('demo.sprint'), -3, 14, blue),
  ].map(e => ({ ...e, id: `demo:${e.id}`, eventId: e.id, calendarId: 'demo', calendar: t('demo.calendar'), editable: true, recurring: false }))
    // 只读日历（如节假日）：不能拖动或编辑
    .concat({ ...allDay('h1', t('demo.holiday'), 0, 1, '#33b679'), id: 'holiday:h1', eventId: 'h1', calendarId: 'holiday', calendar: t('demo.holidays'), description: '', editable: false, recurring: false });
}

function demoTasks() {
  const today = new Date();
  const work = t('demo.list.work'), life = t('demo.list.life'), personal = t('demo.list.personal');
  const task = (id, title, due, listTitle, notes = '', time = null, completed = false) => ({
    id, listId: listTitle, listTitle, title, notes, due: due === null ? null : dayKey(addDays(today, due)), time,
    completed, completedAt: completed ? addDays(today, due || 0).toISOString() : null,
    parent: null, position: id, link: 'https://tasks.google.com/',
  });
  return [
    task('t1', t('demo.t1'), -1, work, t('demo.t1notes')),
    task('t2', t('demo.t2'), 0, work, '', '15:00'),
    task('t3', t('demo.t3'), 0, life),
    task('t4', t('demo.t4'), 2, life),
    task('t5', t('demo.t5'), null, personal),
    task('t6', t('demo.t6'), 0, personal, '', '07:30', true),
    task('t7', t('demo.t7'), 0, work, '', null, true),
    task('t8', t('demo.t8'), -2, life, '', null, true),
  ];
}

// 示例模式用的“假 Google”：接口与 GoogleClient 相同，数据保存在内存中；
// offline = true 时所有请求都抛出 NetworkError，用来演示和测试离线同步。
const { NetworkError } = require('./google');
const { overlaps } = require('./store');

const demoCalendars = () => [
  { id: 'demo', title: t('demo.calendar'), color: '#8ab4f8', primary: true },
  { id: 'work', title: t('demo.work'), color: '#c58af9', primary: false },
];

class FakeGoogle {
  constructor() {
    this.eventList = demoEvents();
    this.taskList = demoTasks();
    this.offline = false;
    this.seq = 0;
  }
  check() { if (this.offline) throw new NetworkError(t('err.network')); }
  async events(timeMin, timeMax) {
    this.check();
    return { account: 'demo@example.com', events: this.eventList.filter(e => overlaps(e, Date.parse(timeMin), Date.parse(timeMax))).map(e => ({ ...e })) };
  }
  async taskLists() { this.check(); return [...new Set(this.taskList.map(x => x.listTitle).concat(t('demo.list.work'), t('demo.list.life'), t('demo.list.personal')))].map(title => ({ id: title, title })); }
  async writableCalendars() { this.check(); return demoCalendars(); }
  async tasks() { this.check(); return this.taskList.map(t => ({ ...t })); }
  async createEvent(calendarId, input) {
    this.check();
    const cals = demoCalendars(), cal = cals.find(c => c.id === calendarId) || cals[0];
    const eventId = `ev${++this.seq}`;
    const event = { id: `${cal.id}:${eventId}`, eventId, calendarId: cal.id, calendar: cal.title, color: cal.color, editable: true, recurring: false, link: '', location: '', description: '', startKey: null, endKey: null, start: null, end: null, ...apply(input) };
    this.eventList.push(event);
    return { ...event };
  }
  async updateEvent(calendarId, eventId, input) {
    this.check();
    const old = this.eventList.find(e => e.calendarId === calendarId && e.eventId === eventId);
    if (!old) throw Object.assign(new Error(t('err.eventNotFound')), { status: 404 });
    if (!old.editable) throw Object.assign(new Error(t('err.readOnly')), { status: 403 });
    const next = { ...old, ...apply(input) };
    this.eventList = this.eventList.map(e => (e === old ? next : e));
    return { ...next };
  }
  async deleteEvent(calendarId, eventId) {
    this.check();
    this.eventList = this.eventList.filter(e => !(e.calendarId === calendarId && e.eventId === eventId));
    return true;
  }
  async createTask({ listId, title, due, time }) {
    this.check();
    const list = listId && listId !== '@default' ? listId : t('demo.list.work');
    const task = { id: `task${++this.seq}`, listId: list, listTitle: list, title, notes: '', due, time: due ? time : null, completed: false, completedAt: null, parent: null, position: '0', link: 'https://tasks.google.com/' };
    this.taskList.push(task);
    return { ...task };
  }
  async setTaskDone(listId, taskId, done) {
    this.check();
    const completedAt = done ? new Date().toISOString() : null;
    this.taskList = this.taskList.map(t => (t.id === taskId ? { ...t, completed: done, completedAt } : t));
    return completedAt;
  }
  async updateTaskSchedule(listId, taskId, { due, time }) {
    this.check();
    this.taskList = this.taskList.map(t => (t.id === taskId ? { ...t, due, time: due ? time : null } : t));
    return { ...this.taskList.find(t => t.id === taskId) };
  }
  async deleteTask(listId, taskId) {
    this.check();
    this.taskList = this.taskList.filter(t => t.id !== taskId && t.parent !== taskId);
    return true;
  }
}

function apply(input) {
  const out = {};
  for (const key of ['title', 'location', 'description']) if (input[key] !== undefined) out[key] = input[key];
  if (input.allDay === true) Object.assign(out, { allDay: true, startKey: input.startKey, endKey: input.endKey, start: null, end: null });
  else if (input.start && input.end) Object.assign(out, { allDay: false, start: input.start, end: input.end, startKey: null, endKey: null });
  return out;
}

module.exports = { demoEvents, demoTasks, FakeGoogle };
