const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 자료만 사용. DM Slack 영역의 기한 표기는 계산 가능한 날짜를 'MM/dd(요일)'로 통일한다.
const ctx = vm.createContext({escapeSlack_: v => String(v), slackMentionText_: v => String(v || ''), BRIEFING: {timezone: 'Asia/Seoul'}});
vm.runInContext(fs.readFileSync('src/central-bot/04_슬랙업무분류.js', 'utf8'), ctx);

assert.equal(ctx.slackDigestDueLabel_('2026-10-22', '익일'), '10/22(목)');
assert.equal(ctx.slackDigestDueLabel_('2026-10-22', '10/22 (목)'), '10/22(목)');
assert.equal(ctx.slackDigestDueLabel_('2026-10-22', '10/22(목) 오후 3시까지'), '10/22(목) 오후 3시');
assert.equal(ctx.slackDigestDueLabel_('2026-10-22', '내일 퇴근 전'), '10/22(목) 퇴근 전');
assert.equal(ctx.slackDigestDueLabel_('', '원문 확인'), '원문 확인', 'unresolved deadlines stay as written');

// 원문 10/21의 '익일'과 원문 10/20의 '10/22 (목)'이 같은 표기로 나온다.
const ts = d => String(Date.parse(d + 'T10:00:00+09:00') / 1000) + '.000001';
const item = (deadline, posted, category) => ({pm: 'PM A', url: 'https://example.slack.com/x', task: 'TASK', kind: '데이터 검수',
  summary: '', deadline, ts: ts(posted), category, state: '요청・안내', text: '요청'});
const text = ctx.formatPersonalSlackDigest_([item('익일', '2026-10-21', 'direct'), item('10/22 (목)', '2026-10-20', 'bbpm')], '2026-10-22', '11:00');
assert.equal((text.match(/기한 10\/22\(목\)/g) || []).length, 2);
assert.doesNotMatch(text, /익일|10\/22 \(목\)/);
console.log('Slack due label checks passed');

// 3번 개선: 업무 줄 아래로 묶기 · 작성자/첫 구절 · 이전 회차 접기
const abuse = Object.assign(item('10/22 (목)', '2026-10-22', 'direct'), {kind: '어뷰저 관리', authorName: '작성자A',
  text: '안녕하세요.\n이번 주 어뷰저 리스트 작성 부탁드립니다 — 대상 언어쌍은 시트 참고해주세요', url: 'https://example.slack.com/abuse'});
const other = Object.assign(item('', '2026-10-22', 'direct'), {kind: '파일 변환', text: '파일 변환 요청드립니다', url: 'https://example.slack.com/file'});
const work = '☀️ *PM A* 님\n\n📌 *오늘 확인할 업무*\n• <https://docs.google.com/x|어뷰저 관리> 7건 · 작성 기한: 10/22 (오늘) — 대상 확인·리스트 작성\n• 언어쌍 종료 임박 2건';
const merged = ctx.attachSlackToWorkLines_(work, [abuse, other], '2026-10-22');
assert.equal(merged.attached, 1);
assert.equal(JSON.stringify(merged.rest.map(i => i.url)), '["https://example.slack.com/file"]');
const lines = merged.text.split('\n');
assert.match(lines[4], /^   ↳ 관련 Slack \[개인\] <https:\/\/example\.slack\.com\/abuse\|원문 10\/22> · 기한 10\/22\(목\) · 작성자A "이번 주 어뷰저 리스트 작성 부탁드립니다 — 대상…"$/);
assert.equal(lines[5], '• 언어쌍 종료 임박 2건', 'attached under the matching work line only');
const rest = ctx.formatPersonalSlackDigest_(merged.rest, '2026-10-22', '11:00', merged.attached);
assert.match(rest, /\n   ↳ "파일 변환 요청드립니다"/, 'snippet shown even without author name');
assert.match(ctx.formatPersonalSlackDigest_([], '2026-10-22', '11:00', 1), /업무 항목 아래에 함께 표시함 \(1건\)/);

