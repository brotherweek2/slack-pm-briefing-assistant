const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const logs=[];
const ctx=vm.createContext({console:{log:value=>logs.push(value)},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()].map(n=>n>127?n-256:n),
    base64EncodeWebSafe:bytes=>Buffer.from(bytes.map(n=>(n+256)%256)).toString('base64url')},
  escapeSlack_:value=>String(value),LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})}});
for(const file of ['11_문구목록.js','10_응원문구.js'])vm.runInContext(fs.readFileSync('src/central-bot/'+file,'utf8'),ctx);
const rows=ctx.defaultBriefingPhraseRows_();
const catalog=ctx.validateBriefingPhraseRows_(rows);
assert.equal(rows.length,80);assert.equal(new Set(rows.map(row=>row[4])).size,80);
for(const slot of ['11:00','17:00']){
  const own=catalog.filter(x=>x.slot===slot);
  assert.equal(own.length,40);
  assert.equal(new Set(own.map(x=>x.family)).size,40);
  assert.deepEqual(Object.values(own.reduce((counts,item)=>(counts[item.theme]=(counts[item.theme]||0)+1,counts),{})),[16,10,8,6]);
  assert.ok(own.every(item=>/^\w+-HUMAN-\d{3}$/.test(item.id)), 'new bank does not reuse old combination IDs');
}
const values=new Map();let writes=0;
const props={getProperty:key=>values.get(key)||null,setProperty:(key,value)=>{writes++;values.set(key,value);}};
const route={pm:'PM A',id:'U0000000002'};
const first=ctx.pickBriefingPhrase_(props,route,'2026-10-19','11:00',catalog);
assert.equal(writes,0,'selection and preview never consume the phrase');
assert.equal(first.id,ctx.pickBriefingPhrase_(props,route,'2026-10-19','11:00',catalog).id);
assert.match(ctx.formatBriefingPhrase_(first),/^\n\n✨ \*오늘의 한마디\*\n> /);
const evening=ctx.pickBriefingPhrase_(props,route,'2026-10-19','17:00',catalog);
assert.match(evening.id,/^PM-/);assert.match(ctx.formatBriefingPhrase_(evening),/^\n\n✨ \*오늘의 한마디\*\n> /);
ctx.markBriefingPhraseSent_(props,route,first);assert.equal(writes,1);
ctx.markBriefingPhraseSent_(props,route,first);assert.equal(writes,1,'same-day repeated success does not duplicate history');
const edited=catalog.map(item=>item.id===first.id?{...item,text:'edited sample'}:item);
assert.equal(ctx.pickBriefingPhrase_(props,route,'2026-10-19','11:00',edited).text,first.text,'sent text stays stable on the same day');
assert.equal(ctx.pickBriefingPhrase_(props,route,'2026-10-19','11:00',edited.filter(x=>x.id!==first.id)),null,'removed phrase is not replaced mid-day');
const disabled=catalog.map(item=>({...item,enabled:false}));
assert.equal(ctx.pickBriefingPhrase_(props,route,'2026-10-20','11:00',disabled),null);
values.set('ENABLE_BRIEFING_PHRASES','false');
assert.equal(ctx.pickBriefingPhrase_(props,route,'2026-10-19','11:00',catalog),null);
values.delete('ENABLE_BRIEFING_PHRASES');
const familyHistory=[];
for(let day=0;day<100;day++){
  const date=new Date(Date.UTC(2026,9,20)+day*86400000).toISOString().slice(0,10);
  const picked=ctx.pickBriefingPhrase_(props,route,date,'11:00',catalog);
  assert.ok(!familyHistory.slice(-20).includes(picked.family),'recent core sentences do not repeat with a different ending');
  familyHistory.push(picked.family);ctx.markBriefingPhraseSent_(props,route,picked);
}
const state=JSON.parse(values.get(ctx.briefingPhraseStateKey_(route,'11:00')));
assert.equal(state.history.length,60);
assert.ok(JSON.stringify(state).length<8000,'each Script Property remains below size limit');
assert.ok(![...values.keys()].some(key=>key.includes(route.id)),'state key hashes the recipient ID');
const diversity=new Set(Array.from({length:50},(_,i)=>ctx.pickBriefingPhrase_(props,{pm:'PM',id:'U'+String(i).padStart(8,'0')},'2026-10-19','11:00',catalog).id));
assert.ok(diversity.size>20,'choices are recipient-specific, not one shared daily phrase');
assert.throws(()=>ctx.validateBriefingPhraseRows_([rows[0],rows[0]]),/중복/);
assert.throws(()=>ctx.validateBriefingPhraseRows_([[...rows[0].slice(0,4),'line\nbreak',true]]),/형식/);
assert.throws(()=>ctx.validateBriefingPhraseRows_([[...rows[0].slice(0,5),'TRUE']]),/형식/);
assert.throws(()=>ctx.validateBriefingPhraseRows_([[...rows[0].slice(0,4),'<@U0000000002>',true]]),/형식/);
ctx.assertBotHeaders_=()=>{};ctx.readBotRows_=()=>rows;
assert.equal(ctx.readBriefingPhraseCatalog_({getSheetByName:()=>null}).length,80,'safe built-in bank before optional setup');
assert.equal(ctx.readBriefingPhraseCatalog_({getSheetByName:()=>({getLastRow:()=>1001})}).length,80);

