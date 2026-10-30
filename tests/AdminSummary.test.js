const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 관리자 회차 요약·원인별 할 일·하루 1회·기록 정리·시작 실패 알림을 확인한다.
const kst = (date, _tz, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => p[{yyyy: 'year', MM: 'month', dd: 'day', HH: 'hour', mm: 'minute'}[k]]);
};
const at = hm => Date.parse('2026-10-23T' + hm + ':00+09:00');
function fixture(extra) {
  const values = new Map(Object.entries(Object.assign({ENABLE_SELF_CALENDAR_PIPELINE: 'true'}, extra || {})));
  const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, String(v)),
    deleteProperty: k => values.delete(k), getProperties: () => Object.fromEntries(values)};
  const rows = [['PM A', 'U00000001', true], ['PM B', 'U00000002', true], ['PM C', 'U00000003', true]];
  const dms = [], logs = [];
  const ctx = vm.createContext({
    console: {log: m => logs.push(m)}, BRIEFING: {timezone: 'Asia/Seoul'}, escapeSlack_: v => String(v),
    BOT_WORKBOOK: {usersTab: 'BOT_USERS', userHeaders: Array(3)},
    PropertiesService: {getScriptProperties: () => props},
    Utilities: {formatDate: kst, newBlob: s => ({getBytes: () => Buffer.from(String(s))})},
    SpreadsheetApp: {openById: () => ({})}, requiredProperty_: (_p, k) => k === 'SLACK_BOT_TOKEN' ? 'synthetic-token' : 'bot',
    requireBotSheet_: () => ({}), readBotRows_: () => rows,
    findPilotRecipient_: r => ({id: r[0][1], enabled: true}), formatBriefingDay_: () => '10/23(금)',
    readBbpmSnapshot_: () => ({meta: {newest: at('10:52') / 1000}}),
    selfCalendarRegistry_: () => [{pm: 'PM A', email: 'a@example.test'}, {pm: 'PM B', email: 'b@example.test'}, {pm: 'PM C', email: 'c@example.test'}],
    selfCalendarStore_: () => ({getLastRow: () => 3, getRange: () => ({getValues: () => [
      ['a@example.test', JSON.stringify({connected: true, sentAt: at('10:55')})],
      ['b@example.test', JSON.stringify({connected: true, sentAt: at('09:00')})]]})}),
    postSlackDm_: (_t, id, text) => dms.push({id, text}),
    briefingPhraseStateKey_: (route, slot) => 'BRIEFING_PHRASE_' + route.id + slot,
    lunchRecommendationStateKey_: (route, kind) => 'LUNCH_CHOICE_' + route.id + (kind === 'light' ? '_LIGHT' : ''),
  });
  vm.runInContext(fs.readFileSync('src/central-bot/29_오후업데이트.js', 'utf8'), ctx); // 회차 표시 이름·실제 시각
  vm.runInContext(fs.readFileSync('src/central-bot/31_완료버튼.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('src/central-bot/23_운영알림.js', 'utf8'), ctx);
  return {ctx, props, values, dms, logs};
}

// 1) 정상 회차 + 일부 실패: 발송 수·실패 PM·원인별 할 일·일정 지연·미연결·저장 공간.
let f = fixture();
const now = new Date(at('11:03'));
const summary = f.ctx.buildAdminRoundSummary_(f.props, '11:00', {state: 'complete-with-errors', total: 3, pendingIds: [],
  failedIds: ['U00000002'], failures: {U00000002: 'Slack 발송 실패: channel_not_found'}, failed: 1}, now);
assert.equal(summary.adminId, 'U00000001');
assert.match(summary.text, /^🛠 \*10:30 오전 정기 DM 점검\* · 10\/23\(금\)/);
assert.match(summary.text, /• 발송 2\/3명 완료/);
assert.match(summary.text, /• 확인 필요: PM B/);
assert.match(summary.text, /• Slack 자료 10:52 기준\n/);
assert.match(summary.text, /• 일정 연결 2\/3명 · 갱신 지연: PM B\(10\/23 09:00\)/);
assert.match(summary.text, /• 미연결: PM C/);
assert.match(summary.text, /👉 \*할 일\*\n• Slack ID가 바뀌었거나 DM이 막힌 PM/);
assert.match(summary.text, /연결 앱 파일 공유/);
assert.match(summary.text, /• 저장 공간 \d+KB \/ 500KB/);

// 회차가 지난 뒤(11:35) 미리보기: 11:13 자동 갱신은 지연이 아니다. 회차(11:00) 전 20분보다 오래된 09:00만 지연.
const later = f.ctx.buildAdminRoundSummary_(f.props, '11:00', {state: 'complete', total: 3, pendingIds: [], failedIds: [], failed: 0}, new Date(at('11:35')));
assert.match(later.text, /갱신 지연: PM B\(10\/23 09:00\)/);
f.ctx.selfCalendarStore_ = () => ({getLastRow: () => 2, getRange: () => ({getValues: () => [['a@example.test', JSON.stringify({connected: true, sentAt: at('11:13')})]]})});
f.ctx.selfCalendarRegistry_ = () => [{pm: 'PM A', email: 'a@example.test'}];
assert.doesNotMatch(f.ctx.buildAdminRoundSummary_(f.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, new Date(at('11:35'))).text, /갱신 지연/);

// 2) 이상 없으면 '이상 없음'.
f = fixture();
f.ctx.selfCalendarRegistry_ = () => [{pm: 'PM A', email: 'a@example.test'}];
const clean = f.ctx.buildAdminRoundSummary_(f.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: [], failed: 0}, now);
assert.match(clean.text, /✅ 이상 없음$/);
assert.doesNotMatch(clean.text, /할 일/);

