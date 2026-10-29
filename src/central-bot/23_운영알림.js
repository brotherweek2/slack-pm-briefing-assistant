/**
 * 23. 운영 알림 — 관리자(본인, PILOT_PM_NAME)에게 정기 회차 상태를 한 번 요약해 보낸다.
 * - previewAdminRoundSummary(): [직접 실행] 지금 상태로 요약 문안만 로그에 출력. Slack 발송·저장 없음.
 * - cleanupBotStorage(): [직접 실행] BOT_USERS에서 빠진 PM의 Slack 발송 이력·한마디·점심 기록을 지운다. DM 없음.
 * - notifyAdminRoundSummary_(slot, info): 회차 끝(완료·일부 실패·중지)이나 시작 실패 때 자동 호출.
 *   같은 날짜·회차에는 한 번만 보낸다. 실패해도 정기 발송 결과에는 영향을 주지 않는다.
 * - buildAdminRoundSummary_: 발송 결과·확인 필요 PM과 원인·연차로 건너뛴 PM·직전 회차 누락·Slack 기준 시각·일정 갱신 지연 PM·저장 공간을 모은다.
 *   금요일 17:00에는 이번 주 피드백(👍/👎) 집계를 붙인다.
 * - adminPreviousRound_(props, slot, day): 직전 회차(10:30은 직전 근무일 17:00). 그 회차의 발송 기록이 하나도 없으면 경고한다.
 * - adminWeeklyFeedbackLine_(bot, day): BOT_FEEDBACK에서 이번 주(월~오늘) 👍/👎 수와 참여 인원.
 * - adminFailureHint_(message): 오류 문구 → 사용자가 할 일 한 줄.
 * - cleanupBotProperties_(props, rows): 17:00 요약 뒤 자동 실행. 명단에 없는 Slack ID의 기록만 지운다.
 * - 한계: 트리거 자체가 권한 만료로 시작하지 못하면 이 코드도 실행되지 않는다. 한 회차만 빠졌으면 다음 회차 요약의
 *   "직전 회차 발송 기록 없음"으로, 전부 멈췄으면 Google의 트리거 실패 메일로 확인한다.
 */
const ADMIN_SUMMARY = Object.freeze({sentKey:'ADMIN_SUMMARY_SENT', staleMinutes:20, maxNames:5});

function previewAdminRoundSummary() {
  const props = PropertiesService.getScriptProperties();
  const job = JSON.parse(props.getProperty('CONNECTED_SEND_JOB') || 'null');
  const slot = job ? job.slot : currentBriefingSlot_(new Date());
  console.log(buildAdminRoundSummary_(props, slot, job ? adminInfoFromJob_(job) : {}, new Date()).text);
  console.log('미리보기만 | Slack 발송·속성/시트 변경 없음');
}

function cleanupBotStorage() {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const removed = cleanupBotProperties_(props, rows);
  console.log('명단에서 빠진 PM 기록 ' + removed + '개 정리 | 저장 공간 ' + adminStorageKb_(props) + 'KB / 500KB | Slack 발송 없음');
}

function adminInfoFromJob_(job) {
  return {state:job.state, total:job.total, pendingIds:job.pendingIds || [], failedIds:job.failedIds || [],
    failures:job.failures || {}, failed:job.failed || 0, error:job.lastError || '',
    elapsedMs:job.elapsedMs || 0, batches:job.batches || 0, maxBatchMs:job.maxBatchMs || 0, maxBatchSize:job.maxBatchSize || 0,
    maxPhaseMs:job.maxPhaseMs || {}};
}

