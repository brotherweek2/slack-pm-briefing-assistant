/**
 * 02. 캘린더일정 — 회의 영역 문안(오늘·내일, 겹침·응답 전 안내)
 *
 * 알아둘 것
 * - PM 본인 연결 앱이 보낸 최신 회의만 쓴다. 중앙 계정으로 대신 조회하지 않는다.
 *
 * 내부 함수 (직접 실행하지 않음)
 * - buildLiveCalendarSection_(route, props, slot, now, viewFrom, allowStale): PM·이메일·Slack 연결을 확인하고 현재 시각의 개인 회의 문안을 만든다
 * - calendarSectionTitle_(includeTomorrow): 오전은 오늘 회의, 오후는 오늘·내일을 담는 회의 제목을 만든다
 * - formatCalendarBriefing_(snapshot, includeTomorrow): 오늘 남은 회의와 선택적으로 내일 회의를 시간·제목·응답 상태로 표시한다
 * - calendarMeetingNotes_(snapshot, includeTomorrow): 회의 영역 끝 안내: 겹치는 회의, 응답하지 않은 초대
 */

// 실제 발송 직전에만 호출. 다른 PM에게 실행 계정의 개인 일정을 배포하지 않는다.
// viewFrom: 아침 시험처럼 실제 발송 시각과 다른 회차를 볼 때, 회의 목록을 그 시각(11:00) 기준으로 자른다.
// allowStale: 본인 시험·미리보기. 회의 갱신이 20분 넘게 지나도 오늘 받은 마지막 일정을 보여 준다.
function buildLiveCalendarSection_(route, props, slot, now, viewFrom, allowStale) {
  if (props.getProperty('ENABLE_CALENDAR_BRIEFING') !== 'true') return '';
  // 개인 연결 모드에서는 중앙 실행 계정의 일정으로 대체하지 않는다.
  if (props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') === 'true') return selfCalendarSection_(route, props, slot, now, viewFrom, allowStale);
  // 예전 중앙 계정 조회 방식은 제거됨(10/23). 본인 연결 방식이 꺼져 있으면 회의 영역에 그 사실만 알린다.
  return '\n\n📅 *회의*\n• 개인 캘린더 연결 방식이 꺼져 있습니다 (ENABLE_SELF_CALENDAR_PIPELINE)';
}

// 조회 시각은 발송부의 기준 줄에 모은다. 17:00에는 오늘 남은 회의와 내일 회의를 한 목록으로 보인다.
function calendarSectionTitle_(includeTomorrow) {
  return '\n\n📅 *' + (includeTomorrow ? '회의' : '오늘 회의') + '*';
}

// 10:30 문안은 includeTomorrow=false, 17:00 문안은 true로 사용한다. 제목 줄은 호출부가 붙인다.
function formatCalendarBriefing_(snapshot, includeTomorrow) {
  const lines = [];
  const append = (prefix, day, events, emptyText) => {
    if (!events.length) {lines.push('• ' + emptyText); return;}
    events.forEach(event => {
      const eventDay = Utilities.formatDate(new Date(event.start), BRIEFING.timezone, 'yyyy-MM-dd');
      const ongoing = event.start < snapshot.now && day === snapshot.day;
      const label = event.allDay ? '종일' : ongoing ? '진행 중' : eventDay < day ? '전날부터' :
        Utilities.formatDate(new Date(event.start), BRIEFING.timezone, 'HH:mm');
      lines.push('• ' + prefix + label + ' ' + escapeSlack_(event.title.replace(/[\r\n]+/g, ' ')) +
        (event.status ? ' · ' + event.status : ''));
    });
  };
  if (!includeTomorrow) append('', snapshot.day, snapshot.today, '남은 회의 없음');
  else {
    append('오늘 ', snapshot.day, snapshot.today, '오늘 남은 회의 없음');
    append('내일 ', snapshot.tomorrowDay, snapshot.tomorrow, '내일 회의 없음');
    // 17:00: 내일 첫 일정이 10시 전이면 눈에 띄게 표시한다.
    const first = snapshot.tomorrow.filter(event => !event.allDay)
      .sort((a, b) => a.start - b.start)[0];
    if (first && Number(Utilities.formatDate(new Date(first.start), BRIEFING.timezone, 'HH')) < 10) {
      const at = lines.findIndex(line => line.startsWith('• 내일 ' + Utilities.formatDate(new Date(first.start), BRIEFING.timezone, 'HH:mm') + ' '));
      if (at >= 0) lines[at] += ' · 🌅 이른 시작';
    }
  }
  lines.push(...calendarMeetingNotes_(snapshot, includeTomorrow));
  return '\n' + lines.join('\n');
}

// 회의 영역 끝 안내: 겹치는 회의, 응답하지 않은 초대. 없으면 아무 줄도 추가하지 않는다.
function calendarMeetingNotes_(snapshot, includeTomorrow) {
  const notes = [];
  const time = value => Utilities.formatDate(new Date(value), BRIEFING.timezone, 'HH:mm');
  const overlaps = (events, prefix) => {
    const timed = events.filter(event => !event.allDay).sort((a, b) => a.start - b.start);
    for (let i = 1; i < timed.length; i++) {
      const before = timed.slice(0, i).find(event => event.end > timed[i].start);
      if (before) notes.push('• ⚠️ ' + prefix + '회의 겹침: ' + time(before.start) + ' ' + escapeSlack_(before.title.replace(/[\r\n]+/g, ' ')) +
        ' ↔ ' + time(timed[i].start) + ' ' + escapeSlack_(timed[i].title.replace(/[\r\n]+/g, ' ')));
    }
  };
  overlaps(snapshot.today, includeTomorrow ? '오늘 ' : '');
  if (includeTomorrow) overlaps(snapshot.tomorrow, '내일 ');
  const pending = snapshot.today.concat(includeTomorrow ? snapshot.tomorrow : []).filter(event => event.status === '응답 전').length;
  // 1건이면 그 회의 줄의 '응답 전'으로 충분하다. 2건 이상일 때만 모아서 알린다.
  if (pending >= 2) notes.push('• 📨 응답 전 초대 ' + pending + '건 — 캘린더에서 참석 여부를 눌러주세요');
  return notes;
}
