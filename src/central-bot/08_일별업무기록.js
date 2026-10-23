/**
 * 08. 일별업무기록
 * - 역할: 헤즈업·검토 대상의 날짜별 조회 기록과 변화 표시
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 08-01. 오늘 조회 기록 저장 [내부]
 * - saveHaCvDailyHistory_(bot, taskRows, day, scannedAt): 같은 날짜 기록 교체·최근 90일 보관. 이전 날짜와 비교한 변화·잔류를 반환한다. 영향: BOT_DAILY_HISTORY 자동 생성 이력 정리.
 *
 * 08-02. 일별 기록 행 생성 [내부]
 * - buildHaCvHistoryRows_(taskRows, day, scannedAt): 헤즈업·HUB 업무에서 근거 행별 기록과 집계를 만든다.
 *
 * 08-03. 전일·잔류 비교 [내부]
 * - calculateHaCvDailyTrends_(oldRows, todayRows, day): 전날 대비 증감과 같은 원천 행의 연속 잔류를 계산한다.
 *
 * 08-04. 기록 날짜 정리 [내부]
 * - haCvHistoryDay_(value): 이력의 날짜 값을 ISO 날짜로 통일한다.
 *
 * 08-05. 변화 안내 문안 [내부]
 * - formatHaCvDailyTrend_(trend): 실제 비교 가능한 증감·잔류만 짧게 표시한다.
 */

/**
 * HA-CV 헤즈업·HUB 검토 필요 대상의 일별 조회 결과를 저장한다.
 * 대상자의 이름이나 연락처는 저장하지 않고 원본 시트의 행 번호만 기록한다.
 * Slack 발송이나 원천 시트 수정은 하지 않는다.
 */
function saveHaCvDailyHistory_(bot, taskRows, day, scannedAt) {
  const sheet = ensureBotSheet_(bot, BOT_WORKBOOK.historyTab, BOT_WORKBOOK.historyHeaders);
  const oldRows = readBotRows_(sheet, BOT_WORKBOOK.historyHeaders.length);
  const todayRows = buildHaCvHistoryRows_(taskRows, day, scannedAt);
  const oldestDay = addDaysToIsoDate_(day, -89);
  const pastRows = oldRows.filter(row => {
    const savedDay = haCvHistoryDay_(row[0]);
    return savedDay && savedDay !== day && savedDay >= oldestDay;
  });
  const trends = calculateHaCvDailyTrends_(oldRows, todayRows, day);
  const output = pastRows.concat(todayRows);

  // 이 탭의 A:G는 자동 생성 영역이다. 동일 날짜의 기존 행을 교체한다.
  const previousCount = sheet.getLastRow() - 1;
  if (output.length) sheet.getRange(2, 1, output.length, BOT_WORKBOOK.historyHeaders.length)
    .setValues(output);
  if (previousCount > output.length) sheet.getRange(output.length + 2, 1,
    previousCount - output.length, BOT_WORKBOOK.historyHeaders.length).clearContent();
  console.log('BOT_DAILY_HISTORY ' + day + ' 조회 기록 ' + (todayRows.length - 1) +
    '행 저장 (같은 날짜는 교체, Slack 발송 없음)');
  return trends;
}

function buildHaCvHistoryRows_(taskRows, day, scannedAt) {
  const rows = [[day, 'SCAN', '', '', '', '', scannedAt]];
  const seen = new Set();
  taskRows.forEach(task => {
    if (task[12] !== true) return;
    const key = String(task[0] || '');
    const type = key.startsWith('HACV_HEADSUP|') ? 'HEADSUP'
      : key.startsWith('HACV_REVIEW|') ? 'REVIEW' : '';
    if (!type) return;
    const owner = String(task[1] || '').trim();
    const pair = String(task[3] || '').trim();
    if (!owner || !pair) return;
    String(task[11] || '').split(',').map(value => value.trim())
      .filter(value => /^\d+$/.test(value)).forEach(sourceRow => {
        const identity = [type, owner, pair, sourceRow].join('|');
        if (seen.has(identity)) return;
        seen.add(identity);
        rows.push([day, type, owner, pair, sourceRow, key, scannedAt]);
      });
  });
  return rows.sort((a, b) => a[1] === 'SCAN' ? -1 : b[1] === 'SCAN' ? 1 :
    String(a.slice(1, 5)).localeCompare(String(b.slice(1, 5))));
}

function calculateHaCvDailyTrends_(oldRows, todayRows, day) {
  const yesterday = addDaysToIsoDate_(day, -1);
  const twoDaysAgo = addDaysToIsoDate_(day, -2);
  const hasScan = date => oldRows.some(row => haCvHistoryDay_(row[0]) === date && row[1] === 'SCAN');
  const prior = hasScan(yesterday) ? oldRows.filter(row => haCvHistoryDay_(row[0]) === yesterday) : null;
  const earlier = prior && hasScan(twoDaysAgo)
    ? oldRows.filter(row => haCvHistoryDay_(row[0]) === twoDaysAgo) : null;
  const identity = row => [row[1], row[2], row[3], row[4]].join('|');
  const priorIds = new Set((prior || []).filter(row => row[1] !== 'SCAN').map(identity));
  const earlierIds = new Set((earlier || []).filter(row => row[1] !== 'SCAN').map(identity));
  // Yesterday's last candidate can disappear today; keep that PM in the comparison.
  const owners = new Set((prior || []).concat(todayRows)
    .filter(row => row[1] !== 'SCAN').map(row => row[2]));
  const trends = {};
  owners.forEach(pm => {
    const count = (rows, type) => rows.filter(row => row[2] === pm && row[1] === type).length;
    trends[pm] = {
      baseline: !prior,
      headsUpDelta: prior ? count(todayRows, 'HEADSUP') - count(prior, 'HEADSUP') : 0,
      reviewDelta: prior ? count(todayRows, 'REVIEW') - count(prior, 'REVIEW') : 0,
      stalled: earlier ? todayRows.filter(row => row[2] === pm && row[1] !== 'SCAN' &&
        priorIds.has(identity(row)) && earlierIds.has(identity(row))).length : 0,
      hasThreeDays: Boolean(earlier),
    };
  });
  return trends;
}

// 시트가 yyyy-MM-dd 입력을 날짜 셀(Date)로 변환하는 경우에도 같은 날로 비교한다.
function haCvHistoryDay_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? ''
      : Utilities.formatDate(value, BRIEFING.timezone, 'yyyy-MM-dd');
  }
  if (typeof value === 'number' && isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString().slice(0, 10);
  }
  return normalizeSheetDate_(value);
}

function formatHaCvDailyTrend_(trend) {
  if (!trend || trend.baseline) return '';
  const signed = value => value > 0 ? '+' + value : String(value);
  const changes = [];
  if (trend.headsUpDelta) changes.push('헤즈업 ' + signed(trend.headsUpDelta) + '명');
  if (trend.reviewDelta) changes.push('검토 필요 ' + signed(trend.reviewDelta) + '명');
  const lines = changes.length ? ['전일 대비: ' + changes.join(' | ')] : [];
  if (trend.hasThreeDays && trend.stalled) {
    lines.push('같은 원본 행 3일 연속 남음: ' + trend.stalled + '건');
  }
  return lines.join('\n');
}