function notifyAdminRoundSummary_(slot, info) {
  try {
    const props = PropertiesService.getScriptProperties();
    const now = new Date();
    const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
    if (props.getProperty(ADMIN_SUMMARY.sentKey) === day + '|' + slot) return;
    const summary = buildAdminRoundSummary_(props, slot, info || {}, now);
    if (!summary.adminId) { console.log('관리자 요약 생략: BOT_USERS에서 관리자(PILOT_PM_NAME) Slack ID 확인 필요'); return; }
    // 보내기 전에 기록한다. 응답이 유실돼도 같은 회차 요약을 두 번 보내지 않는다.
    props.setProperty(ADMIN_SUMMARY.sentKey, day + '|' + slot);
    postSlackDm_(requiredProperty_(props, 'SLACK_BOT_TOKEN'), summary.adminId, summary.text);
    console.log('관리자 회차 요약 발송 완료 | ' + briefingSlotLabel_(slot));
    if (slot === '17:00') {
      try { console.log('명단에서 빠진 PM 기록 정리 ' + cleanupBotProperties_(props, summary.rows) + '개'); }
      catch (error) { console.log('기록 정리 생략 | ' + error.message); }
    }
  } catch (error) { console.log('관리자 요약 생략 | ' + error.message); }
}

function buildAdminRoundSummary_(props, slot, info, now) {
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const nameOf = id => { const row = rows.find(r => String(r[1] || '').trim() === id); return row ? String(row[0]).trim() : '이름 확인 필요'; };
  const names = list => list.length <= ADMIN_SUMMARY.maxNames ? list.join(', ') :
    list.slice(0, ADMIN_SUMMARY.maxNames).join(', ') + ' 외 ' + (list.length - ADMIN_SUMMARY.maxNames) + '명';
  let adminId = '';
  try { const pilot = findPilotRecipient_(rows); adminId = pilot && /^[UW][A-Z0-9]{8,}$/.test(pilot.id) ? pilot.id : ''; } catch (_) {}
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  const lines = ['🛠 *' + briefingSlotLabel_(slot) + ' 정기 DM 점검* · ' + formatBriefingDay_(day)];
  const todo = [];
  // Slack 수집·일정 자동 갱신은 회차 직전(09:45~10:45, 13:30~14:15, 16:00~17:15)에만 돈다.
  // 회차가 지난 뒤 미리보기에서 오탐하지 않게 신선도는 회차 시각 기준으로 본다.
  const reference = Math.min(now.getTime(), Date.parse(day + 'T' + (SLOT_TIME[slot] || slot) + ':00+09:00') || now.getTime());

  // 1) 발송 결과
  if (info.error && !info.total) {
    lines.push('• ⚠️ 회차를 시작하지 못했습니다 — ' + escapeSlack_(String(info.error).slice(0, 120)));
    todo.push(adminFailureHint_(info.error));
  } else if (info.total !== undefined) {
    const pending = info.pendingIds || [], failedIds = info.failedIds || [];
    const failedCount = Math.max(info.failed || 0, failedIds.length);
    let leave = [];
    try {
      const saved = JSON.parse(props.getProperty(PERSONAL_LEAVE.skipsKey) || 'null');
      if (saved && saved.day === day && saved.slot === slot) leave = saved.items;
    } catch (_) {}
    const sent = Math.max(0, info.total - pending.length - failedCount - leave.length);
    lines.push('• 발송 ' + sent + '/' + info.total + '명 완료' + (leave.length ? ' · 연차 ' + leave.length + '명 건너뜀' : '') +
      (info.state === 'stopped' ? ' · ⚠️ 시간·시도 상한으로 중지' : ''));
    if (leave.length) lines.push('• 연차: ' + names(leave.map(escapeSlack_)));
    if (failedIds.length) {
      lines.push('• 확인 필요: ' + names(failedIds.map(nameOf)));
      const reasons = [...new Set(failedIds.map(id => (info.failures || {})[id]).filter(Boolean))];
      reasons.forEach(reason => todo.push(adminFailureHint_(reason)));
      if (!reasons.length) todo.push('실행 로그에서 확인 필요 PM의 오류를 확인하세요.');
    } else if (failedCount) {
      lines.push('• 확인 필요 ' + failedCount + '명 (이름 기록 없음)');
      todo.push('실행 로그에서 "발송 처리 중단" 줄을 확인하세요.');
    }
    if (info.batches) {
      // 한 묶음은 최대 4명. 진행 중 호출은 즉시 중단할 수 없어 4분 초과 여부도 알린다.
      const perPm = info.maxBatchSize ? Math.round(info.maxBatchMs / info.maxBatchSize / 1000) : 0;
      lines.push('• 처리 시간 ' + Math.round(info.elapsedMs / 1000) + '초 · 묶음 ' + info.batches + '개 · 가장 긴 묶음 ' +
        Math.round(info.maxBatchMs / 1000) + '초' + (perPm ? ' (1명당 약 ' + perPm + '초)' : '') + (info.maxBatchMs > 240000 ? ' · ⚠️ 4분 초과' : ''));
      if (info.maxBatchMs > 240000) todo.push('묶음 하나가 4분을 넘었습니다. 현재 4명씩 처리합니다. 아래 구간별 시간과 실행 로그에서 느린 조회·전송을 확인하세요.');
      const phases=info.maxPhaseMs||{};
      if(Object.keys(phases).length) lines.push('• 구간별 최대: '+
        [['workMs','업무·명단'],['slackMs','Slack 준비'],['prepareMs','문안 준비'],['deliveryMs','개인별 구성·발송']]
          .filter(([key])=>Number.isFinite(phases[key])).map(([key,label])=>label+' '+Math.round(phases[key]/1000)+'초').join(' · '));
    }
    if (pending.length) {
      lines.push('• 미발송: ' + names(pending.map(nameOf)));
      todo.push(info.error ? adminFailureHint_(info.error) : '미발송 PM은 회차 시작 20분 안에서만 자동으로 이어 보냅니다. 남은 PM은 다음 회차에 받습니다.');
    }
  }

  // 1-1) 실제 수신자 명단 문제만 표시. 담당 탭이 없는 팀원은 정상 대상이다.
  try {
    const issues = JSON.parse(props.getProperty('ROUTE_ISSUES') || 'null');
    const items = issues && Array.isArray(issues.items) ? issues.items.filter(item =>
      !String(item).includes('업무 시트 담당자 이름과 맞지 않음')) : [];
    if (issues && issues.day === day && issues.slot === slot && items.length) {
      lines.push('• 명단 확인 필요: ' + items.map(escapeSlack_).join(' / '));
      todo.push('봇 시트 BOT_USERS에서 위 수신자의 A열 이름·B열 Slack ID·중복 줄을 확인하세요.');
    }
  } catch (_) {}

  // 1-1b) 담당 탭 양식 확인(탭은 있는데 프로젝트 0건 → 종료 임박·어뷰저가 조용히 빠질 수 있음)
  try {
    const refreshed = JSON.parse(props.getProperty('BOT_TASKS_REFRESHED') || 'null');
    const empty = refreshed && refreshed.day === day && Array.isArray(refreshed.emptyPmTabs) ? refreshed.emptyPmTabs : [];
    if (empty.length) {
      lines.push('• ⚠️ 담당 탭 형식 확인 필요: ' + names(empty.map(escapeSlack_)) + ' (프로젝트 0건)');
      todo.push('위 담당 탭의 프로젝트 칸 형식("번호 · M/D · 수량 · 최대 N배치")이 바뀌었는지 inspectOriginalSheetStructure로 확인하세요. 그동안 종료 임박·어뷰저가 빠집니다.');
    }
    const missingTabs = refreshed && refreshed.day === day && Array.isArray(refreshed.missingPmTabs) ? refreshed.missingPmTabs : [];
    if (missingTabs.length) {
      lines.push('• ⚠️ 담당 탭이 사라짐: ' + names(missingTabs.map(escapeSlack_)) + ' (언어쌍 업무가 빠짐)');
      todo.push('HA-CV 시트에서 위 PM의 담당 탭 이름이 바뀌었거나 지워졌는지 확인하세요. 의도한 변경(담당 해제)이면 그대로 두면 됩니다.');
    }
    // 업무 시트 하나를 못 읽은 경우: 회차는 보내고 그 업무만 직전 결과로 유지했다.
    const failed = refreshed && refreshed.day === day && Array.isArray(refreshed.sourceFailures) ? refreshed.sourceFailures : [];
    if (failed.length) {
      lines.push('• ⚠️ 업무 시트 읽기 실패(직전 결과 유지): ' + failed.map(text => escapeSlack_(String(text).slice(0, 120))).join(' / '));
      todo.push('원본의 탭 이름·머리글이 바뀌었는지 inspectOriginalSheetStructure로 확인하세요. 고치기 전까지 그 업무는 마지막으로 읽은 내용이 나갑니다.');
    }
  } catch (_) {}

  // 1-2) 직전 회차가 아예 돌지 않았는지(트리거 누락·권한 만료 등). 연차로 건너뛴 기록도 실행한 것으로 본다.
  try {
    const prev = adminPreviousRound_(props, slot, day);
    const log = prev ? bot.getSheetByName(BOT_WORKBOOK.logTab) : null;
    if (log) {
      const logRows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 2).getValues() : [];
      const ran = logRows.some(row => Object.prototype.toString.call(row[0]) === '[object Date]' &&
        Utilities.formatDate(row[0], BRIEFING.timezone, 'yyyy-MM-dd') === prev.day && row[1] === 'scheduled-' + prev.slot);
      if (!ran) {
        lines.push('• ⚠️ 직전 회차(' + (prev.day === day ? '' : formatBriefingDay_(prev.day) + ' ') + briefingSlotLabel_(prev.slot) + ') 발송 기록 없음');
        todo.push('직전 회차가 실행되지 않았습니다. 편집기 → 실행 기록에서 sendScheduledBriefing 실패를 확인하고, 트리거가 없으면 09_자동실행.gs → installBriefingTriggers 를 실행하세요.');
      }
    }
  } catch (_) {}

  // 2) Slack 자료 기준 시각
  try {
    const snapshot = readBbpmSnapshot_(props, bot);
    const newest = snapshot && snapshot.meta ? snapshot.meta.newest * 1000 : 0;
    const age = newest ? Math.round((reference - newest) / 60000) : -1;
    lines.push('• Slack 자료 ' + (newest ? Utilities.formatDate(new Date(newest), BRIEFING.timezone, 'HH:mm') + ' 기준' : '없음') +
      (age > 60 ? ' · ⚠️ ' + age + '분 지남' : ''));
    if (!newest || age > 60) todo.push('03_슬랙수집.gs → collectBbpmSnapshot 실행 로그를 확인하세요' +
      (props.getProperty('BBPM_COLLECT_LAST_ERROR') ? ' (최근 오류: ' + escapeSlack_(String(props.getProperty('BBPM_COLLECT_LAST_ERROR')).slice(0, 60)) + ')' : '') + '.');
  } catch (error) { lines.push('• Slack 자료 확인 실패'); todo.push(adminFailureHint_(error.message)); }

  // 3) 일정 갱신 지연·미연결
  try {
    if (props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') === 'true') {
      const registry = selfCalendarRegistry_(props);
      const sheet = selfCalendarStore_(props, false);
      const cached = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
      const stale = [], missing = [];
      registry.forEach(route => {
        const match = cached.filter(row => row[0] === route.email);
        let state = null; try { state = match.length === 1 ? JSON.parse(match[0][1]) : null; } catch (_) {}
        if (!state || !state.connected) { missing.push(route.pm); return; }
        if (!Number.isFinite(state.sentAt) || reference - state.sentAt > ADMIN_SUMMARY.staleMinutes * 60000) {
          stale.push(route.pm + (Number.isFinite(state.sentAt) ? '(' + Utilities.formatDate(new Date(state.sentAt), BRIEFING.timezone, 'MM/dd HH:mm') + ')' : ''));
        }
      });
      lines.push('• 일정 연결 ' + (registry.length - missing.length) + '/' + registry.length + '명' +
        (stale.length ? ' · 갱신 지연: ' + names(stale) : ''));
      if (missing.length) lines.push('• 미연결: ' + names(missing));
      if (registry.skipped && registry.skipped.length) {
        lines.push('• 연결 명단 제외: ' + registry.skipped.map(escapeSlack_).join(' / '));
        todo.push('BOT_USERS에서 위 줄의 이름·Slack ID·이메일 중복을 확인하세요(그 PM만 이번 회차에서 빠짐).');
      }
      if (stale.length) todo.push('갱신 지연 PM은 연결 앱 파일 공유(사내 전체 뷰어)와 연결 화면의 "지금 갱신"을 확인해주세요.');
    }
  } catch (error) { lines.push('• 일정 연결 상태 확인 실패'); }

  // 4) 금요일 17:00: 이번 주 피드백
  if (slot === '17:00' && new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay() === 5) {
    try { lines.push(adminWeeklyFeedbackLine_(bot, day)); } catch (_) { lines.push('• 이번 주 피드백 확인 실패'); }
  }

  // 5) 저장 공간
  const kb = adminStorageKb_(props);
  lines.push('• 저장 공간 ' + kb + 'KB / 500KB' + (kb >= 400 ? ' · ⚠️ 정리 필요' : ''));
  if (kb >= 400) todo.push('23_운영알림.gs → cleanupBotStorage 를 실행하세요.');

  const unique = [...new Set(todo)];
  lines.push(unique.length ? '\n👉 *할 일*\n' + unique.map(item => '• ' + item).join('\n') : '\n✅ 이상 없음');
  return {text:lines.join('\n'), adminId, rows};
}

