/**
 * 01. 슬랙DM발송
 * - 역할: 개인 DM 발송과 오전·오후 통합 미리보기
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 * - sendMyCurrentBriefingTest(): 자기 연결 완료 후 실행 계정 이메일에 대응하는 본인 1명만 통합 DM.
 *   다른 PM 발송 설정은 유지. 현재 시간대 문안, 별도 시험 슬롯 하루 1회. 실제 DM·봇 업무/이력 변경.
 *
 * 01-01. 수신자 점검 [직접 실행]
 * - 함수: previewPmSlackRouting()
 * - 기능: 업무를 갱신하고 PM별 Slack 연결·발송 설정을 확인한다.
 * - 사용: 편집기에서 선택→실행. 수신자 설정을 확인할 때 사용.
 * - 영향: BOT_TASKS·필요시 BOT_USERS 갱신. DM 없음.
 *
 * 01-02. 봇 인증 점검 [직접 실행]
 * - 함수: checkSlackBotToken()
 * - 기능: Slack auth.test로 봇 인증 유효성만 확인한다.
 * - 사용: 인증 설정 후 편집기에서 실행.
 * - 영향: Slack 인증 API만 호출. DM 없음.
 *
 * 01-03. 공통 발송 처리 [내부]
 * - sendPmBriefings_(updatedTest, includeSlack, scheduledSlot, calendarTest): 업무 갱신·수신자 검증·중복 차단 후 개인 DM을 보내고 성공 이력을 저장한다. 영향: 실제 DM·봇 시트/발송/Slack·점심·문구 이력 변경.
 * - 5번째 내부 옵션은 20번 이어 보내기가 지정한 수신자만 처리하고 완료/실패/대기 결과를 반환한다.
 *
 * 01-04. Slack 오류 문안 [내부]
 * - describeSlackFailure_(error, props): 완료본 없음·최신성 초과·권한·인증·호출 제한을 짧은 안내로 바꾼다.
 *
 * 01-05. PM 수신 경로 [내부]
 * - buildPmSlackRoutes_(userRows, owners): 업무 담당자와 BOT_USERS를 대조하고 중복·잘못된 Slack ID를 차단한다.
 *
 * 01-06. 오전 DM 미리보기 [직접 실행]
 * - 함수: previewMyMorningBriefing()
 * - 기능: 저장된 오늘 업무·최신 Slack 완료본·현재 회의로 11시 문안을 출력한다.
 * - 사용: 오늘 BOT_TASKS와 최신 Slack 완료본 준비 후 실행. 현재자료로11시 문안 확인.
 * - 영향: 현재 캘린더 읽기만. DM·시트/속성/발송 이력 변경 없음.
 *
 * 01-07. 저녁 DM 미리보기 [직접 실행]
 * - 함수: previewMyEveningBriefing()
 * - 기능: 현재 자료로 17시 문안과 내일 회의·기한을 출력한다.
 * - 사용: 오늘 BOT_TASKS와 최신 Slack 완료본 준비 후 실행. 현재자료로17시 문안 확인.
 * - 영향: 현재 캘린더 읽기만. DM·시트/속성/발송 이력 변경 없음.
 *
 * 01-08. 통합 문안 조회 [내부]
 * - previewPersonalAssistantBriefing_(slot): 시트 업무→회의→Slack→오전 점심→한마디 순서의 미리보기를 만들고 이력은 변경하지 않는다.
 *
 * 01-09. 조회 기준 한 줄 [내부]
 * - formatBriefingBasis_(now, slackAsOf, day, withCalendar, preview): 업무·회의 및 Slack 조회 시각을 정보 영역 끝 한 줄로 정리한다.
 * - 사용: 발송·미리보기 조립 시 자동 호출. 회차 숫자는 표시하지 않는다. 저장·외부 호출 없음.
 */

