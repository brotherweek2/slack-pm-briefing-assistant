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
const reviewRows = [reviewRow('검수 Agent 완료', '2026-10-10'), // 원본 표기
  reviewRow('1차 검수중', '2026-10-07'),
  reviewRow('검수 AGENT 완료', '2026-10-06'),
  reviewRow('1차 검수 완료', '2026-10-10'),
  reviewRow('검수 AGENT 완료', 'TBD'),
  reviewRow('파일 변환 완료', '2026-10-10'),
  reviewRow('검수 AGENT 완료', '2026-10-20')];
// 시트 흉내: grid의 1행이 시트 1행. getRange(행, 열, 높이, 너비)는 빈칸을 ''로 채운다.
const gridSheet = grid => ({
  getLastRow: () => grid.length,
  getSheetId: () => 900,
  getRange: (row, col, height, width) => ({ getDisplayValues: () => Array.from({length: height}, (_, i) =>
    Array.from({length: width}, (_, j) => (grid[row - 1 + i] || [])[col - 1 + j] || '')) }),
});
const reviewSource = { getSheetByName: name => name === 'PM Review' ? gridSheet([[], [], reviewHeader, ...reviewRows]) : null,
  getUrl: () => 'https://docs.google.com/spreadsheets/d/review/edit' };
const collectReview = vm.runInContext('collectPmReviewTasks_', context);
const reviewTasks = collectReview(reviewSource, '2026-10-07', now);
// 원본 모양: 1행 묶음 제목, 2행 머리글, J열에 "1차 검수 시작 예정일"이 끼어 담당자 K·기한 L.
const shift = row => row.slice(0, 9).concat([row === reviewHeader ? '1차 검수\n시작 예정일' : '2026-10-01'], row.slice(9));
const originalTasks = collectReview({ getSheetByName: () => gridSheet([['327', '묶음 제목'], shift(reviewHeader), ...reviewRows.map(shift)]),
  getUrl: () => 'https://docs.google.com/spreadsheets/d/review/edit' }, '2026-10-07', now);
assert.deepEqual(originalTasks.map(row => [row[1], row[7]]), reviewTasks.map(row => [row[1], row[7]]));
assert.match(originalTasks[0][10], /range=K3:L3/);
// 키는 행 번호가 아니라 프로젝트·언어쌍이라 행이 밀려도 같은 업무로 본다. 같은 키가 또 나오면 뒤에 행 번호를 붙인다.
assert.equal(originalTasks[0][0], 'PM_REVIEW|17358|en_US-zh_CN');
assert.equal(reviewTasks[0][0], originalTasks[0][0]);
assert.equal(originalTasks[1][0], 'PM_REVIEW|17358|en_US-zh_CN|row4');
assert.equal(new Set(originalTasks.map(row => row[0])).size, originalTasks.length);
assert.throws(() => collectReview({ getSheetByName: () => gridSheet([['언어쌍', 'Status']]) }, '2026-10-07', now), /헤더가 예상과 다릅니다/);
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
const testGridSheet = (grid, id) => ({getLastRow: () => grid.length, getLastColumn: () => grid[0].length, getSheetId: () => id,
  getRange: (r, c, h, w) => ({getDisplayValues: () => grid.slice(r - 1, r - 1 + h).map(x => x.slice(c - 1, c - 1 + w))})});
const testSheet = testGridSheet([testHeader].concat(testRows), 800);
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
// 운영본 새 탭명과 기존 사본 탭명을 모두 지원하되, 모호한 탭·잘못된 파일·헤더는 중지한다.
const currentTestSource = {getSheetByName:name => name === 'HT 테스트지 제작 관리' ? testSheet : null,
  getUrl:testSource.getUrl};
const currentTestTasks = collectTest(currentTestSource, now);
assert.equal(currentTestTasks.length, testTasks.length);
assert.equal(currentTestTasks[0][9], 'HT 테스트지 제작 관리');
assert.equal(testTasks[0][9], 'HT 테스트지 제작 관리(ing)');
assert.equal(currentTestTasks.map(row => row[0]).join(','), testTasks.map(row => row[0]).join(','));
assert.equal(currentTestTasks[0][10], testTasks[0][10], 'tab rename does not change the task link target');
assert.throws(() => collectTest({getSheetByName:() => null}, now), /연결 파일과 탭 이름/);
assert.throws(() => collectTest({getSheetByName:() => testSheet}, now), /대상 탭이 2개/);
assert.throws(() => collectTest({getSheetByName:name => name === 'HT 테스트지 제작 관리' ?
  {...testSheet, getRange:() => ({getDisplayValues:() => [Array(8).fill('')]})} : null}, now), /헤더가 예상과 다릅니다/);
