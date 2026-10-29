const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('src/central-bot/13_담당탭읽기.js','utf8'),context);
vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js','utf8'),context);
const top = Array.from({ length: 6 }, () => Array(13).fill(''));
top[1][7] = 'en_US-id_ID';
top[1][8] = 'A'; top[1][9] = 'B';
top[0][8] = '17462'; top[0][9] = '17462';
top[3][8] = 'ta.text'; top[3][9] = 'ta.text';
top[4][8] = '구축중'; top[4][9] = '구축중';
top[5][8] = '2026-10-01'; top[5][9] = '2026-10-01';
const collect = vm.runInContext('collectPilotDashboard_', context);
const records = collect(top);
assert.equal(records.length, 1);
assert.deepEqual(Array.from(records[0].batches), ['A', 'B']);
assert.equal(records[0].pair, 'en_US-id_ID');
assert.equal(records[0].firstColumn, 9);
const buildUpcoming = vm.runInContext('buildHaCvUpcomingTasks_', context);
const candidate = buildUpcoming('PM A', records, '2026-09-29', 'https://example.com/source', 42,
  new Date('2026-09-29T09:00:00Z'));
assert.equal(candidate.length, 1);
assert.equal(candidate[0][1], 'PM A');
assert.equal(candidate[0][2], '17462', 'numeric project ID comes from the PM tab');
assert.equal(candidate[0][7], '2026-10-01');
assert.match(candidate[0][5], /목표 종료일 임박/);
assert.equal(candidate[0][8], '', 'priority remains blank');
assert.match(candidate[0][10], /gid=42&range=I5:I6/);
assert.equal(buildUpcoming('PM A', records, '2026-10-01', 'https://example.com/source', 42,
  new Date()).length, 1, 'target day is included');
assert.equal(buildUpcoming('PM A', records, '2026-10-02', 'https://example.com/source', 42,
  new Date()).length, 0, 'past target is excluded');
assert.equal(buildUpcoming('PM A', records, '2026-09-22', 'https://example.com/source', 42,
  new Date()).length, 0, 'targets beyond seven days are excluded');
assert.equal(buildUpcoming('PM A', [{ ...records[0], status: '작업 종료' }], '2026-09-29',
  'https://example.com/source', 42, new Date()).length, 0);
const sorted = buildUpcoming('PM A', [
  records[0], { ...records[0], pair: 'de_DE-fr_FR', targetEnd: '2026-09-30', firstColumn: 11 },
], '2026-09-29', 'https://example.com/source', 42, new Date());
assert.deepEqual(sorted.map(row => row[7]), ['2026-09-30', '2026-10-01']);
console.log('My HA-CV preview checks passed');
