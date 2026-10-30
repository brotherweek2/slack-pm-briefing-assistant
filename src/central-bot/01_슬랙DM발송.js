/**
 * 01. 슬랙DM발송 — 개인 DM 만들기·보내기, 본인 시험·미리보기
 *
 * 알아둘 것
 * - 본인 시험 DM은 실행 계정 본인 1명에게만, 시험 종류마다 하루 1회.
 * - 한 PM의 명단·문안 오류는 그 PM만 실패로 남기고 나머지는 보낸다.
 * - 담당 탭이 없는 수신자도 정상 대상이다(본인 배정 업무만 표시).
 * - 원본을 못 읽어 직전 결과로 둔 업무 종류는 발송 전 "오늘 갱신" 검사에서 뺀다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 * - ⚠️ previewPmSlackRouting(): 업무를 갱신하고 PM별 Slack 연결·발송 설정을 확인한다
 * - 🔍 checkSlackBotToken(): Slack auth.test로 봇 인증 유효성만 확인한다
 * - ⚠️ sendMyMorningBriefingTest(): 본인에게 10:30 오전 문안 시험 DM
 * - ⚠️ sendMyAfternoonBriefingTest(): 본인에게 14:00 오후 업데이트 시험 DM
 * - ⚠️ sendMyCurrentBriefingTest(): 본인에게 지금 시각 문안 시험 DM(17:00 전 오전형, 17:00 이후 마무리형)
 * - 🔍 previewMyMorningBriefing(): 저장된 오늘 업무·최신 Slack 완료본·현재 회의로 10:30 오전 문안을 출력한다
 * - 🔍 previewMyEveningBriefing(): 현재 자료로 17:00 마무리 문안과 내일 회의·기한을 출력한다
 *
 * 내부 함수 (직접 실행하지 않음)
 * - sendPmBriefings_(updatedTest, includeSlack, scheduledSlot, _unused, deliveryOptions): 업무 갱신·수신자 검증·중복 차단 후 개인 DM을 보내고 성공 이력을 저장한다
 * - formatBriefingBasis_(now, slackAsOf, day, withCalendar, preview): 업무·회의 및 Slack 조회 시각을 정보 영역 끝 한 줄로 정리한다
 * - describeSlackFailure_(error, props): 완료본 없음·최신성 초과·권한·인증·호출 제한을 짧은 안내로 바꾼다
 * - buildPmSlackRoutes_(userRows, owners, issues): BOT_USERS에서 발송 대상(이름·Slack ID)을 만들고 명단 문제를 모은다
 * - previewPersonalAssistantBriefing_(slot): 시트 업무→회의→Slack→오전 점심→한마디 순서의 미리보기를 만들고 이력은 변경하지 않는다
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

/** 본인 전용 10:30 오전 문안 시험. 실행 시각과 상관없이 오전 문안(오늘 회의·점심)으로 본인에게만 보낸다. 하루 1회. */
function sendMyMorningBriefingTest() {
  sendPmBriefings_(true, true, undefined, false, {selfTest:true, forceSlot:'11:00'});
}

