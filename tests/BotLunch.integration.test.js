const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const fixed=new Date('2026-10-19T11:00:00+09:00');
class FixedDate extends Date{constructor(...a){super(...(a.length?a:[fixed]));}}
const properties=new Map([['ENABLE_PM_SEND','true'],['ENABLE_BRIEFING_PHRASES','false']]);
let phase='before-send',sendFailure=false;
const writes=[],posts=[],logs=[],sendRows=[],users=[['PM A','U0000000002',true]];
const props={getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>{writes.push({k,v,phase});properties.set(k,v);}};
const bot={getSheetByName:()=>null};
const ctx=vm.createContext({briefingLeaveRoutes_:()=>[],Date:FixedDate,console:{log:s=>logs.push(s)},BRIEFING:{timezone:'Asia/Seoul'},
  BOT_WORKBOOK:{usersTab:'BOT_USERS',userHeaders:Array(3),tasksTab:'BOT_TASKS',taskHeaders:Array(18),logTab:'BOT_SEND_LOG',logHeaders:Array(5)},
  PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{openById:()=>bot},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{formatDate:(_d,_z,p)=>({'yyyy-MM-dd':'2026-10-19','HH':'11','HH:mm':'11:00','MM/dd':'10/19'}[p]||p),
    DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],
    base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
  requiredProperty_:(_p,k)=>k==='BOT_SPREADSHEET_ID'?'test-bot':'test-token',
  requireBotSheet_:(_b,name)=>({rows:name==='BOT_USERS'?users:name==='BOT_SEND_LOG'?sendRows:[],appendRow:r=>sendRows.push(r)}),
  readBotRows_:s=>s.rows,refreshBotTasks:()=>({pmNames:['PM A']}),saveHaCvDailyHistory_:()=>({}),
  selectHaCvPreviewOwners_:()=>['PM A'],isHaCvBriefingTask_:()=>true,assertFreshPilotTasks_:()=>{},
  findPilotRecipient_:()=>({id:'U0000000002',enabled:true}),getPilotPmName_:()=> 'PM A',maskPilotId_:()=> 'masked',
  formatPersonalWorkBriefing_:(_pm,_rows,_day,_trend,slot)=>'WORK '+slot,
  escapeSlack_:s=>String(s),postSlackDm_:(_token,id,message)=>{
    if(sendFailure)throw Error('synthetic post failure');posts.push({id,message});phase='post-success';
  }});
for(const f of ['16_식당목록.js','15_점심추천.js','01_슬랙DM발송.js','17_운영점검.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+f,'utf8'),ctx);
require('./test-briefing-blocks.cjs')(ctx);
ctx.sendPmBriefings_(true,false,'11:00');
assert.equal(posts.length,1);assert.match(posts[0].message,/WORK 11:00/);assert.match(posts[0].message,/점심 추천/);
assert.equal(writes.length,2);assert.ok(writes.every(x=>x.phase==='post-success'));
assert.match(posts[0].message,/가볍게 · */);assert.doesNotMatch(posts[0].message,/https?:/);
ctx.sendPmBriefings_(true,false,'11:00');assert.equal(posts.length,1);assert.equal(writes.length,2,'duplicate slot consumes no history');
ctx.sendPmBriefings_(true,false,'17:00');assert.equal(posts.length,2);assert.match(posts[1].message,/WORK 17:00/);assert.doesNotMatch(posts[1].message,/점심 추천/);assert.equal(writes.length,2);
sendRows.length=0;properties.clear();properties.set('ENABLE_PM_SEND','true');properties.set('ENABLE_BRIEFING_PHRASES','false');
sendFailure=true;phase='before-send';const before=writes.length;
assert.throws(()=>ctx.sendPmBriefings_(true,false,'11:00'),/synthetic post failure/);
assert.equal(writes.length,before,'failed real pipeline post consumes no lunch choice');assert.equal(sendRows.length,0);
sendFailure=false;
const original=ctx.readLunchRestaurantCatalog_;ctx.readLunchRestaurantCatalog_=()=>{throw Error('broken menu sheet');};
ctx.sendPmBriefings_(true,false,'11:00');assert.equal(posts.length,3);assert.match(posts.at(-1).message,/WORK/);assert.doesNotMatch(posts.at(-1).message,/점심 추천|broken menu sheet/);
assert.equal(writes.length,before,'optional menu failures preserve work delivery');
ctx.readLunchRestaurantCatalog_=original;
const previewWrites=writes.length,previewPosts=posts.length;
ctx.previewMyMorningBriefing();assert.match(logs.at(-2),/점심 추천/);
ctx.previewMyEveningBriefing();assert.doesNotMatch(logs.at(-2),/점심 추천/);
assert.equal(writes.length,previewWrites);assert.equal(posts.length,previewPosts,'preview is read-only');
console.log('Actual delivery integration: morning-only, duplicate/failure history, work preservation and read-only previews passed');
