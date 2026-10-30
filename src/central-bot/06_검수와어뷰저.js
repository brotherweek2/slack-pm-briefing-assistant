/**
 * 06. 검수와어뷰저 — 담당 탭(종료 임박·어뷰저), PM Review 1차 검수, 테스트지 검토 읽기
 *
 * 알아둘 것
 * - 원본은 한 번에 5만 칸 미만으로 나눠 읽는다. 테스트지·PM Review 머리글은 이름으로 찾는다.
 * - 담당 탭 목표 종료일은 연도가 없어 오늘에서 가장 가까운 해로 추정한다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 *
 * 내부 함수 (직접 실행하지 않음)
 * - collectHaCvPmDashboards_(source): 유효한 PM 탭의 프로젝트·목표 종료일을 읽는다
 * - collectPmTabProjects_(sheet, day): 새 양식 담당 탭 전체 열의 "프로젝트 번호 · 목표 종료일 · 수량 · 최대 N배치" 칸을 레코드로 만든다
 * - nearestIsoDate_(month, date, day): 월/일만 있는 날짜를 오늘에서 가장 가까운 해의 ISO 날짜로 바꾼다(연말·연초 경계용)
 * - buildHaCvAbuseTasks_(pm, records, day, sourceUrl, gid, now): 목표 종료 당일과 다음날 알림 후보를 만들고 작성 기한을 종료 다음날로 둔다
 * - isHaCvAbuseReminderDay_(target, day): 현재 날짜가 목표 종료 당일 또는 다음날인지 확인한다
 * - normalizeReviewPm_(value): 검수 담당자 표기를 정리한다
 * - readDisplayRowsInChunks_(sheet, firstRow, height, width): 원본을 한 번에 5만 칸 미만으로 나눠 읽는다(담당 탭·PM Review)
 * - collectPmReviewTasks_(source, day, now): 검수 Agent 완료·1차 검수중 상태의 담당자·파일·프로젝트·기한을 읽는다
 * - collectTestReviewTasks_(source, now): 생성 완료·검토 중인 테스트의 담당자와 검토 기한을 읽는다
 * - uniqueTaskKeys_(rows): 같은 업무 키가 두 번 나오면(같은 프로젝트·언어쌍 행이 둘) 뒤의 것에 행 번호를 붙여 BOT_TASKS 키 중복을 막는다
 */

/** Active PM tabs are discovered from the current source structure, not a name list. */
function collectHaCvPmDashboards_(source) {
  const dashboards = [];
  let day = '';
  source.getSheets().forEach(sheet => {
    const pm = sheet.getName();
    // Person-named active tabs; archive and operational tabs are excluded.
    if (!/^[가-힣]{2,4}[A-Z]?$/.test(pm)) return;
    const width = sheet.getLastColumn();
    if (width < 9) return;
    const top = sheet.getRange(1, 1, 6, width).getDisplayValues();
    // 예전 양식: H4:H6 해당 배치 / 구축 상태 / 목표 종료일
    if ([top[3][7], top[4][7], top[5][7]].map(value => String(value || '').trim())
      .join('|') === '해당 배치|구축 상태|목표 종료일') {
      dashboards.push({ pm, records: collectPilotDashboard_(top), gid: sheet.getSheetId() });
      return;
    }
    // 새 양식(10/27~): 1행 "PM · 언어쌍 관리", 언어쌍 블록 머리글 위 줄의 배치 칸에 "프로젝트 번호 · 목표 종료일 · 수량 · 최대 N배치"
    if (top[0].some(value => String(value || '').includes('언어쌍 관리'))) {
      day = day || Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
      const stats = {malformed: 0, yearGuessed: 0};
      dashboards.push({ pm, records: collectPmTabProjects_(sheet, day, stats), gid: sheet.getSheetId(),
        malformed: stats.malformed, yearGuessed: stats.yearGuessed });
    }
  });
  return dashboards;
}

const HACV_PM_TAB = Object.freeze({
  // 프로젝트 요약은 블록 머리글 바로 위 줄, 배치마다 A열(G·I·K·M·O)에 있다(10/28 인수인계). 열이 바뀔 수 있어 줄 전체를 본다.
  firstColumn: 1,
  project: /^(\d+)\s*·\s*(\d{1,2})\/(\d{1,2})\s*·\s*[\d,]+\s*개\s*·\s*최대\s*(\d+)\s*배치/,
  // 프로젝트 칸처럼 보이지만(번호로 시작하고 수량·배치가 있음) 위 형식과 다른 칸. 일부 칸만 양식이 바뀐 것을 잡는다.
  projectLike: /^\d{3,}\s*\S.*(?:개|배치)/,
  pair: /^[a-z]{2,3}_[A-Z]{2}-[a-z]{2,3}_[A-Z]{2}$/,
});