/** PM별 Slack 수신자 확인. 실행 로그에 ID 전체를 표시하거나 메시지를 보내지 않는다. */
function previewPmSlackRouting() {
  const summary = refreshBotTasks();
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const users = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
  const tasks = requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
  const rows = readBotRows_(users, BOT_WORKBOOK.userHeaders.length);
  const owners = selectHaCvPreviewOwners_(summary.pmNames,
    readBotRows_(tasks, BOT_WORKBOOK.taskHeaders.length));
  const enabled = buildPmSlackRoutes_(rows, owners);
  rows.forEach(row => {
    const pm = String(row[0] || '').trim();
    if (!pm) return;
    const id = String(row[1] || '').trim();
    console.log(pm + ' | 개인 Slack ID ' + (id ? maskPilotId_(id) : '미입력') +
      ' | 발송 여부 ' + (row[2] === true ? 'TRUE' : 'FALSE'));
  });
  console.log('발송 설정된 PM ' + enabled.length + '명 | 전체 발송 허용 ' +
    (props.getProperty('ENABLE_PM_SEND') === 'true' ? 'TRUE' : 'FALSE') +
    ' | 이 함수의 Slack 발송 없음');
}

/** SLACK_BOT_TOKEN이 유효한 봇 토큰인지 auth.test로만 확인한다. 메시지를 보내지 않고 토큰 값도 출력하지 않는다. */
function checkSlackBotToken() {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    console.log('SLACK_BOT_TOKEN 없음 | 스크립트 속성에 봇 토큰(xoxb-)을 넣어 주세요. Slack 발송 없음');
    return;
  }
  if (!token.startsWith('xoxb-')) {
    throw new Error('SLACK_BOT_TOKEN이 봇 토큰(xoxb-)이 아닙니다. 사용자 토큰(xoxp-)은 쓰지 마세요.');
  }
  const response = UrlFetchApp.fetch('https://slack.com/api/auth.test', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || !body.ok) {
    throw new Error('Slack 토큰 확인 실패: ' + (body.error || response.getResponseCode()));
  }
  console.log('Slack 봇 토큰 정상 | 워크스페이스 ' + body.team + ' | 봇 ' + body.user +
    ' | Slack 발송 없음');
}

/** 본인 전용 아침(11시) 버전 시험. 실행 시각과 상관없이 11시 문안(오늘 회의·점심)으로 본인에게만 보낸다. 하루 1회. */
function sendMyMorningBriefingTest() {
  sendPmBriefings_(true, true, undefined, false, {selfTest:true, forceSlot:'11:00'});
}

/** 자기 연결 모드의 본인 전용 통합 시험. 다른 PM 발송 설정을 끄지 않는다. */
function sendMyCurrentBriefingTest() {
  sendPmBriefings_(true, true, undefined, false, {selfTest:true});
}

