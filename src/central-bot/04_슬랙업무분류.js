/**
 * 04. 슬랙업무분류 — 멘션을 업무별로 묶고 DM에 넣을 항목 고르기
 *
 * 알아둘 것
 * - 발송 이력은 읽음·완료 기록이 아니다. 사람별 최근 150개 해시만 보관한다.
 *
 * 직접 실행 (🔍 조회만 · ⚠️ 보내거나 바꿈 · ⏰ 자동 호출)
 *
 * 내부 함수 (직접 실행하지 않음)
 * - slackDigestPlain_(text): 링크·멘션·서식을 덜어내 검색 가능한 본문을 만든다
 * - slackDigestWorkNames_(text): 제목과 업무 키워드에서 HA-CV·HT·MTPE 등의 작업 종류를 찾는다
 * - classifySlackDigest_(record): 요청·업무 유형·프로젝트·언어쌍·명시 기한·불확실성을 판별한다
 * - slackDigestDeadline_(line): 원문에 적힌 날짜·시간 표현만 짧게 추출한다
 * - buildSlackDigestItems_(records): 동일 PM·범위·스레드·업무·프로젝트의 반복 안내를 묶고 링크·조건을 보존한다
 * - selectPersonalSlackItems_(pm, items, seen, day, slot): 새·변경 안내와 명시된 오늘 기한, 저녁의 내일 기한을 선택한다
 * - formatPersonalSlackDigest_(items, day, slot, attachedCount): 개인·BBPM을 구분하고 키워드 링크·원문 날짜·기한을 표시한다
 * - slackDigestDueLabel_(due, raw): 날짜를 계산할 수 있는 기한은 '10/22(목)'로 통일한다(익일·내일·'10/22 (목)' 혼용 방지)
 * - slackDigestDetailLine_(item): 누르기 전에 무슨 일인지 알 수 있게 작성자와 원문 첫 구절을 하위 줄로 붙인다
 * - slackAuthorShortName_(name): 회사 표시 이름이 '이름/팀/아이디' 형식이라 앞의 이름만 쓴다
 * - slackDigestSnippetText_(snippet): [제목]은 그대로, 본문 구절은 따옴표로 감싼다
 * - slackDigestSnippet_(item): 고르는 순서: 원문의 [제목] → 멘션·인사말을 뺀 내용 있는 첫 줄 → (답글에 내용이 없으면) 스레드 부모의 [제목]
 * - attachSlackToWorkLines_(workText, items, day): 시트 업무와 같은 종류의 Slack 항목을 그 업무 줄 아래로 옮긴다
 * - attachSlackAuthorNames_(items, token, readOnly): 작성자 Slack ID → 표시 이름
 * - slackDigestDeadlineText_(item, due): DM 기한 표기 공통: 짧고 명시된 기한만 통일 표기, 여러 개·불명확하면 '원문 확인'으로 경고를 남긴다
 * - slackDigestPostedAt_(ts): Slack 메시지 시각을 한국 시간 월/일로 표시한다
 * - slackDigestDueDay_(item): 명시 날짜나 원문 작성일 기준 상대 날짜를 판별하고 불명확하면 비워 둔다
 * - slackDigestDisplayKeywords_(item): 작업명·업무·프로젝트·언어쌍·주의 조건을 짧은 링크 제목으로 만든다
 * - slackDigestFingerprint_(item): 원문 링크·본문·부모 문맥을 해시로 바꿔 변경 여부를 구분한다
 * - readSlackDigestSeen_(props, id): 수신자별 최근 발송 해시를 읽고 형식을 확인한다
 * - markSlackDigestSeen_(props, id, old, items, current): 성공한 DM에 표시한 항목의 해시만 스크립트 속성에 저장한다
 */

/** 무료 규칙 기반 분류. 원문에 없는 담당자·기한·완료를 생성하지 않는다. */
const SLACK_DIGEST = Object.freeze({ summaryChars: 130, maxSeen: 150 });

