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
  var viewRingBtn = $('timer-view-ring'), viewTilesBtn = $('timer-view-tiles'), soundBtn = $('timer-sound'), unitEl = $('timer-unit');
  var KEY_VIEW = 'routineTimerView', KEY_SOUND = 'routineTimerSound';
  var N = 25;
  // 남은 비율 색 정지점 (앱 변수와 같은 색): 1 --more, 2/3 --mini, 1/3 --max, 0 --primary
  var STOPS = [[255, 122, 61], [255, 184, 0], [139, 209, 124], [77, 168, 255]]; // index = ratio*3 의 정수 구간

  var minutes = DEFAULT;
  var state = 'idle';     // idle | running | paused | done
  var endAt = 0;          // running 일 때 끝나는 시각 (ms)
  var leftMs = 0;         // paused 일 때 남은 ms
  var interval = null;
  var shownSec = -1;
  var wakeLock = null;
  var view = 'ring';      // ring | tiles
  var soundOn = true;
  var audioCtx = null;
  var raf = 0;
  var lastOff = -1;
  var shownColor = '';
  var sets = [];          // 타일 묶음 (화면용, 덮개용)

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
  function loadPrefs() {
    try { if (localStorage.getItem(KEY_VIEW) === 'tiles') view = 'tiles'; } catch (e) { /* 기본값 */ }
    try { if (localStorage.getItem(KEY_SOUND) === 'off') soundOn = false; } catch (e) { /* 기본값 */ }
  }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
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

  function colorAt(ratio) {
    var u = Math.max(0, Math.min(1, ratio)) * 3;
    var i = Math.min(2, Math.floor(u)), t = u - i;
    var c0 = STOPS[i], c1 = STOPS[i + 1];
    return [0, 1, 2].map(function (k) { return Math.round(c0[k] + (c1[k] - c0[k]) * t); });
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function fmtSec(x) { return x.toFixed(1).replace(/\.0$/, ''); }
  function unitText() {
    var cell = minutes * 60 / N;
    if (cell < 60) return '1칸 = ' + fmtSec(cell) + '초';
    var m = Math.floor(cell / 60), sec = cell - m * 60;
    return '1칸 = ' + m + '분' + (sec >= 0.05 ? ' ' + fmtSec(sec) + '초' : '');
  }

  function buildTiles(el) {
    var set = { el: el, tiles: [], fills: [], bars: [] };
    for (var i = 0; i < N; i++) {
      var t = document.createElement('div');
      t.className = 'timer-tile';
      t.setAttribute('data-tile-i', String(i));
      t.setAttribute('data-tile', 'empty');
      t.style.setProperty('--wave-delay', (i * 30) + 'ms');
      var bar = document.createElement('span');
      bar.className = 'timer-fill';
      bar.style.transform = 'scaleY(0)';
      t.appendChild(bar);
      el.appendChild(t);
      set.tiles.push(t); set.bars.push(bar); set.fills.push(0);
    }
    return set;
  }
  function popTile(t) {
    t.classList.remove('tile-pop');
    void t.offsetWidth;
    t.classList.add('tile-pop');
    setTimeout(function () { t.classList.remove('tile-pop'); }, 220);
  }
  function paintTiles(p, animate) {
    var passed = p * N;
    sets.forEach(function (set) {
      for (var i = 0; i < N; i++) {
        var v = Math.max(0, Math.min(1, passed - i));
        v = Math.round(v * 1000) / 1000;
        var old = set.fills[i];
        if (v === old) continue;
        set.fills[i] = v;
        set.bars[i].style.transform = 'scaleY(' + v + ')';
        set.tiles[i].setAttribute('data-tile', v >= 1 ? 'full' : (v > 0 ? 'filling' : 'empty'));
        if (animate && v >= 1 && old < 1) popTile(set.tiles[i]);
      }
    });
  }

  // 그림(링 길이·칸 채움)만: rAF 에서도 부른다. 글자·색은 건드리지 않는다
  function paint(force, animate) {
    var ms = currentLeftMs();
    var ratio = Math.max(0, Math.min(1, ms / total()));
    if (state === 'idle') ratio = 1;
    if (view === 'tiles') {
      paintTiles(1 - ratio, animate);
    } else {
      var off = C * (1 - ratio);
      if (force || Math.abs(off - lastOff) >= 0.05) {
        lastOff = off;
        var o = String(off);
        ringEl.setAttribute('stroke-dashoffset', o);
        coverRingEl.setAttribute('stroke-dashoffset', o);
      }
    }
  }

  // 글자·색·원 그리기. 남은 초가 바뀔 때만 DOM 을 만진다 (force 면 무조건)
  function draw(force) {
    var ms = currentLeftMs();
    var sec = Math.ceil(ms / 1000);
    if (!force && sec === shownSec) return;
    shownSec = sec;
    var ratio = Math.max(0, Math.min(1, ms / total()));
    if (state === 'idle') ratio = 1;
    var text = fmt(sec);
    var ratioStr = ratio.toFixed(3);
    var cr = state === 'idle' ? 1 : Math.min(1, sec * 1000 / total());
    var col = rgb(colorAt(cr)), col2 = rgb(colorAt(cr).map(function (v) { return Math.round(v * 0.82); })); // 같은 계열의 조금 진한 색
    timeEl.textContent = text;
    coverTimeEl.textContent = text;
    [ringEl, coverRingEl].forEach(function (r) {
      r.setAttribute('stroke-dasharray', String(C));
      r.setAttribute('data-timer-ratio', ratioStr);
      r.setAttribute('data-timer-left', String(sec));
      r.setAttribute('data-timer-color', col);
    });
    if (col + col2 !== shownColor) {
      shownColor = col + col2;
      [root, cover].forEach(function (h) {
        h.setAttribute('data-timer-color', col);
        h.style.setProperty('--timer-color', col);
        h.style.setProperty('--timer-color2', col2);
        h.style.setProperty('--timer-glow', 'rgba(' + colorAt(cr).join(',') + ',.28)');
        var s1 = h.querySelectorAll('.timer-stop1'), s2 = h.querySelectorAll('.timer-stop2');
        for (var k = 0; k < s1.length; k++) { s1[k].setAttribute('stop-color', col); s2[k].setAttribute('stop-color', col2); }
      });
    }
    paint(true, false);
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
    [root, cover].forEach(function (h) {
      if (state === 'done') h.setAttribute('data-timer-fx', 'done'); else h.removeAttribute('data-timer-fx');
    });
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
      sync();
      finishFx();
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
    ensureAudio();
    sync();
  }
  function pause() {
    if (state !== 'running') return;
    leftMs = Math.max(0, endAt - Date.now());
    state = 'paused';
    stopTick();
    drawState();
    draw(true);
    sync();
  }
  function reset() {
    stopTick();
    state = 'idle';
    leftMs = total();
    hideError();
    minEl.value = String(minutes);
    drawState();
    draw(true);
    sync();
  }

  // ---------- 소리·종료 효과 ----------
  function ensureAudio() {
    if (!soundOn) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AC) audioCtx = new AC();
      if (audioCtx && audioCtx.resume) { var p = audioCtx.resume(); if (p && p.catch) p.catch(noop); }
    } catch (e) { /* 조용히 */ }
  }
  function chime() {
    if (!soundOn || !audioCtx) return;
    try {
      var t0 = audioCtx.currentTime || 0;
      [523.25, 659.25, 783.99].forEach(function (f, i) {
        var t = t0 + i * 0.12;
        var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + 0.3);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.3);
      });
    } catch (e) { /* 조용히 */ }
  }
  function finishFx() {
    chime();
    try {
      if (RT.effects && RT.effects.celebrate && !reduced()) {
        var el = !cover.hidden ? (view === 'tiles' ? cover.querySelector('.timer-tiles') : coverRingEl)
          : (view === 'tiles' ? root.querySelector('.timer-tiles') : ringEl);
        var r = el.getBoundingClientRect();
        var o = { level: 'max', emoji: '⏱️' };
        if (r.width > 0) { o.x = r.left + r.width / 2; o.y = r.top + r.height / 2; }
        RT.effects.celebrate(o);
      }
    } catch (e) { /* 조용히 */ }
  }

  // ---------- 그림 그리기 루프 (보일 때 + 돌아가는 중일 때만) ----------
  function screenVisible() {
    return !root.hidden && root.getAttribute('data-transition') !== 'leave' && root.getAttribute('aria-hidden') !== 'true';
  }
  function shouldRun() {
    return state === 'running' && document.visibilityState === 'visible' && !reduced() && (screenVisible() || !cover.hidden);
  }
  function frame() {
    raf = 0;
    if (!shouldRun()) return;
    paint(false, true);
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (shouldRun()) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (raf) {
      cancelAnimationFrame(raf); raf = 0;
    }
  }

  // ---------- 보기·소리 스위치 ----------
  function setView(v, persist) {
    view = v === 'tiles' ? 'tiles' : 'ring';
    root.setAttribute('data-timer-view', view);
    cover.setAttribute('data-timer-view', view);
    viewRingBtn.setAttribute('aria-pressed', view === 'ring' ? 'true' : 'false');
    viewTilesBtn.setAttribute('aria-pressed', view === 'tiles' ? 'true' : 'false');
    if (persist) { try { localStorage.setItem(KEY_VIEW, view); } catch (e) { /* 조용히 */ } }
    lastOff = -1;
    paint(true, false);
    sync();
  }
  function setSound(on, persist) {
    soundOn = !!on;
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    if (persist) { try { localStorage.setItem(KEY_SOUND, soundOn ? 'on' : 'off'); } catch (e) { /* 조용히 */ } }
  }
  viewRingBtn.addEventListener('click', function () { setView('ring', true); });
  viewTilesBtn.addEventListener('click', function () { setView('tiles', true); });
  soundBtn.addEventListener('click', function () { setSound(!soundOn, true); if (soundOn) ensureAudio(); });

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
    unitEl.textContent = unitText();
    draw(true);
  });
  minEl.addEventListener('change', function () { minEl.value = String(minutes); }); // 빠져나갈 때 마지막 올바른 값으로

  // ---------- 검은 덮개 ----------
  function noop() {}
  function openCover() {
    cover.hidden = false;
    draw(true);
    sync();
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
    sync();
    try { if (wakeLock && wakeLock.release) { var r = wakeLock.release(); if (r && r.catch) r.catch(noop); } } catch (e) { /* 조용히 */ }
    wakeLock = null;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(noop);
      }
    } catch (e) { /* 조용히 */ }
  }

  // 터치에선 :active 가 안 켜져서 타이머 버튼만 눌린 동안 data-timer-press=1 을 붙인다
  Array.prototype.forEach.call(document.querySelectorAll('#screen-timer .timer-btn, #screen-timer .timer-icon-btn, #timer-cover .timer-icon-btn'), function (b) {
    b.addEventListener('pointerdown', function () { b.setAttribute('data-timer-press', '1'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      b.addEventListener(ev, function () { b.removeAttribute('data-timer-press'); });
    });
  });

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);
  fsBtn.addEventListener('click', openCover);
  closeBtn.addEventListener('click', closeCover);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCover(); });

  // 돌아오면 바로 다시 계산 (숨은 동안 타이머가 느려졌어도 끝나는 시각 기준이라 정확)
  document.addEventListener('visibilitychange', function () {
    sync();
    if (document.visibilityState !== 'visible') return;
    if (state === 'running') tick();
    if (!cover.hidden && !wakeLock) requestLock();
  });

  // ---------- 시작 ----------
  load();
  loadPrefs();
  sets = [buildTiles(root.querySelector('.timer-tiles')), buildTiles(cover.querySelector('.timer-tiles'))];
  minEl.value = String(minutes);
  leftMs = total();
  unitEl.textContent = unitText();
  setSound(soundOn, false);
  drawState();
  setView(view, false);
  draw(true);
  // 탭 전환은 hidden/data-transition/aria-hidden 으로 일어나므로 지켜보다가 그리기 루프를 켜고 끈다
  try {
    var mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['hidden', 'data-transition', 'aria-hidden'] });
    mo.observe(cover, { attributes: true, attributeFilter: ['hidden'] });
  } catch (e) { /* 조용히 */ }

  RT.timer = { start: start, pause: pause, reset: reset };
})(window.RT);
