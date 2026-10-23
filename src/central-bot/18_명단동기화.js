/**
 * 18. 명단동기화
 * - 역할: Slack 그룹만으로 PM 이름·Slack ID·이메일(=캘린더 ID)을 채울 수 있는지 확인
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 18-01. 명단 자동 채우기 증명 [직접 실행]
 * - 함수: previewRosterFromSlack()
 * - 기능: 봇 토큰 권한을 확인하고, Slack 그룹 구성원의 실명·이메일을 읽어 BOT_USERS·업무 시트 담당자 이름과 대조한다.
 * - 사용: Slack 앱에 users:read, users:read.email 추가 후 실행. 그룹은 SLACK_ROSTER_GROUP_IDS(쉼표 구분), 없으면 SLACK_PM_GROUP_ID.
 * - 영향: Slack·시트 읽기만. 로그의 이메일은 일부 가림. 시트·속성·트리거 변경·DM 없음.
 *
 * 18-02. Slack 구성원 읽기 [내부]
 * - readSlackRosterMembers_(token, groupIds, budget): 그룹별 구성원 ID와 users.info의 실명·이메일·비활성 여부를 모은다.
 *
 * 18-03. 이름 맞추기 [내부]
 * - normalizeRosterName_(value): 괄호·슬래시 뒤 표기와 공백을 지워 시트 담당자 이름과 비교할 형태로 만든다.
 *
 * 18-04. BOT_USERS 채우기 [직접 실행]
 * - 함수: syncBotUsersFromSlack()
 * - 기능: Slack 그룹 구성원으로 BOT_USERS의 빈 Slack ID와 D열 email을 채우고, 없는 사람은 발송 FALSE로 새 행을 추가한다.
 * - 사용: previewRosterFromSlack 결과 확인 후 실행. 다시 실행해도 같은 행을 중복 추가하지 않는다.
 * - 영향: BOT_USERS B열(빈 칸만)·D열 email(빈 칸만)·새 행 추가. 이미 있는 값과 발송 여부는 바꾸지 않는다.
 *   PILOT_PM_NAME이 없으면 지금의 시험 대상(Slack ID가 있는 유일한 PM)을 먼저 저장한다. DM·트리거 변경 없음.
 */

function previewRosterFromSlack() {
  const props = PropertiesService.getScriptProperties();
  const token = requiredProperty_(props, 'SLACK_BOT_TOKEN');
  if (!token.startsWith('xoxb-')) throw new Error('봇 토큰(xoxb-)만 사용합니다.');
  const scopes = readSlackTokenScopes_(token);
  const missing = ['users:read', 'users:read.email', 'usergroups:read'].filter(scope => !scopes.includes(scope));
  console.log('봇 토큰 권한 확인 · ' + (missing.length ? '없음: ' + missing.join(', ') : '명단 동기화에 필요한 권한 모두 있음'));
  if (missing.includes('users:read') || missing.includes('users:read.email')) {
    console.log('Slack 앱 OAuth & Permissions에서 권한 추가 후 Reinstall이 필요합니다. 조회 중지 | 시트·DM 변경 없음');
    return;
  }
  const groupIds = String(props.getProperty('SLACK_ROSTER_GROUP_IDS') || props.getProperty('SLACK_PM_GROUP_ID') || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!groupIds.length || groupIds.some(id => !/^S[A-Z0-9]{8,}$/.test(id))) {
    throw new Error('SLACK_ROSTER_GROUP_IDS 또는 SLACK_PM_GROUP_ID에 Slack 그룹 ID(S로 시작)를 설정하세요.');
  }
  const members = readSlackRosterMembers_(token, groupIds, {calls:0, maxCalls:300});

  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const userRows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders),
    BOT_WORKBOOK.userHeaders.length);
  const manualById = new Map(userRows.filter(row => String(row[1] || '').trim())
    .map(row => [String(row[1]).trim(), String(row[0] || '').trim()]));
  const taskRows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders),
    BOT_WORKBOOK.taskHeaders.length);
  const sheetNames = [...new Set(taskRows.map(row => String(row[1] || '').trim()).filter(Boolean))];

  const stats = {email:0, nameSame:0, nameDiff:0, unregistered:0};
  const matchedSheetNames = new Set();
  const lines = members.map(member => {
    const name = normalizeRosterName_(member.realName) || normalizeRosterName_(member.displayName);
    const notes = [];
    if (member.email) stats.email++;
    const manual = manualById.get(member.id);
    if (manual === undefined) { stats.unregistered++; notes.push('BOT_USERS 미등록'); }
    else if (normalizeRosterName_(manual) === name) { stats.nameSame++; notes.push('BOT_USERS 이름 일치'); }
    else { stats.nameDiff++; notes.push('BOT_USERS 이름 다름(' + manual + ')'); }
    const sheetMatch = sheetNames.find(sheetName => normalizeRosterName_(sheetName) === name ||
      (manual && sheetName === manual));
    if (sheetMatch) { matchedSheetNames.add(sheetMatch); notes.push('업무 시트 담당자 매칭(' + sheetMatch + ')'); }
    return '• ' + (name || '(이름 없음)') + ' | Slack ' + maskPilotId_(member.id) + ' | ' +
      (member.email ? maskCalendarAccount_(member.email) : '이메일 없음') + ' | ' + notes.join(' · ');
  });
  const unmatchedSheet = sheetNames.filter(sheetName => !matchedSheetNames.has(sheetName));
  console.log('Slack 그룹 ' + groupIds.length + '개 · 활성 구성원 ' + members.length + '명\n' + lines.join('\n'));
  console.log([
    '요약',
    '• 이메일 자동 확인 ' + stats.email + '/' + members.length + '명 (이메일 = 개인 캘린더 ID)',
    '• BOT_USERS 대조: 이름 일치 ' + stats.nameSame + ' · 이름 다름 ' + stats.nameDiff + ' · 미등록 ' + stats.unregistered,
    '• 업무 시트 담당자 ' + sheetNames.length + '명 중 Slack 구성원과 매칭 ' + matchedSheetNames.size + '명' +
      (unmatchedSheet.length ? ' · 매칭 안 됨: ' + unmatchedSheet.join(', ') : ''),
    'Slack·시트 읽기만 · 시트·속성·트리거 변경·DM 없음',
  ].join('\n'));
}

