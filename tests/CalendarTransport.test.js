const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const waits=[],posts=[];let responses=[];
const ctx=vm.createContext({Date,console,Math,PropertiesService:{getScriptProperties:()=>({getProperty:k=>({
 CONNECTOR_RECEIVER_URL:'https://script.google.com/macros/s/synthetic-receiver/exec',CONNECTOR_SIGNING_KEY:'x'.repeat(64)})[k]})},
 Utilities:{getUuid:()=>crypto.randomUUID(),computeHmacSha256Signature:(p,k)=>crypto.createHmac('sha256',k).update(p).digest(),
  base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),sleep:ms=>waits.push(ms)},
 UrlFetchApp:{fetch:(_url,options)=>{posts.push(options.payload);return responses.shift();}}});
vm.runInContext(fs.readFileSync('src/calendar-connector/01_개인회의연결.js','utf8'),ctx);
const response=(status,body,headers={})=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(body),getAllHeaders:()=>headers});
responses=[response(200,{ok:false,code:'BUSY'}),response(200,{ok:false,code:'BUSY'}),response(200,{ok:true})];
ctx.connectorSend_('snapshot','one@example.test','synthetic',{},'auto');
assert.equal(posts.length,3);assert.equal(new Set(posts).size,1);assert.equal(waits.length,2);
assert.ok(waits.every(ms=>ms>0&&ms<=15000));
posts.length=0;waits.length=0;responses=[response(200,{ok:false,code:'REJECTED'})];
assert.throws(()=>ctx.connectorSend_('snapshot','one@example.test','synthetic',{},'auto'));
assert.equal(posts.length,1);assert.equal(waits.length,0);
posts.length=0;responses=[response(429,{}, {'Retry-After':'30'})];
assert.throws(()=>ctx.connectorSend_('snapshot','one@example.test','synthetic',{},'auto'),/次|다음/);
assert.equal(posts.length,1);assert.equal(waits.length,0,'long Retry-After is not violated by immediate retry');
for(let i=0;i<25;i++){const delay=ctx.connectorStaggerMs_('person'+i+'@example.test');assert.ok(delay>=0&&delay<=30000);}
let entered=0;
ctx.PropertiesService={getScriptProperties:()=>({})};
ctx.LockService={getScriptLock:()=>{throw Error('calendar receiver must not contend with long DM lock');},
 getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
vm.runInContext(fs.readFileSync('src/central-bot/19_개인캘린더연결.js','utf8'),ctx);
ctx.selfCalendarAuthenticate_=()=>({});ctx.selfCalendarApply_=()=>entered++;
assert.equal(ctx.doPost({}).ok,true);assert.equal(entered,1);
ctx.LockService.getUserLock=()=>({tryLock:()=>false});assert.equal(ctx.doPost({}).code,'BUSY');assert.equal(entered,1);
console.log('Calendar transport: bounded BUSY retry, identical payload, no rejection retry, Retry-After, stagger and independent receiver lock passed');
