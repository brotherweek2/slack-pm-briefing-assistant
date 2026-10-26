const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

// 합성 자료만 사용. 10/23 추가 기능: D 회의 안내, E 주간 안내·주말 인사, F 점심 메이트(버튼), 내일 날씨.
const kst = (date, _tz, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => p[{yyyy: 'year', MM: 'month', dd: 'day', HH: 'hour', mm: 'minute'}[k]]);
};
const at = (d, hm) => Date.parse(d + 'T' + hm + ':00+09:00');
const values = new Map();
const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, String(v))};
let fetches = [];
const ctx = vm.createContext({
  console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'}, escapeSlack_: v => String(v),
  Utilities: {formatDate: kst, DigestAlgorithm: {SHA_256: 's'}, computeDigest: (_a, t) => [...crypto.createHash('sha256').update(t).digest()]},
  PropertiesService: {getScriptProperties: () => props},
  ContentService: {createTextOutput: t => ({text: t})},
  UrlFetchApp: {fetch: (url, opt) => { fetches.push({url, opt}); return fetchReply(url); }},
  BRIEFING_LUNCH_REMOVED_NAMES: [],
});
let fetchReply = () => ({getResponseCode: () => 500, getContentText: () => ''});
for (const f of ['02_캘린더일정.js', '05_업무시트연결.js', '07_업무브리핑.js', '24_주간안내.js', '25_점심메이트.js', '26_내일날씨.js']) {
  vm.runInContext(fs.readFileSync('src/central-bot/' + f, 'utf8'), ctx, {filename: f});
}

// ── D. 회의: 겹침 경고, 응답 전 2건 이상 모아 알림, 17시 내일 10시 전 첫 일정 표시
const ev = (d, s, e, title, status) => ({title, start: at(d, s), end: at(d, e), allDay: false, status: status || ''});
const snap = {day: '2026-10-23', tomorrowDay: '2026-10-24', now: at('2026-10-23', '11:00'),
  today: [ev('2026-10-23', '15:00', '16:00', '리뷰', '응답 전'), ev('2026-10-23', '15:30', '16:30', '주간', '응답 전'), ev('2026-10-23', '17:00', '17:30', '1:1')],
  tomorrow: [ev('2026-10-24', '09:30', '10:00', '킥오프'), ev('2026-10-24', '14:00', '15:00', '오후 회의')]};
const morning = ctx.formatCalendarBriefing_(snap, false);
assert.match(morning, /• ⚠️ 회의 겹침: 15:00 리뷰 ↔ 15:30 주간/);
assert.match(morning, /• 📨 응답 전 초대 2건/);
assert.doesNotMatch(morning, /17:00 1:1 ↔|이른 시작/);
const evening = ctx.formatCalendarBriefing_(snap, true);
assert.match(evening, /• 내일 09:30 킥오프 · 🌅 이른 시작/);
assert.doesNotMatch(evening, /14:00 오후 회의 · 🌅/);
assert.match(evening, /• ⚠️ 오늘 회의 겹침/);
assert.doesNotMatch(ctx.formatCalendarBriefing_({...snap, today: [ev('2026-10-23', '15:00', '16:00', 'A', '응답 전')]}, false), /📨/, 'one pending invite is already on its line');

// ── E. 주간 안내: 월 11시 이번 주 종료 예정, 금 17시 다음 주 월·화 미리보기, 그 외 없음
const task = (key, pair, due) => [key, 'PM A', '', pair, '', '', '', due, '', '', '', '', true];
const rows = [task('HACV_DUE_SOON|PM A|en_US-ja_JP|x', 'en_US-ja_JP', '2026-10-21'), task('HACV_DUE_SOON|PM A|ko_KR-en_US|y', 'ko_KR-en_US', '2026-10-23'),
  task('HACV_DUE_SOON|PM A|zh_CN-ko_KR|z', 'zh_CN-ko_KR', '2026-10-27'), task('PM_REVIEW|9', 'en_US-ko_KR', '2026-10-26'),
  task('TEST_REVIEW|4', 'ja_JP-ko_KR', '2026-10-28'), ['HACV_DUE_SOON|PM B|x', 'PM B', '', 'de_DE-ko_KR', '', '', '', '2026-10-21', '', '', '', '', true]];
assert.equal(ctx.formatWeeklyOutlook_('PM A', rows, '2026-10-19', '11:00'),
  '\n\n📆 *이번 주 종료 예정*\n• 10/21(수) en_US-ja_JP\n• 10/23(금) ko_KR-en_US', 'Monday: this week only, own tasks only');
assert.equal(ctx.formatWeeklyOutlook_('PM A', rows, '2026-10-19', '17:00'), '');
assert.equal(ctx.formatWeeklyOutlook_('PM A', rows, '2026-10-23', '17:00'),
  '\n\n📆 *다음 주 초 미리보기*\n• 10/26(월) 1차 검수 · en_US-ko_KR\n• 10/27(화) 언어쌍 종료 · zh_CN-ko_KR', 'Friday: next Mon/Tue only');
