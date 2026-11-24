/**
 * 33. 판소리 — 지정 스레드 읽기 범위·수신자·업무 분류
 * - configureMyPansoriBriefing(): 실행 계정과 연결된 본인을 수신자로 추가. 속성 변경, DM 없음.
 * - previewPansoriBriefing(): 지정 두 스레드를 읽어 본인 분류 결과 확인. 저장·DM 없음.
 * - ENABLE_PANSORI_READ=true, PANSORI_RECIPIENT_IDS=["Slack ID"] 설정 시 활성.
 * - 수신자 명단에 있는 사람에게만 개인 요청·@here/@channel 공통 안내를 제공한다.
 * - 원본 시트·Slack 메시지·캘린더는 변경하지 않는다.
 * - 분류 수정: PANSORI_CATEGORIES의 이름·keywords 수정. 앞 규칙부터 적용.
 * - 완료·보류·일정 변경의 이전 요청 연결은 자동 확정하지 않는다.
 */
const PANSORI_CATEGORIES = Object.freeze([
  {name:'회의·안건·회의록', keywords:/회의|스크럼|위클리|인수인계|온보딩|안건/},
  {name:'모집·스크리닝·참여자 안내', keywords:/모집|스크리닝|리크루팅|참여자 안내|헤즈업/},
  {name:'가이드·계약 문서 검토', keywords:/가이드|계약|\bSA\b|\bSOW\b|\bICF\b|\bNDA\b/i},
  {name:'녹음 준비·환경 테스트·운영 시트', keywords:/녹음|소음|타임테이블|운영 시트|Apple TV|아이폰/i},
  {name:'데이터 검수·납품·정산', keywords:/검수|납품|정산|\bBMS\b|\bWSP\b/i},
]);

function configureMyPansoriBriefing() {
  const props = PropertiesService.getScriptProperties();
  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const routes = selfCalendarRegistry_(props).filter(r => r.email === email && r.sendEnabled);
  if (!email || routes.length !== 1) throw new Error('본인 회사 계정과 봇 명단 연결을 확인하세요.');
  const old = props.getProperty('PANSORI_RECIPIENT_IDS');
  const ids = old ? JSON.parse(old) : [];
  if (!Array.isArray(ids) || ids.some(id => !/^[UW][A-Z0-9]{8,}$/.test(id))) throw new Error('기존 판소리 수신자 설정을 확인하세요.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('다른 봇 작업 진행 중. 잠시 후 재실행하세요.');
  try {
    props.setProperty('PANSORI_RECIPIENT_IDS', JSON.stringify([...new Set(ids.concat(routes[0].slackId))]));
    props.setProperty('ENABLE_PANSORI_READ', 'true');
  } finally { lock.releaseLock(); }
  console.log('본인 판소리 수신 연결 완료 | 다음 수집 완료 후 정기 브리핑 반영 | Slack 발송 없음');
}

function previewPansoriBriefing() {
  const props = PropertiesService.getScriptProperties();
  const route = readPansoriRoute_(props);
  if (!route) throw new Error('먼저 configureMyPansoriBriefing으로 연결하세요.');
  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const people = selfCalendarRegistry_(props).filter(r => r.email === email && r.sendEnabled && route.ids.includes(r.slackId));
  if (!email || people.length !== 1) throw new Error('실행 계정 본인 수신 연결을 확인하세요.');
  const recipients = people.map(r => ({pm:r.pm,id:r.slackId}));
  const token = requiredProperty_(props, 'SLACK_BOT_TOKEN');
  const newest = Date.now()/1000, oldest = newest - 7*86400;
  const messages = [], budget = {calls:0,maxCalls:20,deadline:Date.now()+90000};
  route.threads.forEach(thread => {
    let cursor = '';
    do {
      const result = slackMentionReadApi_('conversations.replies', {channel:thread.channel,ts:thread.ts,
        oldest:String(oldest),latest:String(newest),limit:'100',cursor}, token, budget);
      if (!Array.isArray(result.messages)) throw new Error('판소리 스레드 응답 형식 오류');
      result.messages.filter(m => Number(m.ts)>=oldest && Number(m.ts)<=newest).forEach(m => messages.push(Object.assign({},m,
        {sourceChannel:thread.channel,sourceThreadTs:thread.ts,threadParentText:'판소리'})));
      cursor = result.response_metadata && result.response_metadata.next_cursor || '';
      if (result.has_more && !cursor) throw new Error('조회가 불완전합니다. 미리보기 중지');
    } while (cursor);
  });
  const records = messages.flatMap(m => pansoriMentionRecords_(m,recipients,route));
  const items = buildSlackDigestItems_(records);
  console.log(formatPersonalSlackDigest_(items,Utilities.formatDate(new Date(),BRIEFING.timezone,'yyyy-MM-dd'),'11:00',0));
  console.log('판소리 지정 스레드 2개 조회·본인 분류 완료 | 저장·Slack 발송 없음');
}

function readPansoriRoute_(props) {
  if (props.getProperty('ENABLE_PANSORI_READ') !== 'true') return null;
  let ids;
  try { ids = JSON.parse(props.getProperty('PANSORI_RECIPIENT_IDS') || 'null'); } catch (_) {}
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !/^[UW][A-Z0-9]{8,}$/.test(id))) {
    throw new Error('PANSORI_RECIPIENT_IDS에 판소리 수신자 Slack ID의 JSON 배열을 입력하세요.');
  }
  return {channel:'C0000000001', ids:[...new Set(ids)].sort(), threads:
    ['1700000000.000001','1700000000.000002'].map(ts => ({host:'example.slack.com',channel:'C0000000001',ts}))};
}

