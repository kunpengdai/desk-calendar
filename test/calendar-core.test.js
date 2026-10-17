const test = require('node:test');
const assert = require('node:assert');
const { dayKey, monthGrid, weekDays, occursOn, eventsOn, layoutDay, layoutAllDay, lunarLabel } = require('../src/renderer/calendar-core');

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const timed = (id, start, end) => ({ id, title: id, allDay: false, start, end });
const allDay = (id, startKey, endKey) => ({ id, title: id, allDay: true, startKey, endKey });

test('monthGrid starts on Monday and has 42 days', () => {
  const grid = monthGrid(2026, 9); // 2026 年 10 月，1 号是周四
  assert.strictEqual(grid.length, 42);
  assert.strictEqual(grid[0].getDay(), 1);
  assert.strictEqual(dayKey(grid[0]), '2026-09-28');
  assert.strictEqual(dayKey(grid[3]), '2026-10-01');
});

test('all-day events use exclusive end dates', () => {
  const trip = allDay('trip', '2026-10-20', '2026-10-22');
  assert.ok(occursOn(trip, '2026-10-20'));
  assert.ok(occursOn(trip, '2026-10-21'));
  assert.ok(!occursOn(trip, '2026-10-22'));
});

test('timed events spanning midnight appear on both days', () => {
  const late = timed('late', local(2026, 10, 17, 22), local(2026, 10, 18, 2));
  assert.ok(occursOn(late, '2026-10-17'));
  assert.ok(occursOn(late, '2026-10-18'));
  assert.ok(!occursOn(late, '2026-10-19'));
  const endsAtMidnight = timed('m', local(2026, 10, 17, 23), local(2026, 10, 18, 0));
  assert.ok(!occursOn(endsAtMidnight, '2026-10-18'));
});

test('eventsOn sorts all-day first, then by start time', () => {
  const list = eventsOn([
    timed('b', local(2026, 10, 17, 14), local(2026, 10, 17, 15)),
    timed('a', local(2026, 10, 17, 9), local(2026, 10, 17, 10)),
    allDay('z', '2026-10-17', '2026-10-18'),
  ], '2026-10-17');
  assert.deepStrictEqual(list.map(e => e.id), ['z', 'a', 'b']);
});

test('layoutDay splits overlapping events into columns', () => {
  const blocks = layoutDay([
    timed('a', local(2026, 10, 17, 9), local(2026, 10, 17, 10)),
    timed('b', local(2026, 10, 17, 10), local(2026, 10, 17, 11, 30)),
    timed('c', local(2026, 10, 17, 10, 30), local(2026, 10, 17, 11)),
    timed('d', local(2026, 10, 17, 11), local(2026, 10, 17, 12)),
    allDay('x', '2026-10-17', '2026-10-18'),
  ], '2026-10-17');
  const byId = Object.fromEntries(blocks.map(b => [b.event.id, b]));
  assert.strictEqual(blocks.length, 4);
  assert.strictEqual(byId.a.columns, 1);                 // 9-10 与 10 点开始的不算重叠
  assert.deepStrictEqual([byId.b.column, byId.c.column, byId.d.column], [0, 1, 1]); // d 复用 c 的列
  assert.strictEqual(byId.b.columns, 2);
  assert.strictEqual(byId.d.columns, 2);
  assert.strictEqual(byId.a.top, 9 * 60);
});

test('layoutDay clips cross-midnight events to the day', () => {
  const [block] = layoutDay([timed('late', local(2026, 10, 17, 22), local(2026, 10, 18, 2))], '2026-10-18');
  assert.strictEqual(block.top, 0);
  assert.strictEqual(block.bottom, 120);
});

test('weekDays returns Monday..Sunday containing the date', () => {
  assert.deepStrictEqual(weekDays('2026-10-17').map(dayKey), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.strictEqual(dayKey(weekDays('2026-10-12')[0]), '2026-10-12');
  assert.strictEqual(dayKey(weekDays('2026-10-18')[0]), '2026-10-12');
});

test('layoutAllDay clips spans to the week and stacks overlaps into rows', () => {
  const days = weekDays('2026-10-17');
  const { segments, rows } = layoutAllDay([
    allDay('long', '2026-10-14', '2026-10-28'),   // 周三起，延续到下周
    allDay('fest', '2026-10-18', '2026-10-19'),   // 周日单日
    allDay('prev', '2026-10-10', '2026-10-13'),   // 上周开始，到周一结束
    allDay('mon', '2026-10-12', '2026-10-13'),    // 周一单日，与 prev 重叠
    allDay('next', '2026-10-19', '2026-10-20'),   // 下周，不显示
  ], days);
  const byId = Object.fromEntries(segments.map(s => [s.item.id, s]));
  assert.strictEqual(segments.length, 4);
  assert.deepStrictEqual([byId.long.start, byId.long.span, byId.long.before, byId.long.after], [2, 5, false, true]);
  assert.deepStrictEqual([byId.prev.start, byId.prev.span, byId.prev.before], [0, 1, true]);
  assert.notStrictEqual(byId.prev.row, byId.mon.row);
  assert.notStrictEqual(byId.long.row, byId.fest.row);
  assert.strictEqual(rows, 2);
});

test('lunarLabel gives Chinese lunar day names', () => {
  assert.strictEqual(lunarLabel(new Date(2026, 9, 12)), '初三');
  assert.strictEqual(lunarLabel(new Date(2026, 9, 17)), '初八');
  assert.strictEqual(lunarLabel(new Date(2026, 9, 10)), '九月');   // 初一显示月份
  assert.strictEqual(lunarLabel(new Date(2026, 9, 30)), '廿一');
});