function adminPreviousRound_(props, slot, day) {
  if (slot === '14:00') return {day, slot:'11:00'};
  if (slot === '17:00') return {day, slot:'14:00'};
  // 10:30: 직전 근무일 17:00. 주말·회사 휴무일·공휴일은 건너뛴다. 휴일을 못 읽으면 경고하지 않는다(오탐 방지).
  const extra = String(props.getProperty('COMPANY_HOLIDAYS') || '').split(/[,\s]+/).filter(Boolean);
  for (let i = 1; i <= 7; i++) {
    const date = new Date(Date.parse(day + 'T12:00:00+09:00') - i * 86400000);
    const prev = Utilities.formatDate(date, BRIEFING.timezone, 'yyyy-MM-dd');
    if (!isBriefingWeekday_(date) || extra.includes(prev)) continue;
    try { if (publicHolidayName_(prev)) continue; } catch (_) { return null; }
    return {day:prev, slot:'17:00'};
  }
  return null;
}

// 피드백 탭의 날짜 칸은 시트가 날짜로 바꿔 저장할 수 있어 두 형식을 모두 읽는다.
function adminWeeklyFeedbackLine_(bot, day) {
  const sheet = bot.getSheetByName(FEEDBACK.tab);
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, FEEDBACK.headers.length).getValues() : [];
  const weekday = new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  const monday = new Date(Date.parse(day + 'T00:00:00Z') - (weekday + 6) % 7 * 86400000).toISOString().slice(0, 10);
  const dayOf = value => Object.prototype.toString.call(value) === '[object Date]' ?
    Utilities.formatDate(value, BRIEFING.timezone, 'yyyy-MM-dd') : String(value || '').slice(0, 10);
  const week = rows.filter(row => dayOf(row[3]) >= monday && dayOf(row[3]) <= day);
  if (!week.length) return '• 이번 주 피드백 없음';
  const up = week.filter(row => row[5] === '👍').length, down = week.filter(row => row[5] === '👎').length;
  return '• 이번 주 피드백 👍 ' + up + ' · 👎 ' + down + ' (' + new Set(week.map(row => row[1])).size + '명) · ✍️ 자세한 의견은 폼 응답에서';
}

