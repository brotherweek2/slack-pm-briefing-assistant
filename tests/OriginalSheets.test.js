const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 원본 시트 연결: 미리보기는 읽기만, 전환·되돌리기는 속성만 바꾸고 업무 시트에는 아무것도 쓰지 않는다.
const COPY = 'copy_hacv_0000000000000000000000', ORIG = 'orig_hacv_0000000000000000000000';
const ORIG_PM = 'orig_pmreview_00000000000000000000';
function fixture(extra) {
  const values = new Map(Object.entries(Object.assign({SOURCE_SPREADSHEET_ID: COPY, BOT_SPREADSHEET_ID: 'bot_sheet_000000000000000000000'}, extra || {})));
  const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, String(v)),
    deleteProperty: k => values.delete(k)};
  const opened = [], logs = [];
  // 업무 시트 흉내: 읽기 함수만 있고, 쓰기 함수를 부르면 바로 실패한다.
  const sheet = id => new Proxy({id}, {get: (target, name) => {
    if (/^(set|insert|delete|clear|append|copy|remove|add)/.test(String(name))) throw new Error('write attempted on ' + id + ': ' + String(name));
    if (name === 'getName') return () => 'name:' + id.split('_')[0];
    if (name === 'getUrl') return () => 'https://docs.google.com/spreadsheets/d/' + id;
    return target[name];
  }});
  const ctx = vm.createContext({
    console: {log: m => logs.push(m)}, BRIEFING: {timezone: 'Asia/Seoul'},
    PropertiesService: {getScriptProperties: () => props},
    Utilities: {formatDate: () => '2026-10-27'},
    SpreadsheetApp: {openById: id => { if (/^missing/.test(id)) throw new Error('no access'); opened.push(id); return sheet(id); }},
    // 업무 수집은 시트 ID에 따라 다른 건수를 낸다(원본이 1건 더 많음).
    collectHaCvReviewCandidates_: s => ({byPm: {}, unassigned: [], id: s.id}),
    collectHaCvHeadsUpCandidates_: () => ({byPm: {}, unassigned: []}),
    buildHaCvBotTasks_: () => [], buildHaCvHeadsUpTasks_: () => [],
    collectHaCvPmDashboards_: s => /^orig/.test(s.id) ? [{pm: 'PM A', records: [], gid: 1}, {pm: 'PM D', records: [], gid: 2}] : [{pm: 'PM A', records: [], gid: 1}],
    buildHaCvAbuseTasks_: () => [],
    collectPmReviewTasks_: s => [['PM_REVIEW|x', 'PM A']].concat(/^orig/.test(s.id) ? [['PM_REVIEW|y', 'PM D']] : []),
    collectTestReviewTasks_: () => [],
  });
  vm.runInContext(fs.readFileSync('src/central-bot/05_업무시트연결.js', 'utf8'), ctx);
  ctx.buildHaCvUpcomingTasks_ = () => [];
  return {ctx, values, opened, logs};
}

// 1) 원본 칸이 비어 있으면 아무것도 하지 않는다. 주소 형식이 틀리면 멈춘다. 봇 시트와 같으면 멈춘다.
let f = fixture();
assert.throws(() => f.ctx.previewOriginalSheetConnection(), /원본 시트 주소를 먼저/);
f = fixture({ORIGINAL_HACV_SPREADSHEET_ID: 'not a sheet'});
assert.throws(() => f.ctx.previewOriginalSheetConnection(), /형식이 아닙니다/);
f = fixture({ORIGINAL_HACV_SPREADSHEET_ID: 'bot_sheet_000000000000000000000'});
assert.throws(() => f.ctx.previewOriginalSheetConnection(), /봇 시트와 같습니다/);

// 2) 미리보기: 주소를 넣어도 ID를 꺼내고, 지금(사본) → 원본 건수를 나란히 보이며 속성은 그대로다.
f = fixture({ORIGINAL_HACV_SPREADSHEET_ID: 'https://docs.google.com/spreadsheets/d/' + ORIG + '/edit#gid=0',
  ORIGINAL_PM_REVIEW_SPREADSHEET_ID: ORIG_PM});
const before = new Map(f.values);
f.ctx.previewOriginalSheetConnection();
const out = f.logs.join('\n');
assert.match(out, /HA-CV 유저 관리: 원본으로 바뀜 → name:orig/);
assert.match(out, /PM Review: 원본으로 바뀜/);
assert.match(out, /테스트지 관리: 그대로/);
assert.match(out, /업무 합계: 지금 1건 → 원본 2건/);
assert.match(out, /• PM D: 0 → 1/);
assert.match(out, /새로 보이는 담당 탭: PM D/);
assert.deepEqual([...f.values], [...before], 'preview changes no properties');
assert.ok(f.opened.includes(ORIG) && f.opened.includes(ORIG_PM));

// 3) 원본을 못 열면(권한 없음) 미리보기·전환 모두 멈추고 속성은 그대로다.
f = fixture({ORIGINAL_HACV_SPREADSHEET_ID: 'missing_000000000000000000000000'});
assert.throws(() => f.ctx.previewOriginalSheetConnection(), /열기 실패\(보기 권한 확인\)/);
assert.throws(() => f.ctx.switchToOriginalSheets(), /전환 중지/);
assert.equal(f.values.get('SOURCE_SPREADSHEET_ID'), COPY);

// 4) 전환 → 속성만 원본으로, 이전 값 보관, 회차 재사용 기록 삭제. 되돌리기 → 사본으로 복구.
f = fixture({ORIGINAL_HACV_SPREADSHEET_ID: ORIG, ORIGINAL_PM_REVIEW_SPREADSHEET_ID: ORIG_PM, BOT_TASKS_REFRESHED: '{}'});
f.ctx.switchToOriginalSheets();
assert.equal(f.values.get('SOURCE_SPREADSHEET_ID'), ORIG);
assert.equal(f.values.get('PM_REVIEW_SPREADSHEET_ID'), ORIG_PM);
assert.ok(!f.values.has('TEST_MANAGEMENT_SPREADSHEET_ID'), 'unchanged sheet keeps its default');
assert.ok(!f.values.has('BOT_TASKS_REFRESHED'));
assert.deepEqual(JSON.parse(f.values.get('COPY_SHEETS_BACKUP')), {SOURCE_SPREADSHEET_ID: COPY, PM_REVIEW_SPREADSHEET_ID: '', TEST_MANAGEMENT_SPREADSHEET_ID: ''});
f.ctx.revertToCopySheets();
assert.equal(f.values.get('SOURCE_SPREADSHEET_ID'), COPY);
assert.ok(!f.values.has('PM_REVIEW_SPREADSHEET_ID'));
assert.ok(!f.values.has('COPY_SHEETS_BACKUP'));
assert.throws(() => f.ctx.revertToCopySheets(), /되돌릴 기록/);

console.log('Original sheet preview, switch and revert checks passed (no writes to work sheets)');
