// 중앙 봇 원본 23개 → Apps Script 업로드용 7개 파일로 합친다(동작 동일: Apps Script는 모든 파일을 한 전역 공간에서 실행).
// 사용: node tools/build-apps-script.cjs            → apps-script-deploy/ 생성(이 폴더에서 clasp push)
//       node tools/build-apps-script.cjs <출력폴더> → 테스트용
// 원본 수정은 항상 apps-script-linked/에서 한다. apps-script-deploy/의 파일을 직접 고치지 않는다.
const fs = require('node:fs'), path = require('node:path');
const layout = require('./apps-script-layout.cjs');
const root = path.resolve(__dirname, '..');
// 로컬 작업 폴더는 apps-script-linked/, GitHub 공개본은 src/central-bot/ 에 원본이 있다.
const src = fs.existsSync(path.join(root, 'apps-script-linked')) ? path.join(root, 'apps-script-linked') : path.join(root, 'src', 'central-bot');
const defaultOut = path.join(root, 'apps-script-deploy');

function build(outDir) {
  const out = path.resolve(outDir || defaultOut);
  const sources = fs.readdirSync(src).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
  const listed = layout.flatMap(group => group.files);
  const missing = sources.filter(f => !listed.includes(f));
  const unknown = listed.filter(f => !sources.includes(f));
  const twice = listed.filter((f, i) => listed.indexOf(f) !== i);
  if (missing.length || unknown.length || twice.length) {
    throw new Error('tools/apps-script-layout.cjs 확인 필요 | 묶음에 없음: ' + missing.join(', ') +
      ' | 원본에 없음: ' + unknown.join(', ') + ' | 중복: ' + twice.join(', '));
  }
  // 같은 이름의 함수가 두 파일에 있으면 합친 뒤 뒤쪽이 앞쪽을 덮어쓴다. 원본 단계에서 막는다.
  const owner = new Map();
  for (const file of sources) {
    for (const m of fs.readFileSync(path.join(src, file), 'utf8').matchAll(/^function ([A-Za-z0-9_$]+)\s*\(/gm)) {
      if (owner.has(m[1])) throw new Error('함수 이름 중복: ' + m[1] + ' (' + owner.get(m[1]) + ', ' + file + ')');
      owner.set(m[1], file);
    }
  }
  fs.mkdirSync(out, {recursive: true});
  for (const f of fs.readdirSync(out)) if (/\.(js|gs)$/.test(f)) fs.unlinkSync(path.join(out, f));
  const written = [];
  for (const group of layout) {
    const parts = group.files.map(file => ({file, text: fs.readFileSync(path.join(src, file), 'utf8').replace(/\r\n/g, '\n').trimEnd()}));
    const runnable = parts.map(p => ({file: p.file, names: [...p.text.matchAll(/^function ([A-Za-z0-9]+[A-Za-z0-9]*)\s*\(/gm)]
      .map(m => m[1]).filter(n => !n.endsWith('_'))})).filter(p => p.names.length);
    const header = [
      '/**',
      ' * ' + group.name + ' — ' + group.title,
      ' * 자동 생성 파일: 직접 수정하지 마세요. 원본은 로컬 apps-script-linked/의 ' + group.files.join(', '),
      ' * (node tools/build-apps-script.cjs 로 다시 만듭니다.)',
      ' *',
      ' * 편집기에서 직접 실행하는 함수(이름 끝에 _ 가 없는 함수):',
      ...(runnable.length ? runnable.map(p => ' * - ' + p.file.replace(/\.js$/, '') + ': ' + p.names.join(', ')) : [' * - 없음 (내부 함수와 데이터만)']),
      ' */',
    ].join('\n');
    const body = parts.map(p => '\n\n// ═════════════════════ ' + p.file.replace(/\.js$/, '') + ' ═════════════════════\n\n' + p.text).join('');
    const name = group.name + '.js';
    fs.writeFileSync(path.join(out, name), header + body + '\n', 'utf8');
    written.push(name);
  }
  fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(out, 'appsscript.json'));
  return {out, files: written, sources: sources.length, functions: owner.size};
}

if (require.main === module) console.log(JSON.stringify(build(process.argv[2])));
module.exports = build;