function adminStorageKb_(props) {
  const all = props.getProperties();
  const bytes = value => Utilities.newBlob(String(value)).getBytes().length;
  return Math.ceil(Object.keys(all).reduce((sum, key) => sum + bytes(key) + bytes(all[key]), 0) / 1024);
}

// 오류 문구를 사용자가 할 일 한 줄로 바꾼다. 모르는 오류는 앞부분만 그대로 보인다.
function adminFailureHint_(message) {
  const text = String(message || '');
  if (/invalid_auth|token_revoked|not_authed|account_inactive|token_expired/.test(text)) return 'Slack 봇 토큰(SLACK_BOT_TOKEN)이 만료·해제됐습니다. 새 토큰으로 바꿔주세요.';
  if (/missing_scope/.test(text)) return 'Slack 앱 권한(scope)이 부족합니다. 앱 설정에서 권한 추가 후 재설치하세요.';
  if (/channel_not_found|user_not_found|cannot_dm|is_bot|user_disabled/.test(text)) return 'Slack ID가 바뀌었거나 DM이 막힌 PM입니다. BOT_USERS의 Slack ID를 확인하세요.';
  if (/요청 제한|ratelimited|429/.test(text)) return 'Slack 요청 제한입니다. 잠시 뒤 자동으로 이어 보내며, 이번 회차에 못 받은 PM은 다음 회차에 받습니다.';
  if (/재전송 차단|결과 확인 필요|DM_RESULT_UNCERTAIN/.test(text)) return '전송 결과가 불분명한 PM이 있습니다(자동 재전송 안 함). 해당 PM이 DM을 받았는지 확인하세요.';
  if (/속성 저장 공간/.test(text)) return '저장 공간 부족입니다. 23_운영알림.gs → cleanupBotStorage 를 실행하세요.';
  if (/Authorization|authoriz|권한을 (?:부여|승인)|승인이 필요/i.test(text)) return '편집기에서 함수 하나를 직접 실행해 Google 권한을 다시 승인하세요.';
  if (/설정 확인 필요|설정을 먼저|ENABLE_/.test(text)) return '스크립트 속성의 발송 스위치(ENABLE_PM_SEND·ENABLE_CONNECTED_PM_SEND 등)를 확인하세요.';
  if (/업무 기록|BOT_TASKS|오늘 업무/.test(text)) return '업무 시트 갱신 실패입니다. 원본 시트 접근 권한·탭 이름을 확인하세요.';
  return '실행 로그 확인: ' + escapeSlack_(text.slice(0, 80));
}

// 명단(BOT_USERS)에서 빠진 Slack ID의 발송 이력·한마디·점심 기록만 지운다. 현재 PM 기록과 발송 점유 기록은 건드리지 않는다.
function cleanupBotProperties_(props, rows) {
  const active = new Set(rows.map(row => String(row[1] || '').trim()).filter(Boolean));
  const keys = Object.keys(props.getProperties());
  const gone = keys.filter(key => key.indexOf('SLACK_DIGEST_SEEN_') === 0).map(key => key.slice('SLACK_DIGEST_SEEN_'.length))
    .filter(id => /^[UW][A-Z0-9]{8,}$/.test(id) && !active.has(id));
  let removed = 0;
  gone.forEach(id => {
    const route = {id};
    ['SLACK_DIGEST_SEEN_' + id, briefingPhraseStateKey_(route, '11:00'), briefingPhraseStateKey_(route, '17:00'),
      lunchRecommendationStateKey_(route, ''), lunchRecommendationStateKey_(route, 'light')]
      .filter(key => keys.includes(key)).forEach(key => { props.deleteProperty(key); removed++; });
  });
  return removed;
}