// 3) Slack 자료가 오래되면 수집 확인을 안내한다.
f.ctx.readBbpmSnapshot_ = () => ({meta: {newest: at('08:00') / 1000}});
f.values.set('BBPM_COLLECT_LAST_ERROR', 'Slack 읽기 제한');
assert.match(f.ctx.buildAdminRoundSummary_(f.props, '11:00', {}, now).text, /⚠️ \d+분 지남[\s\S]*collectBbpmSnapshot[\s\S]*최근 오류: Slack 읽기 제한/);

// 4) 원인 → 할 일 변환.
const hint = f.ctx.adminFailureHint_;
assert.match(hint('Slack 발송 실패: invalid_auth'), /SLACK_BOT_TOKEN/);
assert.match(hint('Authorization is required to perform that action.'), /권한을 다시 승인/);
assert.match(hint('Slack 발송 실패: 요청 제한. 대기 후 이어 보냅니다.'), /요청 제한/);
assert.match(hint('DM 재전송 차단: 발송 완료 또는 결과 확인 필요.'), /자동 재전송 안 함/);
assert.match(hint('연결 PM 정기 발송 설정 확인 필요'), /ENABLE_PM_SEND/);
assert.match(hint('알 수 없는 오류 XYZ'), /^실행 로그 확인: 알 수 없는 오류 XYZ$/);

// 5) 같은 날짜·회차에는 한 번만 보내고, 17시에는 명단에서 빠진 PM 기록만 정리한다.
f = fixture({SLACK_DIGEST_SEEN_U00000001: '[]', SLACK_DIGEST_SEEN_U00000099: '[]', BRIEFING_PHRASE_U0000009911: '{}',
  'BRIEFING_PHRASE_U0000009917:00': '{}', LUNCH_CHOICE_U00000099: '{}', LUNCH_CHOICE_U00000099_LIGHT: '{}', BOT_DELIVERY_x: '{}'});
f.values.set('BRIEFING_PHRASE_U0000009911:00', '{}');
f.ctx.notifyAdminRoundSummary_('17:00', {state: 'complete', total: 3, pendingIds: [], failedIds: [], failed: 0});
f.ctx.notifyAdminRoundSummary_('17:00', {state: 'complete', total: 3, pendingIds: [], failedIds: [], failed: 0});
assert.equal(f.dms.length, 1, 'one summary per day and slot');
assert.equal(f.dms[0].id, 'U00000001', 'sent only to the admin');
assert.ok(!f.values.has('SLACK_DIGEST_SEEN_U00000099') && !f.values.has('BRIEFING_PHRASE_U0000009911:00') &&
  !f.values.has('BRIEFING_PHRASE_U0000009917:00') && !f.values.has('LUNCH_CHOICE_U00000099') && !f.values.has('LUNCH_CHOICE_U00000099_LIGHT'));
assert.ok(f.values.has('SLACK_DIGEST_SEEN_U00000001') && f.values.has('BOT_DELIVERY_x'), 'current PM and delivery journals kept');
f.ctx.notifyAdminRoundSummary_('11:00', {error: 'x'});
assert.equal(f.dms.length, 2, 'other slot still reported');

