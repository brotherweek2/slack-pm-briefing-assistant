// Synthetic fixtures only. No network, real accounts, source sheets or Slack sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const values = new Map([['BOT_SPREADSHEET_ID','bot-fixture']]);
const props = {getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),
  getProperties:()=>Object.fromEntries(values),deleteProperty:k=>values.delete(k)};
let calls=0, outcome='ok', effective='employee@example.test';
const ctx=vm.createContext({console:{log:()=>{}},
  PropertiesService:{getScriptProperties:()=>props},
  Session:{getEffectiveUser:()=>({getEmail:()=>effective})},
  BOT_WORKBOOK:{bootstrapId:'bot-fixture'},
  Utilities:{formatDate:()=> '2026-10-20',DigestAlgorithm:{SHA_256:'sha256'},
    newBlob:text=>({getBytes:()=>Buffer.from(text,'utf8')}),
    computeDigest:(_a,s)=>crypto.createHash('sha256').update(s).digest(),
    base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
  UrlFetchApp:{fetch:()=>{calls++;if(outcome==='network')throw Error('network lost');
    return {getResponseCode:()=>outcome==='rate'?429:200,
      getAllHeaders:()=>({'Retry-After':'120'}),
      getContentText:()=>outcome==='invalid'?'invalid json':outcome==='reject'?'{"ok":false,"error":"missing_scope"}':'{"ok":true}'}}}
});
['14_공통설정.js','03_슬랙수집.js','17_운영점검.js'].forEach(name=>
  vm.runInContext(fs.readFileSync('src/central-bot/'+name,'utf8'),ctx));
const post=ctx.postSlackDm_;
post('synthetic','U00000001','work','scheduled-11');
assert.throws(()=>post('synthetic','U00000001','work','scheduled-11'),/재전송 차단/);
assert.equal(calls,1,'accepted delivery never posted twice even if downstream log fails');
outcome='network';
assert.throws(()=>post('synthetic','U00000001','work','network-slot'),/network lost/);
outcome='ok';
assert.throws(()=>post('synthetic','U00000001','work','network-slot'),/재전송 차단/);
assert.equal(calls,2,'ambiguous network result is not retried');
outcome='reject';
assert.throws(()=>post('synthetic','U00000001','work','rejected-slot'),/missing_scope/);
outcome='ok';
post('synthetic','U00000001','work','rejected-slot');
assert.equal(calls,4,'explicit rejection may be retried after repair');
assert.throws(()=>post('synthetic','U00000001','x'.repeat(35001),'long'),/長|길이/);
assert.equal(calls,4,'oversized message cannot be silently truncated');
values.set('synthetic-storage','x'.repeat(480*1024));
assert.throws(()=>post('synthetic','U00000001','work','full-slot'),/저장 공간 부족/);
assert.equal(calls,4,'full property store prevents an unjournaled send');
values.delete('synthetic-storage');
values.set('BRIEFING_EXECUTOR_EMAIL','employee@example.test');
effective='personal@example.test';
assert.throws(()=>ctx.requiredProperty_(props,'BOT_SPREADSHEET_ID'),/계정 불일치/);
effective='employee@example.test';
assert.equal(ctx.requiredProperty_(props,'BOT_SPREADSHEET_ID'),'bot-fixture');
values.set('BOT_SPREADSHEET_ID','other-fixture');
assert.throws(()=>ctx.requiredProperty_(props,'BOT_SPREADSHEET_ID'),/전용 시트/);
values.set('BOT_SPREADSHEET_ID','bot-fixture');
outcome='rate';
const read=ctx.slackMentionReadApi_;
assert.throws(()=>read('conversations.history',{},'synthetic',{calls:0}),/읽기 제한/);
const afterRate=calls;
assert.throws(()=>read('conversations.history',{},'synthetic',{calls:0}),/대기 중/);
assert.equal(calls,afterRate,'Retry-After cooldown prevents a second request');
// Completion publication must happen before the collection lease is released.
let leased=false;
ctx.acquireBbpmLease_=()=>{leased=true;return true;};
ctx.releaseBbpmLease_=()=>{leased=false;};
ctx.readSlackMentionConfig_=()=>({discovery:true,groupId:'S00000001'});
ctx.collectSlackMentionMessages_=config=>{assert.equal(config.scanLockHeld,true);return {newest:1,messageCount:1};};
ctx.SpreadsheetApp={openById:()=>({})};
ctx.writeBbpmSnapshot_=()=>{assert.equal(leased,true,'lease spans publication');return true;};
values.set('ENABLE_SLACK_MENTION_READ','true');
ctx.runBbpmCollectStep_(props,new Date());
assert.equal(leased,false,'success releases lease');
ctx.writeBbpmSnapshot_=()=>{throw Error('write failed');};
assert.throws(()=>ctx.runBbpmCollectStep_(props,new Date()),/write failed/);
assert.equal(leased,false,'failed publication also releases lease');
console.log('Reliability failure and concurrency checks passed');
let kept, cleared;
const logSheet={getRange:(row,col,height)=>({setValues:rows=>{kept=rows;},clearContent:()=>{cleared={row,height};}})};
vm.runInContext('BOT_WORKBOOK.logHeaders = Array(5)',ctx);
const remaining=ctx.retainBriefingSendLog_(logSheet,[['2026-01-01'],['2026-10-20'],['unparseable']], '2026-10-20');
assert.equal(remaining.length,2,'old send log pruned; today and unknown dates preserved');
assert.equal(kept[0][0],'2026-10-20');
assert.equal(cleared.row,4,'only leftover tail is cleared after retained rows written');
