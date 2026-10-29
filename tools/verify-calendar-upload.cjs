// 원격 pull을 별도 폴더에서 완료한 뒤 파일 해시를 비교한다. 내용/식별자는 출력하지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [local,remote]=process.argv.slice(2);
if(!local||!remote)throw Error('Usage: node tools/verify-calendar-upload.cjs LOCAL REMOTE');
const files=fs.readdirSync(local).filter(name=>/\.(js|html|json)$/.test(name)&&!name.startsWith('.'));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let failures=0;
for(const file of files){
 const target=path.join(remote,file);
 if(!fs.existsSync(target)||digest(path.join(local,file))!==digest(target)){failures++;console.log('MISMATCH '+file);}
}
const extra=fs.readdirSync(remote).filter(name=>/\.(js|html|json)$/.test(name)&&!name.startsWith('.')&&!files.includes(name));
failures+=extra.length;
console.log(JSON.stringify({localFiles:files.length,verified:files.length-failures,unexpectedFiles:extra.length,ok:failures===0}));
process.exitCode=failures?1:0;