assert.match(ctx.formatWeeklyOutlook_('PM A', [], '2026-10-23', '17:00'), /월·화 기한 업무 없음/);
assert.equal(ctx.formatWeeklyOutlook_('PM A', rows, '2026-10-22', '17:00'), '');
assert.equal(ctx.formatWeekendCountdown_('2026-10-22', '17:00'), '\n\n🗓️ 주말까지 D-2');
assert.match(ctx.formatWeekendCountdown_('2026-10-23', '17:00'), /D-1 · .*좋은 주말/);
assert.equal(ctx.formatWeekendCountdown_('2026-10-23', '11:00'), '');
assert.equal(ctx.formatWeekendCountdown_('2026-10-21', '17:00'), '');

// ── F. 점심 메이트
const place = (id, name) => ({id, name, category: '식당', enabled: true, status: 'confirmed', menus: ['메뉴1', '메뉴2'], checkedAt: '2026-10-01', recommendation: name + ' 추천'});
const catalog = Array.from({length: 20}, (_, i) => place('L' + i, '예시식당 ' + i)).concat([{...place('C1', '카페'), category: '카페'}]);
const users = Array.from({length: 7}, (_, i) => ['PM ' + i, 'U0000000' + i + '0', i !== 6]);
assert.equal(ctx.lunchMateParticipants_(props, users).length, 0, 'feature off by default');
values.set('ENABLE_LUNCH_MATE', 'true');
assert.equal(ctx.lunchMateParticipants_(props, users).length, 0, 'nobody opted in yet');
for (let i = 0; i < 7; i++) values.set('LUNCH_MATE_U0000000' + i + '0', 'on');
values.set('LUNCH_MATE_U0000000' + 5 + '0', 'off');
const participants = ctx.lunchMateParticipants_(props, users);
assert.equal(participants.length, 5, 'opted-in and send-enabled only (PM 5 off, PM 6 not sending)');
const plan = ctx.lunchMatePlan_(participants, catalog, '2026-10-23');
const groups = new Map(); for (const p of participants) { const k = plan.get(p.id).id; groups.set(k, (groups.get(k) || 0) + 1); }
assert.equal(groups.size, 2, '5 people → 2 places (3 per place)');
assert.ok([...groups.values()].every(n => n >= 2), 'everyone gets at least one mate');
assert.ok([...plan.values()].every(r => r.category === '식당'));
const replan = ctx.lunchMatePlan_([...participants].reverse(), catalog, '2026-10-23');
assert.ok(participants.every(p => replan.get(p.id) === plan.get(p.id)), 'same plan in every batch');
const me = participants[0], light = {name: '가벼운곳'};
const applied = ctx.applyLunchMate_({id: 'Lx', name: '원래', light}, plan, me, '2026-10-23');
assert.equal(applied.id, plan.get(me.id).id); assert.equal(applied.light, light, 'light pick kept');
assert.ok(applied.menus.includes(applied.menu));
const off = {pm: 'PM 9', id: 'U00000099'};
assert.equal(ctx.applyLunchMate_({id: 'Lx'}, plan, off, '2026-10-23').id, 'Lx', 'non-participants keep their own pick');
const mateLine = ctx.formatLunchMateLine_(me, plan, participants);
assert.match(mateLine, /^\n🤝 오늘 \*예시식당 \d+\* 메이트: PM \d 님.* — 같이 가볼까요\?$/);
assert.doesNotMatch(mateLine, new RegExp(me.pm + ' 님'), 'not listing myself');
assert.equal(ctx.formatLunchMateLine_(off, plan, participants), '');
const solo = ctx.lunchMatePlan_([me], catalog, '2026-10-23');
assert.match(ctx.formatLunchMateLine_(me, solo, [me]), /메이트가 없어요/);
// 버튼: 점심 영역 바로 아래, 켜기/끄기 값
const blocks = [{type: 'section', text: {text: '인사'}}, {type: 'divider'}, {type: 'section', text: {text: '🍚 *점심 추천*\n• x'}}, {type: 'divider'}, {type: 'section', text: {text: '✨ 한마디'}}];
const withButton = ctx.insertLunchMateButton_(blocks, ctx.lunchMateButtonBlock_(false));
assert.deepEqual(withButton.map(b => b.type), ['section', 'divider', 'section', 'actions', 'context', 'divider', 'section']);
assert.equal(withButton[3].elements[0].value, 'on'); assert.equal(withButton[3].elements[0].action_id, 'lunch_mate_toggle');
assert.equal(ctx.lunchMateButtonBlock_(true).elements[0].value, 'off');
assert.equal(ctx.insertLunchMateButton_(blocks.filter(b => !/🍚/.test(b.text && b.text.text || '')), ctx.lunchMateButtonBlock_(false)).length, 4, 'no lunch, no button');
// Slack 버튼 응답: 검증 토큰이 맞을 때 누른 본인의 설정만 바꾼다.
const press = (payload) => ctx.handleSlackInteraction_({parameter: {payload: JSON.stringify(payload)}});
const base = {type: 'block_actions', token: 'verify-test', user: {id: 'U00000077'}, response_url: 'https://hooks.slack.com/actions/T/1/abc',
  actions: [{action_id: 'lunch_mate_toggle', value: 'on'}]};