// 명시된 담당자 블록만 분리한다. cc/인용/취소선은 담당자 판정에서 제외한다.
function pansoriMentionRecords_(message, recipients, route) {
  const text = String(message.text || '').replace(/~[^~\n]*~/g, '').split('\n')
    .filter(line => !/^\s*>/.test(line)).join('\n');
  const body = text.replace(/\(?\bcc\s*[.:：]?[\s\S]*$/i, '');
  const ids = value => [...new Set(Array.from(value.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g), m => m[1]))];
  const sections = body.split(/\n(?=\s*(?:[•◦▪︎\-*]\s*)?담당자\s*[:：])/);
  const scoped = sections.length > 1 ? sections.slice(1) : [body];
  const common = /<!here>|<!channel>/.test(body);
  const output = [];
  recipients.filter(r => route.ids.includes(r.id)).forEach(recipient => {
    scoped.forEach((section, index) => {
      const owners = ids(section);
      const direct = owners.includes(recipient.id);
      if (!direct && !(common && !owners.length)) return;
      const ambiguous = owners.length > 1;
      output.push({pm:recipient.pm, category:direct ? 'direct' : 'group', groupLabel:'판소리',
        pansori:true, pansoriAmbiguous:ambiguous, ts:String(message.ts),
        text:section, user:String(message.user || ''), threadParentText:String(message.threadParentText || ''),
        threadKey:message.sourceChannel + '|' + message.sourceThreadTs + '|section:' + index,
        url:'https://example.slack.com/archives/' + message.sourceChannel + '/p' + String(message.ts).replace('.','') +
          '?thread_ts=' + message.sourceThreadTs});
    });
  });
  return output;
}

function refinePansoriDigest_(item) {
  const text = item.text;
  const matches = PANSORI_CATEGORIES.filter(rule => rule.keywords.test(text));
  const uncertain = item.pansoriAmbiguous || /미정|보류|확정 후|의견|어떨까|가능하실|확인 필요|회신 대기/.test(text);
  item.task = '판소리';
  item.kind = uncertain ? '확인·회신 요청' : matches.length ? matches[0].name : '확인 필요';
  item.needsReview = uncertain || !matches.length;
  if (item.pansoriAmbiguous) { item.deadline = ''; item.summary = '담당 업무·기한 원문 확인'; }
  // 완료와 요청이 함께 있을 수 있으므로 자동 완료 처리하지 않는다.
  return item;
}

// DM 선택 시에만 제외한다. 원문/저장 자료/실제 업무 완료 상태는 바꾸지 않는다.
function pansoriPastMeetingNotice_(item, day) {
  const text = String(item.text || '').replace(/<https?:\/\/[^>]+>/g, '');
  if (!/회의|스크럼|위클리|온보딩|인수인계/.test(text)) return false;
  // 회의 관련 실행 업무와 반복 일정은 초대 만료로 취급하지 않는다.
  if (/회의록|안건|작성|제출|검토|매주|매월|매일|차주|다음\s*주|이번\s*주|모레/.test(text)) return false;
  if (!/초대|예약|일정|일시|온보딩|인수인계/.test(text)) return false;
  const stamp = Number(item.ts);
  if (!Number.isFinite(stamp)) return false;
  const posted = new Date(stamp * 1000 + 9 * 3600000).toISOString().slice(0, 10);
  const dates = [...text.matchAll(/(?:\d{4}[-/.])?\d{1,2}[/.]\d{1,2}(?!\d)|\d{1,2}월\s*\d{1,2}일/g)]
    .map(m => slackDigestDueDay_({deadline:m[0],ts:item.ts}));
  // 숫자로 명시된 날짜는 모두 유효하고 과거인 경우에만 숨긴다.
  if (dates.length) return dates.every(date => date && date < day);
  const relative = text.match(/내일|익일|금일|오늘/);
  if (relative) {
    const due = slackDigestDueDay_({deadline:relative[0] === '금일' ? '오늘' : relative[0],ts:item.ts});
    return Boolean(due && due < day);
  }
  // 날짜 없이 시각만 있는 직접 초대는 작성 당일로 안내된 명시적 초대만 처리한다.
  if (/\d{1,2}:\d{2}|\d{1,2}시/.test(text) && /초대\s*드렸|금일|오늘/.test(text) &&
      !/이후|추후|미정|변경\s*예정|요일/.test(text)) return posted < day;
  return false;
}
