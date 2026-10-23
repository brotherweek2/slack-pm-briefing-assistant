/** All fixtures use synthetic PM names, Slack IDs, URLs and tokens. */
function runSlackMentionsChecks(load) {
  let checks = 0;
  const eq = (actual, expected, why) => {
    checks++;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(why + ': ' + JSON.stringify(actual));
  };
  const ok = (value, why) => { checks++; if (!value) throw new Error(why); };
  const throws = (fn, pattern, why) => {
    checks++;
    try { fn(); } catch (error) { if (pattern.test(error.message)) return; throw error; }
    throw new Error(why);
  };
  const ids = ['U00000001', 'U00000002', 'U00000003'];
  const groupId = 'S00000001';
  const now = new Date('2026-10-12T06:00:00Z');
  const newest = now.getTime() / 1000;
  const oldest = newest - 7 * 86400;
  const ts = offset => (newest + offset).toFixed(6);
  const common = {
    PropertiesService: {getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{}})},
    BRIEFING: { timezone: 'Asia/Seoul' },
    escapeSlack_: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    requiredProperty_: (props, key) => {
      const value = props.getProperty(key);
      if (!value) throw new Error('missing ' + key);
      return value;
    },
    Utilities: { formatDate: date => date.toISOString().slice(0, 16) },
  };
  const api = load(common);
  const recipients = api.selectSlackMentionRecipients_([
    ['PM A', ids[0], false], ['PM B', ids[1], false],
    ['PM C', ids[2], false], ['PM D', '', false],
  ]);
  eq(recipients.length, 3, 'preview does not enable sending and skips missing IDs');
  throws(() => api.selectSlackMentionRecipients_([['PM A', ids[0]], ['PM A', ids[1]]]), /중복/, 'duplicate name rejected');
  throws(() => api.selectSlackMentionRecipients_([['PM A', ids[0]], ['PM B', ids[0]]]), /같은 Slack ID/, 'duplicate ID rejected');
  const replyLink = 'https://example.slack.com/archives/C00000001/p1700000001000001?thread_ts=1700000000.000001';
  const root = api.parseSlackMentionThreadUrl_(replyLink);
  eq(root.ts, '1700000000.000001', 'reply link retains old parent timestamp');
  eq(api.parseSlackMentionThreadUrl_('https://example.slack.com/archives/C00000001/p1700000000000001').ts,
    root.ts, 'root link parses timestamp');
  throws(() => api.parseSlackMentionThreadUrl_('https://other.example/archives/C00000001/p1700000000000001'),
    /スレッド|스레드/, 'non-Slack URL rejected');
  const props = values => ({ getProperty: key => values[key] || null });
  const values = {
    SLACK_BOT_TOKEN: 'xoxb-TEST_ONLY', SLACK_PM_GROUP_ID: groupId,
    SLACK_MENTION_THREADS: JSON.stringify([replyLink, replyLink]),
  };
  const config = api.readSlackMentionConfig_(props(values));
  eq(config.threads.length, 1, 'duplicate source links collapse');
  eq(config.days, 7, 'default seven days');
  throws(() => api.readSlackMentionConfig_(props(Object.assign({}, values, { SLACK_BOT_TOKEN: 'xoxp-TEST_ONLY' }))),
    /봇 토큰/, 'user tokens rejected');
  throws(() => api.readSlackMentionConfig_(props(Object.assign({}, values, { SLACK_MENTION_LOOKBACK_DAYS: '0' }))),
    /조회 기간/, 'invalid lookback rejected');
  const message = (time, text, extra) => Object.assign({
    ts: time, text, sourceChannel: root.channel,
    sourceHost: root.host, sourceThreadTs: root.ts,
  }, extra || {});
  const messages = [
    message(ts(-60), '<@' + ids[0] + '> please check'),
    message(ts(-50), '<!subteam^' + groupId + '|pm-group> common notice'),
    message(ts(-40), '<@' + ids[0] + '> <!subteam^' + groupId + '> both'),
    message(ts(-40), '<@' + ids[0] + '> <!subteam^' + groupId + '> both'),
    message(ts(-30), '@PM A @pm-group plain names'),
    message(ts(-20), '\x60<@' + ids[0] + '>\x60 example'),
    message(ts(-10), '> <@' + ids[0] + '> quote'),
    message(ts(-5), '<@' + ids[0] + '> loop', { bot_id: 'B00000001' }),
    message(ts(60), '<@' + ids[0] + '> future'),
    message((oldest - 1).toFixed(6), '<@' + ids[0] + '> old'),
    message(ts(-4), '<@' + ids[0] + '> deleted', { subtype: 'tombstone' }),
  ];
  const records = api.classifySlackMentionMessages_(messages, recipients,
    new Set([ids[0], ids[1]]), groupId, oldest, newest, 'B00000001');
  eq(records.filter(x => x.pm === 'PM A' && x.category === 'direct').length, 2, 'direct messages and direct/group overlap once');
  eq(records.filter(x => x.pm === 'PM A' && x.category === 'group').length, 1, 'common notice separate');
  eq(records.filter(x => x.pm === 'PM B' && x.category === 'group').length, 2, 'group members only receive common notices');
  eq(records.filter(x => x.pm === 'PM C').length, 0, 'nonmembers excluded');
  ok(records.every(x => x.url.includes('thread_ts=' + root.ts)), 'links point to relevant reply and original thread');


  const limited = load(Object.assign({}, common, {
    UrlFetchApp: { fetch: () => ({
      getResponseCode: () => 429, getAllHeaders: () => ({ 'Retry-After': '30' }),
    }) },
  }));
  throws(() => limited.slackMentionReadApi_('conversations.replies', {}, config.token, { calls: 0 }),
    /30초/, 'rate-limit stops without a false zero result');
  throws(() => limited.slackMentionReadApi_('chat.postMessage', {}, config.token, { calls: 0 }),
    /허용하지 않은 API/, 'sending endpoint never allowed');
  const missing = load(Object.assign({}, common, {
    UrlFetchApp: { fetch: () => ({
      getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: false, error: 'missing_scope' }),
    }) },
  }));
  throws(() => missing.slackMentionReadApi_('conversations.replies', {}, config.token, { calls: 0 }),
    /missing_scope/, 'permission errors are explicit');
  let crossCalls = 0;
  const cross = load(Object.assign({}, common, {
    UrlFetchApp: { fetch: () => {
      crossCalls++;
      return { getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ ok: true, url: 'https://different.slack.com/', bot_id: 'B00000001' }) };
    } },
  }));
  throws(() => cross.collectSlackMentionMessages_(config, now), /워크스페이스가 다릅니다/, 'cross-workspace source rejected');
  eq(crossCalls, 1, 'wrong workspace stops before reading membership/messages');
  return checks;
}

if (typeof module !== 'undefined' && module.exports) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync('src/central-bot/03_슬랙수집.js', 'utf8');
  const load = globals => {
    const context = vm.createContext(globals);
    vm.runInContext(source, context);
    return vm.runInContext('({ readSlackMentionConfig_, parseSlackMentionThreadUrl_, selectSlackMentionRecipients_, ' +
      'collectSlackMentionMessages_, slackMentionReadApi_, classifySlackMentionMessages_ })', context);
  };
  console.log('Slack mention checks passed: ' + runSlackMentionsChecks(load));
}