function slackDigestPlain_(text) {
  return slackMentionText_(text).replace(/<https?:\/\/[^>|]+(?:\|([^>]+))?>/g, (_, label) => label || '')
    .replace(/https?:\/\/\S+/g, '').replace(/<@[^>]+>|<!subteam\^[^>]+>/g, '')
    .replace(/[*~]/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function slackDigestWorkNames_(text) {
  const plain = slackDigestPlain_(text).replace(/\bLCT[-_]\d[\w-]*/gi, '자료명');
  // 작업 공지 제목을 우선한다. 본문의 데이터셋 이름을 별도 작업 종류로 섞지 않는다.
  const title = plain.split('\n').map(line => line.trim()).find(Boolean) || '';
  const titleWorks = findSlackKeywordHits_(title, 'work').map(rule => rule.category);
  if (titleWorks.length === 1 && /검수|검토|일정|납품|^\s*\[/.test(title)) return titleWorks;
  const works = findSlackKeywordHits_(plain, 'work').map(rule => rule.category);
  return [...new Set(works)].filter(name => name !== 'HA-C' || !works.includes('HA-CV') ||
    /HA[-_]C(?!V)|\bHAC\b/i.test(plain));
}

function classifySlackDigest_(record) {
  const original = slackDigestPlain_(record.text);
  const excludedLid = /\bLID\b/i.test(original);
  const text = original.replace(/\bLID\b\s*(?:및\s*|and\s*|&\s*|\/\s*)?/gi, '');
  const parentWorks = slackDigestWorkNames_(record.threadParentText || '');
  const ownWorks = slackDigestWorkNames_(text);
  let kind = '확인 필요';
  let rank = 6;
  let summary = '';
  const requests = findSlackKeywordHits_(text, 'request');
  const completed = findSlackKeywordHits_(text, 'completed');
  const cancelled = findSlackKeywordHits_(text, 'cancel');
  const categories = findSlackKeywordHits_(text, 'category');
  const title = text.split('\n').map(line => line.trim()).find(Boolean) || '';
  const meetingRule = categories.find(rule => rule.category === '회의·세션');
  const meetingMinutes = !!meetingRule && /회의록\s*(?:작성|준비|제출)|(?:작성|준비|제출)[^\n]{0,12}회의록/.test(title);
  const toolGuide = getSlackKeywordRules_().some(rule => rule.enabled && rule.type === 'category' &&
    rule.category === '운영 기준') && /플러그인|자동화\s*도구|스킬/.test(title) && /공유|활용|사용\s*안내/.test(title);
  const abuse = categories.some(rule => rule.category === '어뷰저 관리');
  const noticeRuleEnabled = getSlackKeywordRules_().some(rule => rule.enabled &&
    rule.type === 'category' && rule.category === '시트·담당 변경');
  const notice = !abuse && (categories.some(rule => rule.category === '시트·담당 변경') ||
    (noticeRuleEnabled && /중앙\s*탭|담당(?:자)?[\s\S]{0,20}변경|시트\s*사용(?:을|은|이)?\s*(?:중지|중단|가능|재개)/.test(text)));
  if (excludedLid && !categories.length) return null;
  const matchedKinds = categories.map(rule => rule.category);
  if (completed.length && !requests.length && !cancelled.length && !notice) return null;
  if (findSlackKeywordHits_(text, 'noise').length && !notice && !categories.length && !requests.length &&
      !/언급.{0,8}누락|멘션.{0,8}누락|대상.{0,8}추가/.test(text)) return null;
  const policy = categories.some(rule => rule.category === '운영 기준') &&
    /종합적으로 고려|균등한 분배|업무 역량|할당 원칙|배정 원칙/.test(text);
  if (abuse) {
    kind = '어뷰저 관리'; rank = 1;
    summary = text.split('\n').map(line => line.trim()).find(line => /어뷰저|캐시아웃/.test(line)) || '';
  } else if (meetingMinutes) {
    kind = '회의록 작성'; rank = meetingRule.priority;
  } else if (toolGuide) {
    kind = '도구·사용 안내'; rank = 5;
    summary = '자동화 도구 활용 안내';
  } else if (notice) {
    kind = '운영 변경'; rank = 5;
    summary = /시트\s*사용(?:을|은|이)?\s*(?:가능|재개)/.test(text) ? '유저 관리 시트 사용 재개' :
      /사용.{0,5}(중단|중지)/.test(text) ? '유저 관리 시트 사용 중단' :
      /원상\s*복구|원복/.test(text) ? '시트 원상 복구 안내' :
      /담당|재배정/.test(text) ? '담당자 재배정' + (/변경.{0,8}완료|재배정.{0,8}완료/.test(text) ? ' 완료' : ' 안내') :
      '시트 변경 안내';
  } else if (/참여하지\s*않은[\s\S]*참여[\s\S]*부탁/.test(text)) {
    kind = '참여 요청'; rank = 4; summary = '미참여자 참여 요청';
  } else if (/언급.{0,8}누락|멘션.{0,8}누락|대상.{0,8}추가/.test(text)) {
    kind = '대상 확인'; rank = 4;
    summary = '대상 멘션 보완 — 스레드의 업무 안내 확인';
  } else if (policy) {
    kind = '운영 기준'; rank = 5;
    summary = /검수/.test(text) ? '검수 업무 할당 기준·유의사항 확인' : '업무 운영 기준·유의사항 확인';
  } else if (categories.some(rule => rule.category === '예비 작업자·레벨 검토') &&
      /투입|레벨\s*부여/.test(text) && categories.some(rule => rule.category === '헤즈업·참여 확인')) {
    kind = '예비 작업자 검토·헤즈업'; rank = 2;
  } else if (categories.length) {
    kind = categories[0].category; rank = categories[0].priority;
  } else if (/죄송|감사|확인했습니다|확인하였습니다|가능합니다|가능하겠습니다/.test(text) &&
      !/요청|부탁|기한|마감|제출|변경|진행|확인해/.test(text)) {
    return null;
  }
  const lines = text.split(/\n|(?<=[.!?])\s+/).map(line => line.replace(/^[\s•▪◦\-:]+/, '').trim())
    .filter(line => line.length > 5 && !/^안녕하세요|^확인 대상|^작성자|^우선순위|^참고 URL/.test(line));
  if (!summary) {
    const actionable = lines.filter(line => /검수|검토|요청|부탁|제출|확인|변경|종료|기한|마감|참석|중지|어뷰저/.test(line));
    summary = actionable[0] || lines[0] || '원문 확인';
  }
  // 운영 정책은 부모 글의 MTPE/HT 배정과 관계없는 일반 공지일 수 있다.
  const subjectOnly = meetingMinutes || toolGuide;
  const subjectWorks = subjectOnly ? slackDigestWorkNames_(title) : ownWorks;
  const inherited = !subjectWorks.length && !policy && !subjectOnly && parentWorks.length === 1;
  const works = subjectWorks.length ? subjectWorks : inherited ? parentWorks : [];
  const task = meetingMinutes && /\bScrum\b|스크럼/i.test(title) ? 'NAC Scrum' :
    works.length > 1 ? '여러 작업' : works.length ? works[0] + (inherited ? '·스레드 문맥' : '') :
    policy ? '공통 운영' : '작업명 확인 필요';
  const needsReview = kind === '확인 필요' ||
    (!abuse && !notice && !policy && (works.length > 1 || cancelled.length > 0));
  if (needsReview) { kind = '확인 필요'; rank = 6; }
  const pairs = [...new Set(text.match(/[a-z]{2}_[A-Z]{2}-[a-z]{2}_[A-Z]{2}/g) || [])];
  const projects = [...new Set(Array.from(text.matchAll(/(?:프로젝트\s*(?:번호)?\s*[:#]?\s*|#)(\d{4,7})\b/g), hit => hit[1]))];
  // 납품 날짜를 검수 기한으로 바꾸지 않는다. 명시된 기한 줄만, 여러 개면 원문 확인.
  const deadlineLines = lines.filter(line => /기한|마감|까지/.test(line) &&
    /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.]\d{1,2}|\d+월|\d+시|오늘|내일|익일|퇴근/.test(line));
  const deadline = deadlineLines.length === 1 ? slackDigestDeadline_(deadlineLines[0]) :
    deadlineLines.length > 1 ? '기한 여러 개 — 원문 확인' : '';
  const short = value => Array.from(value).slice(0, SLACK_DIGEST.summaryChars).join('') +
    (Array.from(value).length > SLACK_DIGEST.summaryChars ? '…' : '');
  const detailLines = policy ? lines.filter(line => /종합적으로 고려|프로젝트 상황|우선순위|균등한 분배|업무 역량/.test(line))
    : kind === '대상 확인' ? lines.filter(line => /언급|멘션|대상/.test(line)) : [];
  const detail = detailLines.slice(0, 2).map(short).join(' / ');
  const parentTitle = inherited ? slackDigestPlain_(record.threadParentText || '')
    .split('\n').map(line => line.trim()).find(Boolean) || '' : '';
  return Object.assign({}, record, { kind, rank, task, needsReview, summary: short(summary),
    detail, contextTitle: short(parentTitle),
    deadline: notice ? '' : short(deadline), notice, informational: toolGuide, pairs: pairs.slice(0, 2).join(', '), projects, matchedKinds,
    batches: findSlackKeywordHits_(text, 'batch').flatMap(rule => rule.keywords.filter(word => slackKeywordMatches_(text, word))),
    state: cancelled.length ? '취소・미정 등 문맥 확인' : requests.length ? '요청・안내' : '참고' });
}

// 원문에 명시된 날짜/시간 표현만 발췌한다. 상대 날짜를 임의의 날짜로 변환하지 않는다.
function slackDigestDeadline_(line) {
  const match = String(line).match(/(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2}|\d{1,2}월\s*\d{1,2}일|오늘|내일|익일)?\s*(?:\([월화수목금토일](?:요일)?\))?\s*(?:(?:오전|오후)\s*)?\d{1,2}시(?:\s*\d{1,2}분)?\s*(?:까지|전)?|(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2}|\d{1,2}월\s*\d{1,2}일|오늘|내일|익일)\s*(?:\([월화수목금토일](?:요일)?\))?\s*(?:퇴근\s*(?:전|까지)|까지|전)?|퇴근\s*(?:전|까지)/);
  return match ? match[0].trim() : line;
}

function buildSlackDigestItems_(records) {
  const groups = new Map();
  records.map(classifySlackDigest_).filter(Boolean)
    .sort((a, b) => Number(b.ts) - Number(a.ts) || String(a.url).localeCompare(String(b.url)))
    .forEach(item => {
      const key = JSON.stringify([item.pm, item.category, item.threadKey || item.url, item.kind,
        item.task.replace('·스레드 문맥', ''), [...(item.projects || [])].sort(),
        [...new Set(slackDigestPlain_(item.text).match(/\d+\s*차\s*(?:납품|배치)/g) || [])]
          .map(value => value.replace(/\s+/g, '')).sort(),
        item.kind === '어뷰저 관리' ? [] : [...(item.batches || [])].sort(),
        item.notice ? item.summary : '', item.needsReview ? [...item.matchedKinds].sort() : []]);
      if (!groups.has(key)) groups.set(key, []);
      const group = groups.get(key);
      if (!group.some(old => old.url === item.url && old.text === item.text)) group.push(item);
    });
  return [...groups.values()].map(group => {
    const latest = group[0];
    const deadlines = new Map();
    group.forEach(item => {if (item.deadline) deadlines.set(
      slackDigestDueDay_(item) + '|' + item.deadline.replace(/\s+/g, ''), item);});
    const deadlineItem = [...deadlines.values()][0];
    const pairs = [...new Set(group.flatMap(item => slackDigestPlain_(item.text)
      .match(/[a-z]{2}_[A-Z]{2}-[a-z]{2}_[A-Z]{2}/g) || []))];
    return Object.assign({}, latest, {
      text: group.map(item => item.text).join('\n'),
      pairs: pairs.join(', '),
      deadline: deadlines.size > 1 ? '기한 여러 개 — 원문 확인' : deadlineItem ? deadlineItem.deadline : '',
      deadlineTs: deadlineItem ? deadlineItem.ts : latest.ts,
      sourceUrls: group.map(item => item.url), mergedCount: group.length,
    });
  }).sort((a, b) => a.rank - b.rank || Number(b.ts) - Number(a.ts));
}

// DM 전용 선택. 발송 이력은 읽음/완료가 아니며 점검용 전체 목록은 유지한다.
function selectPersonalSlackItems_(pm, items, seen, day, slot) {
  const tomorrow = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
  return items.filter(item => {
    if (item.pm !== pm) return false;
    if (!seen.includes(slackDigestFingerprint_(item))) return true;
    const due = slackDigestDueDay_(item);
    const actionable = !item.needsReview && !item.notice && !item.informational && item.kind !== '운영 기준';
    const stamp=Number(item.ts),postedDate=new Date(stamp*1000+9*3600000);
    const posted=Number.isFinite(stamp)&&!isNaN(postedDate.getTime())?postedDate.toISOString().slice(0,10):'';
    const todayRequest=actionable&&!due&&item.state==='요청・안내'&&posted===day;
    return actionable && (due === day || slot === '17:00' && due === tomorrow || todayRequest);
  }).map(item=>Object.assign({},item,{previouslySent:seen.includes(slackDigestFingerprint_(item))})).sort((a,b) => {
    const rank = item => slackDigestDueDay_(item) === day ? 0 :
      slackDigestDueDay_(item) === tomorrow ? 1 : item.previouslySent ? 3 : 2;
    return rank(a)-rank(b) || Number(b.ts)-Number(a.ts);
  });
}

function formatPersonalSlackDigest_(items, day, slot, attachedCount) {
  const lines = ['', '', '💬 *Slack*'];
  // 당일 명시 요청은 재표시한다. 발송 이력은 읽음/완료 기록이 아니다.
  if (!items.length) return lines.concat(attachedCount ? '• 업무 항목 아래에 함께 표시함 (' + attachedCount + '건)' :
    '• 새로 온 요청·안내 없음').join('\n');
  const tomorrow = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
  const groups = new Map();
  items.forEach(item => {
    const due = slackDigestDueDay_(item);
    const actionable = !item.needsReview && !item.notice && !item.informational && item.kind !== '운영 기준';
    const key = actionable && due === day ? '오늘 기한' :
      actionable && due === tomorrow && slot === '17:00' ? '내일 기한' :
      item.previouslySent ? '오늘 요청 · 이전 회차에 안내됨' :
      item.category === 'direct' ? '개인 · 새·변경' : 'BBPM · 새·변경';
    if (!groups.has(key)) groups.set(key, []);
    // 이전 회차에 이미 자세히 보낸 항목은 링크만 모아 한 줄로 접는다.
    if (item.previouslySent && key === '오늘 요청 · 이전 회차에 안내됨') {
      groups.get(key).push('<' + item.url + '|' + escapeSlack_(slackDigestDisplayKeywords_(item)) + '>');
      return;
    }
    const scope = /^오늘|^내일/.test(key) ? '[' + (item.category === 'direct' ? '개인' : 'BBPM') + '] ' : '';
    const title = item.notice ? [item.task.replace('·스레드 문맥',''),item.summary]
      .filter(value => value && value !== '작업명 확인 필요').join(' · ') : slackDigestDisplayKeywords_(item);
    const posted = slackDigestPostedAt_(item.ts);
    const deadline = slackDigestDeadlineText_(item, due);
    groups.get(key).push('• ' + scope + '<' + item.url + '|' + escapeSlack_(title) + '>' +
      (deadline ? ' · 기한 ' + escapeSlack_(deadline) : '') +
      (due && due < day ? ' (경과·상태 확인)' : '') +
      (posted ? ' · 원문 ' + posted : '') + slackDigestDetailLine_(item));
  });
  // 이전 회차에 이미 보낸 오늘 요청은 제목으로만 구분한다(읽음·완료를 뜻하지 않음).
  ['오늘 기한','내일 기한','개인 · 새·변경','BBPM · 새·변경','오늘 요청 · 이전 회차에 안내됨'].forEach(key => {
    if (!groups.has(key)) return;
    const rows = groups.get(key);
    lines.push('*' + key + '*', ...(key === '오늘 요청 · 이전 회차에 안내됨' ? ['• ' + rows.join(' · ')] : rows));
  });
  return lines.join('\n');
}

// 날짜를 계산할 수 있는 기한은 '10/22(목)'로 통일한다(익일·내일·'10/22 (목)' 혼용 방지). 시각·퇴근 전 표현은 뒤에 남긴다.
function slackDigestDueLabel_(due, raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return raw;
  const date = new Date(due + 'T00:00:00Z');
  const label = due.slice(5, 7) + '/' + due.slice(8, 10) + '(' + '일월화수목금토'[date.getUTCDay()] + ')';
  const time = String(raw || '').match(/(?:(?:오전|오후)\s*)?(?:\d{1,2}:\d{2}|\d{1,2}시(?:\s*\d{1,2}분)?)|퇴근\s*(?:전|까지)/);
  return time ? label + ' ' + time[0] : label;
}

// 누르기 전에 무슨 일인지 알 수 있게 작성자와 원문 첫 구절을 하위 줄로 붙인다. 둘 다 없으면 빈 문자열.
function slackDigestDetailLine_(item) {
  const parts = [];
  if (item.authorName) parts.push(escapeSlack_(slackAuthorShortName_(item.authorName)));
  const snippet = slackDigestSnippet_(item);
  if (snippet) parts.push(slackDigestSnippetText_(snippet));
  return parts.length ? '\n   ↳ ' + parts.join(' · ') : '';
}

// 회사 표시 이름이 '이름/팀/아이디' 형식이라 앞의 이름만 쓴다.
function slackAuthorShortName_(name) {
  return String(name || '').split('/')[0].trim();
}

// [제목]은 그대로, 본문 구절은 따옴표로 감싼다.
function slackDigestSnippetText_(snippet) {
  return /^\[[^\]]+\]$/.test(snippet) ? escapeSlack_(snippet) : '"' + escapeSlack_(snippet) + '"';
}

// 고르는 순서: 원문의 [제목] → 멘션·인사말을 뺀 내용 있는 첫 줄 → (답글에 내용이 없으면) 스레드 부모의 [제목].
function slackDigestSnippet_(item) {
  const clean = text => String(text || '').split('\n').map(line => slackDigestPlain_(line)
    .replace(/[_*~`>]/g, '').replace(/\s+/g, ' ').trim()
    // 멘션을 지우고 남은 쉼표·'님'·기호와 인사말을 앞에서 떼어낸다.
    .replace(/^(?:[\s,.:;·~\-!]|님(?=[\s,.!]|$)|(?:안녕하세요|안녕하십니까)[.!,~]*)+/, '').trim());
  const meaningful = line => (line.match(/[가-힣A-Za-z0-9]/g) || []).length >= 6;
  const title = text => { const m = String(slackDigestPlain_(text || '')).match(/\[([^\[\]\n]{4,40})\]/); return m ? '[' + m[1].trim() + ']' : ''; };
  const ownTitle = title(item.text);
  if (ownTitle) return ownTitle;
  const line = clean(item.text).find(meaningful) || '';
  if (!line) return title(item.threadParentText);
  const chars = Array.from(line);
  if (chars.length <= 32) return chars.join('');
  // 단어 중간이 아니라 마지막 띄어쓰기에서 자르고, 짝이 안 맞는 여는 괄호·구분 기호는 떼어낸다.
  let cut = chars.slice(0, 32).join('');
  const space = cut.lastIndexOf(' ');
  if (space >= 16) cut = cut.slice(0, space);
  cut = cut.replace(/[\s([{<·,:\-–—]+$/, '');
  const open = (cut.match(/[([]/g) || []).length, close = (cut.match(/[)\]]/g) || []).length;
  if (open > close) cut = cut.replace(/\s*[([][^()[\]]*$/, '');
  return cut.trim() + '…';
}

// 시트 업무와 같은 종류의 Slack 항목은 그 업무 줄 아래로 옮기고 Slack 영역에서는 뺀다(같은 일이 두 번 나오지 않게).
const SLACK_WORK_LINKS = [
  {labels:['어뷰저 관리'], kind:/어뷰저/},
  {labels:['예비 작업자 검토'], kind:/예비\s*작업자/},
  {labels:['헤즈업', '헤즈업 대상'], kind:/헤즈업/},
  {labels:['1차 검수'], kind:/1차\s*검수/},
  {labels:['테스트지 검토'], kind:/테스트지/},
];

function attachSlackToWorkLines_(workText, items, day) {
  const lines = String(workText).split('\n');
  const rest = [];
  let attached = 0;
  items.forEach(item => {
    const link = !item.needsReview && !item.notice && SLACK_WORK_LINKS.find(rule => rule.kind.test(item.kind || ''));
    const at = link ? lines.findIndex(line => /^• /.test(line) &&
      link.labels.some(label => line.includes('|' + label + '>') || line.startsWith('• ' + label + ' '))) : -1;
    if (at < 0) { rest.push(item); return; }
    const due = slackDigestDueDay_(item);
    const deadline = slackDigestDeadlineText_(item, due);
    const posted = slackDigestPostedAt_(item.ts);
    const scope = item.category === 'direct' ? '개인' : 'BBPM';
    const detail = [item.authorName ? escapeSlack_(slackAuthorShortName_(item.authorName)) : '',
      slackDigestSnippet_(item) ? slackDigestSnippetText_(slackDigestSnippet_(item)) : ''].filter(Boolean).join(' ');
    let end = at + 1;
    while (end < lines.length && /^ {2,}↳/.test(lines[end])) end++;
    lines.splice(end, 0, '   ↳ 관련 Slack [' + scope + '] <' + item.url + '|원문' + (posted ? ' ' + posted : '') + '>' +
      (deadline ? ' · 기한 ' + escapeSlack_(deadline) : '') + (due && due < day ? ' (경과·상태 확인)' : '') +
      (detail ? ' · ' + detail : ''));
    attached++;
  });
  return {text:lines.join('\n'), rest, attached};
}

// 작성자 Slack ID → 표시 이름. 스크립트 속성에 캐시해 회차마다 다시 묻지 않는다. 실패해도 이름 없이 보낸다.
function attachSlackAuthorNames_(items, token, readOnly) {
  const ids = [...new Set(items.map(item => String(item.user || '')).filter(id => /^[UW][A-Z0-9]{8,}$/.test(id)))];
  if (!ids.length) return items;
  const props = PropertiesService.getScriptProperties();
  let cache = {};
  try { cache = JSON.parse(props.getProperty('SLACK_AUTHOR_NAMES') || '{}') || {}; } catch (error) { cache = {}; }
  const budget = {calls:0, maxCalls:20, deadline:0};
  let changed = false;
  if (!readOnly) ids.filter(id => !cache[id]).slice(0, 20).forEach(id => {
    try {
      const user = slackMentionReadApi_('users.info', {user:id}, token, budget).user || {};
      const profile = user.profile || {};
      const name = String(profile.display_name || profile.real_name || user.real_name || '').trim();
      if (name) { cache[id] = Array.from(name).slice(0, 30).join(''); changed = true; }
    } catch (error) { console.log('작성자 이름 확인 생략 | ' + error.message); }
  });
  if (changed) {
    // 속성 한 칸 크기(9KB)를 넘지 않게, 넘으면 이번에 쓴 사람만 남긴다.
    if (JSON.stringify(cache).length > 8000) cache = ids.reduce((kept, id) => (cache[id] && (kept[id] = cache[id]), kept), {});
    try { props.setProperty('SLACK_AUTHOR_NAMES', JSON.stringify(cache)); } catch (error) { console.log('작성자 이름 캐시 저장 생략'); }
  }
  return items.map(item => cache[item.user] ? Object.assign({}, item, {authorName:cache[item.user]}) : item);
}

// DM 기한 표기 공통: 짧고 명시된 기한만 통일 표기, 여러 개·불명확하면 '원문 확인'으로 경고를 남긴다.
function slackDigestDeadlineText_(item, due) {
  if (!item.deadline) return '';
  if (/여러/.test(item.deadline)) return '여러 개·원문 확인';
  if (!/^(?:\d|오늘|내일|익일|퇴근|오전|오후)/.test(item.deadline) || item.deadline.length > 45) return '원문 확인';
  return slackDigestDueLabel_(due, item.deadline);
}

function slackDigestPostedAt_(ts) {
  if (!/^\d{10,}\.\d{6}$/.test(String(ts || ''))) return '';
  const date = new Date(Number(ts) * 1000 + 9 * 3600000);
  if (isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return pad(date.getUTCMonth() + 1) + '/' + pad(date.getUTCDate());
}

// 날짜가 명시되지 않은 시간/퇴근 전 문구는 오늘 마감으로 추정하지 않는다.
function slackDigestDueDay_(item) {
  const text = String(item.deadline || '').trim();
  if (!text || /여러|원문 확인/.test(text)) return '';
  const stamp = Number(item.deadlineTs || item.ts);
  if (!Number.isFinite(stamp)) return '';
  const base = new Date(stamp * 1000 + 9 * 3600000);
  if (isNaN(base.getTime())) return '';
  const match = text.match(/^(?:(\d{4})[-/.])?(\d{1,2})[/.\-](\d{1,2})|^(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    const year = Number(match[1] || base.getUTCFullYear());
    const month = Number(match[2] || match[4]);
    const date = Number(match[3] || match[5]);
    const value = new Date(Date.UTC(year,month-1,date));
    return value.getUTCFullYear() === year && value.getUTCMonth() === month-1 && value.getUTCDate() === date ?
      value.toISOString().slice(0,10) : '';
  }
  if (/^(오늘|내일|익일)/.test(text)) {
    const plus = /^(내일|익일)/.test(text) ? 1 : 0;
    base.setUTCDate(base.getUTCDate()+plus);
    return base.toISOString().slice(0,10);
  }
  return '';
}

// 댓글 발췌 대신 분류 키워드와 명시된 식별자만 표시한다.
function slackDigestDisplayKeywords_(item) {
  const task = /^(작업명 확인 필요|여러 작업|공통 운영)$/.test(item.task) ? '' :
    String(item.task || '').replace('·스레드 문맥', '');
  const kind = item.kind === '운영 기준' && /검수/.test(item.summary || '') ? '검수 배정 기준' : item.kind;
  const parts = [task, kind];
  if (item.needsReview && item.matchedKinds && item.matchedKinds.length) parts.push(item.matchedKinds[0]);
  if (item.kind === '어뷰저 관리' && /재배정\s*전|재배정\s*이전/.test(slackDigestPlain_(item.text))) parts.push('이전 담당 기준');
  if (item.projects && item.projects.length) parts.push(item.projects.slice(0, 2).map(id => '#' + id).join(', '));
  if (item.pairs) {
    const pairs = item.pairs.split(', ');
    parts.push(pairs.length > 2 ? '언어쌍 ' + pairs.length + '개' : '원문 언어쌍: ' + pairs.join(', '));
  }
  return [...new Set(parts.filter(Boolean))].join(' · ');
}

// 성공 발송한 메시지만 기억한다. 원문·토큰은 저장하지 않으며 미리보기는 이력을 변경하지 않는다.
function slackDigestFingerprint_(item) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([item.url, item.text, item.threadParentText]))).slice(0, 28);
}

function readSlackDigestSeen_(props, id) {
  const raw = props.getProperty('SLACK_DIGEST_SEEN_' + id);
  if (!raw) return [];
  const seen = JSON.parse(raw);
  if (!Array.isArray(seen) || seen.some(value => typeof value !== 'string')) {
    throw new Error('Slack 확인사항 발송 이력 형식이 잘못됐습니다.');
  }
  return seen;
}

function markSlackDigestSeen_(props, id, old, items, current) {
  // 순서: 수집 범위 밖 → 범위 안 → 이번에 보낸 것. 넘치면 앞(범위 밖)부터 잘린다.
  const added = items.map(slackDigestFingerprint_);
  const visible = new Set((current || []).map(slackDigestFingerprint_));
  const kept = old.filter(value => !added.includes(value));
  const ordered = kept.filter(value => !visible.has(value)).concat(kept.filter(value => visible.has(value)), added);
  props.setProperty('SLACK_DIGEST_SEEN_' + id,
    JSON.stringify([...new Set(ordered)].slice(-SLACK_DIGEST.maxSeen)));
}
