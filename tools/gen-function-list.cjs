// 편집기에서 직접 실행하는 함수(이름 끝 _ 없음) 목록을 원본 파일 머리 설명에서 뽑아 Markdown으로 만든다.
// 사용: node tools/gen-function-list.cjs > docs/함수목록.md   (원본을 고친 뒤 다시 실행)
const fs = require('node:fs'), path = require('node:path');
const layout = require('./apps-script-layout.cjs');
const root = path.resolve(__dirname, '..');
const src = fs.existsSync(path.join(root, 'apps-script-linked')) ? path.join(root, 'apps-script-linked') : path.join(root, 'src', 'central-bot');
const clean = s => s.replace(/^\s*\*\s?-?\s*/, '').replace(/\|/g, '/').trim();

function describe(text, name) {
  const end = text.indexOf('*/');
  const header = end > 0 ? text.slice(0, end) : '';
  const para = header.split(/\n \*\n/).find(p => new RegExp('\\b' + name + '\\(').test(p));
  // 함수 바로 위 한 줄 주석도 설명으로 쓴다(머리 설명에 없을 때).
  const above = (() => {
    const lines = text.split('\n'), i = lines.findIndex(l => l.startsWith('function ' + name + '('));
    const prev = i > 0 ? lines[i - 1] : '';
    return /^\/\/|^\/\*\*.*\*\/$/.test(prev) ? prev.replace(/^\/\/\s*|^\/\*\*\s*|\s*\*\/$/g, '') : '';
  })();
  if (!para) return {what: above || '(설명 없음)', effect: ''};
  const lines = para.split('\n');
  const pick = label => { const l = lines.find(x => x.includes('- ' + label + ':')); return l ? clean(l).replace(label + ':', '').trim() : ''; };
  const own = lines.find(l => new RegExp('\\b' + name + '\\(').test(l));
  const fromLine = own && /\):\s*/.test(own) ? own.slice(own.search(/\):\s*/) + 2).trim() : '';
  return {what: pick('기능') || fromLine || above || clean(own || ''), effect: pick('영향')};
}

const out = ['# 함수 목록 — 편집기에서 직접 실행하는 함수', '',
  '> 자동 생성: `node tools/gen-function-list.cjs`. 원본 파일 머리 설명에서 뽑았습니다.',
  '> 위치는 Apps Script 편집기의 **합본 파일 이름 → 함수 이름** 순서입니다. 이름 끝에 `_`가 붙은 내부 함수는 뺐습니다.',
  '> ⚠️ 표시는 실제 Slack DM을 보내거나 설정·트리거를 바꾸는 함수입니다.', ''];
for (const group of layout) {
  const rows = [];
  for (const file of group.files) {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    for (const m of text.matchAll(/^function ([A-Za-z0-9]+)\s*\(/gm)) {
      const name = m[1];
      if (name.endsWith('_')) continue;
      const d = describe(text, name);
      const risky = /실제[^|]*DM|DM 발송|보낸다|트리거 (?:설치|교체|제거)|권한만 추가/.test(d.what + ' ' + d.effect) ||
        /^send|^install|^remove|^sync|^setup|^ensure|^cleanup|^pin|^connect|^update/.test(name);
      rows.push('| ' + (risky ? '⚠️ ' : '') + '`' + name + '` | ' + d.what.replace(/\|/g, '/') + ' | ' + (d.effect || '').replace(/\|/g, '/') + ' | ' + file.replace(/\.js$/, '') + ' |');
    }
  }
  if (!rows.length) continue;
  out.push('## ' + group.name + '.gs — ' + group.title, '', '| 함수 | 하는 일 | 영향 | 원본 |', '| --- | --- | --- | --- |', ...rows, '');
}
out.push('## 연결 앱(PM 개인 캘린더 연결) — 별도 Apps Script 프로젝트', '',
  'PM이 링크로 여는 웹 화면(`doGet`)과 버튼(연결·지금 갱신·해제), 본인 계정의 5분 자동 갱신(`syncMyMeetings`, 평일 10:00~11:15·16:00~17:15)만 있습니다. 관리자가 직접 실행할 함수는 없습니다.', '');
process.stdout.write(out.join('\n'));
