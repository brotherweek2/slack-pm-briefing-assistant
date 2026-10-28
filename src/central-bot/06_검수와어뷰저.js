/**
 * 06. 검수와어뷰저
 * - 역할: PM 담당 일정·직접 검수·테스트·어뷰저 업무 수집
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 06-01. PM 담당 탭 읽기 [내부]
 * - collectHaCvPmDashboards_(source): 유효한 PM 탭의 프로젝트·목표 종료일을 읽는다. 예전 양식(H4:H6)과 새 양식(1행 "언어쌍 관리") 모두 읽는다.
 * - collectPmTabProjects_(sheet, day): 새 양식 담당 탭 전체 열의 "프로젝트 번호 · 목표 종료일 · 수량 · 최대 N배치" 칸을 레코드로 만든다. 지난 종료일은 종료로 본다.
 *
 * 06-02. 대안 일정 자료 읽기 [내부]
 * - collectHaCvPpDashboards_(source): 진단용 HACV_PP 헤더와 날짜·담당자를 읽는다. 현재 일일 발송 기준을 대체하지 않는다.
 *
 * 06-03. 누락 헤더 설명 [내부]
 * - describeMissingHaCvPpHeader_(display): 대안 일정 자료에 필요한 헤더가 없을 때 진단 문구를 만든다.
 *
 * 06-04. 헤더 이름 정리 [내부]
 * - normalizeHaCvPpLabel_(value): 대안 일정 헤더의 공백·표기 차이를 정리한다.
 *
 * 06-05. 대안 일정 열 찾기 [내부]
 * - findHaCvPpColumns_(row): 헤더 이름으로 프로젝트·언어쌍·상태·일정·담당 열을 찾는다.
 *
 * 06-06. 대안 종료 후보 [내부]
 * - buildHaCvPpUpcomingTasks_(pm, records, day, sourceUrl, gid, now): 진단용 대안 자료의 종료 임박 후보를 만든다.
 *
 * 06-07. 대안 어뷰저 후보 [내부]
 * - buildHaCvPpAbuseTasks_(pm, records, day, sourceUrl, gid, now): 진단용 대안 자료에서 종료 당일·다음날 어뷰저 후보를 만든다.
 *
 * 06-08. 대안 일정 묶기 [내부]
 * - groupHaCvPpRecords_(records): 같은 업무의 배치별 레코드를 묶는다.
 *
 * 06-09. 일정 자료 비교 [직접 실행]
 * - 함수: compareHaCvDeadlineSources()
 * - 기능: 담당 탭과 진단용 대안 일정의 차이를 읽기 전용으로 비교한다.
 * - 사용: 담당 탭과 대안 일정 자료의 차이를 진단할 때 실행.
 * - 영향: 시트 읽기만. DM·시트 변경 없음.
 *
 * 06-10. 어뷰저 관리 후보 [내부]
 * - buildHaCvAbuseTasks_(pm, records, day, sourceUrl, gid, now): 목표 종료 당일과 다음날 알림 후보를 만들고 작성 기한을 종료 다음날로 둔다.
 *
 * 06-11. 어뷰저 알림일 확인 [내부]
 * - isHaCvAbuseReminderDay_(target, day): 현재 날짜가 목표 종료 당일 또는 다음날인지 확인한다.
 *
 * 06-12. 검수 담당자 정리 [내부]
 * - normalizeReviewPm_(value): 검수 담당자 표기를 정리한다.
 *
 * 06-13. PM 1차 검수 후보 [내부]
 * - collectPmReviewTasks_(source, day, now): 검수 Agent 완료·1차 검수중 상태의 담당자·파일·프로젝트·기한을 읽는다.
 *
 * 06-14. 테스트지 검토 후보 [내부]
 * - collectTestReviewTasks_(source, now): 생성 완료·검토 중인 테스트의 담당자와 검토 기한을 읽는다.
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
      dashboards.push({ pm, records: collectPmTabProjects_(sheet, day), gid: sheet.getSheetId() });
    }
  });
  return dashboards;
}

const HACV_PM_TAB = Object.freeze({
  // 프로젝트 요약은 블록 머리글 바로 위 줄, 배치마다 A열(G·I·K·M·O)에 있다(10/28 인수인계). 열이 바뀔 수 있어 줄 전체를 본다.
  firstColumn: 1,
  project: /^(\d+)\s*·\s*(\d{1,2})\/(\d{1,2})\s*·\s*[\d,]+\s*개\s*·\s*최대\s*(\d+)\s*배치/,
  pair: /^[a-z]{2,3}_[A-Z]{2}-[a-z]{2,3}_[A-Z]{2}$/,
});

// 새 양식 담당 탭: 프로젝트 칸을 한 건씩 레코드로 만든다. 언어쌍은 같은 줄 또는 바로 아래 줄(블록 머리글)에서 찾는다.
// 같은 언어쌍·프로젝트 번호가 여러 칸에 보이면 첫 칸만 쓴다.
// 목표 종료일이 오늘 이후면 구축중, 지났으면 종료(사용자 확인 10/27). 연도는 오늘에서 가장 가까운 해로 정한다.
function collectPmTabProjects_(sheet, day) {
  const height = sheet.getLastRow(), width = sheet.getLastColumn();
  if (height < 1 || width < HACV_PM_TAB.firstColumn) return [];
  const rows = sheet.getRange(1, 1, height, width).getDisplayValues();
  const findPair = row => (row || []).map(value => String(value || '').trim()).find(value => HACV_PM_TAB.pair.test(value)) || '';
  const records = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    for (let col = HACV_PM_TAB.firstColumn - 1; col < row.length; col++) {
      const match = String(row[col] || '').trim().match(HACV_PM_TAB.project);
      if (!match) continue;
      const pair = findPair(row) || findPair(rows[index + 1]);
      const targetEnd = nearestIsoDate_(Number(match[2]), Number(match[3]), day);
      if (!pair || !targetEnd || seen.has(pair + '|' + match[1])) continue;
      seen.add(pair + '|' + match[1]);
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

// 종료 임박·어뷰저 관리의 공통 원천. PM 개인 탭 상단은 이 탭을 수식으로 참조하므로,
// 개인 탭 양식이 바뀌어도 영향을 받지 않도록 HACV_PP를 제목 이름으로 직접 읽는다.
const HACV_PP = {
  tab: 'HACV_PP',
  headers: { stage: 'Batch', projectId: 'No', pair: '언어쌍', status: 'Status',
    pm: '언어쌍 담당 PM', targetEnd: '목표 종료일' },
};

/** HACV_PP를 읽어 PM별 레코드로 묶는다. 제목줄을 못 찾으면 조용히 넘기지 않고 중지한다. */
function collectHaCvPpDashboards_(source) {
  const sheet = source.getSheetByName(HACV_PP.tab);
  if (!sheet) throw new Error('HA-CV 원천에 ' + HACV_PP.tab + ' 탭이 없습니다.');
  const range = sheet.getDataRange();
  const display = range.getDisplayValues();
  const values = range.getValues();
  const byPm = new Map();
  let columns = null;
  let headerRows = 0;
  display.forEach((row, index) => {
    const found = findHaCvPpColumns_(row);
    if (found) { columns = found; headerRows++; return; }
    if (!columns) return;
    const pm = String(row[columns.pm] || '').trim();
    const pair = String(row[columns.pair] || '').trim();
    if (!pm || !/^[a-z]{2}_[A-Z]{2}-[a-z]{2}_[A-Z]{2}$/.test(pair)) return;
    const rawEnd = values[index][columns.targetEnd];
    if (!byPm.has(pm)) byPm.set(pm, []);
    byPm.get(pm).push({
      pair,
      projectId: String(row[columns.projectId] || '').trim(),
      stage: String(row[columns.stage] || '').trim(),
      status: String(row[columns.status] || '').trim(),
      targetEnd: rawEnd instanceof Date
        ? Utilities.formatDate(rawEnd, BRIEFING.timezone, 'yyyy-MM-dd')
        : String(row[columns.targetEnd] || '').trim(),
      sheetRow: index + 1,
    });
  });
  if (!headerRows) throw new Error(describeMissingHaCvPpHeader_(display));
  const gid = sheet.getSheetId();
  return [...byPm.keys()].sort().map(pm => ({ pm, records: byPm.get(pm), gid }));
}