// auth.test 응답 헤더의 x-oauth-scopes로 실제 부여된 권한을 확인한다. 토큰 값은 출력하지 않는다.
function readSlackTokenScopes_(token) {
  const response = UrlFetchApp.fetch('https://slack.com/api/auth.test', {
    method: 'post', headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true,
  });
  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || !body.ok) throw new Error('Slack 토큰 확인 실패: ' + (body.error || response.getResponseCode()));
  const headers = response.getAllHeaders();
  const key = Object.keys(headers).find(name => name.toLowerCase() === 'x-oauth-scopes');
  return String(key ? headers[key] : '').split(',').map(value => value.trim()).filter(Boolean);
}

function readSlackRosterMembers_(token, groupIds, budget) {
  const ids = [];
  groupIds.forEach(groupId => {
    const group = slackMentionReadApi_('usergroups.users.list', {usergroup:groupId}, token, budget);
    if (!Array.isArray(group.users)) throw new Error('Slack 그룹 구성원을 확인할 수 없습니다: ' + groupId);
    group.users.forEach(id => { if (!ids.includes(id)) ids.push(id); });
  });
  return ids.flatMap(id => {
    const user = slackMentionReadApi_('users.info', {user:id}, token, budget).user || {};
    if (user.deleted || user.is_bot) return [];
    const profile = user.profile || {};
    return [{id, realName:String(profile.real_name_normalized || user.real_name || ''),
      displayName:String(profile.display_name_normalized || ''), email:String(profile.email || '')}];
  });
}

