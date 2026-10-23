// 모든 합성 테스트를 실행한다. 로컬은 맨 위 폴더, GitHub 공개본은 tests/ 폴더의 *.test.js. 실행 위치는 저장소 맨 위.
// 사용: node tools/test-local.cjs
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.existsSync(path.join(root, 'tests')) ? path.join(root, 'tests') : root;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const file of files) {
  const result = cp.spawnSync(process.execPath, [path.join(dir, file)], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) { failed++; console.log('FAIL ' + file + '\n' + result.stdout + '\n' + result.stderr); }
  else console.log('PASS ' + file);
}
console.log((files.length - failed) + '/' + files.length + ' test files passed');
process.exitCode = failed ? 1 : 0;
