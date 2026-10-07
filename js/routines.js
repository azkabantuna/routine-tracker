window.RT = window.RT || {};

// 루틴 기능: 추가·수정·삭제와 오늘 강도 기록. 저장은 RT.store 를 통해서만 한다.
// 이 파일은 화면에 직접 그리지 않는다.
(function (RT) {
  var store = RT.store;
  var LEVELS = store.LEVELS;
  var routines = {};

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function clean(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  // 이모지: 한 개짜리 이모지만 통과. 아니면 '' (저장하지 않음)
  function cleanEmoji(v) {
    var s = clean(v);
    return s && RT.emoji && RT.emoji.isSingleEmoji(s) ? s : '';
  }

  // fields: { name, mini, more, max, emoji(선택) }. 이름이 비면 null 을 돌려주고 아무것도 바꾸지 않는다.
  routines.addRoutine = function (fields) {
    var name = clean(fields.name);
    if (!name) return null;
    var maxOrder = -1;
    store.state.routines.forEach(function (r) {
      if (typeof r.order === 'number' && r.order > maxOrder) maxOrder = r.order;
    });
    var routine = {
      id: store.newId(),
      name: name,
      mini: clean(fields.mini),
      more: clean(fields.more),
      max: clean(fields.max),
      createdAt: RT.today(),
      order: maxOrder + 1
    };
    var emoji = cleanEmoji(fields.emoji);
    if (emoji) routine.emoji = emoji;
    store.state.routines.push(routine);
    store.save();
    return routine;
  };

  routines.updateRoutine = function (id, fields) {
    var name = clean(fields.name);
    var r = store.getRoutine(id);
    if (!r || !name) return null;
    r.name = name;
    r.mini = clean(fields.mini);
    r.more = clean(fields.more);
    r.max = clean(fields.max);
    // emoji 는 fields 에 있을 때만 바꾼다 (없으면 기존 값 유지, 빈 값·틀린 값이면 키 삭제)
    if ('emoji' in fields) {
      var emoji = cleanEmoji(fields.emoji);
      if (emoji) r.emoji = emoji;
      else delete r.emoji;
    }
    store.save();
    return r;
  };

  // 루틴 삭제 + 모든 날짜에서 그 루틴 기록 삭제 + 비게 된 날짜 객체 삭제
  routines.deleteRoutine = function (id) {
    store.state.routines = store.state.routines.filter(function (r) {
      return r.id !== id;
    });
    var logs = store.state.logs;
    Object.keys(logs).forEach(function (date) {
      var day = logs[date];
      if (isPlainObject(day)) {
        delete day[id];
        if (Object.keys(day).length === 0) delete logs[date];
      } else {
        delete logs[date];
      }
    });
    store.save();
  };

  // 그 날 그 루틴의 강도 ('mini'|'more'|'max' 또는 null)
  routines.getLevel = function (date, id) {
    var day = store.state.logs[date];
    if (!isPlainObject(day)) return null;
    return LEVELS.indexOf(day[id]) >= 0 ? day[id] : null;
  };

  // 오늘 강도 누르기: 같은 강도면 취소, 다르면 바꾸기. 결과 강도(또는 null)를 돌려준다.
  routines.toggleLevel = function (date, id, level) {
    if (LEVELS.indexOf(level) < 0) return routines.getLevel(date, id);
    var logs = store.state.logs;
    var current = routines.getLevel(date, id);
    var result;
    if (current === level) {
      if (isPlainObject(logs[date])) {
        delete logs[date][id];
        if (Object.keys(logs[date]).length === 0) delete logs[date];
      }
      result = null;
    } else {
      if (!isPlainObject(logs[date])) logs[date] = {};
      logs[date][id] = level;
      result = level;
    }
    store.save();
    return result;
  };

  RT.routines = routines;
})(window.RT);
