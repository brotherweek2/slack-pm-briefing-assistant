/**
 * 23. 운영 알림 — 관리자(본인, PILOT_PM_NAME)에게 정기 회차 상태를 한 번 요약해 보낸다.
 * - previewAdminRoundSummary(): [직접 실행] 지금 상태로 요약 문안만 로그에 출력. Slack 발송·저장 없음.
 * - cleanupBotStorage(): [직접 실행] BOT_USERS에서 빠진 PM의 Slack 발송 이력·한마디·점심 기록을 지운다. DM 없음.
 * - notifyAdminRoundSummary_(slot, info): 회차 끝(완료·일부 실패·중지)이나 시작 실패 때 자동 호출.
 *   같은 날짜·회차에는 한 번만 보낸다. 실패해도 정기 발송 결과에는 영향을 주지 않는다.
 * - buildAdminRoundSummary_: 발송 결과·확인 필요 PM과 원인·Slack 기준 시각·일정 갱신 지연 PM·저장 공간을 모은다.
 * - adminFailureHint_(message): 오류 문구 → 사용자가 할 일 한 줄.
 * - cleanupBotProperties_(props, rows): 17:00 요약 뒤 자동 실행. 명단에 없는 Slack ID의 기록만 지운다.
 * - 한계: 트리거 자체가 권한 만료로 시작하지 못하면 이 코드도 실행되지 않는다(그때는 Google의 트리거 실패 메일로 확인).
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
    elapsedMs:job.elapsedMs || 0, batches:job.batches || 0, maxBatchMs:job.maxBatchMs || 0, maxBatchSize:job.maxBatchSize || 0};
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
    const sent = Math.max(0, info.total - pending.length - failedCount);
    lines.push('• 발송 ' + sent + '/' + info.total + '명 완료' + (info.state === 'stopped' ? ' · ⚠️ 시간·시도 상한으로 중지' : ''));
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
      // 한 묶음(최대 8명)은 5분 안에 끝나야 한다(Apps Script 6분 제한). 4분을 넘으면 미리 알린다.
      const perPm = info.maxBatchSize ? Math.round(info.maxBatchMs / info.maxBatchSize / 1000) : 0;
      lines.push('• 처리 시간 ' + Math.round(info.elapsedMs / 1000) + '초 · 묶음 ' + info.batches + '개 · 가장 긴 묶음 ' +
        Math.round(info.maxBatchMs / 1000) + '초' + (perPm ? ' (1명당 약 ' + perPm + '초)' : '') + (info.maxBatchMs > 240000 ? ' · ⚠️ 4분 초과' : ''));
      if (info.maxBatchMs > 240000) todo.push('묶음 하나가 4분을 넘었습니다. 인원이 늘면 6분 제한에 걸릴 수 있어 묶음 크기(8명) 축소를 검토하세요.');
    }
    if (pending.length) {
      lines.push('• 미발송: ' + names(pending.map(nameOf)));
      todo.push(info.error ? adminFailureHint_(info.error) : '미발송 PM은 회차 시작 20분 안에서만 자동으로 이어 보냅니다. 남은 PM은 다음 회차에 받습니다.');
    }
  }

  // 1-1) 명단 문제(이 PM만 제외하거나 업무 없이 보냄)
  try {
    const issues = JSON.parse(props.getProperty('ROUTE_ISSUES') || 'null');
    if (issues && issues.day === day && issues.slot === slot && issues.items.length) {
      lines.push('• 명단 확인 필요: ' + issues.items.map(escapeSlack_).join(' / '));
      todo.push('봇 시트 BOT_USERS에서 위 PM의 A열 이름(업무 시트 담당 탭 이름과 같게)·B열 Slack ID·중복 줄을 확인하세요.');
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

  // 4) 저장 공간
  const kb = adminStorageKb_(props);
  lines.push('• 저장 공간 ' + kb + 'KB / 500KB' + (kb >= 400 ? ' · ⚠️ 정리 필요' : ''));
  if (kb >= 400) todo.push('23_운영알림.gs → cleanupBotStorage 를 실행하세요.');

  const unique = [...new Set(todo)];
  lines.push(unique.length ? '\n👉 *할 일*\n' + unique.map(item => '• ' + item).join('\n') : '\n✅ 이상 없음');
  return {text:lines.join('\n'), adminId, rows};
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
