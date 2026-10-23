const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// 업로드용 합본(7개 파일)을 Apps Script처럼 한 전역 공간에 순서대로 올려도 오류가 없고,
// 원본의 모든 함수와 트리거·웹 앱 진입점이 그대로 있는지 확인한다.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-'));
const result = require('../tools/build-apps-script.cjs')(out);
assert.equal(result.files.length, 7);
const ctx = vm.createContext({});
for (const file of result.files) vm.runInContext(fs.readFileSync(path.join(out, file), 'utf8'), ctx, {filename: file});
const src = fs.readdirSync('src/central-bot').filter(f => /^\d\d_.*\.js$/.test(f));
const names = src.flatMap(f => [...fs.readFileSync('src/central-bot/' + f, 'utf8').matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]));
assert.equal(new Set(names).size, names.length, 'no duplicate function names across source files');
for (const name of names) assert.equal(typeof ctx[name], 'function', 'missing after merge: ' + name);
for (const entry of ['sendScheduledBriefing11', 'sendScheduledBriefing17', 'collectBbpmSnapshot', 'resumeConnectedBriefingSend', 'doPost']) {
  assert.equal(typeof ctx[entry], 'function', 'trigger/web entry point kept: ' + entry);
}
assert.ok(fs.existsSync(path.join(out, 'appsscript.json')));
assert.match(fs.readFileSync(path.join(out, '1_자동실행과발송.js'), 'utf8'), /^\/\*\*\n \* 1_자동실행과발송 — [\s\S]*자동 생성 파일/);
fs.rmSync(out, {recursive: true, force: true});
console.log('Merged Apps Script build loads in one scope with ' + names.length + ' functions');
