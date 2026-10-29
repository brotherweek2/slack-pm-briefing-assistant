const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 10/23 성능 개선: BOT_TASKS 일괄 쓰기, 묶음 발송 시 업무 갱신 재사용, 작성자 보존, 처리 시간 요약.

// 1) syncBotTasks_: 업무 100건이어도 시트 호출 수가 업무 수에 비례하지 않는다.
let calls = 0;
function sheet(rows) {
  return {rows, getLastRow: () => rows.length,
    getRange: (row, col, height = 1, width = 1) => { calls++; return {
      getValues: () => rows.slice(row - 1, row - 1 + height).map(r => Array.from({length: width}, (_, i) => r[col - 1 + i] ?? '')),
      setValues: values => values.forEach((v, i) => { while (rows.length < row + i) rows.push([]); v.forEach((x, o) => { rows[row - 1 + i][col - 1 + o] = x; }); }),
      setValue: v => { rows[row - 1][col - 1] = v; }, setNumberFormat: () => {}}; },
    appendRow: r => { calls++; rows.push([...r]); }};
}
const ctx = vm.createContext({console: {log: () => {}}, PropertiesService: {}, SpreadsheetApp: {}});
vm.runInContext(fs.readFileSync('src/central-bot/14_공통설정.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), ctx);
const headers = vm.runInContext('BOT_WORKBOOK.taskHeaders', ctx);
const now = new Date('2026-10-23T02:00:00Z');
const task = (i, active) => ['PM_REVIEW|' + i, 'PM A', '', 'en_US-ko_KR', '1차 검수', 'x', 'y', '', '', 'src', '', String(i), active, now];
const existing = [Array.from(headers)].concat(Array.from({length: 100}, (_, i) => task(i, i !== 5).concat(['APPROVED', '', '', ''])));
const s = sheet(existing);
const detected = Array.from({length: 100}, (_, i) => task(i, true)).filter((_, i) => i !== 7).concat([task(200, true)]);
calls = 0;
ctx.syncBotTasks_(s, detected);
assert.ok(calls <= 6, 'batched read/write, got ' + calls + ' sheet calls');
assert.equal(s.rows.length, 102, 'one new task appended');
assert.equal(s.rows[1 + 7][12], false, 'task missing from source becomes inactive');
assert.equal(s.rows[1 + 5][12], true, 'returning task becomes active');
assert.equal(s.rows[1 + 5][14], 'PENDING', 'returning task needs approval again');
assert.equal(s.rows[1 + 6][14], 'APPROVED', 'manual approval kept');
assert.deepEqual(s.rows.at(-1).slice(12, 15), [true, now, 'PENDING']);

// 2) refreshBotTasksForRound_: 같은 날 15분 안에는 원천을 다시 읽지 않는다.
const values = new Map();
const props = {getProperty: k => values.get(k) || null, setProperty: (k, v) => values.set(k, v)};
let refreshed = 0;
ctx.Utilities = {formatDate: () => '2026-10-23'};
ctx.BRIEFING = {timezone: 'Asia/Seoul'};
ctx.refreshBotTasks = () => { refreshed++; return {pmNames: ['PM A', 'PM B']}; };
const first = ctx.refreshBotTasksForRound_(props);
const second = ctx.refreshBotTasksForRound_(props);
assert.equal(refreshed, 1); assert.equal(first.reused, undefined); assert.equal(second.reused, true);
assert.equal(JSON.stringify(second.pmNames), '["PM A","PM B"]');
const saved = JSON.parse(values.get('BOT_TASKS_REFRESHED')); saved.at -= 16 * 60000; values.set('BOT_TASKS_REFRESHED', JSON.stringify(saved));
ctx.refreshBotTasksForRound_(props);
assert.equal(refreshed, 2, 'older than 15 minutes refreshes again');
ctx.Utilities = {formatDate: () => '2026-10-24'};
ctx.refreshBotTasksForRound_(props);
assert.equal(refreshed, 3, 'a new day always refreshes');

// 3) 채널 본문 캐시도 작성자(user)를 남긴다(관련 Slack 줄의 작성자 이름).
const slack = vm.createContext({});
vm.runInContext(fs.readFileSync('src/central-bot/03_슬랙수집.js', 'utf8'), slack);
let written = null;
slack.appendBbpmDiscoveryCache_({sheet: {getLastRow: () => 1, getRange: () => ({setValues: rows => { written = rows; }})}},
  [{ts: '1790000000.000001', text: 'hello', user: 'U00000001'}]);
assert.equal(JSON.parse(written[0][1]).user, 'U00000001');

// 4) 관리자 요약에 처리 시간이 나오고, 묶음이 4분을 넘으면 경고한다.
const admin = vm.createContext({escapeSlack_: v => String(v)});
vm.runInContext(fs.readFileSync('src/central-bot/23_운영알림.js', 'utf8'), admin);
const info = admin.adminInfoFromJob_({state: 'complete', total: 16, pendingIds: [], failed: 0, elapsedMs: 130000, batches: 2, maxBatchMs: 70000, maxBatchSize: 8});
assert.equal(info.batches, 2); assert.equal(info.maxBatchMs, 70000);
console.log('Round performance checks passed');
