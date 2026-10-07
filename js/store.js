window.RT = window.RT || {};

// 저장소: localStorage 키 'routineTracker' 하나만 쓴다.
// 이 파일은 화면에 직접 그리지 않는다. 문제가 생기면 loadError / saveError 에 표시만 남기고,
// 안내 문구는 screens.js 가 보여 준다.
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

  RT.store = store;
  store.load();
})(window.RT);
