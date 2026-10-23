const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 let clock=Date.parse('2026-10-21T11:00:00+09:00'),held=false,triggers=[],sequence=0,rateOnce=false,ambiguous=false;
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
  refreshBotTasks:()=>({pmNames:users.map(row=>row[0])}),refreshBotTasksForRound_:()=>({pmNames:users.map(row=>row[0]),reused:false}),selectHaCvPreviewOwners_:names=>names,
  selfCalendarFilterRoutes_:routes=>routes,saveHaCvDailyHistory_:()=>({}),assertFreshPilotTasks_:()=>{},
  isHaCvBriefingTask_:()=>true,formatPersonalWorkBriefing_:pm=>'WORK '+pm,escapeSlack_:s=>s,
  loadFreshBbpmSnapshot_:()=>({meta:{newest:clock/1000}}),classifySlackSnapshot_:()=>[],buildSlackDigestItems_:()=>[],
  readSlackDigestSeen_:()=>[],selectPersonalSlackItems_:()=>[],formatPersonalSlackDigest_:()=>'',attachSlackToWorkLines_:(text,items)=>({text,rest:items,attached:0}),attachSlackAuthorNames_:items=>items,
  notifyAdminRoundSummary_:(slot,info)=>admin.push({slot,info}),adminInfoFromJob_:job=>({state:job.state,total:job.total,pendingIds:job.pendingIds,failedIds:job.failedIds||[],failures:job.failures||{},failed:job.failed}),
  retainBriefingSendLog_:(_l,rows)=>rows,markSlackDigestSeen_:()=>{},maskPilotId_:()=> 'masked',
  postSlackDm_:(_token,id,message,slot)=>{
    if(rateOnce){rateOnce=false;throw Object.assign(Error('rate'),{code:'SLACK_RATE_LIMIT',retryAfterMs:90000});}
    if(ambiguous){ambiguous=false;throw Object.assign(Error('uncertain'),{code:'DM_RESULT_UNCERTAIN'});}
    sent.push({id,message,slot});
  }});
 for(const file of ['01_슬랙DM발송.js','20_이어보내기.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+file,'utf8'),ctx);
 require('./test-briefing-blocks.cjs')(ctx);
 return {ctx,sent,users,values,logs,admin,job:()=>JSON.parse(values.get('CONNECTED_SEND_JOB')||'null'),triggers:()=>triggers,
  advance:ms=>clock+=ms,busy:value=>held=value,rate:()=>rateOnce=true,ambiguous:()=>ambiguous=true};
}
let f=fixture();f.ctx.startConnectedBriefingRound_('11:00');
assert.equal(f.sent.length,8);assert.equal(f.job().pendingIds.length,17);assert.equal(f.triggers().length,1);
f.users.push(['Late PM','U0000000005',true]);
for(let i=0;i<3;i++){f.advance(60000);f.ctx.resumeConnectedBriefingSend();assert.ok(f.triggers().length<=1);}
assert.equal(f.sent.length,25);assert.equal(new Set(f.sent.map(s=>s.id)).size,25);
assert.ok(!f.sent.some(s=>s.id==='U0000000005'),'recipient cohort does not expand during retry');
assert.equal(f.job().state,'complete');assert.equal(f.triggers().length,0);
// 회차가 끝나면 관리자 요약을 정확히 한 번 요청한다(중간 배치에서는 보내지 않음).
assert.equal(f.admin.length,1);assert.equal(f.admin[0].slot,'11:00');assert.equal(f.admin[0].info.total,25);assert.equal(f.admin[0].info.pendingIds.length,0);
f.ctx.startConnectedBriefingRound_('11:00');assert.equal(f.sent.length,25,'same round never reopens');
f=fixture();f.busy(true);f.ctx.startConnectedBriefingRound_('11:00');assert.equal(f.sent.length,0);assert.equal(f.triggers().length,1);
f.busy(false);f.advance(60000);f.ctx.resumeConnectedBriefingSend();assert.equal(f.sent.length,8,'busy start keeps durable request');
f=fixture();f.rate();f.ctx.startConnectedBriefingRound_('11:00');
assert.equal(f.sent.length,0);assert.equal(f.job().pendingIds.length,25);assert.equal(f.triggers()[0].delay,90000);
const attempts=f.job().attempts;f.ctx.resumeConnectedBriefingSend();assert.equal(f.job().attempts,attempts,'early manual resume respects wait without spending an attempt');
f.advance(90000);f.ctx.resumeConnectedBriefingSend();assert.equal(f.sent.length,8);
f=fixture();f.ambiguous();f.ctx.startConnectedBriefingRound_('11:00');
for(let i=0;i<3;i++){f.advance(60000);f.ctx.resumeConnectedBriefingSend();}
assert.equal(f.sent.length,24);assert.equal(f.job().state,'complete-with-errors');assert.equal(f.job().failed,1);
assert.ok(!f.sent.some(s=>s.id==='U00000001'),'uncertain delivery is not automatically repeated');
// 실패 PM과 원인이 회차 기록에 남아 관리자 요약으로 전달된다.
assert.equal(JSON.stringify(f.job().failedIds),'["U00000001"]');assert.match(f.job().failures.U00000001,/uncertain/);
assert.equal(f.admin.at(-1).info.failedIds[0],'U00000001');
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.users[8][2]=false;f.advance(60000);f.ctx.resumeConnectedBriefingSend();
assert.ok(!f.sent.some(s=>s.id==='U00000009'),'recipient disabled before continuation is excluded');
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.advance(21*60000);f.ctx.resumeConnectedBriefingSend();
assert.equal(f.sent.length,8);assert.equal(f.job().state,'stopped');assert.equal(f.triggers().length,0);
assert.equal(f.admin.length,1,'stopped round is reported once');assert.equal(f.admin[0].info.pendingIds.length,17);
f=fixture();f.ctx.startConnectedBriefingRound_('11:00');f.values.set('ENABLE_PM_SEND','false');f.advance(60000);f.ctx.resumeConnectedBriefingSend();
assert.equal(f.sent.length,8);assert.equal(f.job().state,'stopped');
console.log('25-recipient actual sender/worker integration: 8-per-batch, fixed cohort, no duplicates, rate limit, ambiguous response, disable and expiry passed');
