/**
 * 33. 판소리 — 지정 스레드 읽기 범위·수신자·업무 분류
 * - configureMyPansoriBriefing(): 실행 계정과 연결된 본인을 수신자로 추가. 속성 변경, DM 없음.
 * - previewPansoriBriefing(): 지정 두 스레드를 읽어 본인 분류 결과 확인. 저장·DM 없음.
 * - ENABLE_PANSORI_READ=true, PANSORI_RECIPIENT_IDS=["Slack ID"], PANSORI_THREADS(스레드 링크, 쉼표·줄바꿈 구분) 설정 시 활성.
 *   스레드 링크는 코드에 두지 않고 BOT_SETTINGS → applyBotSettings로 넣는다. 없으면 판소리 읽기만 건너뛴다.
 * - 11/24 고도화: 담당자 아래 설명·기한 보존. 답장 자동 판정·숨김 제거.
 *   ③ 스레드 목록 설정화 ④ 위클리 당일 10:30 '회의 준비' 줄 ⑤ "1) 2)" 할 일 목록 나누기 ⑥ 회신 대기 표시
 * - 수신자 명단에 있는 사람에게만 개인 요청·@here/@channel 공통 안내를 제공한다.
 * - 원본 시트·Slack 메시지·캘린더는 변경하지 않는다.
 * - 분류 수정: PANSORI_CATEGORIES의 이름·keywords 수정. 앞 규칙부터 적용.
 * - 완료·보류·일정 변경의 이전 요청 연결은 자동 확정하지 않는다.
 */
const PANSORI_CATEGORIES = Object.freeze([
  {name:'회의·안건·회의록', keywords:/회의(?!실)|스크럼|위클리|인수인계|온보딩|안건/},
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
        {sourceChannel:thread.channel,sourceHost:thread.host,sourceThreadTs:thread.ts,threadParentText:'판소리'})));
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
  // ③ 읽을 스레드는 설정값(링크)으로만 받는다. 리드가 아이템별 스레드로 나눠도 코드 수정 없이 추가한다.
  const threads = [];
  for (const url of String(props.getProperty('PANSORI_THREADS') || '').split(/[\s,]+/).filter(Boolean)) {
    let thread = null;
    try { thread = parseSlackMentionThreadUrl_(url); } catch (_) {}
    if (!thread) { console.log('PANSORI_THREADS에 Slack 스레드 링크가 아닌 값이 있음 | 판소리 읽기 건너뜀'); return null; }
    if (!threads.some(t => t.channel === thread.channel && t.ts === thread.ts)) threads.push(thread);
  }
  if (!threads.length || threads.length > 20) {
    console.log('PANSORI_THREADS(판소리 스레드 링크) 없음 또는 20개 초과 | 판소리 읽기 건너뜀');
    return null;
  }
  return {channel:threads[0].channel, ids:[...new Set(ids)].sort(), threads};
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
      // @here 글 아래에 특정 사람에게 따로 맡긴 줄이 섞여 있으면, 멘션받지 않은 사람에게는 @here 부분만 보인다(11/24).
      // 예: "@here 회의록 5시 전까지 업데이트" + "@A 님, 소음 테스트 요약 부탁" → 나머지는 회의록 부분만.
      const shared = !direct && common && owners.length ? pansoriHereLines_(section) : '';
      if (!direct && !(common && (!owners.length || shared))) return;
      // ① 여러 사람이 한 글에 배정되면 내 멘션 줄과 그 위 소제목만 남긴다. 내 줄에도 다른 사람이 같이 있으면 원문 확인.
      const own = direct && owners.length > 1 ? pansoriOwnLines_(section, recipient.id) : null;
      const ambiguous = owners.length > 1 && !own;
      output.push({pm:recipient.pm, recipientId:recipient.id, category:direct ? 'direct' : 'group', groupLabel:'판소리',
        pansori:true, pansoriAmbiguous:ambiguous, pansoriMine:own ? own.summary : '', ts:String(message.ts),
        text:own ? own.text : shared || section, user:String(message.user || ''), threadParentText:String(message.threadParentText || ''),
        threadKey:message.sourceChannel + '|' + message.sourceThreadTs + '|section:' + index,
        url:'https://' + String(message.sourceHost || 'slack.com') + '/archives/' + message.sourceChannel + '/p' +
          String(message.ts).replace('.','') + '?thread_ts=' + message.sourceThreadTs});
    });
  });
  return output;
}

