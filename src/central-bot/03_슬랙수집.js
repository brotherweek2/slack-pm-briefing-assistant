/**
 * 03. 슬랙수집
 * - 역할: Slack 채널·스레드 읽기, 이어서 수집, 완료본 저장
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 03-01. 수집 한도 확인 [내부]
 * - slackBudgetSpent_(budget): 남은 실행 시간과 API 호출 예산을 확인한다.
 *
 * 03-02. 중복 수집 점유 [내부]
 * - acquireBbpmLease_(): 짧은 스크립트 잠금으로 수집 점유 시간을 속성에 기록한다. 영향: 수집 점유 속성 변경.
 *
 * 03-03. 수집 점유 해제 [내부]
 * - releaseBbpmLease_(): 수집 점유 속성을 해제한다. 영향: 수집 점유 속성 변경.
 *
 * 03-04. 중복 실행 오류 [내부]
 * - bbpmBusyError_(): 다른 수집이 진행 중임을 구분하는 오류를 만든다.
 *
 * 03-05. 읽기 설정 검증 [내부]
 * - readSlackMentionConfig_(props): 봇 인증·그룹·기간·스레드·자동 발견 채널 설정을 확인한다.
 *
 * 03-06. 스레드 링크 해석 [내부]
 * - parseSlackMentionThreadUrl_(url): Slack 링크에서 워크스페이스·채널·부모 스레드 정보를 추출한다.
 *
 * 03-07. 멘션 수신자 선택 [내부]
 * - selectSlackMentionRecipients_(rows): BOT_USERS의 이름·Slack ID 중복과 형식을 확인한다.
 *
 * 03-08. 수집 점유 흐름 [내부]
 * - collectSlackMentionMessages_(config, now): 자동 발견 수집의 중복 실행을 막고 종료 시 점유를 해제한다.
 *
 * 03-09. 수집 배치 실행 [내부]
 * - collectSlackMentionRecordsBatch_(config, now): Slack 봇·그룹을 확인하고 채널·부모글·답글을 호출 예산 안에서 읽는다.
 *
 * 03-10. 스레드 발견 진입 [내부]
 * - discoverBbpmThreads_(config, host, oldest, newest, budget): 채널 이력 발견 작업을 수집 점유로 보호한다.
 *
 * 03-11. 채널 이력 이어 읽기 [내부]
 * - discoverBbpmThreadsBatch_(config, host, oldest, newest, budget): 채널 페이지를 읽어 최근 답글이 있는 과거 부모글까지 찾아 진행 커서를 저장한다. 영향: Slack 읽기·진행/캐시 변경.
 *
 * 03-12. 발견 캐시 준비 [내부]
 * - openBbpmDiscoveryCache_(config, host, oldest, newest): 유효한 채널 이력 진행 상태와 봇 전용 캐시 탭을 재사용하거나 준비한다. 영향: 전용 캐시 탭/진행 속성 준비 가능.
 *
 * 03-13. 발견 후보 저장 [내부]
 * - appendBbpmDiscoveryCache_(cache, messages): 채널 메시지·스레드 후보를 전용 캐시 탭에 추가한다. 영향: 전용 캐시 탭 추가.
 *
 * 03-14. 발견 후보 읽기 [내부]
 * - readBbpmDiscoveryCache_(cache, config, host): 저장된 후보와 고정된 조회 시각을 읽어 수집 대상을 복원한다.
 *
 * 03-15. 답글 이어 읽기 [내부]
 * - collectBbpmRepliesBatch_(cache, threads, config, budget): 부모글·답글 페이지를 읽고 스레드별 커서와 완료 상태를 전용 캐시에 저장한다. 영향: Slack 읽기·전용 캐시/진행 변경.
 *
 * 03-16. Slack 읽기 API [내부]
 * - slackMentionReadApi_(method, params, token, budget): 호출 예산·응답·읽기 제한을 검사하며 Slack Web API 읽기 요청을 보낸다.
 *
 * 03-17. 메시지 텍스트 정리 [내부]
 * - slackMentionText_(text): Slack의 사용자·그룹 표기 등을 읽기 쉬운 텍스트로 바꾼다.
 *
 * 03-18. 개인·그룹 멘션 분류 [내부]
 * - classifySlackMentionMessages_(messages, recipients, members, groupId, oldest, newest, ownBotId): 조회 기간·실제 그룹 멤버·수신자 ID를 기준으로 대상 메시지를 나눈다.
 *
 * 03-19. Slack 미리 수집 [직접 실행]
 * - 함수: collectBbpmSnapshot(e)
 * - 기능: 자동 호출은 수집 시간대에만 실행하고 수동 실행은 시간대 밖에서도 이어 읽는다.
 * - 사용: 트리거가 자동 호출. 수동 실행도 가능하며 진행 중이면 이어 실행.
 * - 영향: Slack 읽기·전용 수집/완료본 탭·진행/상태 속성 변경. DM 없음.
 *
 * 03-20. 수집 시간대 판별 [내부]
 * - isBbpmCollectWindow_(now): 한국 시간의 오전·오후 수집 허용 범위를 확인한다.
 *
 * 03-21. 완료본 수집 단계 [내부]
 * - runBbpmCollectStep_(props, now): 한 배치 수집 후 진행 상황 또는 완료본을 저장하고 마지막 오류 상태를 관리한다. 영향: Slack 읽기·완료본/진행/오류 속성 변경.
 *
 * 03-22. Slack 완료본 저장 [내부]
 * - writeBbpmSnapshot_(bot, props, scan, groupId): 멘션이 있는 메시지만 두 전용 탭에 번갈아 저장하고 활성 완료본 속성을 바꾼다. 영향: 봇 전용 완료본 탭·활성 속성 변경.
 *
 * 03-23. Slack 완료본 읽기 [내부]
 * - readBbpmSnapshot_(props, bot): 현재 활성 완료본의 메타정보와 메시지를 읽는다.
 *
 * 03-24. 발송용 최신성 확인 [내부]
 * - loadFreshBbpmSnapshot_(props, bot, now): 완료본 존재와 허용 경과 시간을 검사하고 오래된 자료를 차단한다.
 *
 * 03-25. 저장 멘션 재분류 [내부]
 * - classifySlackSnapshot_(snapshot, recipients): 완료본의 그룹 멤버·기간을 사용해 현재 수신자별로 분류한다.
 */

