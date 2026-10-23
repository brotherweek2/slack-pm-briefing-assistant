const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({
  BRIEFING: { timezone: 'Asia/Seoul' },
  escapeSlack_: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'PILOT_PM_NAME' ? 'PM A' : null }) },
  Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
});
const briefingSource = fs.readFileSync('src/central-bot/07_업무브리핑.js', 'utf8');
vm.runInContext(briefingSource, context);
vm.runInContext(fs.readFileSync('src/central-bot/08_일별업무기록.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/central-bot/01_슬랙DM발송.js', 'utf8'), context);
const own = Array(18).fill('');
own[0] = 'HACV_DUE_SOON|PM A|en_US-id_ID|ta.text|V';
own[1] = 'PM A';
own[3] = 'en_US-id_ID';
own[5] = 'ta.text A/B 구축중, 목표 종료일 임박';
own[6] = '종료 일정과 남은 작업 확인';
own[7] = '2026-10-01';
own[10] = 'https://example.test/source';
own[12] = true;
own[14] = 'PENDING';
const other = [...own]; other[1] = 'PM B';
const inactive = [...own]; inactive[12] = false;
const old = [...own]; old[0] = 'HACV_OVERDUE|PM A|en_US-id_ID|ta.text|V';
const nearer = [...own]; nearer[0] = 'HACV_DUE_SOON|PM A|de_DE-fr_FR|ta.text|K';
nearer[3] = 'de_DE-fr_FR'; nearer[7] = '2026-09-30';
const findRecipient = vm.runInContext('findPilotRecipient_', context);
const summarizeCounts = vm.runInContext('summarizeHaCvCounts_', context);
const headsUp = [...own]; headsUp[0] = 'HACV_HEADSUP|PM A|en_US-id_ID';
headsUp[11] = '12, 18';
const review = [...own]; review[0] = 'HACV_REVIEW|PM A|en_US-id_ID';
review[11] = '101, 102, 103';
const counts = summarizeCounts([headsUp, review, inactive]);
assert.equal(counts['PM A'].headsUp, 2);
assert.equal(counts['PM A'].review, 3);
const formatAll = vm.runInContext('formatHaCvBriefing_', context);
const selectOwners = vm.runInContext('selectHaCvPreviewOwners_', context);
assert.equal(selectOwners(['PM C', 'PM D', 'PM A'], [own, other, inactive]).join(','),
  'PM A,PM B,PM C,PM D', 'all active PM tabs and other task owners appear');
const emptyBriefing = formatAll('PM D', [own, other], '2026-10-07');
assert.equal(emptyBriefing, '📌 *PM D* 님 업무 브리핑 · 10/07 (미리보기)\n오늘 확인할 특이사항 없음');
const combined = formatAll('PM A', [own, headsUp, review, other], '2026-10-06');
assert.match(combined, /\*오늘 확인할 업무\*/);
assert.match(combined, /• 헤즈업 대상 2명/);
assert.match(combined, /• 예비 작업자 검토 3명/);
assert.match(combined, /• 언어쌍 종료 임박 1건/);
assert.doesNotMatch(combined, /en_US-id_ID|101행/, 'count summaries omit individual pairs and worker rows');
assert.doesNotMatch(combined, /담당 PM:|종료 임박 0건|검토 상태:|PENDING/);
assert.doesNotMatch(combined, /PM B/);
const abuse = [...own];
abuse[0] = 'HACV_ABUSE|PM A|en_US-id_ID|2026-10-06';
abuse[5] = '오늘 목표 종료일: tests.system';
abuse[6] = '다음날까지 어뷰저 관리 실시';
abuse[7] = '2026-10-07';
const withAbuse = formatAll('PM A', [abuse, own], '2026-10-06');
assert.match(withAbuse, /• 어뷰저 관리 1건 · 작성 기한: 10\/07/);
const directReview = [...own];
directReview[0] = 'PM_REVIEW|44'; directReview[2] = '17358';
directReview[5] = '검수 AGENT 완료'; directReview[7] = '2026-10-10';
const testReview = [...own];
testReview[0] = 'TEST_REVIEW|12'; testReview[5] = '테스트지 생성 완료, 검토 필요';
testReview[7] = '2026-10-09';
const directMessage = formatAll('PM A', [directReview, testReview], '2026-10-07');
assert.match(directMessage, /\*1차 검수 1건\*/);
assert.match(directMessage, /• 프로젝트 17358 · en_US-id_ID · 검수 기한: 10\/10/);
const linkedReview = [...directReview];
linkedReview[5] = 'MTPE 검수 AGENT 완료';
linkedReview[10] = 'https://docs.google.com/spreadsheets/d/test/edit#gid=9&range=J44:K44';
assert.match(formatAll('PM A', [linkedReview], '2026-10-10', null, 'send', '11:00 회차'),
  /<https:[^>]+\|MTPE · 프로젝트 17358 · en_US-id_ID> · 검수 기한: 10\/10 \(오늘\)/);