// 새 양식 담당 탭: 프로젝트 칸을 한 건씩 레코드로 만든다. 언어쌍은 같은 줄 또는 바로 아래 줄(블록 머리글)에서 찾는다.
// 같은 언어쌍·프로젝트 번호가 여러 칸에 보이면 첫 칸만 쓴다.
// 목표 종료일이 오늘 이후면 구축중, 지났으면 종료(사용자 확인 10/27). 연도는 오늘에서 가장 가까운 해로 정한다.
// stats(선택): malformed = 프로젝트 칸처럼 보이지만 읽지 못한 칸 수(형식 다름·언어쌍/날짜 없음),
// yearGuessed = 목표 종료일 연도를 올해가 아닌 해로 추정한 프로젝트 수(가장 가까운 해 규칙이라 연말·연초에만 생김).
function collectPmTabProjects_(sheet, day, stats) {
  const height = sheet.getLastRow(), width = sheet.getLastColumn();
  if (height < 1 || width < HACV_PM_TAB.firstColumn) return [];
  const rows = readDisplayRowsInChunks_(sheet, 1, height, width);
  const findPair = row => (row || []).map(value => String(value || '').trim()).find(value => HACV_PM_TAB.pair.test(value)) || '';
  const records = [];
  const seen = new Set();
  const count = key => { if (stats) stats[key]++; };
  rows.forEach((row, index) => {
    for (let col = HACV_PM_TAB.firstColumn - 1; col < row.length; col++) {
      const text = String(row[col] || '').trim();
      const match = text.match(HACV_PM_TAB.project);
      if (!match) { if (HACV_PM_TAB.projectLike.test(text)) count('malformed'); continue; }
      const pair = findPair(row) || findPair(rows[index + 1]);
      const targetEnd = nearestIsoDate_(Number(match[2]), Number(match[3]), day);
      if (!pair || !targetEnd) { count('malformed'); continue; }
      if (seen.has(pair + '|' + match[1])) continue;
      seen.add(pair + '|' + match[1]);
      if (targetEnd.slice(0, 4) !== day.slice(0, 4)) count('yearGuessed');
      records.push({ pair, projectId: match[1], stage: '', status: targetEnd >= day ? '구축중' : '종료',
        targetEnd, batches: [], firstColumn: col + 1, sheetRow: index + 1 });
    }
  });
  return records;
}

// 월/일만 있는 날짜를 오늘에서 가장 가까운 해의 ISO 날짜로 바꾼다(연말·연초 경계용).
function nearestIsoDate_(month, date, day) {
  const year = Number(day.slice(0, 4));
  const today = Date.UTC(year, Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return [year - 1, year, year + 1].map(y => normalizeSheetDate_(y + '-' + month + '-' + date)).filter(Boolean)
    .sort((a, b) => Math.abs(Date.parse(a) - today) - Math.abs(Date.parse(b) - today))[0] || '';
}

function buildHaCvAbuseTasks_(pm, records, day, sourceUrl, gid, now) {
  const due = new Map();
  records.forEach(item => {
    const target = normalizeSheetDate_(item.targetEnd);
    if (!isHaCvAbuseReminderDay_(target, day) || !item.pair) return;
    const key = item.pair + '|' + target;
    if (!due.has(key)) due.set(key, []);
    due.get(key).push(item);
  });
  return [...due.keys()].sort().map(key => {
    const items = due.get(key);
    const pair = items[0].pair;
    const target = normalizeSheetDate_(items[0].targetEnd);
    // 새 양식은 단계 대신 프로젝트 번호, 링크는 프로젝트 칸(sheetRow). 예전 양식은 단계·2~6행.
    const stages = [...new Set(items.map(item => item.sheetRow ? '프로젝트 ' + item.projectId : item.stage))].filter(Boolean);
    const column = columnLetters_(items[0].firstColumn);
    const cells = items[0].sheetRow ? column + items[0].sheetRow : column + '2:' + column + '6';
    return [
      'HACV_ABUSE|' + pm + '|' + pair + '|' + target,
      pm,
      '',
      pair,
      '어뷰저 관리',
      '목표 종료일 ' + target + ': ' + stages.join(', '),
      '목표 종료일 다음날까지 어뷰저 관리 실시',
      addDaysToIsoDate_(target, 1),
      '',
      'HA-CV ' + pm + ' 탭',
      sourceUrl + '#gid=' + gid + '&range=' + cells,
      items[0].sheetRow ? cells : column + '2:6',
      true,
      now,
    ];
  });
}

function isHaCvAbuseReminderDay_(target, day) {
  return Boolean(target && (target === day || addDaysToIsoDate_(target, 1) === day));
}

function normalizeReviewPm_(value) {
  const name = String(value || '').trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/님\s*$/, '').trim();
  return /^[가-힣]{2,4}[A-Z]?$/.test(name) ? name : '';
}

