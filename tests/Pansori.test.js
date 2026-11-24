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
  assert.equal(context.pansoriOwnLines_(slots, A), null, 'shared greeting line stays ambiguous');
  const single = context.pansoriMentionRecords_(m('*[배정]*\n• 담당\n    ◦ 10시 독도 - <@' + A + '>\n    ◦ 12시 우유니 - <@' + B + '>', '1700000100.000001', L), me, r2);
  assert.equal(single.length, 1); assert.equal(single[0].pansoriAmbiguous, false);
  assert.match(single[0].pansoriMine, /10시 독도/); assert.match(single[0].url, /^https:\/\/example\.slack\.com\/archives\/C00000001\//);

  // ② 답장: 요청 뒤 요청자를 멘션한 내 글이 있으면 replied, 다른 사람에게 단 글은 인정하지 않음
  const req = context.pansoriMentionRecords_(m('<@' + A + '> 님, 위키와 v2 시트 검토 부탁드립니다', '1700000200.000001', L), me, r2);
  const replied = context.markPansoriReplies_(req, [m('<@' + L + '> 님, 검토했습니다', '1700000300.000001', A)]);
  assert.equal(replied[0].replied, true, 'reply mentioning requester counts');
  const other = context.markPansoriReplies_(req, [m('<@' + B + '> 님 자료 공유드립니다', '1700000300.000001', A)]);
  assert.ok(!other[0].replied, 'reply to someone else does not count');
  const before = context.markPansoriReplies_(req, [m('<@' + L + '> 님', '1700000100.000001', A)]);
  assert.ok(!before[0].replied, 'earlier message is not a reply');

  // ⑤ 할 일 목록, ⑥ 회신 대기
  assert.deepEqual([...context.pansoriChecklist_('• *금일 진행 필요 업무*\n    ◦ *1) 영상 음원 재생 목록 생성*\n    ◦ *2) 녹음 운영 시트 수정 필요 사항 반영*')],
    ['1) 영상 음원 재생 목록 생성', '2) 녹음 운영 시트 수정 필요 사항 반영']);
  assert.equal(context.pansoriChecklist_('1) 하나만').length, 0, 'single number is not a list');
  const waiting = context.refinePansoriDigest_(Object.assign({}, req[0], {deadline:''}));
  assert.equal(waiting.awaitingReply, true, 'direct request without reply waits');
  const done = context.refinePansoriDigest_(Object.assign({}, replied[0], {deadline:''}));
  assert.equal(done.awaitingReply, false, 'replied request is not waiting');

  // DM 선택·표시: 회신 대기는 이미 보냈어도 계속, 답장함은 처음 한 번만 접어서
  vm.runInContext('escapeSlack_ = v => String(v); slackDigestFingerprint_ = item => item.url;', context);
  const base = {pm:'Test A', pansori:true, category:'direct', groupLabel:'판소리', task:'판소리', kind:'확인·회신 요청',
    text:'검토 부탁드립니다', ts:'1700000200.000001', deadline:'', needsReview:true, matchedKinds:[]};
  const wait = Object.assign({}, base, {url:'https://x/1', awaitingReply:true, pansoriChecklist:['1) 가', '2) 나']});
  const rep = Object.assign({}, base, {url:'https://x/2', replied:true});
  const picked = context.selectPersonalSlackItems_('Test A', [wait, rep], ['https://x/1', 'https://x/2'], '2026-11-24', '11:00');
  assert.deepEqual(picked.map(i => i.url), ['https://x/1'], 'waiting stays, replied+seen hidden');
  const text = context.formatPersonalSlackDigest_(context.selectPersonalSlackItems_('Test A', [wait, rep], [], '2026-11-24', '11:00'), '2026-11-24', '11:00', 0);
  assert.match(text, /\*판소리 · 회신 대기\*/); assert.match(text, /☐ 1\) 가/); assert.match(text, /\*판소리 · 답장함 1건\*/);
  const again = context.formatPersonalSlackDigest_(picked, '2026-11-24', '11:00', 0);
  assert.match(again, /\*판소리 · 회신 대기\(이전 안내\) 1건\*/, 'already-sent waiting folds into one line');

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
  assert.equal(context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [Object.assign({}, minutes, {replied:true})], day, '11:00'), '',
    'replied minutes request needs no prep line');
  assert.equal(context.pansoriMeetingPrepLine_(props({}), {pm:'Test A', id:A}, [minutes], '2026-11-25', '11:00'), '', 'no meeting that day');
  console.log('Pansori 11/24: own slot lines, replies, checklist, awaiting reply, thread settings, meeting prep passed');
}
