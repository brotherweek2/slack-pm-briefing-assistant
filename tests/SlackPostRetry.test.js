const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
let clock=Date.parse('2026-10-21T11:00:00+09:00'),calls=0,responses=[];
class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const values=new Map();
const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),getProperties:()=>Object.fromEntries(values)};
const ctx=vm.createContext({Date:Clock,console,BRIEFING:{timezone:'Asia/Seoul',slackPostUrl:'https://slack.invalid/synthetic'},
 PropertiesService:{getScriptProperties:()=>props},Utilities:{formatDate:()=> '2026-10-21',
 newBlob:text=>({getBytes:()=>Buffer.from(text)}),DigestAlgorithm:{SHA_256:'sha256'},
 computeDigest:(_,text)=>crypto.createHash('sha256').update(text).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
 UrlFetchApp:{fetch:()=>{calls++;return responses.shift();}}});
vm.runInContext(fs.readFileSync('src/central-bot/14_공통설정.js','utf8'),ctx);
const response=(status,text,headers={})=>({getResponseCode:()=>status,getContentText:()=>text,getAllHeaders:()=>headers});
responses=[response(429,'Too Many Requests',{'Retry-After':'90'}),response(200,'{"ok":true}')];
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000001','message','scheduled-11:00'),e=>e.code==='SLACK_RATE_LIMIT'&&e.retryAfterMs===90000);
assert.equal(calls,1);assert.ok([...values.values()].some(v=>v.includes('rejected')));
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000001','message','scheduled-11:00'),e=>e.code==='SLACK_RATE_LIMIT');
assert.equal(calls,1,'cooldown does not create another Slack request');
clock+=90000;ctx.postSlackDm_('synthetic','U000000001','message','scheduled-11:00');
assert.equal(calls,2);assert.ok([...values.values()].some(v=>v.includes('sent')));
responses=[response(500,'upstream failed')];
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000002','message','scheduled-11:00'));
const before=calls;
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000002','message','scheduled-11:00'),e=>e.code==='DM_RESULT_UNCERTAIN');
assert.equal(calls,before,'ambiguous HTTP failure is never retried automatically');
responses=[response(200,'not-json')];
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000003','message','scheduled-11:00'));
assert.throws(()=>ctx.postSlackDm_('synthetic','U000000003','message','scheduled-11:00'),e=>e.code==='DM_RESULT_UNCERTAIN');
console.log('Slack real sender: plain-text 429, Retry-After cooldown, rejected retry and ambiguous-response duplicate blocking passed');