// @here가 있는 앞부분(다른 사람을 처음 멘션하는 줄 전까지)만 돌려준다. 그 부분에 @here가 없으면 ''.
function pansoriHereLines_(section) {
  const lines = String(section || '').split('\n');
  const cut = lines.findIndex(line => /<@[UW][A-Z0-9]+/.test(line) && !/<!here>|<!channel>/.test(line));
  const head = (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trim();
  return /<!here>|<!channel>/.test(head) ? head : '';
}

function refinePansoriDigest_(item) {
  const text = item.text;
  const matches = PANSORI_CATEGORIES.filter(rule => rule.keywords.test(text));
  const uncertain = item.pansoriAmbiguous || /미정|보류|확정 후|의견|어떨까|가능하실|확인 필요|회신 대기/.test(text);
  item.task = '판소리';
  item.kind = uncertain ? '확인·회신 요청' : matches.length ? matches[0].name : '확인 필요';
  item.needsReview = uncertain || !matches.length;
  if (item.pansoriAmbiguous) { item.deadline = ''; item.summary = '담당 업무·기한 원문 확인'; }
  // ⑤ "1) … 2) …" 할 일 목록은 항목별로 나눠 DM에 한 줄씩 보인다(최대 5개).
  item.pansoriChecklist = pansoriChecklist_(text);
  // 회신을 요청하는 표현만 찾는다. 실제 회신·완료 여부는 알 수 없다.
  item.awaitingReply = item.category === 'direct' &&
    /부탁|전달\s*(?:주|해\s*주)|확인\s*(?:주|해\s*주)|회신|답변|가능하실|괜찮으실|어떠실|선호/.test(slackDigestPlainSafe_(text));
  // 완료와 요청이 함께 있을 수 있으므로 자동 완료 처리하지 않는다.
  return item;
}

// 04번이 없을 때(단독 테스트)도 동작하도록 멘션·링크 표기만 걷어낸다.
function slackDigestPlainSafe_(text) {
  return typeof slackDigestPlain_ === 'function' ? slackDigestPlain_(text) :
    String(text || '').replace(/<[^>|]+\|([^>]+)>/g, '$1').replace(/<[^>]+>/g, '');
}

// ① 내 멘션이 있는 줄 + 들여쓰기로 본 상위 소제목 + 글 제목([...])만 고른다.
// 내 줄에 다른 사람도 함께 멘션돼 있으면 null(누구 일인지 원문 확인).
function pansoriOwnLines_(section, id) {
  const lines = String(section).split('\n');
  const mine = new RegExp('<@' + id + '(?:\\|[^>]+)?>');
  const indent = line => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
  const picked = new Set(), ownLines = [];
  lines.forEach((line, i) => {
    if (!mine.test(line)) return;
    const others = Array.from(line.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g), m => m[1]).filter(other => other !== id);
    if (others.length) { ownLines.push(null); return; }
    picked.add(i); ownLines.push(i);
    // 내 담당 줄 아래의 설명·기한을 보존한다. 다른 담당자의 구간은 포함하지 않는다.
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (indent(lines[j]) <= indent(line)) break;
      const other = Array.from(lines[j].matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g), m => m[1]).some(value => value !== id);
      if (other) { ownLines.push(null); break; }
      picked.add(j);
    }
    let level = indent(line);
    for (let j = i - 1; j >= 0 && level > 0; j--) {
      if (!lines[j].trim()) continue;
      const lv = indent(lines[j]);
      if (lv < level) { picked.add(j); level = lv; }
    }
  });
  if (!ownLines.length || ownLines.includes(null)) return null;
  const titleAt = lines.findIndex(line => line.trim());
  if (titleAt >= 0 && /^\*?\[[^\]]+\]\*?$/.test(lines[titleAt].trim())) picked.add(titleAt);
  const clean = line => slackDigestPlainSafe_(line.replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g, ''))
    .replace(/[*_~`]/g, '').replace(/^[\s•◦▪︎\-·]+/, '').replace(/[\s\-–—:]+$/, '').replace(/\s+/g, ' ').trim();
  const order = [...picked].sort((a, b) => a - b);
  // 멘션 뒤 "님, …"으로 시작하는 인사 줄은 원문에는 남기고 요약에서는 뺀다. 요약은 원문 줄 순서를 따른다.
  const greeting = i => ownLines.includes(i) && /^님\b|^님[,\s]/.test(clean(lines[i]));
  const summary = order.filter(i => i !== titleAt && !greeting(i)).map(i => clean(lines[i])).filter(Boolean).join(' · ');
  return {text:order.map(i => lines[i]).join('\n'),
    summary:Array.from(summary).slice(0, 80).join('') + (Array.from(summary).length > 80 ? '…' : '')};
}

// ⑤ "1) 영상 음원 재생 목록 생성" 같은 번호 목록을 뽑는다. 2개 이상일 때만 목록으로 본다.
function pansoriChecklist_(text) {
  const items = [];
  String(text || '').split('\n').forEach(line => {
    const m = slackDigestPlainSafe_(line).replace(/[*_~`]/g, '').match(/^[\s•◦▪︎\-]*(\d{1,2})[).]\s*(.{2,60}?)\s*$/);
    if (m && items.length < 5 && !items.some(item => item.n === m[1])) items.push({n:m[1], text:m[2].trim()});
  });
  return items.length >= 2 ? items.map(item => item.n + ') ' + item.text) : [];
}

