window.RT = window.RT || {};

// 시작과 연결: 탭 바꾸기, 버튼 튕김, 다시 보일 때 다시 그리기, 시작.
(function (RT) {
  var screens = RT.screens;
  var reduced = screens.reduced;
  var flushPendingEnter = screens.flushPendingEnter;

  // iOS Safari 에서 :active 눌림이 보이도록
  document.addEventListener('touchstart', function () {}, { passive: true });

  // ---------- 탭 ----------
  var TAB_ORDER = ['today', 'calendar', 'manage', 'timer'];
  var currentTab = null;
  var tabTimer = null;         // 탭 전환 정리 타이머는 하나만
  var screensEl = document.querySelector('.screens');

  function clearTransitionState() {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].removeAttribute('data-transition');
      screens[i].removeAttribute('aria-hidden');
    }
    screensEl.removeAttribute('data-switching');
    screensEl.removeAttribute('data-dir');
  }

  // 3D 캐릭터는 관리 탭이 보일 때만 그린다 (다른 탭·숨겨진 화면에선 멈춤)
  function syncActive() {
    if (window.RT3D && typeof window.RT3D.setActive === 'function') {
      window.RT3D.setActive(currentTab === 'manage' && document.visibilityState !== 'hidden');
    }
  }

  function showTab(name, instant) {
    if (!instant && name === currentTab) return; // 같은 탭 다시 누름: 아무것도 안 함
    var prev = currentTab;
    currentTab = name;
    syncActive();

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-tab') === name ? 'true' : 'false');
    }
    window.scrollTo(0, 0);

    var wasSwitching = tabTimer !== null;
    if (tabTimer) { clearTimeout(tabTimer); tabTimer = null; }
    clearTransitionState();

    var screens = document.querySelectorAll('.screen');
    var target = null, leaving = null;
    for (var j = 0; j < screens.length; j++) {
      var sc = screens[j];
      var isTarget = sc.getAttribute('data-screen') === name;
      if (isTarget) target = sc;
      else if (!sc.hidden && !wasSwitching && prev && !instant) leaving = sc;
      if (!isTarget && sc !== leaving) sc.hidden = true;
    }

    target.hidden = false;
    if (name === 'calendar' && RT.calendar) RT.calendar.refresh(); // 읽기만: 최신 기록으로 다시 그림
    if (instant || reduced() || !prev) {
      if (leaving) leaving.hidden = true;
      flushPendingEnter();
      return;
    }

    // 같은 동기 코드 안에서 leave + enter 를 붙인다
    var dir = TAB_ORDER.indexOf(name) > TAB_ORDER.indexOf(prev) ? 1 : -1;
    screensEl.setAttribute('data-dir', String(dir));
    screensEl.setAttribute('data-switching', 'true');
    if (leaving) {
      leaving.setAttribute('data-transition', 'leave');
      leaving.setAttribute('aria-hidden', 'true');
    }
    target.setAttribute('data-transition', 'enter');
    flushPendingEnter();

    tabTimer = setTimeout(function () {
      tabTimer = null;
      if (leaving) leaving.hidden = true;
      clearTransitionState();
    }, 320);
  }

  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) showTab(tab.getAttribute('data-tab'));
  });

  // ---------- 관리 패널 열고 닫기 ----------
  var panel = document.getElementById('manage-panel');
  var panelToggle = document.getElementById('manage-panel-toggle');
  if (panel && panelToggle) {
    var panelBody = document.getElementById('manage-panel-body');
    // 닫힌 패널 내용은 탭 포커스·터치 불가 (inert), visibility transition 은 쓰지 않음
    if (panelBody && panel.getAttribute('data-open') !== '1') panelBody.inert = true;
    panelToggle.addEventListener('click', function () {
      var open = panel.getAttribute('data-open') !== '1';
      panel.setAttribute('data-open', open ? '1' : '0');
      if (panelBody) panelBody.inert = !open;
      panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ---------- 버튼 튕김 (뗄 때 한 번 통통) ----------
  var BOUNCE_SEL = '.btn, .level-btn, .tab';
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest ? e.target.closest(BOUNCE_SEL) : null;
    if (b) b.removeAttribute('data-bounce');
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest(BOUNCE_SEL) : null;
    if (!b || b.disabled || reduced()) return;
    if (b.__bounceTimer) clearTimeout(b.__bounceTimer);
    b.removeAttribute('data-bounce');
    void b.offsetWidth; // 처음부터 다시 시작
    b.setAttribute('data-bounce', 'true');
    b.__bounceTimer = setTimeout(function () {
      b.removeAttribute('data-bounce');
      b.__bounceTimer = null;
    }, 450);
  }, true);

  // 화면이 다시 보일 때: 상단 날짜·n/m·"오늘" 카드만 다시 그린다 (시트·입력 중인 글은 그대로)
  document.addEventListener('visibilitychange', function () {
    syncActive();
    if (document.visibilityState === 'visible') screens.renderToday();
  });
  window.addEventListener('focus', screens.renderToday);

  // ---------- 시작 ----------
  screens.showLoadError();
  screens.renderAll();
  showTab('today', true);
})(window.RT);