// 제목줄을 못 찾았을 때 원인을 바로 알 수 있도록, 상단 30행 중 제목이 가장 많이 맞는 행과
// 빠진 제목을 알려준다. 제목 문구만 보여주고 데이터 값은 출력하지 않는다.
function describeMissingHaCvPpHeader_(display) {
  const labels = Object.entries(HACV_PP.headers);
  let best = { row: 0, hits: [], cells: [] };
  display.slice(0, 30).forEach((row, index) => {
    const cells = row.map(value => normalizeHaCvPpLabel_(value));
    const hits = labels.filter(([field, label]) => field === 'targetEnd'
      ? cells.some(value => value.startsWith(label)) : cells.includes(label));
    if (hits.length > best.hits.length) best = { row: index + 1, hits, cells };
  });
  const missing = labels.filter(entry => !best.hits.includes(entry)).map(([, label]) => label);
  if (!best.row) {
    return HACV_PP.tab + ' 상단 30행에서 제목을 하나도 찾지 못했습니다. ' +
      '데이터가 비어 있거나 IMPORTRANGE 연결 허용이 필요할 수 있습니다.';
  }
  return HACV_PP.tab + ' 제목줄을 찾지 못했습니다. 가장 비슷한 행: ' + best.row + '행 | 빠진 제목: ' +
    missing.join(', ') + ' | 그 행의 제목들: ' + best.cells.filter(Boolean).slice(0, 40).join(' / ');
}

