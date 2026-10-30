const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 let clock=Date.parse('2026-10-21T11:00:00+09:00'),held=false,triggers=[],sequence=0,rateOnce=false,ambiguous=false,workDelay=0,sendDelay=0;
 class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const format=(date,zone,pattern)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return pattern.replace(/yyyy|MM|dd|HH|mm/g,k=>p[{yyyy:'year',MM:'month',dd:'day',HH:'hour',mm:'minute'}[k]]);};
 const values=new Map(Object.entries({ENABLE_PM_SEND:'true',ENABLE_CONNECTED_PM_SEND:'true',ENABLE_SELF_CALENDAR_PIPELINE:'true',
  ENABLE_SLACK_MENTION_READ:'true',ENABLE_BRIEFING_PHRASES:'false',ENABLE_LUNCH_RECOMMENDATION:'false'}));
 const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),getProperties:()=>Object.fromEntries(values)};
 const users=Array.from({length:25},(_,i)=>['PM '+i,'U'+String(i+1).padStart(8,'0'),true]);
 const sent=[],logs=[],admin=[],sheets={BOT_USERS:{rows:users},BOT_TASKS:{rows:[]},BOT_SEND_LOG:{rows:[],appendRow:r=>sheets.BOT_SEND_LOG.rows.push(r)}};
 const ctx=vm.createContext({Date:Clock,console:{log:m=>logs.push(m)},BRIEFING:{timezone:'Asia/Seoul'},
  BOT_WORKBOOK:{usersTab:'BOT_USERS',tasksTab:'BOT_TASKS',logTab:'BOT_SEND_LOG',userHeaders:Array(3),taskHeaders:Array(18),logHeaders:Array(5)},
  PropertiesService:{getScriptProperties:()=>props},Utilities:{formatDate:format,getUuid:()=> 'job-'+(++sequence),sleep:ms=>clock+=ms},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(held)return false;held=true;return true;},releaseLock:()=>held=false})},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers=triggers.filter(x=>x!==t),
    newTrigger:name=>({timeBased:()=>({after:delay=>({create:()=>triggers.push({getHandlerFunction:()=>name,delay})})})})},
  SpreadsheetApp:{openById:()=>({})},requiredProperty_:(_p,k)=>k==='BOT_SPREADSHEET_ID'?'synthetic-bot':'synthetic-token',
  requireBotSheet_:(_b,n)=>sheets[n],readBotRows_:s=>s.rows,
  refreshBotTasks:()=>({pmNames:users.map(row=>row[0])}),refreshBotTasksForRound_:()=>{clock+=workDelay;return {pmNames:users.map(row=>row[0]),reused:false};},selectHaCvPreviewOwners_:names=>names,
  briefingLeaveRoutes_:()=>[],selfCalendarFilterRoutes_:routes=>routes,saveHaCvDailyHistory_:()=>({}),assertFreshPilotTasks_:()=>{},
  isHaCvBriefingTask_:()=>true,formatPersonalWorkBriefing_:pm=>'WORK '+pm,escapeSlack_:s=>s,
  loadFreshBbpmSnapshot_:()=>({meta:{newest:clock/1000}}),classifySlackSnapshot_:()=>[],buildSlackDigestItems_:()=>[],
  readSlackDigestSeen_:()=>[],selectPersonalSlackItems_:()=>[],formatPersonalSlackDigest_:()=>'',attachSlackToWorkLines_:(text,items)=>({text,rest:items,attached:0}),attachSlackAuthorNames_:items=>items,
  notifyAdminRoundSummary_:(slot,info)=>admin.push({slot,info}),adminInfoFromJob_:job=>({state:job.state,total:job.total,pendingIds:job.pendingIds,failedIds:job.failedIds||[],failures:job.failures||{},failed:job.failed}),
  retainBriefingSendLog_:(_l,rows)=>rows,markSlackDigestSeen_:()=>{},maskPilotId_:()=> 'masked',
  postSlackDm_:(_token,id,message,slot,blocks)=>{
    if(rateOnce){rateOnce=false;throw Object.assign(Error('rate'),{code:'SLACK_RATE_LIMIT',retryAfterMs:90000});}
    if(ambiguous){ambiguous=false;throw Object.assign(Error('uncertain'),{code:'DM_RESULT_UNCERTAIN'});}
    sent.push({id,message,slot,blocks});clock+=sendDelay;
  }});
 for(const file of ['01_슬랙DM발송.js','20_이어보내기.js','31_완료버튼.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+file,'utf8'),ctx);
 require('./test-briefing-blocks.cjs')(ctx);
 return {ctx,sent,users,values,logs,admin,job:()=>JSON.parse(values.get('CONNECTED_SEND_JOB')||'null'),triggers:()=>triggers,
  advance:ms=>clock+=ms,busy:value=>held=value,rate:()=>rateOnce=true,ambiguous:()=>ambiguous=true,
  workDelay:ms=>workDelay=ms,sendDelay:ms=>sendDelay=ms};
}
let f=fixture();f.ctx.startConnectedBriefingRound_('11:00');
assert.equal(f.sent.length,4);assert.equal(f.job().pendingIds.length,21);assert.equal(f.triggers().length,1);
f.users.push(['Late PM','U0000000006',true]);
for(let i=0;i<6;i++){f.advance(60000);f.ctx.resumeConnectedBriefingSend();assert.ok(f.triggers().length<=1);}
assert.equal(f.sent.length,25);assert.equal(new Set(f.sent.map(s=>s.id)).size,25);
assert.ok(!f.sent.some(s=>s.id==='U0000000006'),'recipient cohort does not expand during retry');
assert.equal(f.job().state,'complete');assert.equal(f.triggers().length,0);
// 회차가 끝나면 관리자 요약을 정확히 한 번 요청한다(중간 배치에서는 보내지 않음).
assert.equal(f.admin.length,1);assert.equal(f.admin[0].slot,'11:00');assert.equal(f.admin[0].info.total,25);assert.equal(f.admin[0].info.pendingIds.length,0);
f.ctx.startConnectedBriefingRound_('11:00');assert.equal(f.sent.length,25,'same round never reopens');
f=fixture();f.busy(true);f.ctx.startConnectedBriefingRound_('11:00');assert.equal(f.sent.length,0);assert.equal(f.triggers().length,1);
f.busy(false);f.advance(60000);f.ctx.resumeConnectedBriefingSend();assert.equal(f.sent.length,4,'busy start keeps durable request');
f=fixture();f.rate();f.ctx.startConnectedBriefingRound_('11:00');
assert.equal(f.sent.length,0);assert.equal(f.job().pendingIds.length,25);assert.equal(f.triggers()[0].delay,90000);
const attempts=f.job().attempts;f.ctx.resumeConnectedBriefingSend();assert.equal(f.job().attempts,attempts,'early manual resume respects wait without spending an attempt');
f.advance(90000);f.ctx.resumeConnectedBriefingSend();assert.equal(f.sent.length,4);
f=fixture();f.ambiguous();f.ctx.startConnectedBriefingRound_('11:00');
for(let i=0;i<6;i++){f.advance(60000);f.ctx.resumeConnectedBriefingSend();}
assert.equal(f.sent.length,24);assert.equal(f.job().state,'complete-with-errors');assert.equal(f.job().failed,1);
assert.ok(!f.sent.some(s=>s.id==='U00000001'),'uncertain delivery is not automatically repeated');
// 실패 PM과 원인이 회차 기록에 남아 관리자 요약으로 전달된다.
assert.equal(JSON.stringify(f.job().failedIds),'["U00000001"]');assert.match(f.job().failures.U00000001,/uncertain/);
assert.equal(f.admin.at(-1).info.failedIds[0],'U00000001');
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.users[4][2]=false;f.advance(60000);f.ctx.resumeConnectedBriefingSend();
assert.ok(!f.sent.some(s=>s.id==='U00000005'),'recipient disabled before continuation is excluded');
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.advance(21*60000);f.ctx.resumeConnectedBriefingSend();
assert.equal(f.sent.length,4);assert.equal(f.job().state,'stopped');assert.equal(f.triggers().length,0);
assert.equal(f.admin.length,1,'stopped round is reported once');assert.equal(f.admin[0].info.pendingIds.length,21);
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.values.set('ENABLE_PM_SEND','false');f.advance(60000);f.ctx.resumeConnectedBriefingSend();
assert.equal(f.sent.length,4);assert.equal(f.job().state,'stopped');
console.log('25-recipient actual sender/worker integration: 4-per-batch, fixed cohort, no duplicates, rate limit, ambiguous response, disable and expiry passed');

// 느린 원천 준비가 4분을 넘으면 전송·실패 처리를 하지 않고 다음 묶음으로 남긴다.
{
 const g=fixture();g.workDelay(250000);g.ctx.startConnectedBriefingRound_('11:00');
 assert.equal(g.sent.length,0);assert.equal(g.job().pendingIds.length,25);assert.equal(g.job().failed,0);
 assert.equal(g.job().maxPhaseMs.workMs,250000);
 g.workDelay(0);
 for(let i=0;i<7;i++){g.advance(60000);g.ctx.resumeConnectedBriefingSend();}
 assert.equal(g.sent.length,25);assert.equal(new Set(g.sent.map(s=>s.id)).size,25);assert.equal(g.job().state,'complete');
 assert.equal(g.job().attempts,8,'smaller batches plus one deferred run fit the new attempt limit');
}

// 한 전송이 느릴 때도 4분 뒤 다음 수신자의 전송을 시작하지 않는다. 성공한 사람은 다시 보내지 않는다.
{
 const g=fixture();g.sendDelay(90000);g.ctx.startConnectedBriefingRound_('11:00');
 assert.equal(g.sent.length,3);assert.equal(g.job().pendingIds.length,22);assert.equal(g.job().failed,0);
 assert.ok(g.job().maxPhaseMs.deliveryMs>=270000);
 g.sendDelay(0);
 for(let i=0;i<6;i++){g.advance(60000);g.ctx.resumeConnectedBriefingSend();}
 assert.equal(g.sent.length,25);assert.equal(new Set(g.sent.map(s=>s.id)).size,25);assert.equal(g.job().state,'complete');
}

// 14시 회차: 같은 이어 보내기 경로로 '오후 업데이트' 문안을 보내고, 발송 기록 회차는 scheduled-14:00.
{
  const g=fixture();g.ctx.startConnectedBriefingRound_('14:00');
  for(let i=0;i<6;i++){g.advance(60000);g.ctx.resumeConnectedBriefingSend();}
  assert.equal(g.sent.length,25);
  assert.ok(g.sent.every(s=>/^AFTERNOON PM \d+$/.test(s.message)),'afternoon text only (no lunch, meetings or phrase)');
  assert.ok(g.sent.every(s=>s.slot==='scheduled-14:00'));
  console.log('14:00 round uses the afternoon update path');
}

// 한 PM의 문안 준비 오류(예: 오래된 업무 자료)는 그 PM만 실패로 남기고 나머지는 보낸다.
{
  const g=fixture();
  g.ctx.assertFreshPilotTasks_=tasks=>{};
  const realFormat=g.ctx.formatPersonalWorkBriefing_;
  g.ctx.formatPersonalWorkBriefing_=(pm,...rest)=>{if(pm==='PM 3')throw new Error('synthetic prep failure');return realFormat(pm,...rest);};
  g.ctx.startConnectedBriefingRound_('11:00');
  for(let i=0;i<6;i++){g.advance(60000);g.ctx.resumeConnectedBriefingSend();}
  assert.equal(g.sent.length,24,'everyone except the failing PM');
  assert.ok(!g.sent.some(s=>s.id==='U00000004'));
  assert.equal(g.job().failed,1);assert.match(g.job().failures.U00000004,/synthetic prep failure/);
  console.log('One PM preparation error does not stop the round');
}

// 원본 하나를 못 읽어 직전 결과로 둔 업무(어제 갱신)는 오늘 갱신 검사에서 빠져, 그 PM도 DM을 받는다.
{
  const g=fixture();
  const staleRow=['TEST_REVIEW|ko_KR-en_US|PM 0','PM 0'].concat(Array(10).fill(''),[true]);
  const realSheet=g.ctx.requireBotSheet_;
  g.ctx.requireBotSheet_=(b,n)=>n==='BOT_TASKS'?{rows:[staleRow]}:realSheet(b,n);
  g.ctx.assertFreshPilotTasks_=tasks=>{if(tasks.some(r=>String(r[0]).startsWith('TEST_REVIEW|')))throw new Error('오늘 갱신되지 않은 업무 후보');};
  g.ctx.refreshBotTasksForRound_=()=>({pmNames:g.users.map(r=>r[0]),reused:false,sourceFailures:['테스트지 관리: 탭 없음'],keptPrefixes:['TEST_REVIEW|']});
  g.ctx.startConnectedBriefingRound_('11:00');
  assert.ok(g.sent.some(s=>s.id==='U00000001'),'PM with kept (stale) task still receives the DM');
  assert.match(g.sent.find(s=>s.id==='U00000001').message,/테스트지 관리 시트를 읽지 못해 해당 업무는 직전 확인 결과예요/);
  g.ctx.refreshBotTasksForRound_=()=>({pmNames:g.users.map(r=>r[0]),reused:false});
  const h=fixture();h.ctx.requireBotSheet_=(b,n)=>n==='BOT_TASKS'?{rows:[staleRow]}:g.ctx.requireBotSheet_(b,n);
  h.ctx.assertFreshPilotTasks_=g.ctx.assertFreshPilotTasks_;h.ctx.startConnectedBriefingRound_('11:00');
  assert.ok(!h.sent.some(s=>s.id==='U00000001'),'without a reported read failure, stale tasks still block that PM');
  console.log('Kept tasks from an unreadable sheet do not block the DM');
}

// ✅ 완료 버튼: 오늘 완료 표시한 업무 종류는 그 PM의 DM에서 빠지고 안내 한 줄이 붙는다. 남은 종류만 버튼이 붙는다.
{
  const g=fixture();
  const task=key=>[key,'PM 0'].concat(Array(10).fill(''),[true]);
  g.ctx.requireBotSheet_=(b,n)=>n==='BOT_TASKS'?{rows:[task('PM_REVIEW|1'),task('TEST_REVIEW|2')]}:n==='BOT_USERS'?{rows:g.users}:{rows:[],appendRow:()=>{}};
  let shownRows=null;
  g.ctx.formatPersonalWorkBriefing_=(pm,rows)=>{if(pm==='PM 0')shownRows=rows.filter(r=>r[1]==='PM 0').map(r=>r[0]);return '📌 *오늘 확인할 업무*\n• WORK '+pm;};
  g.values.set('SLACK_VERIFICATION_TOKEN','verify-test');
  g.values.set('TASK_DONE_U00000001',JSON.stringify({day:'2026-10-21',groups:['PM_REVIEW']}));
  g.ctx.startConnectedBriefingRound_('11:00');
  const mine=g.sent.find(s=>s.id==='U00000001');
  assert.deepEqual(JSON.parse(JSON.stringify(shownRows)),['TEST_REVIEW|2'],'done type removed for this PM');
  assert.match(mine.message,/✅ 오늘 완료 표시: 1차 검수/);
  const actions=(mine.blocks||[]).find(b=>b.block_id==='task_done');
  assert.equal(JSON.stringify(actions.elements.map(e=>e.action_id)),'["task_done_TEST_REVIEW","task_undo_PM_REVIEW"]','remaining types get done buttons, the done type gets an undo button');
  console.log('Done task types are hidden for the rest of the day with a note and buttons');
}