press(base);
assert.equal(values.get('LUNCH_MATE_U00000077'), undefined, 'no verification token configured → ignored');
values.set('SLACK_VERIFICATION_TOKEN', 'verify-test');
press({...base, token: 'wrong'});
assert.equal(values.get('LUNCH_MATE_U00000077'), undefined, 'wrong token ignored');
fetches = [];
press(base);
assert.equal(values.get('LUNCH_MATE_U00000077'), 'on');
assert.equal(fetches.length, 1); assert.match(JSON.parse(fetches[0].opt.payload).text, /켰어요/);
assert.equal(JSON.parse(fetches[0].opt.payload).response_type, 'ephemeral');
press({...base, actions: [{action_id: 'lunch_mate_toggle', value: 'off'}]});
assert.equal(values.get('LUNCH_MATE_U00000077'), 'off');
press({...base, actions: [{action_id: 'other', value: 'on'}]});
assert.equal(values.get('LUNCH_MATE_U00000077'), 'off', 'other actions ignored');
fetches = [];
press({...base, response_url: 'https://evil.example/collect'});
assert.equal(fetches.length, 0, 'replies only to Slack response URLs');

// doPost: Slack 버튼(payload)은 버튼 처리로, 연결 앱 요청은 기존 경로로.
const post = vm.createContext({});
vm.runInContext(fs.readFileSync('src/central-bot/19_개인캘린더연결.js', 'utf8'), post);
let routed = '';
post.handleSlackInteraction_ = () => { routed = 'slack'; return 'ok'; };
post.selfCalendarAuthenticate_ = () => { routed = 'calendar'; throw new Error('x'); };
post.selfCalendarJson_ = v => v; post.PropertiesService = {getScriptProperties: () => props};
post.doPost({parameter: {payload: '{}'}});
assert.equal(routed, 'slack');
post.doPost({parameter: {}, postData: {contents: '{}'}});
assert.equal(routed, 'calendar');

// ── 내일 날씨: 기본 꺼짐, 17시만, 하루 한 번 조회, 실패하면 생략
assert.equal(ctx.formatTomorrowWeather_(props, '2026-10-23', '17:00'), '');
values.set('ENABLE_WEATHER', 'true');
assert.equal(ctx.formatTomorrowWeather_(props, '2026-10-23', '11:00'), '');
fetches = [];
fetchReply = () => ({getResponseCode: () => 500, getContentText: () => ''});
assert.equal(ctx.formatTomorrowWeather_(props, '2026-10-23', '17:00'), '', 'API failure → omitted');
fetchReply = () => ({getResponseCode: () => 200, getContentText: () => JSON.stringify({daily: {time: ['2026-10-23', '2026-10-24'],
  weather_code: [0, 61], temperature_2m_max: [20.4, 17.6], temperature_2m_min: [10.1, 8.4], precipitation_probability_max: [0, 70]}})});
fetches = [];
const weather = ctx.formatTomorrowWeather_(props, '2026-10-23', '17:00');
assert.equal(weather, '\n\n*내일 날씨* · 서울 🌧️ 비 · 8~18°C · 강수 70% ☔ 우산 챙기세요');
assert.match(fetches[0].url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=37\.5665&longitude=126\.978/);
ctx.formatTomorrowWeather_(props, '2026-10-23', '17:00');
assert.equal(fetches.length, 1, 'one request per day (cached)');
assert.equal(ctx.weatherCodeLabel_(0), '☀️ 맑음'); assert.equal(ctx.weatherCodeLabel_(3), '☁️ 흐림'); assert.equal(ctx.weatherCodeLabel_(73), '🌨️ 눈');
console.log('Meeting notes, weekly outlook, lunch mate button and weather checks passed');

// 17시 끝부분: 날씨와 주말 인사를 한 영역(구분선 1개)으로 묶는다.
{
  const notes = ctx.formatEveningNotes_(props, '2026-10-23', '17:00');
  assert.equal(notes, '\n\n*내일 날씨* · 서울 🌧️ 비 · 8~18°C · 강수 70% ☔ 우산 챙기세요\n🗓️ 주말까지 D-1 · 이번 주도 수고하셨어요! 좋은 주말 보내세요');
  assert.equal(ctx.buildBriefingBlocks_ ? 1 : 1, 1);
  assert.equal(ctx.formatEveningNotes_(props, '2026-10-21', '11:00'), '', 'nothing in the morning');
  values.set('ENABLE_WEATHER', 'false');
  assert.equal(ctx.formatEveningNotes_(props, '2026-10-22', '17:00'), '\n\n🗓️ 주말까지 D-2', 'countdown alone when weather is off');
  console.log('Evening notes share one area');
}
