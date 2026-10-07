window.RT = window.RT || {};

// 스트릭 계산: 저장된 기록을 "읽기만" 한다 (저장·수정 없음). logs 구조: {날짜: {루틴id: 강도}}
(function (RT) {
  var RANK = { mini: 1, more: 2, max: 3 };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // 그 날 가장 높은 강도 ('mini'|'more'|'max'), 기록 없으면 null
  RT.dayLevel = function (logs, date) {
    var day = logs && has(logs, date) ? logs[date] : null;
    if (!day || typeof day !== 'object') return null;
    var best = null;
    for (var id in day) {
      if (!has(day, id)) continue;
      var lv = day[id];
      if (typeof lv === 'string' && has(RANK, lv) && (!best || RANK[lv] > RANK[best])) best = lv;
    }
    return best;
  };

  // end 날짜부터 거꾸로 이어진 날 수 (has(date) 가 참인 동안)
  function run(end, hasFn) {
    var n = 0, d = end;
    while (hasFn(d) && n < 36600) { n++; d = RT.addDays(d, -1); }
    return n;
  }

  // 루틴 하나의 연속 일수 (오늘 했으면 오늘까지, 아직이면 어제까지)
  RT.routineStreak = function (logs, id, today) {
    function has1(d) {
      var day = logs && has(logs, d) ? logs[d] : null;
      return !!(day && typeof day === 'object' && has(day, id) && has(RANK, day[id]));
    }
    return run(has1(today) ? today : RT.addDays(today, -1), has1);
  };

  // 루틴 1개 이상 한 날 기준 전체 연속 일수
  RT.totalStreak = function (logs, today) {
    return RT.streakInfo(logs, today).count;
  };

  // {count, state}: state = 'today'(오늘 함) | 'pending'(아직, 어제까지 이어짐) | 'none'(0)
  RT.streakInfo = function (logs, today) {
    function hasAny(d) { return RT.dayLevel(logs, d) !== null; }
    if (hasAny(today)) return { count: run(today, hasAny), state: 'today' };
    var c = run(RT.addDays(today, -1), hasAny);
    return { count: c, state: c > 0 ? 'pending' : 'none' };
  };
})(window.RT);
