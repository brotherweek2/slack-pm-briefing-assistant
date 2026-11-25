/**
 * 33. 판소리 — 지정 스레드 읽기 범위·수신자·업무 분류
 * - ⚠️ configureMyPansoriBriefing(): 회사 계정으로 1회 실행. 봇 명단의 본인을 수신자로 추가. 속성 변경, DM 없음.
 * - 🔍 previewPansoriBriefing(): 연결 후 지정 스레드를 직접 읽어 분류 로그 확인. 저장·DM 없음.
 * - 🔍 checkPansoriClassification(): 저장된 수집본의 판소리 글마다 누구에게 어떻게 판정됐는지·의심 사례 점검표. Slack 조회·저장·DM 없음.
 * - ENABLE_PANSORI_READ=true, PANSORI_RECIPIENT_IDS=["Slack ID"], PANSORI_THREADS(스레드 링크, 쉼표·줄바꿈 구분) 설정 시 활성.
 *   스레드 링크는 코드에 두지 않고 BOT_SETTINGS → applyBotSettings로 넣는다. 없으면 판소리 읽기만 건너뛴다.
 * - 읽기 → 담당자별 추출 → 분류 → 회차별 선택 → 개인 DM 순서로 처리한다.
 * - 담당자 하위 설명·기한을 보존한다. 경계가 불명확하면 원문 확인으로 둔다.
 * - 스레드 활동으로 답장·완료를 추정하지 않는다. 14시는 새 항목만, 17시는 회신 요청 재안내.
 * - 스레드 설정화·회의 준비·번호 목록은 아래 내부 함수에서 처리한다.
 * - 수신자 명단에 있는 사람에게만 개인 요청·@here/@channel 공통 안내를 제공한다.
 * - 원본 시트·Slack 메시지·캘린더는 변경하지 않는다.
 * - 분류 수정: PANSORI_CATEGORIES의 이름·keywords 수정. 앞 규칙부터 적용.
 * - 완료·보류·일정 변경의 이전 요청 연결은 자동 확정하지 않는다.
 *
 * 내부 함수(직접 실행하지 않음)
 * - pansoriClassificationReport_(snapshot, people, route, day): 점검표 줄을 만든다(멘션된 사람 전원 기준, 의심 표시).
 * - readPansoriRoute_(props): 활성·수신자·스레드 설정 검증. 링크가 없거나 잘못되면 판소리 읽기 생략.
 * - pansoriMentionRecords_(message, recipients, route): 개인/공통 대상과 담당 구간을 추출한다.
 * - pansoriHereLines_(section): 공통 앞부분에서 개인 요청을 분리한다.
 * - refinePansoriDigest_(item): 업무 유형·번호 목록·회신 요청 표현을 판별한다.
 * - slackDigestPlainSafe_(text): 분류 전에 Slack 서식을 걷어낸다.
 * - pansoriOwnLines_(section, id): 본인 담당 줄·상위 제목·하위 설명과 기한을 보존한다.
 * - pansoriChecklist_(text, id): 번호 목록을 최대 5개 발췌한다. 본인 담당 항목은 "(내 담당)", 다른 담당자 멘션은 뺀다.
 * - pansoriMeetingPrepLine_(props, route, items, day, slot): 오전 회의 준비 안내. 회의록과 회의의 정확한 날짜 대응은 추가 점검 대상.
 * - pansoriPastMeetingNotice_(item, day): 명확히 지난 회의 초대를 DM 선택에서만 제외한다.
 */