/** 본인 전용 14:00 오후 업데이트 시험. 오늘 오전 정기 DM 이후 새로 생긴 것만, 없으면 한 줄 인사. 하루 1회. */
function sendMyAfternoonBriefingTest() {
  sendPmBriefings_(true, true, undefined, false, {selfTest:true, forceSlot:'14:00'});
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
  const forcedSlot=selfTest&&['11:00','14:00'].includes(deliveryOptions.forceSlot)?deliveryOptions.forceSlot:null;
  if(selfTest) {
    if(!updatedTest||!includeSlack||scheduledSlot||
        props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE')!=='true'||
        props.getProperty('ENABLE_CALENDAR_BRIEFING')!=='true') throw new Error('본인 통합 시험은 개인 캘린더 연결 모드에서만 실행하세요.');
    deliveryOptions=null; // 정기 발송 묶음 옵션과 섞지 않는다.
  }
  // 정기 묶음은 4분 이후 새 전송을 시작하지 않아 6분 강제 종료 전 기록·잠금 해제 여유를 둔다.
  const deadline = Date.now() + (deliveryOptions ? 240000 : 300000);
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
    const workStarted=Date.now();
    const summary = deliveryOptions ? refreshBotTasksForRound_(props) : refreshBotTasks();
    // 업무 시트 하나를 못 읽었으면 그 업무는 직전 결과다. 기준 줄 아래에 한 줄로 알린다(시트 이름만, 오류 문구는 관리자 요약).
    const sourceNote = (summary.sourceFailures || []).length ? '\n_⚠️ ' + [...new Set(summary.sourceFailures
      .map(text => String(text).split(':')[0]))].join(' · ') + ' 시트를 읽지 못해 해당 업무는 직전 확인 결과예요_' : '';
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
    const routeIssues = [];
    let routes = buildPmSlackRoutes_(userRows, owners, routeIssues);
    // 관리자 요약이 오늘 명단 문제를 보여 줄 수 있게 남긴다(정기 발송만).
    if (scheduledSlot && (routeIssues.length || props.getProperty('ROUTE_ISSUES'))) {
      try { props.setProperty('ROUTE_ISSUES', JSON.stringify({day, slot:scheduledSlot, items:routeIssues.slice(0, 20)})); } catch (_) {}
    }
    if(selfTest) routes=routes.filter(route=>route.id===selfRoute.slackId&&route.pm===selfRoute.pm);
    // 관리자가 개인 연결 발송을 명시적으로 활성화한 경우에만 대상 확대.
    if (!updatedTest && props.getProperty('ENABLE_CONNECTED_PM_SEND') === 'true') {
      routes = selfCalendarFilterRoutes_(routes, props);
    }
    if(deliveryOptions) {
      if(!scheduledSlot||!Array.isArray(deliveryOptions.recipientIds)||deliveryOptions.recipientIds.length>4) throw new Error('정기 발송 묶음 설정 오류');
      routes=routes.filter(route=>deliveryOptions.recipientIds.includes(route.id));
    }
    // 연차인 PM은 정기 회차에서 뺀다(28번). 끝난 것으로 처리해 이어 보내기 대상에 남기지 않는다.
    const onLeave = scheduledSlot ? briefingLeaveRoutes_(routes, props, new Date()) : [];
    if (onLeave.length) {
      routes = routes.filter(route => !onLeave.some(item => item.route.id === route.id));
      noteBriefingLeave_(props, log, scheduledSlot, onLeave);
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
    const timing={workMs:Date.now()-workStarted};
    const slackStarted=Date.now();
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
    timing.slackMs=Date.now()-slackStarted;
    const prepareStarted=Date.now();
    const prior = retainBriefingSendLog_(log, readBotRows_(log, BOT_WORKBOOK.logHeaders.length), day);
    const packets = routes.map(route => {
     // 한 PM의 문안 준비 오류가 다른 PM 발송을 막지 않게 PM별로 감싼다.
     try {
      if(deliveryOptions&&Date.now()>=deadline)return {route,deferred:true};
      const ownTasks = rows.filter(row => row[12] === true &&
        String(row[1] || '').trim() === route.pm && isHaCvBriefingTask_(row[0]));
      // 이번에 읽지 못해 직전 결과로 둔 업무 종류는 오늘 갱신 검사에서 뺀다(그 PM의 DM이 통째로 막히지 않게).
      const kept = summary.keptPrefixes || [];
      assertFreshPilotTasks_(ownTasks.filter(row => !kept.some(prefix => String(row[0]).startsWith(prefix))), day);
      // ✅ 완료 버튼(31번): 오늘 완료 표시한 업무 종류는 남은 회차에서 뺀다. 발송 기록에도 보여 준 업무만 남긴다.
      const done = taskDoneEnabled_(props) ? taskDoneGroups_(props, route.id, day) : [];
      const shownTasks = withoutDoneTasks_(ownTasks, route.pm, done);
      const seen = includeSlack && !slackFailure ? readSlackDigestSeen_(props, route.id) : [];
      const effectiveSlot = forcedSlot || (scheduledSlot === '14:00' ? '14:00' : scheduledSlot === '17:00' || !scheduledSlot &&
        Number(Utilities.formatDate(new Date(), BRIEFING.timezone, 'HH')) >= 17 ? '17:00' : '11:00');
      const ownSlack = includeSlack ? selectPersonalSlackItems_(route.pm, slackItems, seen, day, effectiveSlot) : [];
      if (effectiveSlot === '14:00') {
        // 14:00: 오전 이후 새로 생긴 업무·Slack만. 없으면 한 줄 인사(29번 파일).
        const keys = morningTaskKeys_(prior, day, route.pm);
        const newRows = keys ? shownTasks.filter(row => !keys.includes(String(row[0]))) : [];
        const fresh = ownSlack.filter(item => !item.previouslySent);
        // 14:00에도 오늘 남은 회의를 붙인다. 회의를 못 읽어도 업무·Slack은 보낸다.
        const withCalendar = props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true';
        let meetings = '', calendarFailure = false;
        if (withCalendar) {
          try {
            meetings = buildLiveCalendarSection_(route, props, '14:00', new Date(),
              forcedSlot ? new Date(Date.parse(day + 'T14:00:00+09:00')) : null);
          } catch (error) {
            calendarFailure = true;
            meetings = '\n\n📅 *오늘 회의*\n⚠️ 본인 회의 일정을 불러오지 못했습니다. 실행 계정·캘린더 연결 설정을 확인해주세요.';
            console.log('캘린더 조회 실패: ' + error.message);
          }
        }
        const update = formatAfternoonUpdate_(route.pm, day, newRows, fresh, slackFailure,
          formatBriefingBasis_(new Date(), slackAsOf, day, withCalendar) + sourceNote, meetings);
        return {route, ownTasks:shownTasks, message:update.text, seen, shownSlack:fresh, slackSection:'', effectiveSlot, afternoon:true,
          quiet:update.quiet, calendarFailure, buttonRows:newRows, doneGroups:done};
      }
      const shownSlack = includeSlack ? ownSlack : [];
      let message = formatPersonalWorkBriefing_(route.pm, withoutDoneTasks_(rows, route.pm, done), day, trends[route.pm], effectiveSlot) +
        taskDoneNote_(done);
      let slackSection = '';
      if (includeSlack) {
        // 시트 업무와 같은 종류의 Slack 항목은 업무 줄 아래로 옮긴다.
        const merged = slackFailure ? null : attachSlackToWorkLines_(message, ownSlack, day);
        if (merged) message = merged.text;
        slackSection = slackFailure ? '\n\n💬 *Slack*\n⚠️ Slack 확인사항을 읽어오지 못했습니다 — ' + slackFailure :
          formatPersonalSlackDigest_(merged.rest, day, effectiveSlot, merged.attached);
      }
      // 월요일 오전·금요일 마무리 DM에만 업무 아래에 주간 안내를 붙인다.
      message += formatWeeklyOutlook_(route.pm, rows, day, effectiveSlot);
      // 기준 시각은 정보 영역 끝에 한 줄로 둔다. 점심·한마디는 그 아래에 붙는다.
      slackSection += formatBriefingBasis_(new Date(), slackAsOf, day,
        props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true') + sourceNote;
      return { route, ownTasks:shownTasks, message, seen, shownSlack, slackSection, effectiveSlot, buttonRows:shownTasks, doneGroups:done };
     } catch (error) { return {route, prepError:error}; }
    });
    // 피드백 버튼이 붙으면 기록 탭도 미리 만들어 둔다(첫 버튼 누름을 기다리지 않음).
    if (feedbackEnabled_(props)) {
      try { ensureBotSheet_(bot, FEEDBACK.tab, FEEDBACK.headers); } catch (error) { console.log('피드백 탭 준비 생략 | ' + error.message); }
    }
    const slot = selfTest ? (forcedSlot === '14:00' ? 'manual-self-afternoon-test' : forcedSlot ? 'manual-self-morning-test' : 'manual-self-current-test-v2') : scheduledSlot ? 'scheduled-' + scheduledSlot : includeSlack ?
      'manual-test-slack-digest' : updatedTest ? 'manual-test-resend' : 'manual-personal';
    let phraseCatalog;
    let lunchCatalog;
    timing.prepareMs=Date.now()-prepareStarted;
    const deliveryStarted=Date.now();
    let lunchMate = null; // 점심 메이트: 켠 PM 전원 기준으로 한 번만 계산(묶음이 달라도 같은 결과)
    const failures = [];
    for (const packet of packets) {
      const {route,ownTasks,seen,shownSlack,slackSection,effectiveSlot}=packet;
      let message=packet.message;
      if (packet.deferred || Date.now() >= deadline) { console.log('발송 실행 시간 상한: 미처리 대상은 이어 보내기 대상으로 유지'); break; }
      try {
      if (packet.prepError) throw packet.prepError;
      const alreadySent = prior.some(row => row[0] instanceof Date &&
        Utilities.formatDate(row[0], BRIEFING.timezone, 'yyyy-MM-dd') === day &&
        row[1] === slot && row[2] === route.pm && /^sent/.test(String(row[4])));
      if (alreadySent) {
        console.log(route.pm + ' | 오늘 개인 브리핑 발송 기록이 있어 건너뜀');
        doneIds.push(route.id);continue;
      }
      let calendarFailure = false;
      if (packet.afternoon) {
        // 14:00은 점심·날씨·한마디 없이 바로 보낸다(회의는 문안 준비 때 붙임). 새 소식이 있을 때만 피드백 버튼.
        let blocks = buildBriefingBlocks_(message);
        if (taskDoneEnabled_(props)) blocks = insertTaskDoneButtons_(blocks, taskDoneButtonBlock_(packet.buttonRows || [], day, packet.doneGroups));
        if (!packet.quiet) blocks = appendFeedbackButtons_(blocks, props, day, effectiveSlot);
        if(deliveryOptions&&Date.now()>=deadline)break;
        postSlackDm_(token, route.id, message, slot, blocks);
        doneIds.push(route.id);
        log.appendRow([new Date(), slot, route.pm, ownTasks.map(row => row[0]).join(', '),
          packet.calendarFailure ? 'sent-calendar-unavailable' : slackFailure ? 'sent-sheet-only' : 'sent']);
        if (includeSlack && !slackFailure && shownSlack.length) {
          try { markSlackDigestSeen_(props, route.id, seen, shownSlack, slackItems.filter(item => item.pm === route.pm)); }
          catch (error) { console.log('Slack 발송 성공, 멘션 표시 이력 저장 실패 | DM 재전송하지 않음'); }
        }
        console.log(route.pm + ' | 14:00 오후 업데이트 발송 완료' + (packet.quiet ? '(새 소식 없음)' : '') + ' | 대상 ' + maskPilotId_(route.id));
        if(deliveryOptions) Utilities.sleep(1100);
        continue;
      }
      if (props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true') {
        try {
          message += buildLiveCalendarSection_(route, props, forcedSlot || scheduledSlot, new Date(),
            forcedSlot ? new Date(Date.parse(Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd') + 'T10:30:00+09:00')) : null);
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
          if (lunch) {
            if (!lunchMate) {
              const participants = lunchMateParticipants_(props, userRows);
              lunchMate = {participants, plan:lunchMatePlan_(participants, lunchCatalog, day)};
            }
            lunch = applyLunchMate_(lunch, lunchMate.plan, route, day);
          }
          message += formatLunchRecommendation_(lunch) + (lunch ? formatLunchMateLine_(route, lunchMate.plan, lunchMate.participants) : '');
        } catch (error) { console.log('점심 추천 생략: 식당 목록·추천 이력 확인 필요 | 업무 브리핑은 유지'); }
      }
      // 17:00: 내일 날씨(켜져 있을 때)와 목·금 주말 인사.
      message += formatEveningNotes_(props, day, effectiveSlot);
      let phrase = null;
      if (props.getProperty('ENABLE_BRIEFING_PHRASES') !== 'false') {
        try {
          if (!phraseCatalog) phraseCatalog = readBriefingPhraseCatalog_(bot);
          phrase = pickBriefingPhrase_(props,route,day,effectiveSlot,phraseCatalog);
          message += formatBriefingPhrase_(phrase);
        } catch (error) { console.log('한마디 생략: 문구 탭 또는 선택 이력 확인 필요 | 업무 브리핑은 유지'); }
      }
      let blocks = buildBriefingBlocks_(message);
      if (taskDoneEnabled_(props)) blocks = insertTaskDoneButtons_(blocks, taskDoneButtonBlock_(packet.buttonRows || [], day, packet.doneGroups));
      // 점심 메이트 버튼: Slack 버튼 응답 주소를 등록하고 ENABLE_LUNCH_MATE=true일 때만.
      if (lunch && props.getProperty('ENABLE_LUNCH_MATE') === 'true') blocks = insertLunchMateButton_(blocks, lunchMateButtonBlock_(lunchMateOn_(props, route.id)));
      blocks = appendFeedbackButtons_(blocks, props, day, effectiveSlot);
      if(deliveryOptions&&Date.now()>=deadline)break;
      postSlackDm_(token, route.id, message, slot, blocks);
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
        try { markSlackDigestSeen_(props, route.id, seen, shownSlack, slackItems.filter(item => item.pm === route.pm)); }
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
    if(deliveryOptions) {
      timing.deliveryMs=Date.now()-deliveryStarted;
      console.log('묶음 구간 시간(ms): '+JSON.stringify(timing));
      return {doneIds:[...new Set(doneIds)],failedIds:[...new Set(failedIds)],failureReasons,retryAfterMs,timing};
    }
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

// 명단 문제는 그 PM만 처리한다(전체 회차를 멈추지 않음). issues 배열을 주면 문제를 모아 돌려준다.
// - 업무 시트 담당자 목록에 이름이 없어도 정상 수신자다. 언어쌍 PM 외의 팀원도 사용한다.
//   본인에게 배정된 검수·테스트 업무는 그대로 표시하며, 담당 탭 부재로 DM·관리자 경고를 만들지 않는다.
// - Slack ID 형식 오류·같은 이름이나 같은 Slack ID가 두 줄 이상 → 그 PM(들)은 보내지 않음(잘못 보낼 위험).
function buildPmSlackRoutes_(userRows, owners, issues) {
  const note = text => { if (Array.isArray(issues)) issues.push(text); };
  const enabled = userRows.map(row => ({pm:String(row[0] || '').trim(), id:String(row[1] || '').trim(), on:row[2] === true}))
    .filter(row => row.pm);
  const count = (key, value) => enabled.filter(row => row[key] === value).length;
  const routes = [];
  enabled.forEach(row => {
    if (!row.on) return;
    if (count('pm', row.pm) > 1) { note(row.pm + ': BOT_USERS에 같은 이름이 두 줄 이상 → 이번 회차 제외'); return; }
    if (!/^[UW][A-Z0-9]{8,}$/.test(row.id)) { note(row.pm + ': Slack ID 형식 오류 → 이번 회차 제외'); return; }
    if (enabled.filter(other => other.on && other.id === row.id).length > 1) { note(row.pm + ': 같은 Slack ID가 다른 PM에도 있음 → 이번 회차 제외'); return; }
    const route = {pm:row.pm, id:row.id};
    routes.push(route);
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
  message += formatWeeklyOutlook_(route.pm, rows, day, slot);
  const withCalendar = props.getProperty('ENABLE_CALENDAR_BRIEFING') === 'true';
  if (withCalendar) {
    try { message += buildLiveCalendarSection_(route, props, slot, now); }
    catch (error) { message += '\n\n📅 *회의*\n⚠️ 회의 일정을 불러오지 못했습니다. 캘린더 연결을 확인해주세요.'; }
  } else message += '\n\n📅 *회의*\n• 캘린더 연결 꺼짐';
  message += slackSection;
  message += formatBriefingBasis_(now, slackAsOf, day, withCalendar, true);
  if (slot === '11:00' && props.getProperty('ENABLE_LUNCH_RECOMMENDATION') !== 'false') {
    try {
      const catalog = readLunchRestaurantCatalog_(bot);
      let lunch = pickLunchRecommendation_(props,route,day,slot,catalog);
      const participants = lunchMateParticipants_(props, users), plan = lunchMatePlan_(participants, catalog, day);
      if (lunch) lunch = applyLunchMate_(lunch, plan, route, day);
      message += formatLunchRecommendation_(lunch) + (lunch ? formatLunchMateLine_(route, plan, participants) : '');
    } catch (error) { console.log('점심 추천 미리보기 생략: 식당 목록·추천 이력 확인 필요'); }
  }
  message += formatEveningNotes_(props, day, slot);
  if (props.getProperty('ENABLE_BRIEFING_PHRASES') !== 'false') {
    try {
      message += formatBriefingPhrase_(pickBriefingPhrase_(props,route,day,slot,readBriefingPhraseCatalog_(bot)));
    } catch (error) { console.log('한마디 미리보기 생략: 문구 탭 또는 선택 이력 확인 필요'); }
  }
  // 실제 DM과 같은 블록 구조로 보여준다(구분선·회색 기준 줄). 블록 상한 초과면 텍스트 그대로.
  let blocks = buildBriefingBlocks_(message);
  // 실제 DM처럼 점심 영역 아래 점심 메이트 버튼도 보여 준다(점심 추천이 있는 오전 문안만).
  if (props.getProperty('ENABLE_LUNCH_MATE') === 'true') blocks = insertLunchMateButton_(blocks, lunchMateButtonBlock_(lunchMateOn_(props, route.id)));
  blocks = appendFeedbackButtons_(blocks, props, day, slot);
  console.log(blocks ? briefingBlocksAsText_(blocks) : message);
  console.log('현재 자료로 회차별 문안만 확인 | 과거 시각 재현 아님 | 원천 새 조회·시트/이력 변경·Slack 수집/발송 없음');
}
