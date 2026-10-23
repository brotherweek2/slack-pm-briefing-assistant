const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const data = [];
const sheet = {
  getLastRow: () => data.length + 1,
  getRange: (row, column, height) => ({
    clearContent: () => { data.splice(0, height); },
    setValues: values => { values.forEach((value, index) => { data[row - 2 + index] = value; }); },
  }),
};
const context = vm.createContext({
  console: { log: () => {} },
  BOT_WORKBOOK: { historyTab: 'BOT_DAILY_HISTORY', historyHeaders: Array(7).fill('') },
  ensureBotSheet_: () => sheet,
  readBotRows_: () => data.map(row => [...row]),
  addDaysToIsoDate_: (day, n) => {
    const date = new Date(day + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  },
  BRIEFING: { timezone: 'Asia/Seoul' },
  Utilities: { formatDate: value => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value) },
  normalizeSheetDate_: value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : '',
});
vm.runInContext(fs.readFileSync('src/central-bot/08_일별업무기록.js', 'utf8'), context);
const save = vm.runInContext('saveHaCvDailyHistory_', context);
const format = vm.runInContext('formatHaCvDailyTrend_', context);
const task = (type, owner, pair, sourceRows) => {
  const row = Array(18).fill('');
  row[0] = `HACV_${type}|${owner}|${pair}`;
  row[1] = owner;
  row[3] = pair;
  row[11] = sourceRows;
  row[12] = true;
  return row;
};
const first = [task('HEADSUP', 'PM A', 'en_US-ja_JP', '12, 18'),
  task('REVIEW', 'PM A', 'en_US-ja_JP', '101')];
let trends = save({}, first, '2026-10-07', new Date('2026-10-07T02:00:00Z'));
assert.equal(data.length, 4, 'scan marker plus three source rows');
assert.equal(format(trends['PM A']), '', 'first-day comparison is omitted');
// Google Sheets can return a date cell as a Date or its serial number.
data.forEach((row, index) => { row[0] = index % 2 ? 46302 : new Date('2026-10-06T15:00:00Z'); });
save({}, first, '2026-10-07', new Date('2026-10-07T04:00:00Z'));
assert.equal(data.length, 4, 'same-day rerun replaces its snapshot');
data.forEach((row, index) => { row[0] = index % 2 ? 46302 : new Date('2026-10-06T15:00:00Z'); });
trends = save({}, [task('HEADSUP', 'PM A', 'en_US-ja_JP', '12'),
  task('REVIEW', 'PM A', 'en_US-ja_JP', '101, 102')],
'2026-10-08', new Date('2026-10-08T02:00:00Z'));
assert.equal(trends['PM A'].headsUpDelta, -1);
assert.equal(trends['PM A'].reviewDelta, 1);
assert.match(format(trends['PM A']), /헤즈업 -1명 \| 검토 필요 \+1명/);
trends = save({}, [task('HEADSUP', 'PM A', 'en_US-ja_JP', '12'),
  task('REVIEW', 'PM A', 'en_US-ja_JP', '101')],
'2026-10-09', new Date('2026-10-09T02:00:00Z'));
assert.equal(trends['PM A'].stalled, 2, 'only rows present on all three days count');
assert.match(format(trends['PM A']), /같은 원본 행 3일 연속 남음: 2건/);
trends = save({}, [], '2026-10-10', new Date('2026-10-10T02:00:00Z'));
assert.equal(trends['PM A'].headsUpDelta, -1, 'disappearing owner remains in comparison');
assert.equal(trends['PM A'].reviewDelta, -1);
assert.match(format(trends['PM A']), /헤즈업 -1명 \| 검토 필요 -1명/);
const historyDay = vm.runInContext('haCvHistoryDay_', context);
assert.equal(data.filter(row => historyDay(row[0]) === '2026-10-07').length, 4,
  'past day remains');
console.log('Bot daily history checks passed');
save({}, [], '2027-02-01', new Date('2027-02-01T02:00:00Z'));
assert.equal(data.length,1,'history older than 90 days is removed; current scan remains');