assert.match(directMessage, /\*테스트지 검토 1건\*/);
assert.match(directMessage, /• HT · en_US-id_ID · 검토 기한: 10\/09/);
const undated = [...testReview]; undated[7] = '';
assert.match(formatAll('PM A', [undated], '2026-10-07'), /• HT · en_US-id_ID · 검토 기한: \(기한 미정\)/);
const manyDueSoon = Array.from({ length: 7 }, (_, index) => {
  const row = [...own]; row[0] += '|sample' + index; row[3] = 'pair-' + index;
  row[7] = '2026-10-1' + index; return row;
});
manyDueSoon[0][10] = 'https://docs.google.com/spreadsheets/d/test/edit#gid=9&range=X5:X6';
const compact = formatAll('PM A', manyDueSoon, '2026-10-07');
assert.match(compact, /<https:\/\/docs\.google\.com\/spreadsheets\/d\/test\/edit#gid=9\|언어쌍 종료 임박> 7건/);
assert.doesNotMatch(compact, /pair-|외 \d+건|range=/, 'due-soon is one count with a tab link');
const edited = [...testReview]; edited[15] = '별도 이슈'; edited[16] = '추가 확인';
assert.match(formatAll('PM A', [edited], '2026-10-07'), /• HT · en_US-id_ID · 검토 기한: 10\/09 — 별도 이슈 \/ 추가 확인/);
assert.doesNotMatch(formatAll('PM A', [own], '2026-10-07', {
  baseline: true, headsUpDelta: 0, reviewDelta: 0, hasThreeDays: false, stalled: 0,
}), /전일 대비/);
assert.equal(findRecipient([['PM A', 'U0000000002', true]]).id, 'U0000000002');
assert.equal(findRecipient([['PM A', 'U0000000002', false]]).enabled, false);
assert.throws(() => findRecipient([['PM A', 'U1', true], ['PM A', 'U2', true]]), /중복/);
const sendPersonal = (() => context.sendPmBriefings_(false));
assert.throws(() => sendPersonal(), /ENABLE_PM_SEND/, 'personal DM is disabled by default');
const routes = vm.runInContext('buildPmSlackRoutes_', context);
assert.equal(routes([['PM A', 'U0000000002', true], ['PM B', '', false]],
  ['PM A', 'PM B']).length, 1, 'only opted-in PMs receive a route');
assert.throws(() => routes([['PM A', 'U0000000002', true],
  ['PM B', 'U0000000002', true]], ['PM A', 'PM B']), /같은 Slack ID/);
assert.throws(() => routes([['PM A', 'U0000000002', true]], ['PM B']), /확인되지 않은 담당 PM/);
assert.throws(() => routes([['PM A', '', true]], ['PM A']), /Slack 사용자 ID/);
const ownOnly = formatAll('PM A', [own, other], '2026-10-07', null, 'send');
assert.doesNotMatch(ownOnly, /PM B|미리보기/);
assert.match(ownOnly, /언어쌍 종료 임박 1건/);
const exact = [...review];
exact[10] = 'https://docs.google.com/spreadsheets/d/test/edit#gid=123&range=F101';
const linked = formatAll('PM A', [exact], '2026-10-07');
assert.match(linked, /<https:[^>]+#gid=123\|예비 작업자 검토> 3명/);
assert.doesNotMatch(linked, /range=|101행|102행|103행/);
const allTypes = formatAll('PM A', [own, headsUp, exact, abuse, linkedReview, testReview, other, inactive], '2026-10-06');
for (const label of ['언어쌍 종료 임박', '헤즈업 대상', '예비 작업자 검토', '어뷰저 관리', '1차 검수', '테스트지 검토']) {
  assert.ok(allTypes.includes(label), 'every connected task kind remains visible: ' + label);
}
assert.equal((allTypes.match(/오늘 확인할 업무/g) || []).length, 1);
assert.doesNotMatch(allTypes, /PM B|PENDING|0명/);
const laterAbuse = [...abuse]; laterAbuse[7] = '2026-10-08';
assert.match(formatAll('PM A', [abuse, laterAbuse], '2026-10-06'),
  /작성 기한: 10\/07[\s\S]*작성 기한: 10\/08/, 'different abuse deadlines stay distinct');
const manyReviews = Array.from({length:7}, (_, i) => {
  const row = [...linkedReview]; row[0]='PM_REVIEW|'+(44+i); row[2]=String(12000+i);
  row[10]='https://docs.google.com/spreadsheets/d/test/edit#gid=9&range=J'+(44+i); return row;
});
const fullReviews = formatAll('PM A', manyReviews, '2026-10-11');
assert.equal((fullReviews.match(/검수 기한:/g) || []).length, 7, 'all direct-review files retain a deadline and link');
assert.match(fullReviews, /프로젝트 12006/);
assert.match(fullReviews, /⚠️ 기한 경과/);
assert.doesNotMatch(fullReviews, /외 \d+건/);
const assertFresh = vm.runInContext('assertFreshPilotTasks_', context);
const dated = [...own];
dated[13] = vm.runInContext('new Date("2026-09-30T09:00:00Z")', context);
assert.throws(() => assertFresh([dated], '2026-10-06'), /오늘 갱신되지 않은/);
dated[13] = vm.runInContext('new Date("2026-10-06T09:00:00Z")', context);
assert.doesNotThrow(() => assertFresh([dated], '2026-10-06'));
console.log('Bot briefing preview checks passed');