// 원본에 열이 하나 끼고 제목 줄이 생겨도(머리글 2행) 이름으로 찾아 같은 업무를 읽는다. 링크·안내 열 글자도 따라간다.
{
  const shiftTest = row => [row[0], '메모'].concat(row.slice(1));
  const shifted = testGridSheet([['HT 테스트지'].concat(Array(8).fill(''))].concat([testHeader].concat(testRows).map(shiftTest)), 801);
  const moved = collectTest({getSheetByName: name => name === 'HT 테스트지 제작 관리' ? shifted : null, getUrl: testSource.getUrl}, now);
  const noRow = key => key.replace(/\|row\d+$/, '');
  assert.deepEqual(moved.map(r => [noRow(r[0]), r[1], r[7]]), testTasks.map(r => [noRow(r[0]), r[1], r[7]]), 'inserted column and title row do not change tasks');
  assert.match(moved[0][10], /range=I3$/);
  assert.match(moved[0][6], /G열을 검토 완료로 변경/);
}
// 새 양식 담당 탭(10/27~): 줄 전체에서 "프로젝트 · 목표 종료일 · 수량 · 최대 N배치", 다음 줄에 언어쌍 블록 머리글.
// 지난 목표 종료일은 종료, 오늘~7일 안은 종료 임박, 오늘·어제 종료는 어뷰저 관리.
{
  const ctx = vm.createContext({console, BRIEFING: {timezone: 'Asia/Seoul'},
    Utilities: {formatDate: () => '2026-10-28'}});
  vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('src/central-bot/06_검수와어뷰저.js', 'utf8'), ctx);
  const plain = value => JSON.parse(JSON.stringify(value));
  const row = cells => { const r = Array(20).fill(''); Object.entries(cells).forEach(([c, v]) => { r[c] = v; }); return r; };
  const grid = [
    row({0: '가나다 · 언어쌍 관리', 10: '프로젝트별 진행 상태'}),
    row({0: '언어쌍 바로가기'}), row({0: 'pt_BR-zh_CN', 1: 'es_ES-zh_CN'}),
    row({10: '100 · 10/12 · 269개 · 최대 2배치', 11: '101 · 10/30 · 155개 · 최대 2배치', 12: '102 · 11/9 · 3개 · 최대 2배치'}),
    row({0: 'pt_BR-zh_CN', 1: '유저', 2: '이메일', 3: '현재 상태'}),
    row({0: 'A', 1: 'test.web'}),
    row({10: '200 · 10/27 · 248개 · 최대 2배치', 11: '201 · 1/3 · 9개 · 최대 1배치'}),
    row({0: 'es_ES-zh_CN', 1: '유저', 2: '이메일', 3: '현재 상태'}),
  ];
  const tab = (name, rows) => ({getName: () => name, getSheetId: () => 77, getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, h, w) => ({getDisplayValues: () => rows.slice(r - 1, r - 1 + h).map(x => x.slice(c - 1, c - 1 + w))})});
  const boards = ctx.collectHaCvPmDashboards_({getSheets: () => [tab('가나다', grid), tab('_백업_가나다', grid)]});
  assert.deepEqual(plain(boards.map(b => b.pm)), ['가나다'], 'backup tabs are skipped');
  const recs = boards[0].records;
  assert.deepEqual(plain(recs.map(r => [r.pair, r.projectId, r.targetEnd, r.status, r.sheetRow, r.firstColumn])), [
    ['pt_BR-zh_CN', '100', '2026-10-12', '종료', 4, 11],
    ['pt_BR-zh_CN', '101', '2026-10-30', '구축중', 4, 12],
    ['pt_BR-zh_CN', '102', '2026-11-09', '구축중', 4, 13],
    ['es_ES-zh_CN', '200', '2026-10-27', '종료', 7, 11],
    ['es_ES-zh_CN', '201', '2027-01-03', '구축중', 7, 12], // 연말 경계: 가장 가까운 해
  ]);
  const url = 'https://docs.google.com/spreadsheets/d/example/edit';
  const due = ctx.buildHaCvUpcomingTasks_('가나다', recs, '2026-10-28', url, 77, now);
  assert.deepEqual(plain(due.map(r => r[0])), ['HACV_DUE_SOON|가나다|pt_BR-zh_CN|101'], 'only open projects ending within 7 days');
  assert.equal(due[0][5], '프로젝트 101 구축중, 목표 종료일 임박');
  assert.match(due[0][10], /gid=77&range=L4$/);
  assert.equal(due[0][11], 'L4');
  const abuse = ctx.buildHaCvAbuseTasks_('가나다', recs, '2026-10-28', url, 77, now);
  assert.deepEqual(plain(abuse.map(r => r[0])), ['HACV_ABUSE|가나다|es_ES-zh_CN|2026-10-27'], 'ended yesterday → abuse reminder');
  assert.equal(abuse[0][5], '목표 종료일 2026-10-27: 프로젝트 200');
  assert.match(abuse[0][10], /range=K7$/);
  // 10/28 인수인계 배치: 요약이 배치마다 A열(G test.web · I ta.text · K tests.system)에 있고, 바로 아래가 블록 머리글.
  // G·I열도 읽고, 같은 프로젝트가 두 칸에 보이면 한 번만 센다.
  const batchGrid = [
    row({0: '가나다 · 언어쌍 관리'}),
    row({6: '300 · 10/29 · 50개 · 최대 3배치', 8: '301 · 11/2 · 20개 · 최대 1배치', 10: '302 · 10/31 · 10개 · 최대 2배치',
      12: '300 · 10/29 · 50개 · 최대 3배치'}),
    row({0: 'ko_KR-en_US', 2: '유저', 3: '이메일', 4: '현재 상태', 5: '메모', 6: 'test.web\nA', 7: 'B', 8: 'ta.text\nA', 9: 'B'}),
    row({2: '사용자1', 3: 'user1@example.com', 6: '할당 완료'}),
    row({}), row({}),
  ];
  const batchRecs = ctx.collectHaCvPmDashboards_({getSheets: () => [tab('가나다', batchGrid)]})[0].records;
  assert.deepEqual(plain(batchRecs.map(r => [r.pair, r.projectId, r.targetEnd, r.firstColumn])), [
    ['ko_KR-en_US', '300', '2026-10-29', 7],
    ['ko_KR-en_US', '301', '2026-11-02', 9],
    ['ko_KR-en_US', '302', '2026-10-31', 11],
  ], 'G·I열 배치 요약을 읽고 중복 칸은 한 번만');
  // 큰 탭은 한 번에 5만 칸 미만으로 나눠 읽는다. 조각 경계에 요약 줄(위)과 머리글(아래)이 갈려도 결과가 같아야 한다.
  const reads = [];
  const counted = rows => Object.assign(tab('가나다', rows), {getRange: (r, c, h, w) => { reads.push(h * w);
    return {getDisplayValues: () => rows.slice(r - 1, r - 1 + h).map(x => x.slice(c - 1, c - 1 + w))}; }});
  const wide = 1000, tall = [row({0: '가나다 · 언어쌍 관리'})].map(x => x.concat(Array(wide - x.length).fill('')));
  while (tall.length < 48) tall.push(Array(wide).fill(''));
  tall.push(Object.assign(Array(wide).fill(''), {6: '400 · 10/30 · 5개 · 최대 1배치'})); // 49행: 첫 조각(49줄)의 끝
  tall.push(Object.assign(Array(wide).fill(''), {0: 'ko_KR-ja_JP'}));                     // 50행: 다음 조각의 처음
  while (tall.length < 120) tall.push(Array(wide).fill(''));
  const tallRecs = ctx.collectHaCvPmDashboards_({getSheets: () => [counted(tall)]})[0].records;
  assert.deepEqual(plain(tallRecs.map(r => [r.pair, r.projectId, r.sheetRow])), [['ko_KR-ja_JP', '400', 49]], 'chunk boundary keeps pair lookup');
  assert.ok(reads.every(cells => cells < 50000), 'each read stays under 50,000 cells');
  assert.ok(reads.length > 2, 'tall tab is read in several chunks');
}

console.log('Additional PM task checks passed');
