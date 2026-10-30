const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. 14시 오후 업데이트 문안과 피드백 버튼·기록.
const kst = (date, _tz, pattern) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return pattern.replace(/yyyy|MM|dd|HH|mm/g, k => p[{yyyy: 'year', MM: 'month', dd: 'day', HH: 'hour', mm: 'minute'}[k]]);
};
const values = new Map([['BOT_SPREADSHEET_ID', 'bot']]);
const props = {getProperty: k => values.has(k) ? values.get(k) : null, setProperty: (k, v) => values.set(k, v)};
const feedbackRows = [], fetches = [];
const ctx = vm.createContext({console: {log: () => {}}, BRIEFING: {timezone: 'Asia/Seoul'}, Utilities: {formatDate: kst},
  escapeSlack_: v => String(v), formatBriefingDay_: () => '10/26(월)',
  formatHaCvBriefing_: (pm, rows) => '📌 head\n\n*오늘 확인할 업무*\n' + rows.map(r => '• ' + r[0]).join('\n'),
  formatPersonalSlackDigest_: items => '\n\n💬 *Slack*\n' + items.map(i => '• ' + i.title).join('\n'),
  requiredProperty_: (p, k) => p.getProperty(k), SpreadsheetApp: {openById: () => ({})},
  ensureBotSheet_: () => ({appendRow: r => feedbackRows.push(r)}),
  UrlFetchApp: {fetch: (url, opt) => fetches.push({url, opt})}, ContentService: {createTextOutput: t => t},
  PropertiesService: {getScriptProperties: () => props}});
for (const f of ['29_오후업데이트.js', '30_피드백.js', '25_점심메이트.js']) vm.runInContext(fs.readFileSync('src/central-bot/' + f, 'utf8'), ctx);

// ── 14시 문안
const quiet = ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [], [], '', '\n\n_기준_');
assert.equal(quiet.quiet, true);
assert.equal(quiet.text, '🕑 *PM A* 님, 10/26(월) 오전 이후 새로운 알림이 없습니다. 점심 맛있게 드셨나요? 🍚');
const news = ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [['PM_REVIEW|9']], [{title: '새 요청'}], '', '\n\n_기준_');
assert.equal(news.quiet, false);
assert.match(news.text, /^🕑 \*PM A\* 님, 10\/26\(월\) 오후 업데이트입니다\.\n\n📌 \*오전 이후 새로 생긴 업무\*\n• PM_REVIEW\|9\n\n💬 \*새 Slack\*\n• 새 요청\n\n_기준_$/);
assert.match(ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [['X|1']], [], '', '').text, /오전 이후 새 요청·안내 없음/);
// 14:00에도 오늘 남은 회의: 새 소식이 없어도 붙고(quiet 유지), 있으면 업무와 Slack 사이에 들어간다.
const meet = '\n\n📅 *오늘 회의*\n• 15:00 리뷰';
const quietMeet = ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [], [], '', '\n\n_기준_', meet);
assert.equal(quietMeet.quiet, true);
assert.equal(quietMeet.text, '🕑 *PM A* 님, 10/26(월) 오전 이후 새로운 알림이 없습니다. 점심 맛있게 드셨나요? 🍚\n\n📅 *오늘 회의*\n• 15:00 리뷰\n\n_기준_');
assert.match(ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [['PM_REVIEW|9']], [{title: '새 요청'}], '', '\n\n_기준_', meet).text,
  /• PM_REVIEW\|9\n\n📅 \*오늘 회의\*\n• 15:00 리뷰\n\n💬 \*새 Slack\*\n• 새 요청\n\n_기준_$/);
const failed = ctx.formatAfternoonUpdate_('PM A', '2026-10-26', [], [], '사유: 읽기 제한', '');
assert.equal(failed.quiet, false, 'Slack failure is not reported as "nothing new"');
assert.match(failed.text, /읽어오지 못했습니다 — 사유: 읽기 제한/);
const day = new Date('2026-10-26T10:31:00+09:00');
const log = [[day, 'scheduled-11:00', 'PM A', 'A|1, B|2', 'sent'], [day, 'scheduled-11:00', 'PM B', 'C|3', 'sent'],
  [new Date('2026-10-23T10:31:00+09:00'), 'scheduled-11:00', 'PM C', 'Z|9', 'sent']];