// 6) 요약 실패는 삼킨다(정기 발송에 영향 없음). 관리자 ID가 없으면 보내지 않는다.
f = fixture();
f.ctx.postSlackDm_ = () => { throw new Error('Slack 발송 실패: invalid_auth'); };
assert.doesNotThrow(() => f.ctx.notifyAdminRoundSummary_('11:00', {total: 1, pendingIds: [], failedIds: []}));
f = fixture();
f.ctx.findPilotRecipient_ = () => null;
f.ctx.notifyAdminRoundSummary_('11:00', {total: 1, pendingIds: [], failedIds: []});
assert.equal(f.dms.length, 0);

// 7) 시작 실패(09번): 원인과 함께 관리자에게 알리고 오류는 그대로 던진다.
const start = vm.createContext({PropertiesService: {getScriptProperties: () => ({getProperty: k => k === 'ENABLE_CONNECTED_PM_SEND' ? 'true' : null})},
  Utilities: {formatDate: kst}, BRIEFING: {timezone: 'Asia/Seoul'}, console: {log: () => {}}, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [at('11:00')])); } }});
const notes = [];
start.notifyAdminRoundSummary_ = (slot, info) => notes.push({slot, info});
vm.runInContext(fs.readFileSync('src/central-bot/09_자동실행.js', 'utf8'), start);
// 공휴일 판단(28번)은 DayOff.test.js에서 검사한다. 여기서는 이 테스트의 평일 가짜 함수를 따른다.
start.briefingDayOff_ = now => start.isBriefingWeekday_(now) ? '' : '주말';
assert.throws(() => start.sendScheduledBriefing11(), /개인 연결 파이프라인 설정/);
assert.equal(notes.length, 1, 'config error is reported too');notes.length=0;
start.PropertiesService = {getScriptProperties: () => ({getProperty: k => ['ENABLE_CONNECTED_PM_SEND', 'ENABLE_SELF_CALENDAR_PIPELINE'].includes(k) ? 'true' : null})};
start.startConnectedBriefingRound_ = () => { throw new Error('Authorization is required to perform that action.'); };
assert.throws(() => start.sendScheduledBriefing11(), /Authorization/);
assert.equal(notes.length, 1); assert.equal(notes[0].slot, '11:00'); assert.match(notes[0].info.error, /Authorization/);
console.log('Admin round summary, hints, once-per-slot, cleanup and start-failure alerts passed');

// 오후(14:11) 미리보기: 11:10 Slack 자료는 11시 회차 기준으로는 최신이다. 회차 전 오래된 자료(08:00)만 경고.
{
  const g = fixture();
  g.ctx.selfCalendarRegistry_ = () => [];
  g.ctx.readBbpmSnapshot_ = () => ({meta: {newest: at('11:10') / 1000}});
  assert.doesNotMatch(g.ctx.buildAdminRoundSummary_(g.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('14:11'))).text, /지남|collectBbpmSnapshot/);
  g.ctx.readBbpmSnapshot_ = () => ({meta: {newest: at('08:00') / 1000}});
  assert.match(g.ctx.buildAdminRoundSummary_(g.props, '11:00', {}, new Date(at('14:11'))).text, /⚠️ 150분 지남/);
  console.log('Freshness is judged at the round time');
}

// 처리 시간: 묶음 수·가장 긴 묶음·1명당 시간, 4분 초과 시 경고와 할 일.
{
  const g = fixture();
  g.ctx.selfCalendarRegistry_ = () => [];
  const t = g.ctx.buildAdminRoundSummary_(g.props, '11:00', {state: 'complete', total: 16, pendingIds: [], failedIds: [],
    elapsedMs: 130000, batches: 2, maxBatchMs: 72000, maxBatchSize: 8}, new Date(at('11:05'))).text;
  assert.match(t, /• 처리 시간 130초 · 묶음 2개 · 가장 긴 묶음 72초 \(1명당 약 9초\)/);
  assert.doesNotMatch(t, /4분 초과/);
  const slow = g.ctx.buildAdminRoundSummary_(g.props, '11:00', {state: 'complete', total: 8, pendingIds: [], failedIds: [],
    elapsedMs: 250000, batches: 1, maxBatchMs: 250000, maxBatchSize: 8}, new Date(at('11:05'))).text;
  assert.match(slow, /⚠️ 4분 초과[\s\S]*현재 4명씩 처리/);
  const measured=g.ctx.buildAdminRoundSummary_(g.props,'11:00',{state:'complete',total:4,pendingIds:[],failedIds:[],
    elapsedMs:120000,batches:1,maxBatchMs:120000,maxBatchSize:4,
    maxPhaseMs:{workMs:80000,slackMs:10000,prepareMs:5000,deliveryMs:25000}},new Date(at('11:05'))).text;
  assert.match(measured,/구간별 최대: 업무·명단 80초 · Slack 준비 10초 · 문안 준비 5초 · 개인별 구성·발송 25초/);
  console.log('Round timing summary checks passed');
}

