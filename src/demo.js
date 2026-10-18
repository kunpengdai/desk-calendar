// 示例数据（--demo），以今天为基准生成，便于不登录时预览界面。
const { dayKey, addDays } = require('./renderer/calendar-core');

function at(base, days, hour, minute = 0) {
  const d = addDays(base, days); d.setHours(hour, minute, 0, 0); return d.toISOString();
}

function demoEvents() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const blue = '#8ab4f8', green = '#81c995', orange = '#fcad70', purple = '#c58af9';
  const timed = (id, title, days, h1, m1, h2, m2, color, location = '') => ({
    id, title, allDay: false, startKey: null, endKey: null, start: at(t, days, h1, m1), end: at(t, days, h2, m2),
    location, description: '示例日程', link: '', calendar: '示例', color,
  });
  const allDay = (id, title, days, length, color) => ({
    id, title, allDay: true, startKey: dayKey(addDays(t, days)), endKey: dayKey(addDays(t, days + length)),
    start: null, end: null, location: '', description: '示例全天日程', link: '', calendar: '示例', color,
  });
  return [
    timed('d1', '晨会', 0, 9, 30, 10, 0, blue, '会议室 A'),
    timed('d2', '产品评审', 0, 10, 0, 11, 30, purple, '线上'),
    timed('d3', '和设计同步', 0, 10, 30, 11, 0, green),
    timed('d4', '午餐', 0, 12, 0, 13, 0, orange),
    timed('d5', '写周报', 0, 16, 0, 17, 15, blue),
    timed('d6', '健身', 1, 19, 0, 20, 0, green, '健身房'),
    timed('d7', '客户电话', 2, 14, 0, 14, 45, purple),
    timed('d8', '牙医', -3, 15, 0, 16, 0, orange),
    timed('d9', '读书会', 5, 20, 0, 21, 30, green),
    allDay('a1', '出差 · 上海', 3, 2, orange),
    allDay('a2', '妈妈生日', 9, 1, purple),
    allDay('a3', '版本发布日', 0, 1, blue),
    allDay('a4', '个人项目冲刺 · 第 1–2 周', -3, 14, blue),
  ].map(e => ({ ...e, id: `demo:${e.id}`, eventId: e.id, calendarId: 'demo', calendar: '我的日历', editable: true, recurring: false }))
    // 只读日历（如节假日）：不能拖动或编辑
    .concat({ ...allDay('h1', '重阳节', 0, 1, '#33b679'), id: 'holiday:h1', eventId: 'h1', calendarId: 'holiday', calendar: '中国节假日', description: '', editable: false, recurring: false });
}

function demoTasks() {
  const t = new Date();
  const task = (id, title, due, listTitle, notes = '', time = null, completed = false) => ({
    id, listId: listTitle, listTitle, title, notes, due: due === null ? null : dayKey(addDays(t, due)), time,
    completed, completedAt: completed ? addDays(t, due || 0).toISOString() : null,
    parent: null, position: id, link: 'https://tasks.google.com/',
  });
  return [
    task('t1', '提交报销单', -1, '工作', '附上发票照片'),
    task('t2', '确认发布清单', 0, '工作', '', '15:00'),
    task('t3', '买牛奶和鸡蛋', 0, '生活'),
    task('t4', '预订机票', 2, '生活'),
    task('t5', '整理读书笔记', null, '个人'),
    task('t6', '晨跑 5 公里', 0, '个人', '', '07:30', true),
    task('t7', '回复客户邮件', 0, '工作', '', null, true),
    task('t8', '交水电费', -2, '生活', '', null, true),
  ];
}

// 示例模式用的“假 Google”：接口与 GoogleClient 相同，数据保存在内存中；
// offline = true 时所有请求都抛出 NetworkError，用来演示和测试离线同步。
const { NetworkError } = require('./google');
const { overlaps } = require('./store');

const DEMO_CALENDARS = [
  { id: 'demo', title: '我的日历', color: '#8ab4f8', primary: true },
  { id: 'work', title: '工作', color: '#c58af9', primary: false },
];

class FakeGoogle {
  constructor() {
    this.eventList = demoEvents();
    this.taskList = demoTasks();
    this.offline = false;
    this.seq = 0;
  }
  check() { if (this.offline) throw new NetworkError('无法连接 Google，请检查网络。'); }
  async events(timeMin, timeMax) {
    this.check();
    return { account: 'demo@example.com', events: this.eventList.filter(e => overlaps(e, Date.parse(timeMin), Date.parse(timeMax))).map(e => ({ ...e })) };
  }
  async taskLists() { this.check(); return [...new Set(this.taskList.map(t => t.listTitle).concat('工作', '生活', '个人'))].map(title => ({ id: title, title })); }
  async writableCalendars() { this.check(); return DEMO_CALENDARS; }
  async tasks() { this.check(); return this.taskList.map(t => ({ ...t })); }
  async createEvent(calendarId, input) {
    this.check();
    const cal = DEMO_CALENDARS.find(c => c.id === calendarId) || DEMO_CALENDARS[0];
    const eventId = `ev${++this.seq}`;
    const event = { id: `${cal.id}:${eventId}`, eventId, calendarId: cal.id, calendar: cal.title, color: cal.color, editable: true, recurring: false, link: '', location: '', description: '', startKey: null, endKey: null, start: null, end: null, ...apply(input) };
    this.eventList.push(event);
    return { ...event };
  }
  async updateEvent(calendarId, eventId, input) {
    this.check();
    const old = this.eventList.find(e => e.calendarId === calendarId && e.eventId === eventId);
    if (!old) throw Object.assign(new Error('日程不存在。'), { status: 404 });
    if (!old.editable) throw Object.assign(new Error('没有修改这个日历的权限（只读日历）。'), { status: 403 });
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
    const list = listId && listId !== '@default' ? listId : '工作';
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