// 원본 조회 규칙(10/28 인수인계): 한 번에 5만 칸 미만으로 나눠 읽는다. 결과는 한 번에 읽은 것과 같다.
function readDisplayRowsInChunks_(sheet, firstRow, height, width) {
  const rows = [];
  const step = Math.max(1, Math.floor(49000 / width));
  for (let top = firstRow; top < firstRow + height; top += step) {
    rows.push(...sheet.getRange(top, 1, Math.min(step, firstRow + height - top), width).getDisplayValues());
  }
  return rows;
}

function collectPmReviewTasks_(source, day, now) {
  const sheet = source.getSheetByName('PM Review');
  if (!sheet) throw new Error('PM Review 탭이 없습니다.');
  // 머리글 줄과 열을 이름으로 찾는다. 사본은 3행·J·K열, 원본은 머리글 줄이 다르고
  // "1차 검수 시작 예정일"이 끼어 K·L열이다. 머리글은 1~5행 안에 있다.
  const width = 30;
  const top = sheet.getRange(1, 1, 5, width).getDisplayValues().map(row => row.map(value => String(value || '').trim()));
  const headerIndex = top.findIndex(row => ['언어쌍', 'Status', '1차 검수', '1차 검수 기한'].every(name => row.includes(name)));
  if (headerIndex < 0) {
    throw new Error('PM Review의 언어쌍·상태·담당자·기한 헤더가 예상과 다릅니다. 1~5행 중 한 줄에 언어쌍 / Status / 1차 검수 / 1차 검수 기한이 있어야 합니다.');
  }
  const header = top[headerIndex], firstRow = headerIndex + 2;
  const col = {pair:header.indexOf('언어쌍'), status:header.indexOf('Status'), pm:header.indexOf('1차 검수'),
    due:header.indexOf('1차 검수 기한'), type:header.indexOf('데이터 타입')};
  const height = Math.max(0, sheet.getLastRow() - firstRow + 1);
  if (!height) return [];
  const rows = readDisplayRowsInChunks_(sheet, firstRow, height, width);
  // 원본은 "검수 Agent 완료"처럼 대소문자·띄어쓰기가 다를 수 있어 둘 다 무시하고 비교한다.
  const statusKey = value => String(value || '').replace(/\s+/g, '').toUpperCase();
  const active = new Set(BOT_WORKBOOK.pmReviewStatuses.map(statusKey));
  const link = [columnLetters_(col.pm + 1), columnLetters_(col.due + 1)];
  return uniqueTaskKeys_(rows.flatMap((row, index) => {
    const status = String(row[col.status] || '').trim();
    const pm = normalizeReviewPm_(row[col.pm]);
    const pair = String(row[col.pair] || '').trim();
    const due = normalizeSheetDate_(row[col.due]);
    // "1차 검수 기한" 열의 날짜가 기한이다. TBD/빈칸은 아직 기한 미정이다.
    // 검수 완료 전이라면 지난 기한도 '기한 경과'로 표시한다.
    if (!active.has(statusKey(status)) || !pm || !pair) return [];
    const rowNumber = index + firstRow;
    const projectId = /^\d+$/.test(String(row[0] || '').trim()) ? String(row[0]).trim() : '';
    const type = col.type < 0 ? '' : String(row[col.type] || '').trim();
    return [[
      // 원본은 행이 끼거나 정렬되므로 행 번호 대신 프로젝트 번호·언어쌍으로 구분한다(14:00 새 업무 판단용).
      'PM_REVIEW|' + (projectId ? projectId + '|' + pair : 'row' + rowNumber),
      pm,
      projectId,
      pair,
      '1차 검수',
      (type ? type + ' ' : '') + status + (due && due < day ? ', 기한 경과' : ''),
      'PM Review의 데이터 검수 파일 확인 및 1차 검수 진행',
      due,
      '',
      'PM Review', // 분기마다 파일이 바뀌므로 분기 이름은 넣지 않는다.
      source.getUrl() + '#gid=' + sheet.getSheetId() + '&range=' + link[0] + rowNumber + ':' + link[1] + rowNumber,
      String(rowNumber),
      true,
      now,
    ]];
  }));
}