// 네 번째 인수는 예전 캘린더 시험 자리로 비워 둔다(호출 위치 호환).
function sendPmBriefings_(updatedTest, includeSlack, scheduledSlot, _unused, deliveryOptions) {
  const props = PropertiesService.getScriptProperties();
  const selfTest=!!(deliveryOptions&&deliveryOptions.selfTest===true);
  // 본인 시험에서만 회차를 고정할 수 있다(정기 발송에는 쓰지 않음).
  const forcedSlot=selfTest&&deliveryOptions.forceSlot==='11:00'?'11:00':null;
  if(selfTest) {
    if(!updatedTest||!includeSlack||scheduledSlot||
        props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE')!=='true'||
        props.getProperty('ENABLE_CALENDAR_BRIEFING')!=='true') throw new Error('본인 통합 시험은 개인 캘린더 연결 모드에서만 실행하세요.');
    deliveryOptions=null; // 정기 발송 묶음 옵션과 섞지 않는다.
  }
  const deadline = Date.now() + 300000;
  if (props.getProperty('ENABLE_PM_SEND') !== 'true') {
    throw new Error('발송 중지: ENABLE_PM_SEND가 true가 아닙니다.');
  }
  requiredProperty_(props, 'BOT_SPREADSHEET_ID'); // 원천 조회·봇 변경 전에 대상과 실행 계정 확인
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('발송 중지: 다른 브리핑 실행이 진행 중입니다.');
  try {
    let selfRoute=null;
    if(selfTest) {
      const email=String(Session.getEffectiveUser().getEmail()||'').trim().toLowerCase();
      const matches=selfCalendarRegistry_(props).filter(route=>route.email===email&&route.sendEnabled);
      if(!email||matches.length!==1) throw new Error('실행한 본인 Google 계정과 BOT_USERS 이메일·발송 설정을 확인하세요.');
      selfRoute=matches[0];
    }
    // 정기 묶음 발송은 첫 묶음에서 갱신한 업무를 15분 동안 재사용한다(묶음마다 원천 재조회 방지).
    const summary = deliveryOptions ? refreshBotTasksForRound_(props) : refreshBotTasks();
    const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
    const users = requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders);
    const tasksSheet = requireBotSheet_(bot, BOT_WORKBOOK.tasksTab, BOT_WORKBOOK.taskHeaders);
    const log = requireBotSheet_(bot, BOT_WORKBOOK.logTab, BOT_WORKBOOK.logHeaders);
    const rows = readBotRows_(tasksSheet, BOT_WORKBOOK.taskHeaders.length);
    const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
    // 일별 기록은 업무를 새로 읽었을 때만 저장한다(DM에는 추세 줄을 싣지 않음).
    const trends = summary.reused ? {} : saveHaCvDailyHistory_(bot, rows, day, new Date());
    const owners = selectHaCvPreviewOwners_(summary.pmNames, rows);
    const userRows = readBotRows_(users, BOT_WORKBOOK.userHeaders.length);
    let routes = buildPmSlackRoutes_(userRows, owners);
    if(selfTest) routes=routes.filter(route=>route.id===selfRoute.slackId&&route.pm===selfRoute.pm);
    // 관리자가 개인 연결 발송을 명시적으로 활성화한 경우에만 대상 확대.
    if (!updatedTest && props.getProperty('ENABLE_CONNECTED_PM_SEND') === 'true') {
      routes = selfCalendarFilterRoutes_(routes, props);
    }
    if(deliveryOptions) {
      if(!scheduledSlot||!Array.isArray(deliveryOptions.recipientIds)||deliveryOptions.recipientIds.length>8) throw new Error('정기 발송 묶음 설정 오류');
      routes=routes.filter(route=>deliveryOptions.recipientIds.includes(route.id));
    }
    const doneIds=deliveryOptions?deliveryOptions.recipientIds.filter(id=>!routes.some(route=>route.id===id)):[];
    const failedIds=[],failureReasons={};let retryAfterMs=0;
    if (updatedTest) {
      const pilot = selfTest?{id:selfRoute.slackId,enabled:true}:findPilotRecipient_(userRows);
      if (!pilot || !pilot.enabled || routes.length !== 1 || routes[0].id !== pilot.id) {
        throw new Error('시험 발송 중지: BOT_USERS에서 본인만 발송 TRUE로 설정해야 합니다.');
      }
    }
    if (!routes.length) {
      console.log('발송 설정된 PM 0명. Slack 발송 없음');
      return deliveryOptions?{doneIds,failedIds,retryAfterMs}:undefined;
    }
    // 모든 수신자와 문안을 먼저 검사한 뒤 전송한다. 한 PM의 오류로 앞선 PM에만
    // 메시지가 간 상황을 줄이고, 실제 전송 성공분은 즉시 로그에 남긴다.
    const token = requiredProperty_(props, 'SLACK_BOT_TOKEN');
    let slackItems = [];
    let slackAsOf = '';
    let slackFailure = '';
    if (includeSlack) {
      // 발송 시점에는 Slack을 새로 읽지 않는다. collectBbpmSnapshot이 미리 만든 완료본만 쓴다.
      // Slack 쪽이 실패해도 시트 업무는 보내고, 읽지 못한 사실과 사유를 DM에 남긴다.
      try {
        if (props.getProperty('ENABLE_SLACK_MENTION_READ') !== 'true') {
          throw Object.assign(new Error('Slack 읽기 비활성'), { code: 'READ_DISABLED' });
        }
        const snapshot = loadFreshBbpmSnapshot_(props, bot, new Date());
        slackAsOf = Utilities.formatDate(new Date(snapshot.meta.newest * 1000),
          BRIEFING.timezone, 'yyyy-MM-dd HH:mm');
        slackItems = buildSlackDigestItems_(classifySlackSnapshot_(snapshot, routes));
        try { slackItems = attachSlackAuthorNames_(slackItems, token); }
        catch (error) { console.log('작성자 이름 생략 | ' + error.message); }
      } catch (error) {
        slackItems = [];
        slackAsOf = '';
        slackFailure = describeSlackFailure_(error, props);
        console.log('Slack 확인사항 제외 · ' + slackFailure + ' | 원인: ' + error.message);
      }
    }
    const packets = routes.map(route => {
      const ownTasks = rows.filter(row => row[12] === true &&
        String(row[1] || '').trim() === route.pm && isHaCvBriefingTask_(row[0]));
      assertFreshPilotTasks_(ownTasks, day);
      const seen = includeSlack && !slackFailure ? readSlackDigestSeen_(props, route.id) : [];
      const effectiveSlot = forcedSlot || (scheduledSlot === '17:00' || !scheduledSlot &&
        Number(Utilities.formatDate(new Date(), BRIEFING.timezone, 'HH')) >= 17 ? '17:00' : '11:00');
      const ownSlack = includeSlack ? selectPersonalSlackItems_(route.pm, slackItems, seen, day, effectiveSlot) : [];
      const shownSlack = includeSlack ? ownSlack : [];
      let message = formatPersonalWorkBriefing_(route.pm, rows, day, trends[route.pm], effectiveSlot);
      let slackSection = '';
      if (includeSlack) {
        // 시트 업무와 같은 종류의 Slack 항목은 업무 줄 아래로 옮긴다.
        const merged = slackFailure ? null : attachSlackToWorkLines_(message, ownSlack, day);
        if (merged) message = merged.text;
        slackSection = slackFailure ? '\n\n💬 *Slack*\n⚠️ Slack 확인사항을 읽어오지 못했습니다 — ' + slackFailure :
          formatPersonalSlackDigest_(merged.rest, day, effectiveSlot, merged.attached);
      }
      // 기준 시각은 정보 영역 끝에 한 줄로 둔다. 점심·한마디는 그 아래에 붙는다.
      slackSection += formatBriefingBasis_(new Date(), slackAsOf, day,
        props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true');
      return { route, ownTasks, message, seen, shownSlack, slackSection, effectiveSlot };
    });
    const prior = retainBriefingSendLog_(log, readBotRows_(log, BOT_WORKBOOK.logHeaders.length), day);
    const slot = selfTest ? (forcedSlot ? 'manual-self-morning-test' : 'manual-self-current-test-v2') : scheduledSlot ? 'scheduled-' + scheduledSlot : includeSlack ?
      'manual-test-slack-digest' : updatedTest ? 'manual-test-resend' : 'manual-personal';
    let phraseCatalog;
    let lunchCatalog;
    const failures = [];
    for (const packet of packets) {
      const {route,ownTasks,seen,shownSlack,slackSection,effectiveSlot}=packet;
      let message=packet.message;
      if (Date.now() >= deadline) { console.log('발송 실행 시간 상한: 미처리 대상은 이어 보내기 대상으로 유지'); break; }
      try {
      const alreadySent = prior.some(row => row[0] instanceof Date &&
        Utilities.formatDate(row[0], BRIEFING.timezone, 'yyyy-MM-dd') === day &&
        row[1] === slot && row[2] === route.pm && /^sent/.test(String(row[4])));
      if (alreadySent) {
        console.log(route.pm + ' | 오늘 개인 브리핑 발송 기록이 있어 건너뜀');
        doneIds.push(route.id);continue;
      }
      let calendarFailure = false;
      if (props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true') {
        try {
          message += buildLiveCalendarSection_(route, props, forcedSlot || scheduledSlot, new Date(),
            forcedSlot ? new Date(Date.parse(Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd') + 'T11:00:00+09:00')) : null);
        } catch (error) {
          calendarFailure = true;
          message += '\n\n📅 *회의*\n⚠️ 본인 회의 일정을 불러오지 못했습니다. 실행 계정·캘린더 연결 설정을 확인해주세요.';
          console.log('캘린더 조회 실패: ' + error.message);
        }
      }
      message += slackSection;
      let lunch = null;
      if (effectiveSlot === '11:00' && props.getProperty('ENABLE_LUNCH_RECOMMENDATION') !== 'false') {
        try {
          if (!lunchCatalog) lunchCatalog = readLunchRestaurantCatalog_(bot);
          lunch = pickLunchRecommendation_(props,route,day,effectiveSlot,lunchCatalog);
          message += formatLunchRecommendation_(lunch);
        } catch (error) { console.log('점심 추천 생략: 식당 목록·추천 이력 확인 필요 | 업무 브리핑은 유지'); }
      }
      let phrase = null;
      if (props.getProperty('ENABLE_BRIEFING_PHRASES') !== 'false') {
        try {
          if (!phraseCatalog) phraseCatalog = readBriefingPhraseCatalog_(bot);
          phrase = pickBriefingPhrase_(props,route,day,effectiveSlot,phraseCatalog);
          message += formatBriefingPhrase_(phrase);
        } catch (error) { console.log('한마디 생략: 문구 탭 또는 선택 이력 확인 필요 | 업무 브리핑은 유지'); }
      }
      postSlackDm_(token, route.id, message, slot, buildBriefingBlocks_(message));
      doneIds.push(route.id);
      log.appendRow([new Date(), slot, route.pm, ownTasks.map(row => row[0]).join(', '),
        calendarFailure ? 'sent-calendar-unavailable' : slackFailure ? 'sent-sheet-only' : 'sent']);
      if (lunch) {
        try { markLunchRecommendationSent_(props,route,lunch); }
        catch (error) { console.log('점심 추천 발송 성공, 선택 이력 저장 실패 | 반복 방지 설정 확인 필요'); }
      }
      if (phrase) {
        try { markBriefingPhraseSent_(props,route,phrase); }
        catch (error) { console.log('한마디 발송 성공, 선택 이력 저장 실패 | 반복 방지 설정 확인 필요'); }
      }
      if (includeSlack && !slackFailure) {
        try { markSlackDigestSeen_(props, route.id, seen, shownSlack); }
        catch (error) { console.log('Slack 발송 성공, 멘션 표시 이력 저장 실패 | DM 재전송하지 않음'); }
      }
      console.log(route.pm + ' | 개인 브리핑 Slack 발송 완료 | 대상 ' + maskPilotId_(route.id));
      if(deliveryOptions) Utilities.sleep(1100);
      } catch (error) {
        if(deliveryOptions&&error.code==='SLACK_RATE_LIMIT') {
          retryAfterMs=Math.max(60000,Number(error.retryAfterMs)||60000);
          console.log('Slack 요청 제한: 현재 및 남은 수신자를 대기 상태로 유지');break;
        }
        if(deliveryOptions) {doneIds.push(route.id);failedIds.push(route.id);failureReasons[route.id]=String(error.message).slice(0,160);}
        failures.push(error.message);
        console.log(route.pm + ' | 발송 처리 중단 | ' + error.message);
      }
    }
    if(deliveryOptions) return {doneIds:[...new Set(doneIds)],failedIds:[...new Set(failedIds)],failureReasons,retryAfterMs};
    if (failures.length) throw new Error('일부 PM 처리 실패 ' + failures.length + '건: ' + failures.join(' / '));
  } finally {
    lock.releaseLock();
  }
}

// 예: "_업무·회의 11:02 · Slack 10:30 기준_". Slack 완료본이 다른 날이면 날짜도 붙인다.
function formatBriefingBasis_(now, slackAsOf, day, withCalendar, preview) {
  const slack = String(slackAsOf || '');
  const slackTime = !slack ? '' : slack.slice(0, 10) === day ? slack.slice(11, 16) :
    slack.slice(5, 7) + '/' + slack.slice(8, 10) + ' ' + slack.slice(11, 16);
  return '\n\n_' + (preview ? '미리보기 · ' : '') + (withCalendar ? '업무·회의 ' : '업무 ') +
    Utilities.formatDate(now, BRIEFING.timezone, 'HH:mm') + (slackTime ? ' · Slack ' + slackTime : '') + ' 기준_';
}

// DM에는 짧은 사유만 쓴다. 완료본이 없거나 오래됐으면 마지막 수집 오류로 원인을 좁힌다.
function describeSlackFailure_(error, props) {
  let reason = '기타 오류 (실행 로그 확인)';
  if (error.code === 'READ_DISABLED') reason = 'Slack 읽기 설정 꺼짐';
  else if (error.code === 'NO_SNAPSHOT' || error.code === 'STALE') {
    let last = null;
    try { last = JSON.parse(props.getProperty('BBPM_COLLECT_LAST_ERROR') || 'null'); } catch (ignored) {}
    const cause = last ? String(last.message || '') : '';
    reason = !last ? (error.code === 'STALE' ? '저장된 Slack 자료가 최신성 기준을 초과함' : '완료된 수집 자료 없음') :
      /읽기 제한|ratelimited/.test(cause) ? 'Slack 읽기 제한' :
      /missing_scope|not_in_channel|channel_not_found|pm_team_channel|권한/.test(cause) ? '봇 권한·채널 참여 확인 필요' :
      /invalid_auth|not_authed|token_revoked|token_expired|account_inactive|토큰/.test(cause) ? '봇 토큰 확인 필요' :
      '기타 오류 (실행 로그 확인)';
  }
  const lastAsOf = Number(error.lastAsOf || 0);
  return '사유: ' + reason + (lastAsOf ? ' (마지막 완료 수집 ' + Utilities.formatDate(
    new Date(lastAsOf * 1000), BRIEFING.timezone, 'MM/dd HH:mm') + ')' : '');
}

function buildPmSlackRoutes_(userRows, owners) {
  const knownOwners = new Set(owners);
  const seenPm = new Set();
  const seenId = new Set();
  const routes = [];
  userRows.forEach(row => {
    const pm = String(row[0] || '').trim();
    if (!pm) return;
    if (seenPm.has(pm)) throw new Error('BOT_USERS에 담당 PM이 중복됩니다: ' + pm);
    seenPm.add(pm);
    if (row[2] !== true) return;
    const id = String(row[1] || '').trim();
    if (!knownOwners.has(pm)) throw new Error('발송 중지: 현재 원천에서 확인되지 않은 담당 PM: ' + pm);
    if (!/^[UW][A-Z0-9]{8,}$/.test(id)) {
      throw new Error('발송 중지: ' + pm + '의 Slack 사용자 ID를 확인하세요.');
    }
    if (seenId.has(id)) throw new Error('발송 중지: 같은 Slack ID가 여러 PM에 배정돼 있습니다.');
    seenId.add(id);
    routes.push({ pm, id });
  });
  return routes;
}

/** 저장된 오늘 업무 + 최신 Slack 완료본 + 현재 회의로 오전/오후 DM 문안을 조회만 한다. */
function previewMyMorningBriefing() { previewPersonalAssistantBriefing_('11:00'); }
function previewMyEveningBriefing() { previewPersonalAssistantBriefing_('17:00'); }

function previewPersonalAssistantBriefing_(slot) {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const users = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab,
    BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length);
  const pilot = findPilotRecipient_(users);
  if (!pilot || !/^[UW][A-Z0-9]{8,}$/.test(pilot.id)) throw new Error('본인 Slack 연결을 확인하세요.');
  const route = {pm:getPilotPmName_(users), id:pilot.id};
  const rows = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.tasksTab,
    BOT_WORKBOOK.taskHeaders), BOT_WORKBOOK.taskHeaders.length);
  const now = new Date();
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  assertFreshPilotTasks_(rows.filter(row => row[12] === true && row[1] === route.pm && isHaCvBriefingTask_(row[0])), day);
  let message = formatPersonalWorkBriefing_(route.pm, rows, day, null, slot, true);
  // Slack을 먼저 읽어 업무 줄에 묶을 항목을 정한 뒤, 업무→회의→Slack 순서로 조립한다.
  let slackAsOf = '', slackSection = '';
  try {
    if (props.getProperty('ENABLE_SLACK_MENTION_READ') !== 'true') {
      throw Object.assign(new Error('Slack 읽기 비활성'), {code:'READ_DISABLED'});
    }
    const snapshot = loadFreshBbpmSnapshot_(props, bot, now);
    let items = buildSlackDigestItems_(classifySlackSnapshot_(snapshot, [route]));
    // 미리보기는 저장된 작성자 이름만 쓴다(Slack 조회·속성 저장 없음).
    try { items = attachSlackAuthorNames_(items, '', true); }
    catch (error) { console.log('작성자 이름 생략 | ' + error.message); }
    const seen = readSlackDigestSeen_(props, route.id);
    const merged = attachSlackToWorkLines_(message, selectPersonalSlackItems_(route.pm, items, seen, day, slot), day);
    message = merged.text;
    slackSection = formatPersonalSlackDigest_(merged.rest, day, slot, merged.attached);
    slackAsOf = Utilities.formatDate(new Date(snapshot.meta.newest * 1000), BRIEFING.timezone, 'yyyy-MM-dd HH:mm');
  } catch (error) { slackSection = '\n\n💬 *Slack*\n⚠️ Slack 확인사항을 읽어오지 못했습니다 — ' + describeSlackFailure_(error, props); }
  const withCalendar = props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true';
  if (withCalendar) {
    try { message += buildLiveCalendarSection_(route, props, slot, now); }
    catch (error) { message += '\n\n📅 *회의*\n⚠️ 회의 일정을 불러오지 못했습니다. 캘린더 연결을 확인해주세요.'; }
  } else message += '\n\n📅 *회의*\n• 캘린더 연결 꺼짐';
  message += slackSection;
  message += formatBriefingBasis_(now, slackAsOf, day, withCalendar, true);
  if (slot === '11:00' && props.getProperty('ENABLE_LUNCH_RECOMMENDATION') !== 'false') {
    try {
      message += formatLunchRecommendation_(pickLunchRecommendation_(props,route,day,slot,readLunchRestaurantCatalog_(bot)));
    } catch (error) { console.log('점심 추천 미리보기 생략: 식당 목록·추천 이력 확인 필요'); }
  }
  if (props.getProperty('ENABLE_BRIEFING_PHRASES') !== 'false') {
    try {
      message += formatBriefingPhrase_(pickBriefingPhrase_(props,route,day,slot,readBriefingPhraseCatalog_(bot)));
    } catch (error) { console.log('한마디 미리보기 생략: 문구 탭 또는 선택 이력 확인 필요'); }
  }
  // 실제 DM과 같은 블록 구조로 보여준다(구분선·회색 기준 줄). 블록 상한 초과면 텍스트 그대로.
  const blocks = buildBriefingBlocks_(message);
  console.log(blocks ? briefingBlocksAsText_(blocks) : message);
  console.log('현재 자료로 회차별 문안만 확인 | 과거 시각 재현 아님 | 원천 새 조회·시트/이력 변경·Slack 수집/발송 없음');
}