// 실제 ID·중복 명단 문제는 알리되, 예전 비언어쌍 PM 경고 이력은 표시하지 않는다.
{
  const g = fixture({ROUTE_ISSUES: JSON.stringify({day: '2026-10-23', slot: '11:00', items: ['PM C: Slack ID 형식 오류 → 이번 회차 제외', 'PM D: 업무 시트 담당자 이름과 맞지 않음 → 업무 없이 발송']})});
  g.ctx.selfCalendarRegistry_ = () => [];
  const t = g.ctx.buildAdminRoundSummary_(g.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('10:40'))).text;
  assert.match(t, /• 명단 확인 필요: PM C: Slack ID 형식 오류/);
  assert.doesNotMatch(t, /PM D|업무 시트 담당 탭 이름과 같게|업무 없이 발송/);
  assert.doesNotMatch(g.ctx.buildAdminRoundSummary_(g.props, '17:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('17:05'))).text, /명단 확인 필요/, 'other rounds unaffected');
  console.log('Roster issues appear in the round summary');
}

// 담당 탭은 있는데 프로젝트를 하나도 못 읽었으면(양식 변경 의심) 같은 날 요약에 경고한다.
{
  const g = fixture({BOT_TASKS_REFRESHED: JSON.stringify({day: '2026-10-23', at: 0, pmNames: ['PM A', 'PM B'], emptyPmTabs: ['PM B']})});
  g.ctx.selfCalendarRegistry_ = () => [];
  const t = g.ctx.buildAdminRoundSummary_(g.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('10:40'))).text;
  assert.match(t, /⚠️ 담당 탭 형식 확인 필요: PM B \(프로젝트 0건\)/);
  assert.match(t, /inspectOriginalSheetStructure/);
  const ok = fixture({BOT_TASKS_REFRESHED: JSON.stringify({day: '2026-10-23', at: 0, pmNames: ['PM A'], emptyPmTabs: []})});
  ok.ctx.selfCalendarRegistry_ = () => [];
  assert.doesNotMatch(ok.ctx.buildAdminRoundSummary_(ok.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('10:40'))).text, /담당 탭 형식/);
  const failedSource = fixture({BOT_TASKS_REFRESHED: JSON.stringify({day: '2026-10-23', at: 0, pmNames: ['PM A'], emptyPmTabs: [],
    sourceFailures: ['테스트지 관리: 탭이 없습니다'], missingPmTabs: ['PM C']})});
  failedSource.ctx.selfCalendarRegistry_ = () => [];
  const st = failedSource.ctx.buildAdminRoundSummary_(failedSource.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('10:40'))).text;
  assert.match(st, /⚠️ 업무 시트 읽기 실패\(직전 결과 유지\): 테스트지 관리: 탭이 없습니다/);
  assert.match(st, /⚠️ 담당 탭이 사라짐: PM C/);
  const partial = fixture({BOT_TASKS_REFRESHED: JSON.stringify({day: '2026-10-23', at: 0, pmNames: ['PM A'], emptyPmTabs: [],
    malformedPmTabs: ['PM A 2칸'], yearGuessed: 3})});
  partial.ctx.selfCalendarRegistry_ = () => [];
  const pt = partial.ctx.buildAdminRoundSummary_(partial.props, '11:00', {state: 'complete', total: 1, pendingIds: [], failedIds: []}, new Date(at('10:40'))).text;
  assert.match(pt, /⚠️ 담당 탭 일부 칸 형식 다름: PM A 2칸/);
  assert.match(pt, /📅 연도 추정 3건/);
  assert.doesNotMatch(st, /연도 추정|일부 칸 형식/, 'no lines when nothing is flagged');
  console.log('Empty PM tabs and unreadable work sheets are flagged in the round summary');
}
