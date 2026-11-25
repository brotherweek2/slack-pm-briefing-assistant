const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('src/central-bot/33_판소리.js','utf8'),context);
const route={ids:['U00000001','U00000002']};
const recipients=[{pm:'Test A',id:route.ids[0]},{pm:'Test B',id:route.ids[1]},{pm:'Outside',id:'U00000003'}];
const msg=text=>({text,ts:'1700000001.000001',sourceChannel:'C00000001',sourceThreadTs:'1700000000.000001'});
const records=text=>context.pansoriMentionRecords_(msg(text),recipients,route);
assert.equal(records('<@U00000001> 가이드 확인 부탁드립니다\n(cc. <@U00000002>)').length,1);
assert.equal(records('<!here> 위클리 회의록 업데이트 부탁드립니다').length,2);
assert.equal(records('감사합니다').length,0);
assert.equal(records('~<@U00000001> 취소된 내용~').length,0);
const sections=records('업무 요청\n담당자: <@U00000001>\n가이드 검토 기한 11/25\n담당자: <@U00000002>\n녹음 준비 기한 11/26');
assert.equal(sections.length,2);assert.ok(!sections[0].text.includes('11/26'));
const mixed=records('<@U00000001> <@U00000002>\n1. 녹음 준비 11/25\n2. 계약 검토 11/26');
const refined=context.refinePansoriDigest_({...mixed[0],deadline:'11/25'});
assert.equal(refined.deadline,'');assert.equal(refined.needsReview,true);
assert.equal(context.readPansoriRoute_({getProperty:()=>null}),null);
assert.throws(()=>context.readPansoriRoute_({getProperty:()=> 'true'}),/PANSORI_RECIPIENT_IDS/);
console.log('Pansori routing, cc, common notices, per-owner deadlines and ambiguous requests passed');
vm.runInContext(fs.readFileSync('src/central-bot/04_슬랙업무분류.js','utf8'),context);
const postedTs=String(Date.parse('2026-11-23T01:54:23Z')/1000);
const event=text=>({pm:'Test A',pansori:true,ts:postedTs,text});
assert.equal(context.pansoriPastMeetingNotice_(event('[프로젝트 온보딩]\n아래 일정으로 초대 드렸습니다.\n14:10 독도'), '2026-11-24'),true);
assert.equal(context.pansoriPastMeetingNotice_(event('위클리 일정 11/25 17:00 예약'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('회의록 작성 요청 기한 11/23'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('온보딩 문서 검토 기한 11/23'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('위클리 일정 매주 화요일 17:00'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('회의 안내 내일 17:00 초대'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('회의 안내 11/22, 11/25 일정'), '2026-11-24'),false);
assert.equal(context.pansoriPastMeetingNotice_(event('회의 초대 확인 부탁드립니다'), '2026-11-24'),false);
vm.runInContext('slackDigestFingerprint_ = () => "synthetic";',context);
const items=[event('[프로젝트 온보딩]\n아래 일정으로 초대 드렸습니다.\n14:10 독도'),event('회의록 작성 요청')];
assert.equal(context.selectPersonalSlackItems_('Test A',items,[],'2026-11-24','11:00').length,1);
console.log('Past meeting excluded before unseen selection; real work, future/recurring/unknown meetings retained');

// ── 11/24 고도화: 실제 판소리 글 모양(합성 ID)으로 확인
{
  vm.runInContext(fs.readFileSync('src/central-bot/03_슬랙수집.js', 'utf8'), context); // slackDigestPlain_이 쓰는 멘션 정리 함수
  const A = 'U00000001', B = 'U00000002', L = 'U00000009';
  const thread = {sourceChannel:'C00000001', sourceThreadTs:'1700000000.000001', sourceHost:'example.slack.com'};
  const m = (text, ts, user) => Object.assign({text, ts, user}, thread);
  const me = [{pm:'Test A', id:A}];
  const r2 = {ids:[A, B]};

  // ① 시간대별 담당 배정: 내 줄과 상위 소제목·제목만 남는다
  const slots = '*[소음 테스트 회의실 예약 완료]*\n<@' + A + '> <@' + B + '> 님, 명일 소음 테스트 일정입니다.\n' +
    '• 회의실 및 테스트 담당자\n    ◦ [오전]\n        ▪︎ 10시 독도 - <@' + A + '>\n        ▪︎ 12시 우유니 - <@' + B + '>\n' +
    '    ◦ [오후]\n        ▪︎ 2시 독도 - <@' + B + '>';
  const own = context.pansoriOwnLines_(slots.split('\n').slice(2).join('\n'), A);
  assert.ok(own && /10시 독도/.test(own.summary) && /\[오전\]/.test(own.summary), 'own slot line with its heading');
  assert.ok(!/우유니|2시 독도/.test(own.text), 'other people lines are dropped');
  // 인사 줄에 둘 다 멘션된 글 전체는 원문 확인(내 줄에 다른 사람 동시 멘션)
  // 11/25: 인사·호칭 줄("@A @B 님, 명일 일정입니다")은 배정이 아니므로 건너뛰고 내 줄만 뽑는다
  const greeted = context.pansoriOwnLines_(slots, A);
  assert.ok(greeted && /10시 독도/.test(greeted.summary) && !/우유니|2시 독도/.test(greeted.text), 'greeting line skipped');
  assert.equal(context.pansoriOwnLines_('<@' + A + '> <@' + B + '> 님, 둘 다 회의록 업데이트 부탁드립니다\n• 10시 - <@' + A + '>', A), null,
    'shared request line (부탁) still counts as shared → ambiguous');
  const single = context.pansoriMentionRecords_(m('*[배정]*\n• 담당\n    ◦ 10시 독도 - <@' + A + '>\n    ◦ 12시 우유니 - <@' + B + '>', '1700000100.000001', L), me, r2);
  assert.equal(single.length, 1); assert.equal(single[0].pansoriAmbiguous, false);
  assert.match(single[0].pansoriMine, /10시 독도/); assert.match(single[0].url, /^https:\/\/example\.slack\.com\/archives\/C00000001\//);

  // 같은 스레드의 활동을 근거로 요청을 숨기지 않는다.
  const req = context.pansoriMentionRecords_(m('<@' + A + '> 님, 위키와 v2 시트 검토 부탁드립니다', '1700000200.000001', L), me, r2);
  // ⑤ 할 일 목록, ⑥ 회신 요청
  assert.deepEqual([...context.pansoriChecklist_('• *금일 진행 필요 업무*\n    ◦ *1) 영상 음원 재생 목록 생성*\n    ◦ *2) 녹음 운영 시트 수정 필요 사항 반영*')],
    ['1) 영상 음원 재생 목록 생성', '2) 녹음 운영 시트 수정 필요 사항 반영']);
  assert.equal(context.pansoriChecklist_('1) 하나만').length, 0, 'single number is not a list');
  const waiting = context.refinePansoriDigest_(Object.assign({}, req[0], {deadline:''}));
  assert.equal(waiting.awaitingReply, true, 'direct request without reply waits');

  // DM 선택·표시: 회신 요청는 이미 보냈어도 계속, 답장함은 처음 한 번만 접어서
  vm.runInContext('escapeSlack_ = v => String(v); slackDigestFingerprint_ = item => item.url;', context);
  const base = {pm:'Test A', pansori:true, category:'direct', groupLabel:'판소리', task:'판소리', kind:'확인·회신 요청',
    text:'검토 부탁드립니다', ts:'1700000200.000001', deadline:'', needsReview:true, matchedKinds:[]};
  const wait = Object.assign({}, base, {url:'https://x/1', awaitingReply:true, pansoriChecklist:['1) 가', '2) 나']});
  const rep = Object.assign({}, base, {url:'https://x/2', replied:true});
  const picked = context.selectPersonalSlackItems_('Test A', [wait, rep], ['https://x/1', 'https://x/2'], '2026-11-24', '11:00');
  assert.deepEqual(picked.map(i => i.url), [], 'morning already sent requests do not repeat');
  assert.equal(context.selectPersonalSlackItems_('Test A', [wait], ['https://x/1'], '2026-11-24', '17:00').length, 1, 'evening repeats reply requests');
  assert.equal(context.selectPersonalSlackItems_('Test A', [wait], ['https://x/1'], '2026-11-24', '14:00').length, 0, 'afternoon new only');
  const text = context.formatPersonalSlackDigest_(context.selectPersonalSlackItems_('Test A', [wait, rep], [], '2026-11-24', '11:00'), '2026-11-24', '11:00', 0);
  assert.match(text, /\*판소리 · 회신 요청\*/); assert.match(text, /\n      1\) 가/); assert.doesNotMatch(text, /☐/); assert.doesNotMatch(text, /답장함/);
  const again = context.formatPersonalSlackDigest_(context.selectPersonalSlackItems_('Test A', [wait], ['https://x/1'], '2026-11-24', '17:00'), '2026-11-24', '11:00', 0);
  assert.match(again, /\*판소리 · 회신 요청\(이전 안내\) 1건\*/, 'already-sent waiting folds into one line');

  // ③ 스레드 목록은 설정값으로만
  const props = v => ({getProperty: k => v[k] === undefined ? null : v[k]});
  const on = {ENABLE_PANSORI_READ:'true', PANSORI_RECIPIENT_IDS:JSON.stringify([A])};
  vm.runInContext('console = {log: () => {}};', context);
  assert.equal(context.readPansoriRoute_(props(on)), null, 'no thread links → skip, do not break collection');
  const route = context.readPansoriRoute_(props(Object.assign({}, on, {PANSORI_THREADS:
    'https://example.slack.com/archives/C00000001/p1700000000000001, https://example.slack.com/archives/C00000001/p1700000000000002'})));
  assert.equal(route.threads.length, 2); assert.equal(route.threads[0].host, 'example.slack.com');
  assert.equal(context.readPansoriRoute_(props(Object.assign({}, on, {PANSORI_THREADS:'not a link'}))), null);

  // ④ 회의 준비: 오늘 판소리 회의 + 답장 안 한 회의록 요청 → 10:30에 한 줄
  const day = '2026-11-24', start = Date.parse(day + 'T17:00:00+09:00');
  vm.runInContext('BRIEFING = {timezone:"Asia/Seoul"};', context);
  context.Utilities = {formatDate:(d, _z, p) => {
    const k = new Date(d.getTime() + 9 * 3600000).toISOString();
    return p === 'yyyy-MM-dd' ? k.slice(0, 10) : p === 'HH:mm' ? k.slice(11, 16) : k;
  }};
  context.selfCalendarRegistry_ = () => [{pm:'Test A', slackId:A, email:'a@example.test'}];
  context.selfCalendarStore_ = () => ({getLastRow:() => 2, getRange:() => ({getValues:() => [['a@example.test',
    JSON.stringify({events:[{title:'[바이칼] Pansori PM Weekly', start, end:start + 3600000, allDay:false}]})]]})});
  context.slackDigestPostedAt_ = () => '11/24';
  const minutes = {pm:'Test A', pansori:true, text:'<!here> 위클리 회의록 업데이트 부탁드립니다', url:'https://x/m',
    ts:String(Date.parse(day + 'T09:00:00+09:00') / 1000)};
  const prep = context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [minutes], day, '11:00');
  assert.match(prep, /판소리 회의 준비/); assert.match(prep, /17:00 \[바이칼\] Pansori PM Weekly 전/);
  assert.equal(context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [minutes], day, '17:00'), '', '10:30 only');
  assert.match(context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [Object.assign({}, minutes, {replied:true})], day, '11:00'), /회의 준비/,
    'legacy reply state cannot hide a meeting request');
  assert.equal(context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [minutes], '2026-11-25', '11:00'), '', 'no meeting that day');
  console.log('Pansori 11/24: own slot lines, replies, checklist, awaiting reply, thread settings, meeting prep passed');
}

// 담당자 아래 업무 설명·기한 보존 및 타 담당자 정보 차단.
const ownBlock = context.pansoriOwnLines_('담당 <@U00000001>\n    녹음 운영 시트 수정\n    기한: 11/26\n담당 <@U00000002>\n    다른 업무 11/27', 'U00000001');
assert.match(ownBlock.text,/녹음 운영 시트 수정/); assert.match(ownBlock.text,/11\/26/); assert.doesNotMatch(ownBlock.text,/11\/27/);
assert.equal(context.pansoriOwnLines_('담당 <@U00000001>\n    재배정 <@U00000002> 업무', 'U00000001'),null);
assert.equal(typeof context.markPansoriReplies_, 'undefined', 'automatic reply inference removed');

// 11/24: @here 글에 특정 사람 몫 줄이 섞여 있어도 나머지 수신자에게 @here 부분은 보인다.
{
  const A = 'U00000001', B = 'U00000002';
  const msg = {sourceChannel:'C00000001', sourceThreadTs:'1700000000.000001', sourceHost:'example.slack.com', ts:'1700000500.000001', user:'U00000009',
    text:'*[위클리 회의록 업데이트]*\n<!here> 금일 위클리 회의록 페이지 전달드립니다.\n5시 전까지 업데이트 부탁드립니다.\n<@' + B + '> 님, 소음 테스트 요약도 설명 부탁드립니다.'};
  const forA = context.pansoriMentionRecords_(msg, [{pm:'Test A', id:A}], {ids:[A, B]});
  assert.equal(forA.length, 1, '@here part reaches the non-mentioned recipient');
  assert.match(forA[0].text, /5시 전까지 업데이트/); assert.doesNotMatch(forA[0].text, /소음 테스트/, 'other person line is not shown');
  assert.equal(forA[0].category, 'group');
  const forB = context.pansoriMentionRecords_(msg, [{pm:'Test B', id:B}], {ids:[A, B]});
  assert.equal(forB[0].category, 'direct'); assert.match(forB[0].text, /소음 테스트/);
  assert.equal(context.pansoriHereLines_('<@' + B + '> 님 먼저\n<!here> 공지'), '', 'here after someone else line is not split');
  console.log('Pansori 11/24: @here part with an extra personal line passed');
}

// 11/24: 한 줄에 시각이 둘이면 요청 표현 앞의 시각이 기한
assert.equal(context.slackDigestDeadline_('두 분 모두 4시까지 검수 진행 후 5시 전까지만 업데이트 해주시면 감사하겠습니다'), '5시 전');
assert.equal(context.slackDigestDeadline_('내일 3시까지 제출'), '내일 3시까지');
console.log('Slack deadline: request-adjacent time passed');

// 11/24: 판정 점검표 — 멘션된 사람 전원 기준, 아무에게도 안 붙은 멘션 글은 ⚠️
{
  const T = {host:'example.slack.com', channel:'C00000001', ts:'1700000000.000001'};
  const m = (ts, text) => ({ts, text, user:'U00000009', sourceChannel:T.channel, sourceHost:T.host, sourceThreadTs:T.ts});
  const snapshot = {meta:{newest:1700001000}, messages:[
    m('1700000100.000001', '*[녹음 준비]*\n<@U00000002> 님, 소음 테스트 진행 부탁드립니다'),
    m('1700000200.000001', '~<@U00000003> 취소~ 공지만 남깁니다'),
    {ts:'1700000300.000001', text:'<@U00000002> 다른 채널', sourceChannel:'C00000009', sourceHost:T.host, sourceThreadTs:'1'}]};
  vm.runInContext(fs.readFileSync('src/central-bot/12_슬랙키워드.js', 'utf8'), context); // 점검표는 실제 분류(키워드)까지 거친다
  const report = context.pansoriClassificationReport_(snapshot, [{pm:'Test B', id:'U00000002'}],
    {channel:T.channel, ids:['U00000001'], threads:[T]}, '2026-11-24').join('\n');
  assert.match(report, /글 2개/, 'only configured threads');
  assert.match(report, /→ Test B · 직접 · 녹음 준비/, 'mentioned non-recipient is checked too');
  assert.match(report, /⚠️ .*멘션이 있는데 아무에게도 안 붙음/, 'struck-through mention flagged');
  assert.match(report, /의심 1건 \/ 2건/);
  console.log('Pansori: classification report passed');
}

// 11/25 피드백: 실제 업무 요청 글 모양 — 인사 줄에 여러 명, 번호 항목마다 담당자·기한
{
  const A = 'U00000001', B = 'U00000002', C = 'U00000003';
  const msg = {sourceChannel:'C00000001', sourceThreadTs:'1700000000.000002', sourceHost:'example.slack.com', ts:'1700000900.000001', user:C,
    text:'*[업무 요청]*\n<@' + B + '>, <@' + A + '> 님,\n금일 위클리에서 전달드렸던 업무 요청 건 정리하여 공유드립니다.\n• *요청 업무:* \n' +
      '    ◦ *1) 녹음 운영 시트 업데이트* - <@' + B + '> 님\n        ▪︎ *기한: ~11/27(금) 퇴근 전*\n' +
      '    ◦ *2) 음원 리스트 추가 서치 -* <@' + A + '> 님\n        ▪︎ *기한: ~ 11/27(금) 퇴근 전* \n' +
      '    ◦ *3) 모더레이터 SOW 반영 완료 -* <@' + C + '> \n        ▪︎ *기한: ~11/27(금) 퇴근 전*'};
  const rec = context.pansoriMentionRecords_(msg, [{pm:'Test A', id:A}], {ids:[A, B, C]});
  assert.equal(rec.length, 1); assert.equal(rec[0].pansoriAmbiguous, false, 'greeting with two people does not block own line');
  assert.match(rec[0].pansoriMine, /2\) 음원 리스트 추가 서치/); assert.match(rec[0].pansoriMine, /11\/27/);
  assert.doesNotMatch(rec[0].pansoriMine, /녹음 운영|SOW|님/, 'other people lines and dangling 님 removed');
  const list = context.pansoriChecklist_(msg.text, A);
  assert.deepEqual([...list], ['1) 녹음 운영 시트 업데이트', '2) 음원 리스트 추가 서치 (내 담당)', '3) 모더레이터 SOW 반영 완료']);
  console.log('Pansori 11/25: greeting line, own task with deadline, checklist owner marks passed');
}
