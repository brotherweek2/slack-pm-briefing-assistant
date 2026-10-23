const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/central-bot/06_검수와어뷰저.js', 'utf8'), context);
const build = vm.runInContext('buildHaCvAbuseTasks_', context);
const now = new Date('2026-10-07T05:00:00Z');
const tasks = build('홍길동', [
  { pair: 'en_US-ko_KR', stage: 'ta.text', targetEnd: '2026. 10. 7', firstColumn: 12 },
  { pair: 'en_US-ko_KR', stage: 'tests.system', targetEnd: '2026. 10. 7', firstColumn: 14 },
  { pair: 'de_DE-en_US', stage: 'test.web', targetEnd: '2026. 10. 8', firstColumn: 9 },
], '2026-10-07', 'https://docs.google.com/spreadsheets/d/example/edit', 123, now);
assert.equal(tasks.length, 1, 'same PM and pair have one reminder');
assert.equal(tasks[0][0], 'HACV_ABUSE|홍길동|en_US-ko_KR|2026-10-07');
assert.match(tasks[0][5], /ta.text, tests.system/);
assert.equal(tasks[0][7], '2026-10-08', 'action is due the following day');
assert.match(tasks[0][10], /gid=123&range=L2:L6/);
assert.equal(tasks[0][12], true);
const nextDay = build('홍길동', [
  { pair: 'en_US-ko_KR', stage: 'tests.system', targetEnd: '2026. 10. 7', firstColumn: 12 },
], '2026-10-08', '', 123, now);
assert.equal(nextDay.length, 1, 'reminder remains on the actual deadline');
assert.equal(nextDay[0][0], tasks[0][0], 'task identity is based on target date');
assert.equal(nextDay[0][7], '2026-10-08', 'rerunning next day must not extend deadline');
assert.equal(build('홍길동', [
  { pair: 'en_US-ko_KR', targetEnd: '2026-10-07', firstColumn: 12 },
], '2026-10-09', '', 123, now).length, 0, 'expired reminder is excluded');

const top = Array.from({ length: 6 }, () => Array(12).fill(''));
top[1][7] = 'en_US-ko_KR'; top[1][8] = 'A';
top[3][7] = '해당 배치'; top[4][7] = '구축 상태'; top[5][7] = '목표 종료일';
top[3][8] = 'tests.system'; top[4][8] = '작업 종료'; top[5][8] = '2026. 10. 7';
let dashboardReads=0, dashboardWidths=0;
const sheet = name => ({
  getName: () => name,
  getLastColumn: () => {dashboardWidths++;return 12;},
  getSheetId: () => 321,
  getRange: (row, col, height) => {dashboardReads++;return { getDisplayValues: () => row === 4 && col === 8 && height === 3
    ? [['해당 배치'], ['구축 상태'], ['목표 종료일']] : top };},
});
const source = { getSheets: () => [sheet('홍길동'), sheet('김서연'), sheet('홍길동(아카이브)')],
  getUrl: () => 'https://docs.google.com/spreadsheets/d/example/edit' };
vm.runInContext('function collectPilotDashboard_(top) { return [{ pair: "en_US-ko_KR", stage: "tests.system", status: "구축중", targetEnd: "2026. 10. 7", firstColumn: 9, batches: ["A", "B"] }]; }', context);
const dashboards = vm.runInContext('collectHaCvPmDashboards_', context)(source);
assert.equal(dashboards.length, 2, 'all active PM tabs are discovered');
assert.equal(dashboardReads,2,'one top-range read per active PM tab');
assert.equal(dashboardWidths,2,'each active PM tab width is read once');
assert.equal(dashboards.map(row => row.pm).join(','), '홍길동,김서연');
assert.equal(dashboards.flatMap(({pm,records,gid}) => build(pm,records,'2026-10-07',source.getUrl(),gid,now)).length,2,'live dashboard path excludes archive tabs');
const buildUpcoming = vm.runInContext('buildHaCvUpcomingTasks_', context);
const upcoming = dashboards.flatMap(({ pm, records, gid }) =>
  buildUpcoming(pm, records, '2026-10-07', source.getUrl(), gid, now));
