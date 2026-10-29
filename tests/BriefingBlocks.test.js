const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 합성 문안만 사용한다. 영역별 구분선·회색 기준 줄·상한 처리 확인.
const ctx = vm.createContext({});
require('./test-briefing-blocks.cjs')(ctx);
const message = [
  '☀️ *PM A* 님, 10/22(목) 오전 브리핑 드립니다!',
  '',
  '📌 *오늘 확인할 업무*\n• 언어쌍 종료 임박 2건',
  '',
  '📅 *오늘 회의*\n• 16:00 Scrum · 응답 전',
  '',
  '💬 *Slack*\n• 새로 온 요청·안내 없음',
  '',
  '_업무·회의 10:58 · Slack 10:50 기준_',
  '',
  '🍚 *점심 추천*\n• *예시식당 45* — 한식',
  '',
  '> 한마디',
].join('\n');
const blocks = ctx.buildBriefingBlocks_(message);
assert.equal(JSON.stringify(blocks.map(b => b.type)),
  JSON.stringify(['section', 'divider', 'section', 'divider', 'section', 'divider', 'section', 'context', 'divider', 'section', 'divider', 'section']),
  'divider between sections; basis line attaches as context without a divider');
assert.equal(blocks[0].text.text, '☀️ *PM A* 님, 10/22(목) 오전 브리핑 드립니다!');
assert.equal(blocks[2].text.type, 'mrkdwn');
assert.equal(blocks[7].elements[0].text, '_업무·회의 10:58 · Slack 10:50 기준_');
assert.equal(blocks.at(-1).text.text, '> 한마디', 'phrase stays last');
assert.equal(ctx.briefingBlocksAsText_(blocks).split('\n').filter(line => line === '──────────').length, 5);

// 3,000자 상한: 긴 영역은 줄 단위로 여러 section으로 나뉘고 내용은 그대로 보존된다.
const longLines = Array.from({length: 120}, (_, i) => '• 항목 ' + i + ' ' + '가'.repeat(40));
const long = ctx.buildBriefingBlocks_('제목\n\n💬 *Slack*\n' + longLines.join('\n'));
const sections = long.filter(b => b.type === 'section').slice(1);
assert.ok(sections.length > 1);
assert.ok(sections.every(b => Array.from(b.text.text).length <= 2900));
assert.equal(sections.map(b => b.text.text).join('\n'), '💬 *Slack*\n' + longLines.join('\n'));

// 블록 50개 초과면 null → 호출부는 텍스트 그대로 보낸다.
assert.equal(ctx.buildBriefingBlocks_(Array.from({length: 30}, (_, i) => '영역 ' + i).join('\n\n')), null);

// 업무 영역: 전일 대비·3일 연속 줄은 DM에 싣지 않는다.
const work = vm.createContext({escapeSlack_: v => String(v), isSheetUrl_: () => false, formatHaCvDailyTrend_: () => '전일 대비: 헤즈업 +1명',
  summarizeHaCvCounts_: () => ({}), formatPilotDate_: v => String(v || ''), formatDueLabel_: v => v});
vm.runInContext(fs.readFileSync('src/central-bot/07_업무브리핑.js', 'utf8'), work);
const text = work.formatPersonalWorkBriefing_('PM A', [], '2026-10-22', {baseline: false, headsUpDelta: 1}, '11:00');
assert.doesNotMatch(text, /전일 대비|3일 연속/);
assert.equal(text, '☀️ *PM A* 님, 10/22(목) 오전 브리핑 드립니다!\n\n📌 *오늘 확인할 업무*\n• 확인할 특이사항 없음');
console.log('Briefing block layout checks passed');

// Codex 10/23 검토 반영: 2,900자를 넘는 한 줄도 잘리지 않고 여러 section으로 보존된다.
const giant = '가'.repeat(7000);
const kept = ctx.buildBriefingBlocks_('제목\n\n' + giant).filter(b => b.type === 'section').slice(1);
assert.equal(kept.map(b => b.text.text).join(''), giant);
assert.ok(kept.every(b => Array.from(b.text.text).length <= 2900));
console.log('Long single line is preserved');