assert.equal(JSON.stringify(ctx.morningTaskKeys_(log, '2026-10-26', 'PM A')), '["A|1","B|2"]');
// 오전 DM이 실패해 오늘 기록이 없으면 직전 정기 DM(7일 안)과 비교한다. 더 오래됐거나 시험 발송뿐이면 비교하지 않는다.
assert.equal(JSON.stringify(ctx.morningTaskKeys_(log, '2026-10-26', 'PM C')), '["Z|9"]', 'falls back to the last scheduled DM');
const fallbackLog = [[new Date('2026-10-23T17:01:00+09:00'), 'scheduled-17:00', 'PM D', 'K|1', 'sent'],
  [new Date('2026-10-23T10:31:00+09:00'), 'scheduled-11:00', 'PM D', 'OLD|1', 'sent'],
  [new Date('2026-10-26T10:31:00+09:00'), 'manual-self-morning-test', 'PM D', 'T|1', 'sent'],
  [new Date('2026-10-15T17:01:00+09:00'), 'scheduled-17:00', 'PM E', 'Q|1', 'sent']];
assert.equal(JSON.stringify(ctx.morningTaskKeys_(fallbackLog, '2026-10-26', 'PM D')), '["K|1"]', 'latest scheduled one, tests ignored');
assert.equal(ctx.morningTaskKeys_(fallbackLog, '2026-10-26', 'PM E'), null, 'older than 7 days is not used');
assert.equal(ctx.briefingSlotLabel_('11:00'), '10:30 오전'); assert.equal(ctx.briefingSlotLabel_('14:00'), '14:00 오후');
const at = t => new Date('2026-10-26T' + t + ':00+09:00');
assert.equal(ctx.currentBriefingSlot_(at('10:20')), '11:00'); assert.equal(ctx.currentBriefingSlot_(at('14:05')), '14:00'); assert.equal(ctx.currentBriefingSlot_(at('17:03')), '17:00');

// ── 피드백 버튼: Slack 버튼 응답이 설정됐을 때만, 폼은 올바른 주소일 때만
const blocks = [{type: 'section', text: {text: 'x'}}];
assert.equal(ctx.appendFeedbackButtons_(blocks, props, '2026-10-26', '11:00').length, 1, 'no verification token → no buttons');
values.set('SLACK_VERIFICATION_TOKEN', 'verify-test');
let withButtons = ctx.appendFeedbackButtons_(blocks, props, '2026-10-26', '11:00');
assert.equal(JSON.stringify(withButtons.map(b => b.type)), '["section","context","actions"]');
assert.equal(JSON.stringify(withButtons[2].elements.map(e => e.action_id)), '["feedback_up","feedback_down","feedback_form"]', 'default form link shown');
assert.match(withButtons[2].elements[2].url, /^https:[/][/]forms[.]gle[/]/);
assert.equal(withButtons[2].elements[0].value, '2026-10-26|11:00');
values.set('FEEDBACK_FORM_URL', 'https://evil.example/form');
assert.equal(ctx.appendFeedbackButtons_(blocks, props, '2026-10-26', '11:00')[2].elements[2].url, vm.runInContext('FEEDBACK.formUrl', ctx), 'non-Google form URL ignored → default form');
values.set('FEEDBACK_FORM_URL', 'https://forms.gle/abc123');
withButtons = ctx.appendFeedbackButtons_(blocks, props, '2026-10-26', '17:00');
assert.equal(withButtons[2].elements[2].url, 'https://forms.gle/abc123');
values.set('ENABLE_FEEDBACK', 'false');
assert.equal(ctx.appendFeedbackButtons_(blocks, props, '2026-10-26', '11:00').length, 1);
values.delete('ENABLE_FEEDBACK');
assert.equal(ctx.appendFeedbackButtons_(Array(49).fill(blocks[0]), props, '2026-10-26', '11:00').length, 49, 'block limit respected');

// ── 버튼 누름 → 검증 → 시트 기록 → 누른 사람에게만 답장
const press = (action, extra) => ctx.handleSlackInteraction_({parameter: {payload: JSON.stringify(Object.assign({type: 'block_actions',
  token: 'verify-test', user: {id: 'U00000077', name: 'user.a'}, response_url: 'https://hooks.slack.com/actions/T/1/x', actions: [action]}, extra || {}))}});
press({action_id: 'feedback_up', value: '2026-10-26|11:00'});
assert.equal(feedbackRows.length, 1);
assert.equal(JSON.stringify(feedbackRows[0].slice(1)), JSON.stringify(['U00000077', 'user.a', '2026-10-26', '10:30 오전', '👍']));
assert.match(JSON.parse(fetches.at(-1).opt.payload).text, /고마워요/);
press({action_id: 'feedback_down', value: '2026-10-26|14:00'});
assert.equal(feedbackRows[1][5], '👎'); assert.equal(feedbackRows[1][4], '14:00 오후');
press({action_id: 'feedback_up', value: 'bad'});
press({action_id: 'feedback_form', url: 'https://forms.gle/abc123'});
assert.equal(feedbackRows.length, 2, 'bad values and form-link clicks are not recorded');
press({action_id: 'feedback_up', value: '2026-10-26|11:00'}, {token: 'wrong'});
assert.equal(feedbackRows.length, 2, 'wrong verification token ignored');
console.log('Afternoon update and feedback button checks passed');
