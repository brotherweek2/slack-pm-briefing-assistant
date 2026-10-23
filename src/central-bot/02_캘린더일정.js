/**
 * 02. 캘린더일정
 * - 역할: PM 본인 연결(19번) 회의 캐시를 DM 회의 영역으로 표시
 * - 읽는 법: [직접 실행]은 편집기에서 선택, [내부]는 상위 함수가 필요한 인수를 전달해 자동 호출.
 * - 이름 끝 _ 는 내부 함수. 함수 식별자는 유지하므로 기존 트리거·호출 연결은 그대로 사용.
 * - 아래 번호는 안내 제목이며 실제 함수 이름 앞에 숫자를 입력하지 않는다.
 *
 * 02-01. 발송 직전 회의 조회 [내부]
 * - buildLiveCalendarSection_(route, props, slot, now): PM·이메일·Slack 연결을 확인하고 현재 시각의 개인 회의 문안을 만든다.
 * - ENABLE_SELF_CALENDAR_PIPELINE=true이면 본인 연결 앱의 최신 회의 캐시만 사용한다. 중앙 계정으로 대체 조회하지 않는다.
 *
 * 02-02. 일일 회의 문안 [내부]
 * - formatCalendarBriefing_(snapshot, includeTomorrow): 오늘 남은 회의와 선택적으로 내일 회의를 시간·제목·응답 상태로 표시한다.
 *
 * 02-03. 회의 영역 제목 [내부]
 * - calendarSectionTitle_(includeTomorrow): 오전은 오늘 회의, 오후는 오늘·내일을 담는 회의 제목을 만든다.
 * - 사용: 회의 문안 조립 시 자동 호출. 캘린더 조회·저장·DM 없음.
 */

// 실제 발송 직전에만 호출. 다른 PM에게 실행 계정의 개인 일정을 배포하지 않는다.
// viewFrom: 아침 시험처럼 실제 발송 시각과 다른 회차를 볼 때, 회의 목록을 그 시각(11:00) 기준으로 자른다.
function buildLiveCalendarSection_(route, props, slot, now, viewFrom) {
  if (props.getProperty('ENABLE_CALENDAR_BRIEFING') !== 'true') return '';
  // 개인 연결 모드에서는 중앙 실행 계정의 일정으로 대체하지 않는다.
  if (props.getProperty('ENABLE_SELF_CALENDAR_PIPELINE') === 'true') return selfCalendarSection_(route, props, slot, now, viewFrom);
  // 예전 중앙 계정 조회 방식은 제거됨(10/23). 본인 연결 방식이 꺼져 있으면 회의 영역에 그 사실만 알린다.
  return '\n\n📅 *회의*\n• 개인 캘린더 연결 방식이 꺼져 있습니다 (ENABLE_SELF_CALENDAR_PIPELINE)';
}

// 조회 시각은 발송부의 기준 줄에 모은다. 17시에는 오늘 남은 회의와 내일 회의를 한 목록으로 보인다.
function calendarSectionTitle_(includeTomorrow) {
  return '\n\n📅 *' + (includeTomorrow ? '회의' : '오늘 회의') + '*';
}

// 11시 문안은 includeTomorrow=false, 17시 문안은 true로 사용한다. 제목 줄은 호출부가 붙인다.
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
  }
  return '\n' + lines.join('\n');
}
