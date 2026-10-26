/**
 * 14. 공통설정
 * - 역할: 공통 설정·헤즈업/HUB 수집·Slack API 전송 보조
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 14-01. HUB 검토 필요 읽기 [내부]
 * - collectHaCvReviewCandidates_(spreadsheet): 기존 담당자·언어쌍·검토 상태의 허용된 열만 읽어 후보와 근거 링크를 만든다.
 *
 * 14-02. 헤즈업 대상 읽기 [내부]
 * - collectHaCvHeadsUpCandidates_(spreadsheet): 담당 PM·언어쌍·헤즈업 상태의 허용된 열만 읽어 후보와 근거 링크를 만든다.
 *
 * 14-03. Slack DM API [내부]
 * - buildBriefingBlocks_(text): 개인 브리핑을 영역별 구분선·회색 기준 줄 블록으로 변환(50개 초과 시 null). briefingBlocksAsText_는 미리보기 로그용.
 * - postSlackDm_(token, userId, text, deliveryKey, blocks): 개인 DM 전송·길이 확인. blocks는 선택(개인 브리핑만 사용). deliveryKey가 있으면 요청 전 점유를 기록하고 결과 불명 시 재전송을 차단한다. 호출자는 발송 잠금을 확보해야 한다. 영향: 실제 Slack 발송·발송 점유 속성 변경.
 *
 * 14-04. 필수 속성 확인 [내부]
 * - requiredProperty_(props, key): 필수 속성 확인. 봇 파일 ID 요청 시 지정 전용 파일·실행 계정도 검사한다.
 *
 * 14-05. Slack 문자 처리 [내부]
 * - escapeSlack_(value): 문안의 특수 문자를 안전하게 표시한다.
 *
 * - appsscript.json: 권한·시간대·V8 실행 환경 설정. 예약된 JSON 파일이므로 이름·내용 유지.
 */

/**
 * NAC 개인 업무 이슈 브리핑 — Google Apps Script 시범 코드.
 *
 * 현재 연결된 원천: HA-CV 유저 관리 시트의 헤즈업 `헤즈업 대상`과 HUB `검토 필요` 후보.
 * 헤즈업 담당 PM은 결과 집계 E열, HUB 검토 담당 PM은 HUB D열을 사용한다.
 * 기존 시트의 참여확정/투입 버튼을 변경하거나 시트 값을 쓰지 않는다.
 * 별도 유료 AI 서비스는 사용하지 않는다.
 */

const BRIEFING = Object.freeze({
  timezone: 'Asia/Seoul',
  resultTab: 'HA-CV 헤즈업 결과 집계',
  hubTab: 'HACV_Hub',
  reviewStatus: '검토 필요',
  headsUpStatus: '헤즈업 대상',
  slackPostUrl: 'https://slack.com/api/chat.postMessage',
});

// 현재 파이프라인이 사용하는 원천 수집·Slack 전송 공통 함수만 둔다.
function collectHaCvReviewCandidates_(spreadsheet) {
  const hubTab = spreadsheet.getSheetByName(BRIEFING.hubTab);
  if (!hubTab) throw new Error('HACV_Hub 탭을 찾지 못했습니다.');
  const headers = hubTab.getRange(2, 1, 1, 6).getDisplayValues()[0];
  if (headers[0] !== '투입 언어쌍' || headers[3] !== '(기존) 담당자' ||
      headers[5] !== '담당자 탭으로 전송 여부') {
    throw new Error('HACV_Hub의 언어쌍·담당자·상태 헤더가 예상과 다릅니다.');
  }

  const byPm = {};
  const unassigned = [];
  let sourceBase = '';
  const hubLastRow = hubTab.getLastRow();
  if (hubLastRow >= 3) {
    const pairs = hubTab.getRange(3, 1, hubLastRow - 2, 1).getDisplayValues();
    const owners = hubTab.getRange(3, 4, hubLastRow - 2, 1).getDisplayValues();
    const statuses = hubTab.getRange(3, 6, hubLastRow - 2, 1).getDisplayValues();
    pairs.forEach((row, index) => {
      const pair = row[0].trim();
      const pm = owners[index][0].trim();
      const status = statuses[index][0].trim();
      if (status !== BRIEFING.reviewStatus) return;

      const sheetRow = index + 3;
      if (!pair || !pm) {
        unassigned.push('HUB ' + sheetRow + '행');
        return;
      }
      if (!byPm[pm]) byPm[pm] = {};
      if (!byPm[pm][pair]) byPm[pm][pair] = [];
      if (!sourceBase) sourceBase = spreadsheet.getUrl() + '#gid=' + hubTab.getSheetId();
      byPm[pm][pair].push({
        row: sheetRow,
        url: sourceBase + '&range=F' + sheetRow,
      });
    });
  }
  return { byPm, unassigned };
}