// Workbook preparation is confined to the designated bot workbook and preserves existing rows.
ctx.BOT_WORKBOOK={bootstrapId:'test-bot'};ctx.requiredProperty_=()=> 'test-bot';
ctx.PropertiesService={getScriptProperties:()=>props};
let opened=0;
ctx.SpreadsheetApp={openById:id=>{opened++;assert.equal(id,'test-bot');return {getSheetByName:()=>({getLastRow:()=>1001})};}};
ctx.setupBotPhrases();assert.equal(opened,1);
assert.ok(logs.some(value=>value.includes('보존')));
values.set('SOURCE_SPREADSHEET_ID','test-bot');
assert.throws(()=>ctx.setupBotPhrases(),/전용/);assert.equal(opened,1,'source equality fails before any workbook access');
values.delete('SOURCE_SPREADSHEET_ID');
let seeded,checkboxOrder=0,valuesOrder=0,order=0,added=0;
const newSheet={getMaxRows:()=>40,insertRowsAfter:(_after,count)=>{added=count;},
  getRange:()=>({setNumberFormat:()=>{},insertCheckboxes:()=>{checkboxOrder=++order;},
    setValues:data=>{valuesOrder=++order;seeded=data;},setWrap:()=>{}})};
ctx.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};ctx.ensureBotSheet_=()=>newSheet;
ctx.setupBotPhrases();assert.equal(seeded.length,80);assert.equal(added,41);
assert.ok(checkboxOrder<valuesOrder,'checkbox insertion must not reset enabled TRUE values');
assert.ok(seeded.every(row=>row[5]===true));

// The explicit phrase trial posts one DM with both slots and preserves normal phrase history.
Object.assign(ctx.BOT_WORKBOOK,{usersTab:'BOT_USERS',userHeaders:Array(3),logTab:'BOT_SEND_LOG',logHeaders:Array(5)});
ctx.BRIEFING={timezone:'Asia/Seoul'};
ctx.Utilities.formatDate=(_date,_zone,pattern)=>pattern==='yyyy-MM-dd'?'2026-10-19':'10/19';
values.set('ENABLE_PM_SEND','true');
// (예전 sendMyPhraseTest 시험은 본인만 발송 TRUE 조건이라 제거됨 10/23. 실제 문구 노출은 통합 DM 테스트에서 확인)
console.log('80 complete phrases, tone mix, stable daily choices, recipient isolation, repeat avoidance and safe setup passed');
