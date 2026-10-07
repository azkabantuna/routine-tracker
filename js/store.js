window.RT = window.RT || {};

// 저장소: localStorage 키 'routineTracker' 하나만 쓴다.
// 이 파일은 화면에 직접 그리지 않는다. 문제가 생기면 loadError / saveError 에 표시만 남기고,
// 안내 문구는 app.js 가 보여 준다.
(function (RT) {
  var KEY = 'routineTracker';
  var BACKUP_KEY = 'routineTracker.backup';
  var VERSION = 1;
  var LEVELS = ['mini', 'more', 'max'];

  function emptyState() {
    return { version: VERSION, routines: [], logs: {}, celebratedOn: null };
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isValid(data) {
    return isPlainObject(data) &&
      data.version === VERSION &&
      Array.isArray(data.routines) &&
      isPlainObject(data.logs);
  }

  var store = {
    state: emptyState(),
    loadError: null, // 예: 'corrupt' | 'version' | 'unavailable'
    saveError: null, // 예: 'quota'
    LEVELS: LEVELS
  };

  store.load = function () {
    var raw = null;
    store.loadError = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      store.loadError = 'unavailable';
      store.state = emptyState();
      return store.state;
    }
    if (raw === null) {
      store.state = emptyState();
      return store.state;
    }
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = undefined;
    }
    if (data === undefined || !isValid(data)) {
      store.loadError = (data !== undefined && isPlainObject(data) && data.version !== VERSION) ? 'version' : 'corrupt';
      try {
        window.localStorage.setItem(BACKUP_KEY, raw);
      } catch (e) {
        // 백업도 못 하면 그냥 넘어간다 (원본은 덮어쓰기 전까지 그대로 남아 있음)
      }
      store.state = emptyState();
      return store.state;
    }
    if (!('celebratedOn' in data)) data.celebratedOn = null;
    store.state = data;
    return store.state;
  };

  // 저장 성공하면 true, 실패하면 false (saveError 표시)
  store.save = function () {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(store.state));
      store.saveError = null;
      return true;
    } catch (e) {
      store.saveError = 'fail';
      return false;
    }
  };

  store.newId = function () {
    return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  // 만든 순서대로 정렬된 루틴 목록 (복사본)
  store.getRoutines = function () {
    return store.state.routines.slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  };

  store.getRoutine = function (id) {
    for (var i = 0; i < store.state.routines.length; i++) {
      if (store.state.routines[i].id === id) return store.state.routines[i];
    }
    return null;
  };

  function clean(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  // 이모지: 한 개짜리 이모지만 통과. 아니면 '' (저장하지 않음)
  function cleanEmoji(v) {
    var s = clean(v);
    return s && RT.emoji && RT.emoji.isSingleEmoji(s) ? s : '';
  }

  // fields: { name, mini, more, max, emoji(선택) }. 이름이 비면 null 을 돌려주고 아무것도 바꾸지 않는다.
  store.addRoutine = function (fields) {
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

  store.updateRoutine = function (id, fields) {
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
  store.deleteRoutine = function (id) {
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
  store.getLevel = function (date, id) {
    var day = store.state.logs[date];
    if (!isPlainObject(day)) return null;
    return LEVELS.indexOf(day[id]) >= 0 ? day[id] : null;
  };

  // 오늘 강도 누르기: 같은 강도면 취소, 다르면 바꾸기. 결과 강도(또는 null)를 돌려준다.
  store.toggleLevel = function (date, id, level) {
    if (LEVELS.indexOf(level) < 0) return store.getLevel(date, id);
    var logs = store.state.logs;
    var current = store.getLevel(date, id);
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

  RT.store = store;
  store.load();
})(window.RT);
