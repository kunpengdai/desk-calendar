// 纯日期 / 布局逻辑，浏览器（window.CalendarCore）和 Node 测试共用。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalendarCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

  // 以周一开头的 6 周（42 天）月网格。
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }

  function occursOn(event, key) {
    if (event.allDay) return event.startKey <= key && (key < event.endKey || event.startKey === event.endKey && key === event.startKey);
    const dayStart = parseKey(key).getTime(), dayEnd = addDays(parseKey(key), 1).getTime();
    const start = new Date(event.start).getTime(), end = new Date(event.end).getTime();
    if (end <= start) return start >= dayStart && start < dayEnd;
    return start < dayEnd && end > dayStart;
  }

  function eventsOn(events, key) {
    return events.filter(e => occursOn(e, key)).sort((a, b) =>
      Number(b.allDay) - Number(a.allDay) || (a.start || a.startKey).localeCompare(b.start || b.startKey) || a.title.localeCompare(b.title));
  }

  // 日视图时间轴布局：分钟数 top/bottom（截断到当天），互相重叠的为一组，组内贪心分列。
  function layoutDay(events, key, minMinutes = 20) {
    const dayStart = parseKey(key).getTime();
    const blocks = events.filter(e => !e.allDay && occursOn(e, key)).map(event => {
      const top = Math.max(0, (new Date(event.start).getTime() - dayStart) / 60000);
      const bottom = Math.min(1440, Math.max(top + minMinutes, (new Date(event.end).getTime() - dayStart) / 60000));
      return { event, top: Math.min(top, 1440 - minMinutes), bottom, column: 0, columns: 1 };
    }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);

    let group = [], groupEnd = -Infinity;
    const flush = () => {
      const columns = group.reduce((max, b) => Math.max(max, b.column + 1), 1);
      group.forEach(b => { b.columns = columns; });
      group = [];
    };
    for (const block of blocks) {
      if (group.length && block.top >= groupEnd) flush();
      const taken = new Set(group.filter(b => b.bottom > block.top).map(b => b.column));
      while (taken.has(block.column)) block.column++;
      group.push(block);
      groupEnd = Math.max(groupEnd, block.bottom);
    }
    if (group.length) flush();
    return blocks;
  }

  // 所在周（周一开始）的 7 天。
  function weekDays(key) {
    const d = parseKey(key);
    const monday = addDays(d, -((d.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }

  // 周视图全天栏：全天日程（以及额外传入的单日条目）截断到本周，按起始列贪心分行。
  // 返回 { item, start, span, row, before, after }，before/after 表示在本周之外还有延续。
  function layoutAllDay(items, days) {
    const keys = days.map(dayKey), first = keys[0], last = keys[keys.length - 1];
    const segments = items.map(item => {
      const startKey = item.startKey, endKey = item.endKey > item.startKey ? item.endKey : dayKey(addDays(parseKey(item.startKey), 1));
      const lastKey = dayKey(addDays(parseKey(endKey), -1));
      if (lastKey < first || startKey > last) return null;
      const start = startKey < first ? 0 : keys.indexOf(startKey);
      const end = lastKey > last ? keys.length - 1 : keys.indexOf(lastKey);
      return { item, start, span: end - start + 1, row: 0, before: startKey < first, after: lastKey > last };
    }).filter(Boolean).sort((a, b) => a.start - b.start || b.span - a.span);
    const rows = [];
    for (const s of segments) {
      let row = rows.findIndex(endCol => endCol < s.start);
      if (row === -1) { row = rows.length; rows.push(-1); }
      rows[row] = s.start + s.span - 1;
      s.row = row;
    }
    return { segments, rows: rows.length };
  }

  // 农历日期：初一显示月份（如“九月”），其余显示“初三 / 十五 / 廿一”。
  const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
  let lunarFormat = null;
  function lunarLabel(date) {
    try {
      lunarFormat = lunarFormat || new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
      const parts = lunarFormat.formatToParts(date);
      const day = Number(parts.find(p => p.type === 'day')?.value);
      const month = parts.find(p => p.type === 'month')?.value || '';
      if (!day) return '';
      return day === 1 ? month : LUNAR_DAYS[day - 1] || '';
    } catch { return ''; }
  }

  return { pad, dayKey, parseKey, addDays, monthGrid, weekDays, occursOn, eventsOn, layoutDay, layoutAllDay, lunarLabel };
});
