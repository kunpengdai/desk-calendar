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
    .concat({ ...allDay('h1', '重阳节', 1, 1, '#33b679'), id: 'holiday:h1', eventId: 'h1', calendarId: 'holiday', calendar: '中国节假日', description: '', editable: false, recurring: false });
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

module.exports = { demoEvents, demoTasks };