// 이전 회차에 안내된 항목은 링크만 한 줄로 접는다.
const old = n => Object.assign(item('', '2026-10-22', 'direct'), {kind: '작업 ' + n, previouslySent: true, url: 'https://example.slack.com/' + n});
const folded = ctx.formatPersonalSlackDigest_([old(1), old(2), old(3)], '2026-10-22', '11:00');
assert.match(folded, /\*오늘 요청 · 이전 회차에 안내됨\*\n• <[^>]+\|TASK · 작업 1> · <[^>]+\|TASK · 작업 2> · <[^>]+\|TASK · 작업 3>$/);
assert.doesNotMatch(folded, /↳/);
console.log('Slack DM readability checks passed');

// Codex 10/23 검토 반영: 콜론 시각 보존, 묶을 때 BBPM 구분·여러 기한 경고·기한 경과 표시 유지.
assert.equal(ctx.slackDigestDueLabel_('2026-10-22', '10/22 15:00까지'), '10/22(목) 15:00');
const bbpm = Object.assign(item('기한 여러 개 — 원문 확인', '2026-10-20', 'bbpm'), {kind: '어뷰저 관리', url: 'https://example.slack.com/b'});
const late = Object.assign(item('10/21', '2026-10-20', 'direct'), {kind: '어뷰저 관리', url: 'https://example.slack.com/late'});
const kept = ctx.attachSlackToWorkLines_(work, [bbpm, late], '2026-10-22').text.split('\n');
assert.match(kept[4], /^   ↳ 관련 Slack \[BBPM\] <[^>]+\|원문 10\/20> · 기한 여러 개·원문 확인/);
assert.match(kept[5], /\[개인\] .* · 기한 10\/21\(수\) \(경과·상태 확인\)/);

// 미리보기(readOnly)는 저장된 이름만 쓰고 Slack 조회·속성 저장을 하지 않는다.
let apiCalls = 0, writes = 0;
ctx.PropertiesService = {getScriptProperties: () => ({getProperty: () => JSON.stringify({U00000001: '저장된이름'}), setProperty: () => writes++})};
ctx.slackMentionReadApi_ = () => { apiCalls++; return {user: {real_name: '새이름'}}; };
const named = ctx.attachSlackAuthorNames_([{user: 'U00000001'}, {user: 'U00000002'}], '', true);
assert.equal(named[0].authorName, '저장된이름'); assert.equal(named[1].authorName, undefined);
assert.equal(apiCalls, 0); assert.equal(writes, 0);
ctx.attachSlackAuthorNames_([{user: 'U00000002'}], 'token', false);
assert.equal(apiCalls, 1); assert.equal(writes, 1, 'scheduled send looks up and caches new names');
console.log('Codex review regressions passed');

// 11시 실제 출력 피드백: 첫 구절은 단어 경계에서 자르고 열린 괄호를 남기지 않는다.
assert.equal(ctx.slackDigestSnippet_({text: '[10/30(금) HA-CV 납품 대상 파일 검수 일정 (언어쌍별 상이) 안내드립니다'}), '[10/30(금) HA-CV 납품 대상 파일 검수 일정…');
console.log('Snippet cut checks passed');

// 10/23 시험 DM 피드백: 멘션만 있는 첫 줄 대신 내용 있는 줄, [제목] 우선, 답글이 비면 부모 [제목], 작성자는 이름만.
{
  const line = extra => ctx.slackDigestDetailLine_(Object.assign({authorName: '작성자A/TEAM/user.a'}, extra));
  assert.equal(line({text: '<@U00000001> <@U00000002> 님,\n캘린더 및 해당 스레드 확인하시어 참석 부탁드립니다'}),
    '\n   ↳ 작성자A · "캘린더 및 해당 스레드 확인하시어 참석 부탁드립니다"');
  assert.equal(line({text: '<@U00000001>\n안녕하세요.\n[리소스 관리 체계 고도화 관련 안내]\n본문'}), '\n   ↳ 작성자A · [리소스 관리 체계 고도화 관련 안내]');
  assert.equal(line({text: '<@U00000001> ...', threadParentText: '[납품 대상 파일 검수 일정] 안내'}), '\n   ↳ 작성자A · [납품 대상 파일 검수 일정]');
  assert.equal(line({text: '<@U00000001> <@U00000002>, 님,'}), '\n   ↳ 작성자A', 'no "…" or ", , 님," fragments');
  console.log('Snippet quality checks passed');
}