/**
 * 지정 스레드의 개인 멘션 / PM 그룹 멘션을 구분하는 읽기 전용 미리보기.
 * Slack 메시지를 변경하거나 발송하지 않는다. 자동 발견 시 전용 수집 캐시·진행 속성을 갱신한다.
 * ENABLE_SLACK_MENTION_READ=true일 때만 Slack 읽기를 시작한다.
 */
// 수집은 호출 횟수보다 Apps Script 실행 시간(6분)이 실제 한계다. maxCalls는 폭주 방지용 안전 상한.
const SLACK_MENTIONS = Object.freeze({
  maxThreads: 5, maxPagesPerThread: 10, maxCalls: 300, timeLimitMs: 270000, leaseMs: 390000,
  pageSize: 100,
});

function slackBudgetSpent_(budget) {
  return budget.calls >= (budget.maxCalls || SLACK_MENTIONS.maxCalls) ||
    (budget.deadline > 0 && Date.now() >= budget.deadline);
}

// 수집은 몇 분씩 걸리므로 스크립트 잠금은 점유 표시를 쓰는 순간에만 잡는다. 발송이 수집을 기다리지 않게 한다.
function acquireBbpmLease_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    const props = PropertiesService.getScriptProperties();
    if (Number(props.getProperty('BBPM_COLLECT_LEASE') || 0) > Date.now()) return false;
    props.setProperty('BBPM_COLLECT_LEASE', String(Date.now() + SLACK_MENTIONS.leaseMs));
    return true;
  } finally { lock.releaseLock(); }
}

function releaseBbpmLease_() {
  PropertiesService.getScriptProperties().setProperty('BBPM_COLLECT_LEASE', '0');
}

function bbpmBusyError_() {
  const error = new Error('다른 BBPM 수집이 진행 중입니다. 잠시 후 재실행하세요.');
  error.code = 'BUSY';
  return error;
}

