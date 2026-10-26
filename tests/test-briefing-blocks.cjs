// 테스트 공용: 14_공통설정.js에서 브리핑 블록 변환 함수만 잘라 테스트 컨텍스트에 넣는다.
// (같은 파일의 postSlackDm_ 등은 각 테스트의 가짜 함수를 덮어쓰지 않도록 넣지 않는다.)
const fs = require('node:fs');
const vm = require('node:vm');

module.exports = function loadBriefingBlocks(context) {
  const source = fs.readFileSync('src/central-bot/14_공통설정.js', 'utf8') // 테스트는 저장소 맨 위에서 실행;
  const start = source.indexOf('function buildBriefingBlocks_');
  const end = source.indexOf('function postSlackDm_');
  if (start < 0 || end < start) throw new Error('briefing block helpers not found in 14_공통설정.js');
  vm.runInContext(source.slice(start, end), context);
};

// 10/23 추가 기능(주간 안내·점심 메이트·날씨·주말 인사)의 기본값: 01번만 불러오는 테스트에서 영향 없는 빈 동작.
// 각 테스트가 직접 넣은 가짜 함수가 있으면 덮어쓰지 않는다. 기능 자체는 WeeklyLunchWeather.test.js에서 검사한다.
const defaults = {
  formatWeeklyOutlook_: () => '', formatTomorrowWeather_: () => '', formatWeekendCountdown_: () => '', formatEveningNotes_: () => '',
  lunchMateParticipants_: () => [], lunchMatePlan_: () => new Map(), applyLunchMate_: selection => selection,
  formatLunchMateLine_: () => '', lunchMateOn_: () => false, lunchMateButtonBlock_: () => null, insertLunchMateButton_: blocks => blocks,
};
const original = module.exports;
module.exports = function loadBriefingBlocksWithDefaults(context) {
  original(context);
  for (const [name, fn] of Object.entries(defaults)) if (typeof context[name] !== 'function') context[name] = fn;
};