assert.equal(upcoming.length, 2, 'due-soon work is built for every discovered PM');
assert.equal(upcoming.map(row => row[1]).join(','), '홍길동,김서연');
assert.match(upcoming[1][0], /^HACV_DUE_SOON\|김서연\|/);

const reviewHeader = Array(11).fill('');
reviewHeader[1] = '언어쌍'; reviewHeader[6] = 'Status';
reviewHeader[9] = '1차 검수'; reviewHeader[10] = '1차 검수 기한';
const reviewRow = (status, deadline, reviewer = '홍길동님') => {
  const row = Array(11).fill('');
  row[0] = '17358'; row[1] = 'en_US-zh_CN'; row[4] = 'HT train';
  row[6] = status; row[9] = reviewer; row[10] = deadline;
  return row;
};
const reviewRows = [reviewRow('검수 AGENT 완료', '2026-10-10'),
  reviewRow('1차 검수중', '2026-10-07'),
  reviewRow('검수 AGENT 완료', '2026-10-06'),
  reviewRow('1차 검수 완료', '2026-10-10'),
  reviewRow('검수 AGENT 완료', 'TBD'),
  reviewRow('파일 변환 완료', '2026-10-10'),
  reviewRow('검수 AGENT 완료', '2026-10-20')];
const reviewSheet = {
  getLastRow: () => reviewRows.length + 3,
  getSheetId: () => 900,
  getRange: row => ({ getDisplayValues: () => row === 3 ? [reviewHeader] : reviewRows }),
};
const reviewSource = { getSheetByName: name => name === 'PM Review' ? reviewSheet : null,
  getUrl: () => 'https://docs.google.com/spreadsheets/d/review/edit' };
const collectReview = vm.runInContext('collectPmReviewTasks_', context);
const reviewTasks = collectReview(reviewSource, '2026-10-07', now);
assert.equal(reviewTasks.length, 5, 'all unfinished review tasks appear regardless of deadline distance');
assert.equal(reviewTasks[4][7], '2026-10-20', 'future unfinished review remains visible');
assert.equal(reviewTasks[0][1], '홍길동');
assert.equal(reviewTasks[0][2], '17358');
assert.equal(reviewTasks[0][7], '2026-10-10');
assert.match(reviewTasks[0][10], /gid=900&range=J4:K4/);
assert.equal(reviewTasks[2][7], '2026-10-06', 'overdue task remains visible');
assert.match(reviewTasks[2][5], /기한 경과/);
assert.equal(reviewTasks[3][7], '', 'TBD is not presented as a deadline');

const testHeader = Array(8).fill('');
testHeader[0] = 'Language Pair'; testHeader[4] = '검토 완료일';
testHeader[5] = 'Status'; testHeader[7] = '검토 PM';
const testRow = (reviewDue, status, reviewer = '홍길동님') => {
  const row = Array(8).fill('');
  row[0] = 'de_DE-en_US'; row[4] = reviewDue; row[5] = status; row[7] = reviewer;
  return row;
};
const testRows = [testRow('2026-10-10', '생성 완료'),
  testRow('2026-10-09', '검토 중'),
  testRow('2026-10-08', '검토 완료'),
  testRow('2026-10-07', '업로드 완료'),
  testRow('2026-10-11', '생성 중'),
  testRow('2026-10-12', '생성 완료', '')];
const testSheet = {
  getLastRow: () => testRows.length + 1,
  getSheetId: () => 800,
  getRange: row => ({ getDisplayValues: () => row === 1 ? [testHeader] : testRows }),
};
const testSource = { getSheetByName: name => name === 'HT 테스트지 제작 관리(ing)' ? testSheet : null,
  getUrl: () => 'https://docs.google.com/spreadsheets/d/tests/edit' };
const collectTest = vm.runInContext('collectTestReviewTasks_', context);
const testTasks = collectTest(testSource, now);
assert.equal(testTasks.length, 2, 'assigned creation-complete and in-review tasks appear');
assert.equal(testTasks[0][1], '홍길동');
assert.equal(testTasks[0][7], '2026-10-10', 'E is the review deadline');
assert.equal(testTasks[1][7], '2026-10-09');
assert.match(testTasks[0][6], /F열을 검토 완료로 변경/);
assert.match(testTasks[0][10], /gid=800&range=H2/);
console.log('Additional PM task checks passed');
