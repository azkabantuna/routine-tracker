window.RT = window.RT || {};

// 타이머 탭: 끝나는 시각(Date.now) 기준으로 남은 시간을 계산한다. 저장은 'routineTimer' 하나뿐
// ('routineTracker' 는 읽지도 쓰지도 않음).
(function (RT) {
  var root = document.getElementById('screen-timer');
  var cover = document.getElementById('timer-cover');
  if (!root || !cover) return;
  var $ = function (t) { return document.querySelector('[data-testid="' + t + '"]'); };

  var KEY = 'routineTimer';
  var MIN = 1, MAX = 180, DEFAULT = 25;
  var C = 2 * Math.PI * 45; // 원 둘레 (반지름 45, viewBox 100)

  var timeEl = $('timer-time'), ringEl = $('timer-ring'), minEl = $('timer-min'), errEl = $('timer-min-error');
  var startBtn = $('timer-start'), pauseBtn = $('timer-pause'), resetBtn = $('timer-reset');
  var fsBtn = $('timer-fs'), doneEl = $('timer-done');
  var coverTimeEl = $('timer-cover-time'), coverRingEl = $('timer-cover-ring'), closeBtn = $('timer-cover-close');

  var minutes = DEFAULT;
  var state = 'idle';     // idle | running | paused | done
  var endAt = 0;          // running 일 때 끝나는 시각 (ms)
  var leftMs = 0;         // paused 일 때 남은 ms
  var interval = null;
  var shownSec = -1;
  var wakeLock = null;

  function valid(n) { return typeof n === 'number' && n % 1 === 0 && n >= MIN && n <= MAX; }
  function total() { return minutes * 60000; }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var n = JSON.parse(raw).minutes;
        if (valid(n)) minutes = n;
      }
    } catch (e) { /* 읽기 실패: 기본값 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ minutes: minutes })); } catch (e) { /* 저장 실패해도 동작 */ }
  }

  function fmt(sec) {
    var s = sec % 60;
    return Math.floor(sec / 60) + ':' + (s < 10 ? '0' : '') + s;
  }

  function currentLeftMs() {
    if (state === 'running') return Math.max(0, endAt - Date.now());
    if (state === 'paused') return leftMs;
    if (state === 'done') return 0;
    return total();
  }

  // 글자·원 그리기. 남은 초가 바뀔 때만 DOM 을 만진다 (force 면 무조건)
  function draw(force) {
    var ms = currentLeftMs();
    var sec = Math.ceil(ms / 1000);
    if (!force && sec === shownSec) return;
    shownSec = sec;
    var ratio = Math.max(0, Math.min(1, ms / total()));
    if (state === 'idle') ratio = 1;
    var text = fmt(sec);
    var ratioStr = ratio.toFixed(3);
    var off = String(C * (1 - ratio));
    timeEl.textContent = text;
    coverTimeEl.textContent = text;
    [ringEl, coverRingEl].forEach(function (r) {
      r.setAttribute('stroke-dasharray', String(C));
      r.setAttribute('stroke-dashoffset', off);
      r.setAttribute('data-timer-ratio', ratioStr);
      r.setAttribute('data-timer-left', String(sec));
    });
  }

  function drawState() {
    root.setAttribute('data-timer-state', state);
    cover.setAttribute('data-timer-state', state);
    minEl.disabled = !(state === 'idle' || state === 'done');
    startBtn.hidden = state === 'running';
    startBtn.disabled = false;
    startBtn.textContent = state === 'paused' ? '이어서' : (state === 'done' ? '다시 시작' : '시작');
    pauseBtn.hidden = state !== 'running';
    fsBtn.hidden = !(state === 'running' || state === 'paused');
    doneEl.hidden = state !== 'done';
    if (state === 'idle') closeCover();
  }

  function stopTick() { if (interval) { clearInterval(interval); interval = null; } }
  function startTick() { stopTick(); interval = setInterval(tick, 250); }

  function tick() {
    if (state !== 'running') return;
    if (endAt - Date.now() <= 0) {
      state = 'done';
      stopTick();
      drawState();
      draw(true);
      return;
    }
    draw(false);
  }

  function start() {
    if (state === 'running') return;
    if (state !== 'paused') leftMs = total();
    endAt = Date.now() + leftMs;
    state = 'running';
    hideError();
    startTick();
    drawState();
    draw(true);
  }
  function pause() {
    if (state !== 'running') return;
    leftMs = Math.max(0, endAt - Date.now());
    state = 'paused';
    stopTick();
    drawState();
    draw(true);
  }
  function reset() {
    stopTick();
    state = 'idle';
    leftMs = total();
    hideError();
    minEl.value = String(minutes);
    drawState();
    draw(true);
  }

  // ---------- 분 입력 (1~180 정수만) ----------
  function hideError() { errEl.hidden = true; }
  minEl.addEventListener('input', function () {
    var t = minEl.value.trim();
    var n = /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
    if (!valid(n)) { errEl.hidden = false; return; } // 값·저장은 그대로
    hideError();
    minutes = n;
    save();
    if (state === 'done') { state = 'idle'; drawState(); }
    leftMs = total();
    draw(true);
  });
  minEl.addEventListener('change', function () { minEl.value = String(minutes); }); // 빠져나갈 때 마지막 올바른 값으로

  // ---------- 검은 덮개 ----------
  function noop() {}
  function openCover() {
    cover.hidden = false;
    draw(true);
    try {
      var p = cover.requestFullscreen && cover.requestFullscreen();
      if (p && p.catch) p.catch(noop);
    } catch (e) { /* 조용히 */ }
    requestLock();
    try { closeBtn.focus(); } catch (e) { /* 조용히 */ }
  }
  function requestLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        var p = navigator.wakeLock.request('screen');
        if (p && p.then) p.then(function (l) { wakeLock = l; }, noop);
      }
    } catch (e) { /* 조용히 */ }
  }
  function closeCover() {
    if (cover.hidden) return;
    cover.hidden = true;
    try { if (wakeLock && wakeLock.release) { var r = wakeLock.release(); if (r && r.catch) r.catch(noop); } } catch (e) { /* 조용히 */ }
    wakeLock = null;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(noop);
      }
    } catch (e) { /* 조용히 */ }
  }

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);
  fsBtn.addEventListener('click', openCover);
  closeBtn.addEventListener('click', closeCover);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCover(); });

  // 돌아오면 바로 다시 계산 (숨은 동안 타이머가 느려졌어도 끝나는 시각 기준이라 정확)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (state === 'running') tick();
    if (!cover.hidden && !wakeLock) requestLock();
  });

  // ---------- 시작 ----------
  load();
  minEl.value = String(minutes);
  leftMs = total();
  drawState();
  draw(true);

  RT.timer = { start: start, pause: pause, reset: reset };
})(window.RT);
