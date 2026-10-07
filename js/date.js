window.RT = window.RT || {};

// 날짜 도우미: 모두 "휴대폰의 지역 시간" 기준 YYYY-MM-DD 문자열을 쓴다.
// UTC 기준 ISO 문자열 변환은 UTC 라 한국 오전 9시 전에 하루가 밀리므로 쓰지 않는다.
(function (RT) {
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Date 객체 -> 지역 시간 'YYYY-MM-DD'
  RT.formatDate = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  // 오늘 날짜 (부를 때마다 new Date() 로 새로 계산)
  RT.today = function () {
    return RT.formatDate(new Date());
  };

  // 'YYYY-MM-DD' -> 지역 시간 Date (자정)
  RT.parseDate = function (str) {
    var p = String(str).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };

  // 'YYYY-MM-DD' 에 n 일 더하기 (음수면 빼기)
  RT.addDays = function (str, n) {
    var p = String(str).split('-');
    return RT.formatDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  };

  // 화면용 한국어 날짜: '10월 7일 수요일'
  RT.koreanDate = function (str) {
    var d = RT.parseDate(str);
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + days[d.getDay()] + '요일';
  };
})(window.RT);
