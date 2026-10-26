/**
 * 24. 주간 안내 — 월요일 11시·목/금요일 17시에만 붙는 짧은 영역.
 * - formatWeeklyOutlook_(pm, rows, day, slot): 월요일 11시 "이번 주 종료 예정"(언어쌍 목표 종료일),
 *   금요일 17시 "다음 주 초 미리보기"(다음 주 월·화 기한 업무). 해당 요일·회차가 아니면 빈 문자열.
 * - formatWeekendCountdown_(day, slot): 목요일 17시 "주말까지 D-2", 금요일 17시 "D-1 · 좋은 주말 보내세요".
 * - 영향: 계산만. 시트 읽기는 이미 읽어 둔 BOT_TASKS 행만 쓴다. 저장·DM 없음(발송부가 문안에 붙임).
 */
function weeklyDayOfWeek_(day) {
  return new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay(); // 0=일 … 5=금
}

function weeklyTaskDay_(value) {
  return formatPilotDate_(value).match(/^\d{4}-\d{2}-\d{2}/) ? formatPilotDate_(value).slice(0, 10) : normalizeSheetDate_(value);
}

function formatWeeklyOutlook_(pm, rows, day, slot) {
  const weekday = weeklyDayOfWeek_(day);
  const own = rows.filter(row => row[12] === true && String(row[1] || '').trim() === pm && isHaCvBriefingTask_(row[0]));
  if (weekday === 1 && slot === '11:00') {
    // 월요일: 이번 주(월~금) 안에 목표 종료일이 있는 언어쌍
    const friday = addDaysToIsoDate_(day, 4);
    const items = own.filter(row => String(row[0]).startsWith('HACV_DUE_SOON|'))
      .map(row => ({due: weeklyTaskDay_(row[7]), pair: String(row[3] || '').trim()}))
      .filter(item => item.due && item.due >= day && item.due <= friday && item.pair)
      .sort((a, b) => a.due.localeCompare(b.due) || a.pair.localeCompare(b.pair));
    if (!items.length) return '';
    const unique = [...new Map(items.map(item => [item.due + '|' + item.pair, item])).values()];
    return '\n\n📆 *이번 주 종료 예정*\n' + unique.map(item => '• ' + formatBriefingDay_(item.due) + ' ' + escapeSlack_(item.pair)).join('\n');
  }
  if (weekday === 5 && slot === '17:00') {
    // 금요일: 다음 주 월·화 기한 업무를 미리 본다(종료 임박·어뷰저·1차 검수·테스트지).
    const monday = addDaysToIsoDate_(day, 3), tuesday = addDaysToIsoDate_(day, 4);
    const label = key => key.startsWith('HACV_DUE_SOON|') ? '언어쌍 종료' : key.startsWith('HACV_ABUSE|') ? '어뷰저 관리' :
      key.startsWith('PM_REVIEW|') ? '1차 검수' : key.startsWith('TEST_REVIEW|') ? '테스트지 검토' : '';
    const items = own.map(row => ({due: weeklyTaskDay_(row[7]), kind: label(String(row[0])), pair: String(row[3] || '').trim()}))
      .filter(item => item.kind && (item.due === monday || item.due === tuesday))
      .sort((a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind) || a.pair.localeCompare(b.pair));
    const unique = [...new Map(items.map(item => [item.due + '|' + item.kind + '|' + item.pair, item])).values()];
    return '\n\n📆 *다음 주 초 미리보기*\n' + (unique.length ?
      unique.map(item => '• ' + formatBriefingDay_(item.due) + ' ' + item.kind + (item.pair ? ' · ' + escapeSlack_(item.pair) : '')).join('\n') :
      '• 월·화 기한 업무 없음');
  }
  return '';
}

function formatWeekendCountdown_(day, slot) {
  if (slot !== '17:00') return '';
  const weekday = weeklyDayOfWeek_(day);
  if (weekday === 4) return '\n\n🗓️ 주말까지 D-2';
  if (weekday === 5) return '\n\n🗓️ 주말까지 D-1 · 이번 주도 수고하셨어요! 좋은 주말 보내세요';
  return '';
}