function collectHaCvHeadsUpCandidates_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(BRIEFING.resultTab);
  if (!sheet) throw new Error('HA-CV 헤즈업 결과 집계 탭을 찾지 못했습니다.');
  const headers = sheet.getRange(1, 4, 1, 5).getDisplayValues()[0];
  if (headers[0] !== '언어쌍' || headers[1] !== '담당 PM' ||
      headers[4] !== '헤즈업 상태 (HA-CV 참여 여부)') {
    throw new Error('헤즈업 결과 집계의 언어쌍·담당 PM·상태 헤더가 예상과 다릅니다.');
  }
  const byPm = {};
  const unassigned = [];
  let sourceBase = '';
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { byPm, unassigned };
  const pairOwners = sheet.getRange(2, 4, lastRow - 1, 2).getDisplayValues();
  const statuses = sheet.getRange(2, 8, lastRow - 1, 1).getDisplayValues();
  pairOwners.forEach((row, index) => {
    if (String(statuses[index][0] || '').trim() !== BRIEFING.headsUpStatus) return;
    const pair = row[0].trim();
    const pm = row[1].trim();
    const sheetRow = index + 2;
    if (!pair || !pm) {
      unassigned.push(sheetRow);
      return;
    }
    if (!byPm[pm]) byPm[pm] = {};
    if (!byPm[pm][pair]) byPm[pm][pair] = [];
    if (!sourceBase) sourceBase = spreadsheet.getUrl() + '#gid=' + sheet.getSheetId();
    byPm[pm][pair].push({
      row: sheetRow,
      url: sourceBase + '&range=H' + sheetRow,
    });
  });
  return { byPm, unassigned };
}


// 개인 브리핑 문안을 Slack 블록으로 바꾼다. 빈 줄로 나뉜 영역 사이에 구분선을 넣고,
// "_…기준_" 한 줄은 작은 회색 글씨(context)로 둔다. 문안 자체는 바꾸지 않는다. 블록 50개 초과 시 null(텍스트로 발송).
function buildBriefingBlocks_(text) {
  const chunks = String(text).split(/\n{2,}/).map(chunk => chunk.replace(/^\n+|\n+$/g, '')).filter(Boolean);
  const blocks = [];
  chunks.forEach((chunk, index) => {
    if (/^_[^\n]*기준_$/.test(chunk)) {
      blocks.push({type:'context', elements:[{type:'mrkdwn', text:chunk}]});
      return;
    }
    if (index > 0) blocks.push({type:'divider'});
    // section 글자 상한(3,000자) 안에서 줄 단위로 나눈다.
    let part = '';
    chunk.split('\n').forEach(line => {
      let chars = Array.from(line);
      // 한 줄이 상한보다 길면 2,900자 조각으로 나눠 앞 조각부터 별도 section으로 보낸다(무통보 잘림 방지).
      while (chars.length > 2900) {
        if (part) { blocks.push(briefingSection_(part)); part = ''; }
        blocks.push(briefingSection_(chars.slice(0, 2900).join('')));
        chars = chars.slice(2900);
      }
      line = chars.join('');
      if (part && Array.from(part + '\n' + line).length > 2900) { blocks.push(briefingSection_(part)); part = ''; }
      part = part ? part + '\n' + line : line;
    });
    if (part) blocks.push(briefingSection_(part));
  });
  return blocks.length > 50 ? null : blocks;
}

function briefingSection_(text) {
  return {type:'section', text:{type:'mrkdwn', text:Array.from(text).slice(0, 3000).join('')}};
}

// 미리보기 로그용: 블록 구조를 구분선 줄로 보여준다(Slack 화면 모양 확인용).
function briefingBlocksAsText_(blocks) {
  return blocks.map(block => block.type === 'divider' ? '──────────' :
    block.type === 'context' ? '(회색) ' + block.elements[0].text :
    block.type === 'actions' ? '[버튼] ' + block.elements.map(e => e.text.text).join(' / ') : block.text.text).join('\n');
}