// 답장으로 개별 요청의 처리 상태를 추정하지 않는다.

// ④ 위클리 당일 10:30: 오늘 캘린더에 판소리 회의가 있고, 아직 답하지 않은 회의록 요청이 있으면 한 줄 안내.
// 캘린더는 PM이 연결한 저장본(BOT_CALENDAR_PERSONAL)을 읽기만 한다. 못 읽으면 줄을 생략한다.
function pansoriMeetingPrepLine_(props, route, items, day, slot) {
  if (slot !== '11:00') return '';
  const since = Date.parse(day + 'T00:00:00+09:00') - 7 * 86400000;
  const requests = items.filter(item => item.pm === route.pm && item.pansori &&
    /회의록/.test(slackDigestPlainSafe_(item.text)) && Number(item.ts) * 1000 >= since);
  if (!requests.length) return '';
  try {
    const binding = selfCalendarRegistry_(props).find(row => row.slackId === route.id);
    const sheet = binding && selfCalendarStore_(props, false);
    const rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
    const row = binding && rows.find(r => r[0] === binding.email);
    const events = row ? (JSON.parse(row[1]).events || []) : [];
    const meeting = events.filter(e => !e.allDay && /pansori|판소리/i.test(String(e.title || '')) &&
      Utilities.formatDate(new Date(e.start), BRIEFING.timezone, 'yyyy-MM-dd') === day).sort((a, b) => a.start - b.start)[0];
    if (!meeting) return '';
    const latest = requests.sort((a, b) => Number(b.ts) - Number(a.ts))[0];
    return '\n🗂 *판소리 회의 준비*\n• ' + Utilities.formatDate(new Date(meeting.start), BRIEFING.timezone, 'HH:mm') + ' ' +
      escapeSlack_(String(meeting.title).replace(/[\r\n]+/g, ' ')) + ' 전 · <' + latest.url + '|회의록 업데이트 요청 ' +
      slackDigestPostedAt_(latest.ts) + '>';
  } catch (error) { console.log('판소리 회의 준비 줄 생략 | ' + error.message); return ''; }
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
