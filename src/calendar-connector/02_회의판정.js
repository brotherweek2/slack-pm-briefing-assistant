/**
 * 연결 앱 02. 회의판정 — 본인이 참석·생성한 일정만 고르기
 *
 * 알아둘 것
 * - 공유 캘린더 소유권·이름만으로 참석을 추정하지 않는다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - collectMyCalendarEvents_(calendar, now, options): 한 캘린더에서 본인이 참석·생성한 일정만 골라 오늘·내일로 나눈다
 */
const BRIEFING = {timezone:'Asia/Seoul'};

function collectMyCalendarEvents_(calendar, now, options) {
  options = options || {};
  const day = Utilities.formatDate(now, BRIEFING.timezone, 'yyyy-MM-dd');
  // BRIEFING은 Asia/Seoul. 서버/기기 시간대 대신 명시된 +09:00 경계를 사용한다.
  const start = new Date(day + 'T00:00:00+09:00');
  const tomorrowStart = new Date(start.getTime() + 86400000);
  const tomorrowEnd = new Date(start.getTime() + 2 * 86400000);
  const days = options.days === undefined ? 2 : options.days;
  if (!Number.isInteger(days) || days < 2 || days > 8) throw new Error('캘린더 조회 범위는 2~8일이어야 합니다.');
  const limit = new Date(start.getTime() + days * 86400000);
  const tomorrow = Utilities.formatDate(tomorrowStart, BRIEFING.timezone, 'yyyy-MM-dd');
  const raw = calendar.getEvents(now, limit);
  if (raw.length > 500) throw new Error('조회 일정이 500건을 넘어 미리보기를 중지합니다.');
  const seen = new Set();
  const declinedKeys = [];
  let notInvited = 0;
  const events = raw.flatMap(event => {
    const type = typeof event.getEventType === 'function' ? String(event.getEventType()) : 'DEFAULT';
    if (['FOCUS_TIME', 'OUT_OF_OFFICE', 'WORKING_LOCATION', 'BIRTHDAY'].includes(type)) return [];
    const begins = event.getStartTime();
    const ends = event.getEndTime();
    if (ends.getTime() <= now.getTime() || begins.getTime() >= limit.getTime()) return [];
    const key = event.getId() + '|' + begins.getTime();
    // 공유 캘린더 소유권이나 이름/제목 일치로 본인 참석을 추정하지 않는다.
    const guest = options.account ? event.getGuestByEmail(options.account) : null;
    if (options.requireInvitation && (!guest ||
        String(guest.getEmail()).toLowerCase() !== options.account.toLowerCase())) {
      notInvited++; return [];
    }
    // getMyStatus는 실행 계정 기준이라, 다른 PM의 캘린더에서는 쓰지 않는다.
    const status = guest ? String(guest.getGuestStatus()) : options.ownerCalendar ? 'OWNER' : String(event.getMyStatus());
    if (status === 'NO') {declinedKeys.push(key); return [];}
    if (!['YES', 'OWNER', 'MAYBE', 'INVITED'].includes(status)) {notInvited++; return [];}
    if (options.meetingsOnly && !options.requireInvitation) {
      const invitedSelf = guest && status !== 'OWNER';
      const otherPerson = !invitedSelf && event.getGuestList().some(person => {
        const email = String(person.getEmail() || '').toLowerCase();
        return email && email !== options.account.toLowerCase() &&
          !/@(?:resource\.)?calendar\.google\.com$/.test(email);
      });
      if (!invitedSelf && !otherPerson) return [];
    }
    if (seen.has(key)) return [];
    seen.add(key);
    const allDay = event.isAllDayEvent();
    const privateEvent = String(event.getVisibility()) === 'PRIVATE';
    return [{key, title:privateEvent ? '비공개 일정' : String(event.getTitle() || '제목 없는 일정'),
      start:begins.getTime(), end:ends.getTime(), allDay,
      status:status === 'INVITED' ? '응답 전' : status === 'MAYBE' ? '참석 미정' : '',
    }];
  }).sort((a,b) => a.start-b.start || a.title.localeCompare(b.title));
  return {day, tomorrowDay:tomorrow, now:now.getTime(), until:limit.getTime(), events, declinedKeys, notInvited,
    today:events.filter(event => event.start < tomorrowStart.getTime() && event.end > now.getTime()),
    tomorrow:events.filter(event => event.start < tomorrowEnd.getTime() && event.end > tomorrowStart.getTime())};
}