function collectTestReviewTasks_(source, now) {
  // 운영본은 (ing)가 없고 기존 사본은 (ing)가 있다. 확인된 두 이름만 허용한다.
  // 둘 다 있으면 활성 탭을 임의 선택하지 않는다. 다른 파일 연결을 0건으로 숨기지 않는다.
  const candidates = ['HT 테스트지 제작 관리', 'HT 테스트지 제작 관리(ing)']
    .map(name => ({name, sheet:source.getSheetByName(name)})).filter(item => item.sheet);
  if (candidates.length !== 1) throw new Error(candidates.length ?
    '테스트지 관리 대상 탭이 2개입니다. 활성 탭을 확인하세요. 자동 선택·발송 없음.' :
    '테스트 관리 연결 파일에 HT 테스트지 제작 관리 또는 HT 테스트지 제작 관리(ing) 탭이 없습니다. 연결 파일과 탭 이름을 확인하세요.');
  const {name:tabName, sheet} = candidates[0];
  // 머리글은 1~3행 중 한 줄에서 이름으로 찾는다(지금은 1행 A·E·F·H). 열이 끼거나 순서가 바뀌어도 읽는다.
  const width = Math.max(1, Math.min(sheet.getLastColumn(), 30));
  const names = {pair:'Language Pair', due:'검토 완료일', status:'Status', pm:'검토 PM'};
  const top = sheet.getRange(1, 1, Math.min(3, Math.max(1, sheet.getLastRow())), width).getDisplayValues();
  let headerIndex = -1, col = null;
  top.some((row, r) => {
    const cells = row.map(value => String(value || '').trim()), found = {};
    if (!Object.keys(names).every(key => (found[key] = cells.indexOf(names[key])) >= 0)) return false;
    headerIndex = r; col = found; return true;
  });
  if (!col) {
    throw new Error('테스트 관리 탭의 언어쌍·검토 완료일·상태·검토 PM 헤더가 예상과 다릅니다. 1~3행 중 한 줄에 ' +
      'Language Pair / 검토 완료일 / Status / 검토 PM이 있어야 합니다 · 1행: ' + (top[0] || []).slice(0, 8).map(v => '"' + v + '"').join(' / '));
  }
  const firstRow = headerIndex + 2;
  const height = Math.max(0, sheet.getLastRow() - firstRow + 1);
  if (!height) return [];
  const rows = readDisplayRowsInChunks_(sheet, firstRow, height, width);
  const statusLetter = columnLetters_(col.status + 1), pmLetter = columnLetters_(col.pm + 1);
  return uniqueTaskKeys_(rows.flatMap((row, index) => {
    const pair = String(row[col.pair] || '').trim();
    const due = normalizeSheetDate_(row[col.due]);
    const status = String(row[col.status] || '').trim();
    const pm = normalizeReviewPm_(row[col.pm]);
    if (!pm || !pair || !['생성 완료', '검토 중'].includes(status)) return [];
    const rowNumber = index + firstRow;
    return [[
      'TEST_REVIEW|' + pair + '|' + pm, // 행 번호 대신 언어쌍·담당자(같은 조합이 또 있으면 행 번호를 붙임)
      pm,
      '',
      pair,
      '테스트지 검토',
      '테스트지 ' + status + ', 검토 필요',
      '테스트지 검토 후 ' + statusLetter + '열을 검토 완료로 변경',
      due, // '검토 완료일'은 완료 기록이 아니라 검토 완료 기한이다.
      '',
      tabName,
      source.getUrl() + '#gid=' + sheet.getSheetId() + '&range=' + pmLetter + rowNumber,
      String(rowNumber),
      true,
      now,
    ]];
  }));
}

// 같은 업무 키가 두 번 나오면(같은 프로젝트·언어쌍 행이 둘) 뒤의 것에 행 번호를 붙여 BOT_TASKS 키 중복을 막는다.
function uniqueTaskKeys_(rows) {
  const seen = new Set();
  return rows.map(row => {
    if (seen.has(row[0])) row[0] += '|row' + row[11];
    seen.add(row[0]);
    return row;
  });
}