function normalizeHaCvPpLabel_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findHaCvPpColumns_(row) {
  const cells = row.map(value => normalizeHaCvPpLabel_(value));
  const columns = {};
  for (const [field, label] of Object.entries(HACV_PP.headers)) {
    const index = field === 'targetEnd'
      ? cells.findIndex(value => value.startsWith(label))
      : cells.indexOf(label);
    if (index < 0) return null;
    columns[field] = index;
  }
  return columns;
}

// 종료 임박: 같은 PM·언어쌍·목표 종료일은 한 건으로 묶는다(배치 단계가 여러 개여도 한 줄).
function buildHaCvPpUpcomingTasks_(pm, records, day, sourceUrl, gid, now) {
  const endDay = addDaysToIsoDate_(day, BOT_WORKBOOK.upcomingDays);
  const groups = groupHaCvPpRecords_(records.filter(item => {
    const target = normalizeSheetDate_(item.targetEnd);
    return item.status === '구축중' && target && target >= day && target <= endDay;
  }));
  return groups.map(({ pair, target, items }) => [
    'HACV_DUE_SOON|' + pm + '|' + pair + '|' + target,
    pm,
    items.map(item => item.projectId).filter(id => /^\d+$/.test(id)).join(', '),
    pair,
    '구축 현황 확인',
    items.map(item => item.stage).filter(Boolean).join('/') + ' 구축중, 목표 종료일 임박',
    '종료 일정과 남은 작업 확인',
    target,
    '',
    'HA-CV ' + HACV_PP.tab,
    sourceUrl + '#gid=' + gid + '&range=A' + items[0].sheetRow + ':AH' + items[0].sheetRow,
    items.map(item => item.sheetRow).join(', '),
    true,
    now,
  ]);
}

// 종료 당일과 다음날 모두 안내한다. 완료 상태를 읽지 않으므로 완료 여부는 추정하지 않는다.
function buildHaCvPpAbuseTasks_(pm, records, day, sourceUrl, gid, now) {
  const groups = groupHaCvPpRecords_(records.filter(item =>
    isHaCvAbuseReminderDay_(normalizeSheetDate_(item.targetEnd), day)));
  return groups.map(({ pair, target, items }) => [
    'HACV_ABUSE|' + pm + '|' + pair + '|' + target,
    pm,
    '',
    pair,
    '어뷰저 관리',
    '목표 종료일 ' + target + ': ' + [...new Set(items.map(item => item.stage))].filter(Boolean).join(', '),
    '목표 종료일 다음날까지 어뷰저 관리 실시',
    addDaysToIsoDate_(target, 1),
    '',
    'HA-CV ' + HACV_PP.tab,
    sourceUrl + '#gid=' + gid + '&range=A' + items[0].sheetRow + ':AH' + items[0].sheetRow,
    items.map(item => item.sheetRow).join(', '),
    true,
    now,
  ]);
}

function groupHaCvPpRecords_(records) {
  const groups = new Map();
  records.forEach(item => {
    const target = normalizeSheetDate_(item.targetEnd);
    const key = item.pair + '\u001f' + target;
    if (!groups.has(key)) groups.set(key, { pair: item.pair, target, items: [] });
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a, b) =>
    a.target.localeCompare(b.target) || a.pair.localeCompare(b.pair));
}