// 예: "PM A (BB)" → "PM A", "PM A/PM" → "PM A". 시트 담당자 이름과 비교할 때만 쓴다.
function normalizeRosterName_(value) {
  return String(value || '').replace(/\s*[(\[（].*$/, '').replace(/\s*[\/|·].*$/, '').replace(/\s+/g, '').trim();
}

function syncBotUsersFromSlack() {
  const props = PropertiesService.getScriptProperties();
  const token = requiredProperty_(props, 'SLACK_BOT_TOKEN');
  const scopes = readSlackTokenScopes_(token);
  if (!scopes.includes('users:read') || !scopes.includes('users:read.email')) {
    throw new Error('users:read, users:read.email 권한이 없어 중지합니다. 시트 변경 없음.');
  }
  const groupIds = String(props.getProperty('SLACK_ROSTER_GROUP_IDS') || props.getProperty('SLACK_PM_GROUP_ID') || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!groupIds.length || groupIds.some(id => !/^S[A-Z0-9]{8,}$/.test(id))) {
    throw new Error('SLACK_ROSTER_GROUP_IDS 또는 SLACK_PM_GROUP_ID에 Slack 그룹 ID를 설정하세요. 시트 변경 없음.');
  }
  const members = readSlackRosterMembers_(token, groupIds, {calls:0, maxCalls:300});
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const sheet = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
  const emailHeader = String(sheet.getRange(1, 4).getValue() || '').trim();
  if (emailHeader && emailHeader !== 'email') {
    throw new Error('BOT_USERS D1에 다른 값(' + emailHeader + ')이 있어 중지합니다. 시트 변경 없음.');
  }
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];

  // Slack ID를 여러 명에게 채우면 "ID가 있는 유일한 PM = 시험 대상" 규칙이 깨지므로 먼저 고정한다.
  if (!String(props.getProperty('PILOT_PM_NAME') || '').trim()) {
    const pilot = getPilotPmName_(rows.map(row => row.slice(0, 3)));
    props.setProperty('PILOT_PM_NAME', pilot);
    console.log('시험 대상 고정 · PILOT_PM_NAME = ' + pilot);
  }

  const byName = new Map(), byId = new Map();
  rows.forEach((row, index) => {
    const name = String(row[0] || '').trim();
    const id = String(row[1] || '').trim();
    if (name) byName.set(normalizeRosterName_(name), index);
    if (id) byId.set(id, index);
  });
  const filled = [], added = [], skipped = [];
  members.forEach(member => {
    const name = normalizeRosterName_(member.realName) || normalizeRosterName_(member.displayName);
    const label = (name || '(이름 없음)') + ' ' + maskPilotId_(member.id);
    if (!name) { skipped.push(label + ': Slack 이름 없음'); return; }
    let index = byId.has(member.id) ? byId.get(member.id) : byName.get(name);
    if (index !== undefined && index < rows.length) {
      const row = rows[index];
      const existingId = String(row[1] || '').trim();
      if (existingId && existingId !== member.id) { skipped.push(label + ': 같은 이름에 다른 Slack ID 있음 · 변경 안 함'); return; }
      const changes = [];
      if (!existingId) { sheet.getRange(index + 2, 2).setValue(member.id); row[1] = member.id; changes.push('Slack ID'); }
      if (!String(row[3] || '').trim() && member.email) {
        sheet.getRange(index + 2, 4).setValue(member.email); row[3] = member.email; changes.push('email');
      }
      if (changes.length) filled.push(label + ': ' + changes.join('·') + ' 채움');
      return;
    }
    if (index !== undefined) { skipped.push(label + ': 이번 실행에서 같은 이름이 이미 추가됨 · 변경 안 함'); return; }
    rows.push([name, member.id, false, member.email]);
    byName.set(name, rows.length - 1);
    byId.set(member.id, rows.length - 1);
    added.push(name);
  });
  const newRows = rows.slice(rows.length - added.length);
  if (!emailHeader) sheet.getRange(1, 4).setValue('email');
  if (newRows.length) sheet.getRange(lastRow + 1, 1, newRows.length, 4).setValues(newRows);
  // calendar_connect 열이 있으면 새 행에도 체크박스를 만든다(체크 해제 상태). 초대 여부는 관리자가 정한다.
  if (newRows.length && typeof selfCalendarUsesConnectColumn_ === 'function' && selfCalendarUsesConnectColumn_(sheet)) {
    const box = sheet.getRange(lastRow + 1, 5, newRows.length, 1);
    box.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    box.setValues(newRows.map(() => [false]));
  }
  console.log([
    'BOT_USERS 채우기 완료 · Slack 구성원 ' + members.length + '명',
    '• 기존 행 채움 ' + filled.length + '건' + (filled.length ? '\n  ' + filled.join('\n  ') : ''),
    '• 새 행 추가 ' + added.length + '명 (발송 여부 FALSE)' + (added.length ? ': ' + added.join(', ') : ''),
    '• 건너뜀 ' + skipped.length + '건' + (skipped.length ? '\n  ' + skipped.join('\n  ') : ''),
    '발송 여부는 바꾸지 않음 · DM·트리거 변경 없음',
  ].join('\n'));
}

// 로그에 이메일 일부만 보인다.
function maskCalendarAccount_(email) {
  return String(email).replace(/^(.)([^@]*)(@.*)$/, '$1***$3');
}
