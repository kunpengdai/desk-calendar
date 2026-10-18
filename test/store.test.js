const test = require('node:test');
const assert = require('node:assert');
const { DataStore, overlay } = require('../src/store');
const { FakeGoogle } = require('../src/demo');
const { NetworkError } = require('../src/google');

const ALL = ['2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'];
const iso = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

// 模拟磁盘：save 写入的内容，下次 load 读出来
function disk() {
  let data = null;
  return { load: () => (data ? JSON.parse(JSON.stringify(data)) : null), save: d => { data = JSON.parse(JSON.stringify(d)); }, peek: () => data };
}

async function onlineStore(d = disk()) {
  const server = new FakeGoogle();
  const store = new DataStore({ load: d.load, save: d.save });
  store.setClient(server);
  await store.fetchEvents(...ALL);
  await store.fetchTasks(...ALL);
  await store.taskLists();
  await store.writableCalendars();
  return { server, store, d };
}

test('restart shows cached data before any network request', async () => {
  const { d, server } = await onlineStore();
  const restarted = new DataStore({ load: d.load, save: d.save });   // 尚未设置 client，也就没有联网
  const cached = restarted.cached(...ALL);
  assert.strictEqual(cached.events.length, server.eventList.length);
  assert.strictEqual(cached.tasks.length, server.taskList.length);
  assert.ok(restarted.status().lastSync);
});

test('reads fall back to cache when offline and flag the store offline', async () => {
  const { server, store } = await onlineStore();
  server.offline = true;
  const events = await store.fetchEvents(...ALL);
  assert.strictEqual(events.length, server.eventList.length);
  assert.strictEqual(store.status().offline, true);
});

test('online writes go straight to the server', async () => {
  const { server, store } = await onlineStore();
  const created = await store.createEvent('demo', { title: 'Online', allDay: false, start: iso(18), end: iso(19) });
  assert.ok(!created.pending && !created.eventId.startsWith('local-'));
  assert.ok(server.eventList.some(e => e.eventId === created.eventId));
  assert.strictEqual(store.status().pending, 0);
});

test('offline writes are queued, persisted, shown locally, then uploaded in order with temp ids remapped', async () => {
  const d = disk();
  const { server, store } = await onlineStore(d);
  server.offline = true;

  const local = await store.createEvent('demo', { title: '离线新建', allDay: false, start: iso(18), end: iso(19) });
  assert.ok(local.pending && local.eventId.startsWith('local-'));
  const moved = await store.updateEvent('demo', local.eventId, { start: iso(20), end: iso(21) });   // 修改还没上传的日程
  assert.strictEqual(moved.start, iso(20));
  const milk = server.taskList.find(t => t.title === '买牛奶和鸡蛋');
  await store.setTaskDone(milk.listId, milk.id, true);
  const newTask = await store.createTask({ listId: '生活', title: '离线任务', due: '2026-10-20', time: '09:00' });
  await store.rescheduleTask(newTask.listId, newTask.id, { due: '2026-10-21', time: '10:00', notes: '' });
  await store.deleteEvent('demo', 'd4');

  assert.strictEqual(store.status().pending, 6);
  assert.strictEqual(server.eventList.filter(e => e.title === '离线新建').length, 0);     // 服务器还没有
  const view = store.cached(...ALL);
  assert.ok(view.events.find(e => e.title === '离线新建').pending);
  assert.ok(!view.events.some(e => e.eventId === 'd4'));
  assert.ok(view.tasks.find(t => t.id === milk.id).completed);
  assert.strictEqual(d.peek().outbox.length, 6);   // 队列已写盘

  // 重启后队列还在
  const restarted = new DataStore({ load: d.load, save: d.save });
  assert.strictEqual(restarted.status().pending, 6);
  restarted.setClient(server);

  server.offline = false;
  await restarted.checkConnection();
  assert.strictEqual(restarted.status().pending, 0);
  const uploaded = server.eventList.find(e => e.title === '离线新建');
  assert.ok(uploaded && !uploaded.eventId.startsWith('local-'));
  assert.strictEqual(uploaded.start, iso(20));                                   // 后续修改用真实 ID 补传
  assert.ok(!server.eventList.some(e => e.eventId === 'd4'));
  assert.ok(server.taskList.find(t => t.id === milk.id).completed);
  const task = server.taskList.find(t => t.title === '离线任务');
  assert.deepStrictEqual([task.due, task.time], ['2026-10-21', '10:00']);
  assert.ok(!restarted.cached(...ALL).events.some(e => e.pending));
  assert.ok(restarted.cached(...ALL).events.some(e => e.eventId === uploaded.eventId));
});