function postSlackDm_(token, userId, text, deliveryKey, blocks) {
  if (Array.from(String(text)).length > 35000) throw new Error('DM 길이 상한 초과: 문안 분리가 필요합니다. 자동 생략·발송 없음');
  // 정기/통합 발송은 요청 전 점유를 저장한다. 응답 유실은 자동 재전송하지 않는다.
  let props, journalKey, day;
  if (deliveryKey) {
    props = PropertiesService.getScriptProperties();
    const notBefore=Number(props.getProperty('SLACK_POST_NOT_BEFORE')||0);
    if(notBefore>Date.now()) throw Object.assign(new Error('Slack 발송 대기: 요청 제한 해제 후 이어 보냅니다.'),
      {code:'SLACK_RATE_LIMIT',retryAfterMs:notBefore-Date.now(),definitive:true});
    const all = props.getProperties();
    const size = Object.keys(all).reduce((sum, key) => sum +
      Utilities.newBlob(key + all[key]).getBytes().length, 0);
    if (size >= 480 * 1024) throw new Error('속성 저장 공간 부족: 발송 점유를 안전하게 기록할 여유가 없습니다. 운영 점검 필요');
    if (size >= 400 * 1024) console.log('속성 저장량 400KB 이상: 사용하지 않는 PM 이력 점검 필요');
    day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
    journalKey = 'BOT_DELIVERY_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, userId + '|' + deliveryKey));
    const previous = JSON.parse(props.getProperty(journalKey) || 'null');
    if (previous && previous.day === day && previous.state !== 'rejected') {
      throw Object.assign(new Error('DM 재전송 차단: 발송 완료 또는 결과 확인 필요. 기존 DM·실행 로그를 확인하세요.'),
        {code:'DM_RESULT_UNCERTAIN'});
    }
    props.setProperty(journalKey, JSON.stringify({day, state:'pending'}));
  }
  const response = UrlFetchApp.fetch(BRIEFING.slackPostUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    // blocks가 있으면 화면은 블록으로, text는 알림 미리보기·대체 문구로 쓰인다.
    payload: JSON.stringify(Object.assign({ channel: userId, text, unfurl_links: false }, blocks ? { blocks } : {})),
    muteHttpExceptions: true,
  });
  let body;
  try { body=JSON.parse(response.getContentText()); } catch (_) { body={}; }
  if (response.getResponseCode() !== 200 || !body.ok) {
    const status = response.getResponseCode();
    // 명시적으로 거절된 요청만 재시도 가능. 5xx·해석 실패·통신 단절은 pending 유지.
    if (journalKey && (status === 429 || status >= 400 && status < 500 || status === 200 && body.ok === false)) {
      props.setProperty(journalKey, JSON.stringify({day, state:'rejected'}));
    }
    const code = /^[a-z0-9_]+$/.test(String(body.error || '')) ? body.error : status;
    if(status===429) {
      const headers=typeof response.getAllHeaders==='function'?response.getAllHeaders():{};
      const key=Object.keys(headers).find(name=>name.toLowerCase()==='retry-after');
      const seconds=key?Number(headers[key]):60;
      const retryAfterMs=Number.isFinite(seconds)&&seconds>0?seconds*1000:60000;
      if(props) props.setProperty('SLACK_POST_NOT_BEFORE',String(Date.now()+retryAfterMs));
      throw Object.assign(new Error('Slack 발송 실패: 요청 제한. 대기 후 이어 보냅니다.'),{code:'SLACK_RATE_LIMIT',retryAfterMs,definitive:true});
    }
    throw Object.assign(new Error('Slack 발송 실패: ' + code),{code:'SLACK_SEND_FAILED',
      definitive:status>=400&&status<500||status===200&&body.ok===false});
  }
  if (journalKey) props.setProperty(journalKey, JSON.stringify({day, state:'sent'}));
}

function requiredProperty_(props, key) {
  const value = props.getProperty(key);
  if (!value) throw new Error('스크립트 속성 ' + key + '이(가) 비어 있습니다.');
  if (key === 'BOT_SPREADSHEET_ID') {
    if (typeof BOT_WORKBOOK === 'undefined' || value !== BOT_WORKBOOK.bootstrapId ||
        value === props.getProperty('SOURCE_SPREADSHEET_ID')) {
      throw new Error('지정된 브리핑 전용 시트만 쓰기 대상으로 사용할 수 있습니다.');
    }
    const expected = props.getProperty('BRIEFING_EXECUTOR_EMAIL') || props.getProperty('CALENDAR_BRIEFING_ACCOUNT');
    if (expected) {
      const actual = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
      if (actual !== expected.trim().toLowerCase()) throw new Error('실행 계정 불일치: 연결한 회사 계정으로 실행하세요.');
    }
  }
  return value;
}

function escapeSlack_(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