const PANSORI_CATEGORIES = Object.freeze([
  {name:'회의·안건·회의록', keywords:/회의(?!실)|스크럼|위클리|인수인계|온보딩|안건/},
  {name:'모집·스크리닝·참여자 안내', keywords:/모집|스크리닝|리크루팅|참여자 안내|헤즈업/},
  {name:'가이드·계약 문서 검토', keywords:/가이드|계약|\bSA\b|\bSOW\b|\bICF\b|\bNDA\b/i},
  {name:'녹음 준비·환경 테스트·운영 시트', keywords:/녹음|소음|음원|타임테이블|운영 시트|Apple TV|아이폰/i},
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

// 🔍 판정 점검표: 저장된 수집본의 판소리 글마다 누구에게 어떤 종류·기한으로 붙었는지와 의심 사례를 로그로 보인다.
// 글에 멘션된 사람은 수신자 설정과 상관없이 모두 판정해 본다(실제 DM 수신자는 바뀌지 않음). Slack 조회·저장·DM 없음.
// 리드 글이 20~30개 쌓였을 때 한 번 돌려 "⚠️" 줄부터 원문과 비교한다.
function checkPansoriClassification() {
  const props = PropertiesService.getScriptProperties();
  const route = readPansoriRoute_(props);
  if (!route) throw new Error('판소리 읽기가 꺼져 있거나 PANSORI_THREADS가 비어 있습니다.');
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const snapshot = readBbpmSnapshot_(props, bot);
  if (!snapshot) throw new Error('저장된 Slack 수집본이 없습니다. collectBbpmSnapshot 뒤 다시 실행하세요.');
  const people = readBotRows_(requireBotSheet_(bot, BOT_WORKBOOK.usersTab, BOT_WORKBOOK.userHeaders), BOT_WORKBOOK.userHeaders.length)
    .map(row => ({pm:String(row[0] || '').trim(), id:String(row[1] || '').trim()})).filter(p => p.pm && p.id);
  const day = Utilities.formatDate(new Date(), BRIEFING.timezone, 'yyyy-MM-dd');
  console.log(pansoriClassificationReport_(snapshot, people, route, day).join('\n'));
}

function pansoriClassificationReport_(snapshot, people, route, day) {
  const inThread = m => route.threads.some(t => t.channel === m.sourceChannel && t.ts === m.sourceThreadTs);
  const messages = (snapshot.messages || []).filter(inThread).sort((a, b) => Number(a.ts) - Number(b.ts));
  const idsIn = text => [...new Set(Array.from(String(text || '').matchAll(/<@([UW][A-Z0-9]+)/g), m => m[1]))];
  const ids = [...new Set(route.ids.concat(messages.flatMap(m => idsIn(m.text))))];
  const nameOf = id => (people.find(p => p.id === id) || {}).pm || '명단 밖 …' + id.slice(-4);
  const recipients = ids.map(id => ({pm:nameOf(id), id}));
  const wide = Object.assign({}, route, {ids});
  const lines = ['[판소리 판정 점검표] 글 ' + messages.length + '개 · 판정 대상 ' + ids.length + '명(멘션된 사람 전원, 실제 수신자 ' +
    route.ids.length + '명) · 수집본 ' + Utilities.formatDate(new Date(snapshot.meta.newest * 1000), BRIEFING.timezone, 'MM/dd HH:mm') +
    ' 기준 · 읽기만, 저장·DM 없음'];
  let flagged = 0;
  messages.forEach(m => {
    const text = String(m.text || '');
    // 제목: 인사 줄("○○ 님, 안녕하세요")은 건너뛴 첫 줄
    const plainLines = slackDigestPlainSafe_(text).split('\n').map(line => line.trim()).filter(Boolean);
    const title = plainLines.find(line => !/^@?\S*\s*님[,!.\s]|^님[,!.\s]?|안녕하세요/.test(line)) || plainLines[0] || '';
    const here = /<!here>|<!channel>/.test(text);
    const mentions = idsIn(text).length;
    const items = buildSlackDigestItems_(pansoriMentionRecords_(m, recipients, wide));
    const flags = [];
    if ((here || mentions) && !items.length) flags.push('멘션이 있는데 아무에게도 안 붙음');
    if (mentions && !here && items.length < mentions) flags.push('멘션 ' + mentions + '명 중 ' + items.length + '명만 붙음');
    if (items.some(i => i.pansoriAmbiguous)) flags.push('담당 구분 실패(원문 확인)');
    if (items.some(i => i.kind === '확인 필요')) flags.push('업무 종류 못 정함');
    if (items.some(i => /여러 개/.test(i.deadline || ''))) flags.push('기한 여러 개');
    if (flags.length) flagged++;
    lines.push('', (flags.length ? '⚠️ ' : '• ') + slackDigestPostedAt_(m.ts) + ' ' + Array.from(title).slice(0, 40).join('') +
      ' | 멘션 ' + mentions + '명' + (here ? ' + @here' : '') + (flags.length ? ' | ' + flags.join(' · ') : ''));
    items.forEach(i => lines.push('   → ' + i.pm + ' · ' + (i.category === 'direct' ? '직접' : '공통') + ' · ' + i.kind +
      (i.deadline ? ' · 기한 ' + i.deadline : '') + (i.awaitingReply ? ' · 회신 요청' : '') +
      (i.pansoriMine ? ' · 내 담당: ' + Array.from(i.pansoriMine).slice(0, 40).join('') : '') +
      ((i.pansoriChecklist || []).length ? ' · 할 일 ' + i.pansoriChecklist.length + '개' : '') +
      (pansoriPastMeetingNotice_(i, day) ? ' · 지난 회의라 DM에서 숨김' : '')));
    if (!items.length) lines.push('   → (붙은 사람 없음)');
  });
  lines.push('', '의심 ' + flagged + '건 / ' + messages.length + '건. ⚠️ 줄은 Slack 원문과 비교해 규칙 보완이 필요한지 판단하세요.');
  return lines;
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

// 담당자 블록을 먼저 나누고, 필요하면 본인 줄과 하위 설명·기한을 추출한다. cc/인용/취소선 제외.
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
  item.pansoriChecklist = pansoriChecklist_(text, item.recipientId);
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

// 본인 멘션 줄·상위 제목·하위 설명과 기한을 함께 보존한다. 들여쓰기가 끝나면 담당 구간을 닫는다.
// 내 줄에 다른 사람도 함께 멘션돼 있으면 null(누구 일인지 원문 확인).
function pansoriOwnLines_(section, id) {
  const lines = String(section).split('\n');
  const mine = new RegExp('<@' + id + '(?:\\|[^>]+)?>');
  const indent = line => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
  const picked = new Set(), ownLines = [];
  // 인사·호칭 줄("@A, @B 님,", "@A @B 님, 명일 일정입니다")은 담당 배정이 아니므로 판단에서 뺀다(11/25).
  // 요청 표현(부탁·해 주시면 등)이 있으면 함께 맡긴 일로 보고 그대로 판단한다.
  const address = line => /^\s*(?:<@[UW][A-Z0-9]+(?:\|[^>]+)?>[\s,·]*)+님/.test(line) &&
    !/부탁|해\s*주|주시면|주세요|바랍니다|요청/.test(line.replace(/<@[^>]+>/g, ''));
  lines.forEach((line, i) => {
    if (!mine.test(line) || address(line)) return;
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
  // 멘션은 뒤따르는 "님"까지 지운다("- @PM A 님" → "-"가 남았다가 아래에서 정리됨).
  const clean = line => slackDigestPlainSafe_(line.replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>\s*님?/g, ''))
    .replace(/[*_~`]/g, '').replace(/^[\s•◦▪︎\-·]+/, '').replace(/[\s\-–—:]+$/, '').replace(/\s+/g, ' ').trim();
  const order = [...picked].sort((a, b) => a - b);
  // 멘션 뒤 "님, …"으로 시작하는 인사 줄은 원문에는 남기고 요약에서는 뺀다. 요약은 원문 줄 순서를 따른다.
  const greeting = i => ownLines.includes(i) && /^님\b|^님[,\s]/.test(clean(lines[i]));
  const summary = order.filter(i => i !== titleAt && !greeting(i)).map(i => clean(lines[i])).filter(Boolean).join(' · ');
  return {text:order.map(i => lines[i]).join('\n'),
    summary:Array.from(summary).slice(0, 80).join('') + (Array.from(summary).length > 80 ? '…' : '')};
}

// ⑤ "1) 영상 음원 재생 목록 생성" 같은 번호 목록을 뽑는다. 2개 이상일 때만 목록으로 본다.
function pansoriChecklist_(text, id) {
  const items = [];
  String(text || '').split('\n').forEach(line => {
    // 항목 끝의 담당자 멘션: 본인이면 "(내 담당)", 다른 사람이면 뺀다("- 님"만 남던 문제, 11/25).
    const raw = line.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>\s*님?/g, (_m, who) => who === id ? '\u0001' : '\u0002');
    const plain = slackDigestPlainSafe_(raw).replace(/[*_~`]/g, '')
      .replace(/[\s\-–—:]*\u0001/g, ' (내 담당)').replace(/[\s\-–—:]*\u0002/g, '');
    const m = plain.match(/^[\s•◦▪︎\-]*(\d{1,2})[).]\s*(.{2,60}?)\s*$/);
    if (m && items.length < 5 && !items.some(item => item.n === m[1])) items.push({n:m[1], text:m[2].trim()});
  });
  return items.length >= 2 ? items.map(item => item.n + ') ' + item.text) : [];
}

// 답장으로 개별 요청의 처리 상태를 추정하지 않는다.

// 10:30: 오늘 판소리 회의와 최근 7일 회의록 요청을 함께 안내한다. 실제 답장 여부는 판단하지 않는다.
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