function readSlackMentionConfig_(props) {
  const token = requiredProperty_(props, 'SLACK_BOT_TOKEN');
  if (!token.startsWith('xoxb-')) throw new Error('멘션 읽기는 봇 토큰만 사용합니다. 토큰 값을 로그에 출력하지 마세요.');
  const groupId = requiredProperty_(props, 'SLACK_PM_GROUP_ID').trim();
  if (!/^S[A-Z0-9]{8,}$/.test(groupId)) throw new Error('SLACK_PM_GROUP_ID의 그룹 ID를 확인하세요.');
  const days = Number(props.getProperty('SLACK_MENTION_LOOKBACK_DAYS') || '7');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('조회 기간은 1~30일 정수로 설정하세요.');
  let urls;
  try { urls = JSON.parse(requiredProperty_(props, 'SLACK_MENTION_THREADS')); }
  catch (error) { throw new Error('SLACK_MENTION_THREADS는 스레드 URL의 JSON 배열이어야 합니다.'); }
  if (!Array.isArray(urls) || !urls.length || urls.length > SLACK_MENTIONS.maxThreads) {
    throw new Error('시범 수집은 스레드 링크 1~5개를 등록하세요.');
  }
  const seen = new Set();
  const threads = urls.map(parseSlackMentionThreadUrl_).filter(item => {
    const key = item.host + '|' + item.channel + '|' + item.ts;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const discovery = props.getProperty('ENABLE_SLACK_CHANNEL_DISCOVERY') === 'true';
  const channel = String(props.getProperty('SLACK_DISCOVERY_CHANNEL_ID') ||
    (new Set(threads.map(item => item.channel)).size === 1 ? threads[0].channel : '')).trim();
  if (discovery && !/^[CG][A-Z0-9]{8,}$/.test(channel)) {
    throw new Error('SLACK_DISCOVERY_CHANNEL_ID에 BBPM 채널 ID를 설정하세요.');
  }
  return { token, groupId, days, threads, discovery, channel };
}

function parseSlackMentionThreadUrl_(url) {
  const value = String(url || '').trim();
  const match = value.match(/^https:\/\/([a-z0-9-]+\.slack\.com)\/archives\/([CG][A-Z0-9]{8,})\/p(\d{16,})(?:\?([^#]*))?(?:#.*)?$/i);
  if (!match) throw new Error('Slack 메시지의 링크 복사로 얻은 스레드 URL을 등록하세요.');
  const params = {};
  String(match[4] || '').split('&').filter(Boolean).forEach(part => {
    const at = part.indexOf('=');
    if (at >= 0) {
      try { params[decodeURIComponent(part.slice(0, at))] = decodeURIComponent(part.slice(at + 1)); }
      catch (error) { throw new Error('스레드 링크의 쿼리 형식이 잘못되었습니다.'); }
    }
  });
  // 답글 링크에서도 부모 스레드를 조회한다.
  const digits = match[3];
  const ts = params.thread_ts || digits.slice(0, -6) + '.' + digits.slice(-6);
  if (!/^\d{10,}\.\d{6}$/.test(ts)) throw new Error('스레드 부모 메시지 ID 형식이 잘못되었습니다.');
  return { host: match[1].toLowerCase(), channel: match[2].toUpperCase(), ts };
}

function selectSlackMentionRecipients_(rows) {
  const names = new Set();
  const ids = new Set();
  return rows.flatMap(row => {
    const pm = String(row[0] || '').trim();
    const id = String(row[1] || '').trim();
    if (!pm) return [];
    if (names.has(pm)) throw new Error('BOT_USERS의 PM 이름이 중복됩니다.');
    names.add(pm);
    if (!id) return [];
    if (!/^[UW][A-Z0-9]{8,}$/.test(id)) throw new Error('BOT_USERS의 Slack 사용자 ID 형식을 확인하세요.');
    if (ids.has(id)) throw new Error('BOT_USERS에서 같은 Slack ID가 여러 PM에 등록돼 있습니다.');
    ids.add(id);
    return [{ pm, id }];
  });
}

function collectSlackMentionMessages_(config, now) {
  const leased = config.discovery && !config.scanLockHeld;
  if (leased && !acquireBbpmLease_()) throw bbpmBusyError_();
  try {
    return collectSlackMentionRecordsBatch_(Object.assign({}, config,
      {scanLockHeld: config.scanLockHeld || leased}), now);
  } finally { if (leased) releaseBbpmLease_(); }
}

function collectSlackMentionRecordsBatch_(config, now) {
  const budget = { calls: 0, deadline: config.deadline || 0 };
  const identity = slackMentionReadApi_('auth.test', {}, config.token, budget);
  const hostMatch = String(identity.url || '').match(/^https:\/\/([a-z0-9-]+\.slack\.com)\/?$/i);
  if (!hostMatch || !identity.bot_id) throw new Error('현재 봇의 워크스페이스 주소/봇 ID를 확인할 수 없습니다.');
  if (config.threads.some(thread => thread.host !== hostMatch[1].toLowerCase())) {
    throw new Error('등록 스레드와 현재 봇 토큰의 워크스페이스가 다릅니다.');
  }
  const group = slackMentionReadApi_('usergroups.users.list',
    { usergroup: config.groupId }, config.token, budget);
  if (!Array.isArray(group.users)) throw new Error('PM 그룹의 멤버 목록을 확인할 수 없습니다.');
  const members = new Set(group.users);
  let newest = now.getTime() / 1000;
  let oldest = newest - config.days * 86400;
  const messages = [];
  let threads = config.threads.slice();
  let discoveryCache = null;
  if (config.discovery) {
    const discovered = discoverBbpmThreads_(config, hostMatch[1].toLowerCase(),
      oldest, newest, budget);
    if (discovered.pending) return discovered;
    oldest = discovered.oldest;
    newest = discovered.newest;
    discoveryCache = discovered.cache;
    messages.push(...discovered.messages);
    const unique = new Map(threads.concat(discovered.threads).map(thread =>
      [thread.channel + '|' + thread.ts, thread]));
    threads = [...unique.values()];
  }
  if (!discoveryCache) throw new Error('Slack 수집은 BBPM 채널 자동 발견(ENABLE_SLACK_CHANNEL_DISCOVERY=true)에서만 사용합니다.');
  const replies = collectBbpmRepliesBatch_(discoveryCache, threads, config, budget);
  if (replies.pending) return replies;
  messages.push(...replies.messages);
  return { messages, members: [...members], botId: identity.bot_id, oldest, newest,
    messageCount: new Set(messages.map(item => item.sourceChannel + '|' + item.ts)).size,
    threadCount: threads.length, discovery: Boolean(config.discovery), asOf: newest };
}

// 전체 이력을 페이지 처리해 오래된 부모의 최근 답글도 발견한다. 불완전한 조회는 중지한다.
function discoverBbpmThreads_(config, host, oldest, newest, budget) {
  const leased = !config.scanLockHeld;
  if (leased && !acquireBbpmLease_()) throw bbpmBusyError_();
  try { return discoverBbpmThreadsBatch_(config, host, oldest, newest, budget); }
  finally { if (leased) releaseBbpmLease_(); }
}

function discoverBbpmThreadsBatch_(config, host, oldest, newest, budget) {
  const info = slackMentionReadApi_('conversations.info', { channel: config.channel }, config.token, budget);
  if (!info.channel || info.channel.name !== 'pm_team_channel') {
    throw new Error('자동 수집은 승인된 pm_team_channel 채널에 한정합니다.');
  }
  const cache = openBbpmDiscoveryCache_(config, host, oldest, newest);
  oldest = cache.state.oldest;
  newest = cache.state.newest;
  const cursors = new Set();
  let cursor = cache.state.cursor;
  if (cache.state.complete) return readBbpmDiscoveryCache_(cache, config, host);
  // 부모 글 기간은 자르지 않는다. 오래된 부모의 새 답글도 찾기 위해 시간이 허락하는 만큼 이어 읽는다.
  for (;;) {
    if (slackBudgetSpent_(budget)) break;
    const params = { channel: config.channel, latest: newest.toFixed(6), inclusive: 'true', limit: '100' };
    if (cursor) params.cursor = cursor;
    const body = slackMentionReadApi_('conversations.history', params, config.token, budget);
    if (!Array.isArray(body.messages)) throw new Error('BBPM 채널 응답 형식이 잘못되었습니다.');
    const candidates = body.messages.filter(message => {
      const ts = String(message.ts || '');
      return /^\d{10,}\.\d{6}$/.test(ts) && (Number(ts) >= oldest ||
        (Number(message.reply_count) > 0 && Number(message.latest_reply || ts) >= oldest));
    });
    const next = String(body.response_metadata && body.response_metadata.next_cursor || '').trim();
    if (!next && body.has_more === true) throw new Error('BBPM 채널 조회가 불완전합니다.');
    if (next && (next === cursor || cursors.has(next))) throw new Error('BBPM 채널 페이지가 반복됩니다.');
    appendBbpmDiscoveryCache_(cache, candidates);
    cache.state.pages++;
    cache.state.cursor = next;
    cache.state.complete = !next;
    cache.props.setProperty('BBPM_DISCOVERY_CHECKPOINT', JSON.stringify(cache.state));
    cursor = next;
    if (!cursor) return readBbpmDiscoveryCache_(cache, config, host);
    cursors.add(cursor);
  }
  return { pending: true, records: [], progress: 'BBPM 수집 진행 중: 누적 ' + cache.state.pages +
    '페이지 저장. 같은 미리보기 함수를 다시 실행하면 이어 읽습니다. 아직 브리핑·Slack 발송 없음.' };
}

// 채널 기록은 브리핑 시트의 전용 캐시에, 커서/기준시각만 스크립트 속성에 저장한다.
function openBbpmDiscoveryCache_(config, host, oldest, newest) {
  const props = PropertiesService.getScriptProperties();
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  let sheet = bot.getSheetByName('BOT_SLACK_DISCOVERY_CACHE');
  if (!sheet) sheet = bot.insertSheet('BOT_SLACK_DISCOVERY_CACHE');
  let state;
  try { state = JSON.parse(props.getProperty('BBPM_DISCOVERY_CHECKPOINT') || 'null'); }
  catch (error) { state = null; }
  const age = state ? newest - state.newest : Infinity;
  if (!state || state.channel !== config.channel || state.host !== host ||
      state.days !== config.days || age < 0 || age > (state.repliesComplete ? 900 : 43200) ||
      sheet.getLastRow() < 1) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 2).setValues([['message_ts', 'candidate_json']]);
    state = { channel: config.channel, host, days: config.days, oldest, newest,
      cursor: '', pages: 0, complete: false };
    props.setProperty('BBPM_DISCOVERY_CHECKPOINT', JSON.stringify(state));
  }
  return { props, sheet, state };
}

function appendBbpmDiscoveryCache_(cache, messages) {
  if (!messages.length) return;
  const rows = messages.map(message => {
    // 작성자(user)도 남긴다. DM의 '관련 Slack' 줄에 작성자 이름을 보이기 위해 필요하다.
    const data = JSON.stringify({ ts: message.ts, text: String(message.text || ''), user: message.user,
      thread_ts: message.thread_ts, reply_count: message.reply_count,
      latest_reply: message.latest_reply, bot_id: message.bot_id, subtype: message.subtype });
    if (data.length > 49000) throw new Error('Slack 원문이 캐시 셀 크기를 넘습니다. 누락 없이 처리하려면 분할 저장이 필요합니다.');
    return [String(message.ts), data];
  });
  cache.sheet.getRange(cache.sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}

function readBbpmDiscoveryCache_(cache, config, host) {
  const count = cache.sheet.getLastRow() - 1;
  const rows = count > 0 ? cache.sheet.getRange(2, 1, count, 2).getValues() : [];
  const unique = new Map(rows.map(row => { const item = JSON.parse(row[1]); return [item.ts, item]; }));
  const messages = [], threads = [];
  unique.forEach(message => {
    const ts = String(message.ts);
    if (Number(ts) >= cache.state.oldest) messages.push(Object.assign({}, message, {
      sourceChannel: config.channel, sourceHost: host, sourceThreadTs: message.thread_ts || ts,
      threadParentText: String(message.text || '') }));
    if (Number(message.reply_count) > 0) threads.push({host, channel: config.channel,
      ts: message.thread_ts || ts});
  });
  return { messages, threads, oldest: cache.state.oldest, newest: cache.state.newest, cache };
}

// 답글도 호출 상한 전에 멈추고 다음 실행에서 현재 스레드/페이지부터 재개한다.
function collectBbpmRepliesBatch_(cache, threads, config, budget) {
  const bot = SpreadsheetApp.openById(requiredProperty_(cache.props, 'BOT_SPREADSHEET_ID'));
  let sheet = bot.getSheetByName('BOT_SLACK_REPLY_CACHE');
  if (!sheet) sheet = bot.insertSheet('BOT_SLACK_REPLY_CACHE');
  const state = cache.state;
  // 부모글 수가 늘어도 체크포인트 속성 크기는 일정하게 유지한다.
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([state.newest, threads.map(item => item.channel + '|' + item.ts)])));
  if (state.replySignature !== signature || sheet.getLastRow() < 1) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 1).setValues([['message_json']]);
    state.replySignature = signature;
    state.replyIndex = 0;
    state.replyCursor = '';
    state.replyParentReady = false;
    state.repliesComplete = false;
    cache.props.setProperty('BBPM_DISCOVERY_CHECKPOINT', JSON.stringify(state));
  }
  const count = sheet.getLastRow() - 1;
  const messages = count > 0 ? sheet.getRange(2, 1, count, 1).getValues()
    .map(row => JSON.parse(row[0])) : [];
  const save = batch => {
    if (batch.length) {
      const rows = batch.map(item => {
        // 분류에 쓰지 않는 blocks·첨부·반응 등은 캐시에 중복 적재하지 않는다.
        const compact = {};
        ['ts', 'text', 'user', 'bot_id', 'subtype', 'sourceChannel', 'sourceHost',
          'sourceThreadTs', 'threadParentText'].forEach(key => {
          if (item[key] !== undefined) compact[key] = item[key];
        });
        const json = JSON.stringify(compact);
        if (json.length > 49000) throw new Error('Slack 답글 캐시 셀 크기 초과. 분할 저장이 필요합니다.');
        return [json];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
      messages.push(...batch);
    }
    cache.props.setProperty('BBPM_DISCOVERY_CHECKPOINT', JSON.stringify(state));
  };
  const pending = () => ({pending:true, records:[], progress:'BBPM 답글 수집 진행 중: ' +
    state.replyIndex + '/' + threads.length + '개 스레드 완료. 같은 미리보기 함수를 다시 실행하면 이어 읽습니다. Slack 발송 없음.'});
  while (state.replyIndex < threads.length) {
    const thread = threads[state.replyIndex];
    if (!state.replyParentReady) {
      if (slackBudgetSpent_(budget)) return pending();
      const body = slackMentionReadApi_('conversations.replies',
        {channel:thread.channel, ts:thread.ts, limit:'1'}, config.token, budget);
      if (!Array.isArray(body.messages)) throw new Error('스레드 부모 응답 형식 오류');
      const parent = (body.messages || []).find(item => item.ts === thread.ts);
      state.replyParentReady = true;
      save(parent ? [Object.assign({}, parent, {sourceChannel:thread.channel,
        sourceHost:thread.host, sourceThreadTs:thread.ts, threadParentText:String(parent.text || '')})] : []);
    }
    const parent = messages.find(item => item.sourceChannel === thread.channel && item.ts === thread.ts);
    const parentText = parent ? String(parent.text || '') : '';
    let pages = 0;
    const cursors = new Set();
    while (pages < SLACK_MENTIONS.maxPagesPerThread) {
      if (slackBudgetSpent_(budget)) return pending();
      const cursor = state.replyCursor;
      const params = {channel:thread.channel, ts:thread.ts, oldest:state.oldest.toFixed(6),
        latest:state.newest.toFixed(6), inclusive:'true', limit:String(SLACK_MENTIONS.pageSize)};
      if (cursor) params.cursor = cursor;
      const body = slackMentionReadApi_('conversations.replies', params, config.token, budget);
      if (!Array.isArray(body.messages)) throw new Error('스레드 메시지 응답 형식 오류');
      const next = String(body.response_metadata && body.response_metadata.next_cursor || '').trim();
      if ((!next && body.has_more === true) || (next && (next === cursor || cursors.has(next)))) {
        throw new Error('스레드 페이지 정보가 불완전하거나 반복됩니다.');
      }
      const batch = body.messages.map(item => Object.assign({}, item, {sourceChannel:thread.channel,
        sourceHost:thread.host, sourceThreadTs:thread.ts, threadParentText:parentText}));
      state.replyCursor = next;
      if (next) cursors.add(next);
      if (!next) {state.replyIndex++; state.replyParentReady = false;}
      save(batch);
      pages++;
      if (!next) break;
    }
    if (state.replyCursor) return pending();
  }
  state.repliesComplete = true;
  save([]);
  return {messages};
}

function slackMentionReadApi_(method, params, token, budget) {
  if (!['auth.test', 'usergroups.users.list', 'conversations.replies',
    'conversations.info', 'conversations.history', 'users.info'].includes(method)) {
    throw new Error('멘션 미리보기에서 허용하지 않은 API입니다.');
  }
  const retryProps = PropertiesService.getScriptProperties();
  const retryKey = 'BBPM_RETRY_' + method.replace(/\./g, '_');
  if (Number(retryProps.getProperty(retryKey) || 0) > Date.now()) {
    throw new Error('Slack 읽기 제한 대기 중: 같은 API를 호출하지 않고 종료합니다.');
  }
  budget.calls += 1;
  if (budget.calls > (budget.maxCalls || SLACK_MENTIONS.maxCalls)) {
    throw new Error('읽기 호출 안전 상한입니다. 스레드/기간을 줄이세요.');
  }
  const query = Object.keys(params).map(key =>
    encodeURIComponent(key) + '=' + encodeURIComponent(params[key])).join('&');
  const response = UrlFetchApp.fetch('https://slack.com/api/' + method + (query ? '?' + query : ''), {
    method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status === 429) {
    const headers = response.getAllHeaders();
    const key = Object.keys(headers).find(name => name.toLowerCase() === 'retry-after');
    const wait = key && /^\d+$/.test(String(headers[key])) ? String(headers[key]) : '지정';
    retryProps.setProperty(retryKey, String(Date.now() + (wait === '지정' ? 60 : Math.max(1, Number(wait))) * 1000));
    throw new Error('Slack 읽기 제한 | ' + wait + '초 뒤 재실행 필요. 이번 조회는 완료되지 않았습니다.');
  }
  let body;
  try { body = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error('Slack 읽기 응답을 해석할 수 없습니다.'); }
  if (status !== 200 || !body.ok) {
    const code = /^[a-z0-9_]+$/.test(String(body.error || '')) ? body.error : 'unknown_error';
    throw new Error('Slack 읽기 실패 (' + method + '): ' + code);
  }
  return body;
}

function slackMentionText_(text) {
  // 인용·코드 예시의 ID는 새 요청 멘션으로 잡지 않는다.
  return String(text || '').replace(/\x60{3}[\s\S]*?\x60{3}/g, '').replace(/\x60[^\x60]*\x60/g, '')
    .split('\n').filter(line => !/^\s*(?:>|&gt;)/.test(line)).join('\n');
}

function classifySlackMentionMessages_(messages, recipients, members, groupId, oldest, newest, ownBotId) {
  const byMessage = new Map();
  messages.forEach(message => {
    const ts = String(message.ts || '');
    if (!/^\d{10,}\.\d{6}$/.test(ts) || Number(ts) < oldest || Number(ts) > newest) return;
    if (message.bot_id && message.bot_id === ownBotId) return;
    if (['tombstone', 'message_deleted', 'message_changed'].includes(message.subtype)) return;
    if (!message.sourceChannel || !message.sourceHost) return;
    // 중복 등록/재조회한 동일 메시지는 한 번만 표시한다.
    byMessage.set(message.sourceChannel + '|' + ts, message);
  });
  const output = [];
  byMessage.forEach(message => {
    const text = slackMentionText_(message.text);
    const users = new Set(Array.from(text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g), m => m[1]));
    const groups = new Set(Array.from(text.matchAll(/<!subteam\^([S][A-Z0-9]+)(?:\|[^>]+)?>/g), m => m[1]));
    const common = groups.has(groupId);
    recipients.forEach(recipient => {
      const direct = users.has(recipient.id);
      if (!direct && !(common && members.has(recipient.id))) return;
      const url = 'https://' + message.sourceHost + '/archives/' + message.sourceChannel +
        '/p' + String(message.ts).replace('.', '') + '?thread_ts=' + message.sourceThreadTs;
      output.push({ pm: recipient.pm, category: direct ? 'direct' : 'group',
        ts: String(message.ts), text: String(message.text || ''), url,
        user: message.user ? String(message.user) : '',
        threadParentText: String(message.threadParentText || ''),
        threadKey: message.sourceChannel + '|' + message.sourceThreadTs });
    });
  });
  return output.sort((a, b) => Number(b.ts) - Number(a.ts) || a.pm.localeCompare(b.pm));
}

/**
 * 정기 발송 전 BBPM 채널을 미리 읽어 완료본을 만든다. 읽기 전용이며 Slack 발송은 없다.
 * 시간 트리거로 실행되면 수집 시간대에만 동작하고, 편집기에서 직접 실행하면 항상 수집한다.
 */
const BBPM_SNAPSHOT = Object.freeze({
  tabs: { A: 'BOT_SLACK_SNAPSHOT_A', B: 'BOT_SLACK_SNAPSHOT_B' }, slotKey: 'BBPM_SNAPSHOT_SLOT',
  maxAgeMinutes: 60, skipIfNewerMinutes: 25, windows: [['10:00', '11:15'], ['16:00', '17:15']],
});

function collectBbpmSnapshot(e) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  if (e) props.setProperty('BBPM_COLLECT_LAST_TRIGGER_AT', String(now.getTime()));
  if (e) {
    if (!isBbpmCollectWindow_(now)) return;
    // 주말에는 정기 DM이 없으므로 미리 수집도 쉰다. 편집기 수동 실행은 그대로 수집한다.
    if (!isBriefingWeekday_(now)) return;
    const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
    const saved = readBbpmSnapshot_(props, bot);
    if (saved && now.getTime() / 1000 - saved.meta.newest < BBPM_SNAPSHOT.skipIfNewerMinutes * 60) return;
  }
  props.setProperty('BBPM_COLLECT_STATUS', JSON.stringify({at:now.getTime(), status:'running',
    source:e ? 'trigger' : 'manual'}));
  try {
    const result = runBbpmCollectStep_(props, now);
    props.setProperty('BBPM_COLLECT_STATUS', JSON.stringify({at:Date.now(),
      status:result.pending ? 'pending' : 'complete', source:e ? 'trigger' : 'manual'}));
    console.log(result.progress);
  } catch (error) {
    props.setProperty('BBPM_COLLECT_STATUS', JSON.stringify({at:Date.now(), status:'error',
      source:e ? 'trigger' : 'manual'}));
    throw error;
  }
}

function isBbpmCollectWindow_(now) {
  const time = Utilities.formatDate(now, BRIEFING.timezone, 'HH:mm');
  return BBPM_SNAPSHOT.windows.some(([start, end]) => time >= start && time <= end);
}

function runBbpmCollectStep_(props, now) {
  requiredProperty_(props, 'BOT_SPREADSHEET_ID');
  if (props.getProperty('ENABLE_SLACK_MENTION_READ') !== 'true') throw new Error('Slack 멘션 읽기가 비활성입니다.');
  const config = readSlackMentionConfig_(props);
  if (!config.discovery) throw new Error('미리 수집은 ENABLE_SLACK_CHANNEL_DISCOVERY=true에서만 사용합니다.');
  config.deadline = Date.now() + SLACK_MENTIONS.timeLimitMs;
  // 완료본 게시까지 같은 점유를 유지한다. 수집 종료 직후 다른 실행이 끼어들지 않게 한다.
  if (!acquireBbpmLease_()) return {pending:true, progress:'다른 BBPM 수집이 진행 중입니다. 이번 실행 건너뜀'};
  config.scanLockHeld = true;
  try {
  let scan;
  try { scan = collectSlackMentionMessages_(config, now); }
  catch (error) {
    if (error.code === 'BUSY') return { pending: true, progress: error.message + ' | 이번 실행 건너뜀' };
    props.setProperty('BBPM_COLLECT_LAST_ERROR', JSON.stringify({ at: Date.now(), message: String(error.message).slice(0, 200) }));
    throw error;
  }
  if (scan.pending) return scan;
  const bot = SpreadsheetApp.openById(requiredProperty_(props, 'BOT_SPREADSHEET_ID'));
  const written = writeBbpmSnapshot_(bot, props, scan, config.groupId);
  props.deleteProperty('BBPM_COLLECT_LAST_ERROR');
  return { pending: false, scan, progress: 'BBPM 수집 완료 · 기준 ' +
    Utilities.formatDate(new Date(scan.newest * 1000), BRIEFING.timezone, 'yyyy-MM-dd HH:mm') +
    ' · 메시지 ' + scan.messageCount + '개 · 완료본 ' + (written ? '교체' : '변경 없음') + ' | Slack 발송 없음' };
  } finally { releaseBbpmLease_(); }
}

// 수집이 끝난 결과만 기록한다. 쓰는 동안에도 직전 완료본을 읽을 수 있게 두 탭을 번갈아 쓴다.
function writeBbpmSnapshot_(bot, props, scan, groupId) {
  const saved = readBbpmSnapshot_(props, bot);
  if (saved && saved.meta.newest === scan.newest) return false;
  const slot = props.getProperty(BBPM_SNAPSHOT.slotKey) === 'A' ? 'B' : 'A';
  const name = BBPM_SNAPSHOT.tabs[slot];
  const sheet = bot.getSheetByName(name) || bot.insertSheet(name);
  // 멘션이 없는 글은 분류 대상이 아니므로 저장하지 않는다.
  const messages = scan.messages.filter(message => /<@|<!subteam/.test(String(message.text || '')) &&
    Number(message.ts) >= scan.oldest && Number(message.ts) <= scan.newest).map(message => ({
    ts: message.ts, text: message.text, user: message.user, bot_id: message.bot_id, subtype: message.subtype,
    sourceChannel: message.sourceChannel, sourceHost: message.sourceHost,
    sourceThreadTs: message.sourceThreadTs, threadParentText: message.threadParentText }));
  const meta = { newest: scan.newest, oldest: scan.oldest, botId: scan.botId, groupId,
    members: scan.members, messageCount: scan.messageCount, savedAt: Date.now() };
  const rows = [meta].concat(messages).map(item => {
    const json = JSON.stringify(item);
    if (json.length > 49000) throw new Error('Slack 완료본 셀 크기 초과. 분할 저장이 필요합니다.');
    return [json];
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 1).setValues([['snapshot_json']]);
  sheet.getRange(2, 1, rows.length, 1).setValues(rows);
  props.setProperty(BBPM_SNAPSHOT.slotKey, slot);
  return true;
}

function readBbpmSnapshot_(props, bot) {
  const slot = props.getProperty(BBPM_SNAPSHOT.slotKey);
  const sheet = slot && BBPM_SNAPSHOT.tabs[slot] ? bot.getSheetByName(BBPM_SNAPSHOT.tabs[slot]) : null;
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(row => JSON.parse(row[0]));
  return { meta: values[0], messages: values.slice(1) };
}

// 발송용: 정해진 시간 안에 만든 완료본만 쓴다. 오래되거나 없으면 사유 코드와 함께 중지한다.
function loadFreshBbpmSnapshot_(props, bot, now) {
  const snapshot = readBbpmSnapshot_(props, bot);
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    error.lastAsOf = snapshot ? snapshot.meta.newest : 0;
    return error;
  };
  if (!snapshot) throw fail('NO_SNAPSHOT', '완료된 Slack 수집 결과가 없습니다. collectBbpmSnapshot으로 수집을 완료하세요.');
  const maxAge = Number(props.getProperty('SLACK_SNAPSHOT_MAX_AGE_MINUTES') || BBPM_SNAPSHOT.maxAgeMinutes);
  if (!Number.isFinite(maxAge) || maxAge < 1 || maxAge > 1440) {
    throw fail('INVALID_CONFIG', 'Slack 완료본 허용 시간은 1~1440분 숫자여야 합니다.');
  }
  const meta = snapshot.meta;
  const age = now.getTime() / 1000 - meta.newest;
  if (!Number.isFinite(meta.newest) || !Number.isFinite(meta.oldest) || meta.oldest > meta.newest ||
      !Array.isArray(meta.members) || age < -60) {
    throw fail('INVALID_SNAPSHOT', 'Slack 완료본 날짜·그룹 정보가 올바르지 않습니다. 다시 수집하세요.');
  }
  const groupId = props.getProperty('SLACK_PM_GROUP_ID');
  if (groupId && groupId !== meta.groupId) {
    throw fail('CONFIG_CHANGED', 'Slack PM 그룹 설정이 변경됐습니다. 다시 수집하세요.');
  }
  if (age > maxAge * 60) {
    throw fail('STALE', '최근 ' + maxAge + '분 안에 완료된 Slack 수집 결과가 없습니다.');
  }
  return snapshot;
}

function classifySlackSnapshot_(snapshot, recipients) {
  const meta = snapshot.meta;
  return classifySlackMentionMessages_(snapshot.messages, recipients, new Set(meta.members),
    meta.groupId, meta.oldest, meta.newest, meta.botId);
}
