const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({
  console,
  BRIEFING: { timezone: 'Asia/Seoul' },
  Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
});
vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/central-bot/06_검수와어뷰저.js', 'utf8'), context);

// HACV_PP 모양: 위쪽 안내 표, 9행 제목줄(열 순서는 실제와 다르게 섞음), 10행부터 데이터.
const header = ['Batch', 'No', '언어쌍', '메모', 'Status', '언어쌍 담당 PM', '시작일', '목표 종료일/취합 예정일'];
const row = (stage, no, pair, status, pm, end) => [stage, no, pair, '', status, pm, '', end];
const display = [
  ['Campaign', 'ID', 'Link', '', '', '', '', ''],
  ['test.web', '326', 'https://example.test', '', '', '', '', ''],
  header,
  row('test.web', '101', 'en_US-ja_JP', '구축중', 'PM A', '2026-10-12'),
  row('ta.text', '102', 'en_US-ja_JP', '구축중', 'PM A', '2026-10-12'),
  row('test.web', '103', 'de_DE-fr_FR', '구축중', 'PM A', '2026-10-20'),
  row('test.web', '104', 'ko_KR-en_US', '작업 종료', 'PM A', '2026-10-10'),
  row('sms.short', '105', 'fr_FR-ru_RU', '구축중', 'PM B', '2026-10-08'),
  row('sms.long', '106', 'fr_FR-ru_RU', '투입 대기 중', 'PM B', '2026-10-08'),
  row('test.web', '107', 'it_IT-es_ES', '구축중', '', '2026-10-09'),
  ['', '', '', '', '', '', '', ''],
  header,
  row('tests.system', '108', 'pl_PL-uk_UA', '구축중', 'PM C', '2026-10-09'),
];
const values = display.map(cells => [...cells]);
// 날짜 칸이 Date 값으로 오는 경우 (PM B의 두 번째 행). 표시값은 연도 없는 형식.
values[8][7] = vm.runInContext('new Date("2026-10-13T00:00:00Z")', context);
display[8][7] = '10/13';
const source = (rows = display) => ({
  getSheetByName: name => name === 'HACV_PP' ? {
    getSheetId: () => 77,
    getDataRange: () => ({ getDisplayValues: () => rows, getValues: () => values }),
  } : null,
});

const collect = vm.runInContext('collectHaCvPpDashboards_', context);
const dashboards = collect(source());
assert.equal(dashboards.map(item => item.pm).join(','), 'PM A,PM B,PM C',
  'rows without a PM are skipped; repeated header rows are handled');
const pmB = dashboards.find(item => item.pm === 'PM B');
assert.equal(pmB.records[1].targetEnd, '2026-10-13', 'Date cells are read as dates, not display text');
assert.equal(dashboards[2].records[0].sheetRow, 13);

const upcoming = vm.runInContext('buildHaCvPpUpcomingTasks_', context);
const url = 'https://docs.google.com/spreadsheets/d/x/edit';
const now = new Date('2026-10-08T02:00:00Z');
const dueA = upcoming('PM A', dashboards[0].records, '2026-10-08', url, 77, now);
assert.equal(dueA.length, 1, 'same pair and date are one item; out-of-range and finished rows excluded');
assert.equal(dueA[0][0], 'HACV_DUE_SOON|PM A|en_US-ja_JP|2026-10-12');
assert.equal(dueA[0][2], '101, 102');
assert.match(dueA[0][5], /^test\.web\/ta\.text 구축중/);
assert.equal(dueA[0][7], '2026-10-12');
assert.equal(dueA[0][10], url + '#gid=77&range=A4:AH4');

const abuse = vm.runInContext('buildHaCvPpAbuseTasks_', context);
const abuseB = abuse('PM B', pmB.records, '2026-10-08', url, 77, now);
assert.equal(abuseB.length, 1);
assert.equal(abuseB[0][0], 'HACV_ABUSE|PM B|fr_FR-ru_RU|2026-10-08');
assert.equal(abuseB[0][7], '2026-10-09', 'abuse check is due the next day');
const abuseNext = abuse('PM B', pmB.records, '2026-10-09', url, 77, now);
assert.equal(abuseNext.length, 1);
assert.equal(abuseNext[0][0], abuseB[0][0]);
assert.equal(abuseNext[0][7], '2026-10-09', 'next-day PP reminder preserves deadline');
assert.equal(abuse('PM B', pmB.records, '2026-10-10', url, 77, now).length, 0);
assert.equal(upcoming('PM B', pmB.records, '2026-10-08', url, 77, now).length, 1,
  'today counts as due soon too');

assert.throws(() => collect(source([['Batch', 'No'], ['x', '1']])),
  /가장 비슷한 행: 1행 \| 빠진 제목: 언어쌍, Status, 언어쌍 담당 PM, 목표 종료일 \| 그 행의 제목들: Batch \/ No/,
  'missing header fails loudly and says which labels are missing');
assert.throws(() => collect(source([['', ''], ['#REF!', '']])), /하나도 찾지 못했습니다.*IMPORTRANGE/);
const wrapped = display.map(cells => [...cells]);
wrapped[2] = header.map(label => label.replace(' 담당 ', '\n담당  '));
assert.equal(collect(source(wrapped)).length, 3, 'line breaks and double spaces in headers still match');
assert.throws(() => collect({ getSheetByName: () => null }), /HACV_PP 탭이 없습니다/);
console.log('HACV_PP deadline source checks passed');