test('a later write after reconnect still waits for earlier queued writes', async () => {
  const { server, store } = await onlineStore();
  server.offline = true;
  const local = await store.createEvent('demo', { title: 'A', allDay: false, start: iso(8), end: iso(9) });
  server.offline = false;
  // 队列不为空时新的修改排在后面，并通过临时 ID 映射到真实日程
  await store.updateEvent('demo', local.eventId, { title: 'A2' });
  await store.flush();
  assert.strictEqual(store.status().pending, 0);
  assert.ok(server.eventList.some(e => e.title === 'A2' && !e.eventId.startsWith('local-')));
  assert.ok(!server.eventList.some(e => e.title === 'A'));
});

test('changes to items deleted elsewhere are dropped quietly; rejected changes are dropped with a message', async () => {
  const { server, store } = await onlineStore();
  server.offline = true;
  await store.deleteEvent('demo', 'd1');
  await store.updateEvent('demo', 'd2', { title: '改名' });
  await store.updateEvent('holiday', 'h1', { title: '改不了' });   // 只读日历
  server.eventList = server.eventList.filter(e => e.eventId !== 'd2');       // d2 在别处被删除
  server.offline = false;
  await store.flush();
  assert.strictEqual(store.status().pending, 0);
  assert.ok(!server.eventList.some(e => e.eventId === 'd1'));
  assert.match(store.status().error, /无法同步.*只读/);
  assert.ok(!store.cached(...ALL).events.some(e => e.eventId === 'd2'));
});

test('flush stops at a network error and keeps the rest queued', async () => {
  const { server, store } = await onlineStore();
  server.offline = true;
  await store.deleteEvent('demo', 'd1');
  await store.deleteEvent('demo', 'd2');
  let calls = 0;
  server.offline = false;
  const realDelete = server.deleteEvent.bind(server);
  server.deleteEvent = async (...args) => { if (++calls === 2) throw new NetworkError('drop'); return realDelete(...args); };
  await store.flush();
  assert.strictEqual(store.status().pending, 1);
  assert.strictEqual(store.status().offline, true);
  await store.flush();
  assert.strictEqual(store.status().pending, 0);
});

test('non-network errors on direct writes are thrown, not queued', async () => {
  const { store } = await onlineStore();
  await assert.rejects(store.updateEvent('holiday', 'h1', { title: 'x' }), /只读/);
  assert.strictEqual(store.status().pending, 0);
});

test('overlay marks touched items pending and applies ops in order', () => {
  const events = [{ id: 'c:1', calendarId: 'c', eventId: '1', title: 'A', allDay: false, start: iso(9), end: iso(10) }];
  const tasks = [{ id: 't1', title: 'T', completed: false }];
  const view = overlay(events, tasks, [
    { type: 'event:update', calendarId: 'c', eventId: '1', input: { title: 'B' } },
    { type: 'task:done', taskId: 't1', done: true, completedAt: 'x' },
  ]);
  assert.deepStrictEqual([view.events[0].title, view.events[0].pending], ['B', true]);
  assert.deepStrictEqual([view.tasks[0].completed, view.tasks[0].pending], [true, true]);
  assert.strictEqual(events[0].title, 'A');   // 快照本身不被修改
});