/** 개인 탭 방식과 HACV_PP 방식의 PM별 건수를 나란히 로그로 비교한다. 시트 변경·Slack 발송 없음. */
function compareHaCvDeadlineSources() {
  const props = PropertiesService.getScriptProperties();
  const source = SpreadsheetApp.openById(requiredProperty_(props, 'SOURCE_SPREADSHEET_ID'));
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  const now = new Date();
  // PM별로 "언어쌍 목표종료일" 목록을 만든다. 건수만이 아니라 어떤 건이 다른지 보여주기 위함.
  const collect = (dashboards, upcoming, abuse) => {
    const result = {};
    dashboards.forEach(({ pm, records, gid }) => {
      const label = row => row[3] + ' ' + String(row[7]).slice(5);
      result[pm] = {
        due: upcoming(pm, records, day, '', gid, now).map(label),
        abuse: abuse(pm, records, day, '', gid, now).map(row => row[3]),
      };
    });
    return result;
  };
  const tabs = collect(collectHaCvPmDashboards_(source), buildHaCvUpcomingTasks_, buildHaCvAbuseTasks_);
  const pp = collect(collectHaCvPpDashboards_(source), buildHaCvPpUpcomingTasks_, buildHaCvPpAbuseTasks_);
  const show = item => item ? item.due.length + '/' + item.abuse.length : '없음';
  console.log('PM | 개인 탭 (종료 임박/어뷰저) | HACV_PP (종료 임박/어뷰저)');
  [...new Set(Object.keys(tabs).concat(Object.keys(pp)))].sort().forEach(pm => {
    console.log(pm + ' | ' + (tabs[pm] ? show(tabs[pm]) : '탭 없음') + ' | ' + show(pp[pm]));
    const a = tabs[pm] ? tabs[pm].due.concat(tabs[pm].abuse.map(p => '어뷰저 ' + p)) : [];
    const b = pp[pm] ? pp[pm].due.concat(pp[pm].abuse.map(p => '어뷰저 ' + p)) : [];
    const onlyPp = b.filter(item => !a.includes(item));
    const onlyTab = a.filter(item => !b.includes(item));
    if (onlyPp.length) console.log('   HACV_PP에만: ' + onlyPp.join(', '));
    if (onlyTab.length) console.log('   개인 탭에만: ' + onlyTab.join(', '));
  });
  console.log('비교만 수행 | 시트 변경 없음 | Slack 발송 없음');
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
  const rows = sheet.getRange(firstRow, 1, height, width).getDisplayValues();
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
  const sheet = source.getSheetByName('HT 테스트지 제작 관리(ing)');
  if (!sheet) throw new Error('HT 테스트지 제작 관리(ing) 탭이 없습니다.');
  const header = sheet.getRange(1, 1, 1, 8).getDisplayValues()[0];
  if (header[0].trim() !== 'Language Pair' || header[4].trim() !== '검토 완료일' ||
      header[5].trim() !== 'Status' || header[7].trim() !== '검토 PM') {
    throw new Error('테스트 관리 탭의 언어쌍·검토 완료일·상태·검토 PM 헤더가 예상과 다릅니다. 1행 A·E·F·H열 기대: ' +
      'Language Pair / 검토 완료일 / Status / 검토 PM · 실제: ' + [0, 4, 5, 7].map(i => '"' + header[i] + '"').join(' / '));
  }
  const height = Math.max(0, sheet.getLastRow() - 1);
  if (!height) return [];
  const rows = sheet.getRange(2, 1, height, 8).getDisplayValues();
  return uniqueTaskKeys_(rows.flatMap((row, index) => {
    const pair = String(row[0] || '').trim();
    const due = normalizeSheetDate_(row[4]);
    const status = String(row[5] || '').trim();
    const pm = normalizeReviewPm_(row[7]);
    if (!pm || !pair || !['생성 완료', '검토 중'].includes(status)) return [];
    const rowNumber = index + 2;
    return [[
      'TEST_REVIEW|' + pair + '|' + pm, // 행 번호 대신 언어쌍·담당자(같은 조합이 또 있으면 행 번호를 붙임)
      pm,
      '',
      pair,
      '테스트지 검토',
      '테스트지 ' + status + ', 검토 필요',
      '테스트지 검토 후 F열을 검토 완료로 변경',
      due, // E열은 완료 기록이 아니라 검토 완료 기한이다.
      '',
      'HT 테스트지 제작 관리(ing)',
      source.getUrl() + '#gid=' + sheet.getSheetId() + '&range=H' + rowNumber,
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
