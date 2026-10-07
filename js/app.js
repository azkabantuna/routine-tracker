window.RT = window.RT || {};

// 화면 그리기와 버튼 처리.
// 사용자 글자(루틴 이름·기준)는 모두 textContent 로만 넣는다.
(function (RT) {
  var store = RT.store;
  var LEVELS = ['mini', 'more', 'max'];
  var LEVEL_LABEL = { mini: 'mini', more: 'more', max: 'max' };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    banner: $('banner-error') || document.querySelector('[data-testid="banner-error"]'),
    toast: document.querySelector('[data-testid="toast"]'),
    todayDate: $('today-date'),
    progress: document.querySelector('[data-testid="progress"]'),
    progressInner: $('progress-inner'),
    progressText: $('progress-text'),
    progressFill: $('progress-fill'),
    emptyState: $('empty-state'),
    cardList: $('card-list'),
    manageList: $('manage-list'),
    manageEmpty: $('manage-empty'),
    backdrop: $('sheet-backdrop'),
    sheet: $('sheet'),
    sheetTitle: $('sheet-title'),
    inputName: $('input-name'),
    inputMini: $('input-mini'),
    inputMore: $('input-more'),
    inputMax: $('input-max'),
    inputEmoji: $('input-emoji'),
    errorName: $('error-name'),
    errorEmoji: $('error-emoji'),
    emojiPick: $('emoji-pick'),
    confirm: $('confirm-sheet')
  };

  var editingId = null; // 시트에서 수정 중인 루틴 id (추가면 null)
  var toastTimer = null;

  // ---------- 안내 (배너·토스트) ----------
  function showBanner(text) {
    els.banner.textContent = text;
    els.banner.hidden = false;
  }

  function showToast(text, kind) {
    els.toast.textContent = text;
    if (kind) els.toast.setAttribute('data-kind', kind);
    else els.toast.removeAttribute('data-kind');
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
      toastTimer = null;
    }, 2000);
  }

  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    els.toast.hidden = true;
  }

  function checkSaveError() {
    if (store.saveError) {
      showBanner('저장하지 못했어요. 사생활 보호 모드이거나 저장 공간이 꽉 찼을 수 있어요. 지금 화면의 기록은 새로고침하면 사라질 수 있어요.');
    }
  }

  function showLoadError() {
    if (store.loadError === 'unavailable') {
      showBanner('이 브라우저에서는 기록을 저장할 수 없어요. 사생활 보호 모드를 끄면 저장돼요.');
    } else if (store.loadError) {
      showBanner('저장된 기록을 읽지 못해 빈 상태로 시작했어요. 원래 데이터는 따로 백업해 두었어요.');
    }
  }

  // ---------- 움직임 도우미 ----------
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(reduceMq && reduceMq.matches); }

  var firstRenderDone = false;   // 첫 렌더에서 만든 카드는 등장 연출 없음
  var pendingEnter = {};         // 오늘 화면이 숨겨져 있을 때 만든 카드 id (화면이 보이면 enter)

  function todayVisible() { return !$('screen-today').hidden; }

  // data-anim 을 붙였다가 시간이 지나면 통째로 제거 (animationend 에 기대지 않음). 카드당 타이머 하나.
  function setAnim(li, kind, ms) {
    if (reduced()) return;
    if (li.__animTimer) clearTimeout(li.__animTimer);
    li.removeAttribute('data-anim');
    void li.offsetWidth; // 같은 애니메이션을 처음부터 다시 시작
    li.setAttribute('data-anim', kind);
    li.__animTimer = setTimeout(function () {
      li.removeAttribute('data-anim');
      li.__animTimer = null;
    }, ms);
  }

  function flushPendingEnter() {
    if (!todayVisible()) return;
    Object.keys(pendingEnter).forEach(function (id) {
      var li = findCard(id);
      if (li) setAnim(li, 'enter', 320);
    });
    pendingEnter = {};
  }

  function findCard(id) {
    var nodes = els.cardList.children;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-routine-id') === id && nodes[i].getAttribute('data-leaving') !== 'true') return nodes[i];
    }
    return null;
  }

  function leaveCard(li) {
    if (li.getAttribute('data-leaving') === 'true') return;
    var id = li.getAttribute('data-routine-id');
    delete pendingEnter[id];
    if (li.__animTimer) { clearTimeout(li.__animTimer); li.__animTimer = null; }
    li.removeAttribute('data-anim');
    li.setAttribute('data-leaving', 'true');
    li.setAttribute('aria-hidden', 'true');
    if (reduced()) {
      if (li.parentNode) li.parentNode.removeChild(li);
      return;
    }
    // 오늘 화면이 숨겨져 있어도 animationend 는 안 오므로 타이머로 반드시 제거
    setTimeout(function () {
      if (li.parentNode) li.parentNode.removeChild(li);
    }, 250);
  }

  // ---------- 오늘 화면 ----------
  function renderToday() {
    var today = RT.today();
    var routines = store.getRoutines();
    var total = routines.length;
    var done = 0;

    els.todayDate.textContent = RT.koreanDate(today);

    // 기존 카드(퇴장 중인 것 제외)를 id 로 모은다
    var existing = {};
    var kids = els.cardList.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.getAttribute('data-leaving') === 'true') continue;
      existing[k.getAttribute('data-routine-id')] = k;
    }

    var wanted = {};
    var cursor = nextLive(els.cardList.firstElementChild);
    routines.forEach(function (r) {
      wanted[r.id] = true;
      var level = store.getLevel(today, r.id);
      if (level) done++;
      var li = existing[r.id];
      if (li) {
        updateCard(li, r, level);
      } else {
        li = createCard(r, level);
        if (firstRenderDone) {
          if (todayVisible()) setAnim(li, 'enter', 320);
          else pendingEnter[r.id] = true;
        }
      }
      // 이미 맞는 자리면 건드리지 않고, 아니면 옮기기만 한다
      if (li === cursor) cursor = nextLive(cursor.nextElementSibling);
      else els.cardList.insertBefore(li, cursor);
    });

    Object.keys(existing).forEach(function (id) {
      if (!wanted[id]) leaveCard(existing[id]);
    });

    firstRenderDone = true;
    els.emptyState.hidden = total !== 0;
    updateProgress(done, total);
  }

  function nextLive(node) {
    while (node && node.getAttribute('data-leaving') === 'true') node = node.nextElementSibling;
    return node;
  }

  function updateProgress(done, total) {
    els.progress.setAttribute('data-done-count', String(done));
    els.progress.setAttribute('data-total', String(total));
    els.progressInner.hidden = total === 0;
    els.progressText.textContent = '오늘 ' + done + '/' + total + ' 완료';
    var pct = total ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.transform = 'scaleX(' + (pct / 100) + ')';
  }

  function countDone() {
    var today = RT.today();
    var done = 0;
    store.getRoutines().forEach(function (r) { if (store.getLevel(today, r.id)) done++; });
    return done;
  }

  function createCard(r, level) {
    var li = document.createElement('li');
    li.className = 'card';
    li.setAttribute('data-testid', 'routine-card');
    li.setAttribute('data-routine-id', r.id);

    var head = document.createElement('div');
    head.className = 'card-head';
    var emo = document.createElement('span');
    emo.className = 'routine-emoji';
    emo.setAttribute('data-testid', 'routine-emoji');
    emo.setAttribute('aria-hidden', 'true');
    emo.hidden = true;
    head.appendChild(emo);
    var name = document.createElement('h2');
    name.className = 'card-name';
    head.appendChild(name);
    li.appendChild(head);

    var row = document.createElement('div');
    row.className = 'level-row';
    LEVELS.forEach(function (lv) {
      var col = document.createElement('div');
      col.className = 'level-col';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn level-' + lv;
      btn.setAttribute('data-level', lv);
      btn.textContent = LEVEL_LABEL[lv];
      col.appendChild(btn);

      var crit = document.createElement('p');
      crit.className = 'level-crit';
      col.appendChild(crit);

      row.appendChild(col);
    });
    li.appendChild(row);
    updateCard(li, r, level);
    return li;
  }

  // 기존 카드 노드를 다시 만들지 않고 값만 맞춘다
  function updateCard(li, r, level) {
    li.setAttribute('data-done', level ? 'true' : 'false');
    if (level) li.setAttribute('data-current', level);
    else li.removeAttribute('data-current');

    var name = li.querySelector('.card-name');
    if (name.textContent !== r.name) name.textContent = r.name;
    var emo = li.querySelector('.routine-emoji');
    var glyph = r.emoji || '';
    if (emo.textContent !== glyph) emo.textContent = glyph;
    emo.hidden = !glyph;

    LEVELS.forEach(function (lv) {
      var btn = li.querySelector('.level-btn[data-level="' + lv + '"]');
      btn.setAttribute('aria-pressed', level === lv ? 'true' : 'false');
      btn.setAttribute('aria-label', r.name + ' ' + lv + (r[lv] ? ': ' + r[lv] : ''));
      var crit = btn.parentNode.querySelector('.level-crit');
      var text = r[lv] || '';
      if (crit.textContent !== text) crit.textContent = text;
    });
  }

  // 강도 버튼 누르기 (이벤트 위임): 그 카드만 갱신
  els.cardList.addEventListener('click', function (e) {
    var btn = e.target.closest('.level-btn');
    if (!btn) return;
    var card = btn.closest('[data-routine-id]');
    if (!card || card.getAttribute('data-leaving') === 'true') return;
    var id = card.getAttribute('data-routine-id');
    var lv = btn.getAttribute('data-level');
    var r = store.getRoutine(id);
    if (!r) return;
    // 터짐 위치: 카드를 고치기 전에 눌린 버튼 중앙을 읽는다
    var rect = btn.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var result = store.toggleLevel(RT.today(), id, lv);
    checkSaveError();
    updateCard(card, r, store.getLevel(RT.today(), id));
    updateProgress(countDone(), store.getRoutines().length);
    if (result) setAnim(card, 'pop', 370); // 취소(null)는 팝 없음
    if (result === 'mini') showToast('mini 도 한 거다!', 'mini');
    if (result && RT.effects) RT.effects.celebrate({ level: result, x: cx, y: cy, emoji: r.emoji || '' }); // 취소는 효과 없음
  });

  // ---------- 루틴 관리 화면 ----------
  function renderManage() {
    var routines = store.getRoutines();
    var frag = document.createDocumentFragment();
    routines.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'manage-item';
      li.setAttribute('data-testid', 'manage-item');
      li.setAttribute('data-routine-id', r.id);

      var info = document.createElement('div');
      info.className = 'manage-info';
      var head = document.createElement('div');
      head.className = 'manage-head';
      var memo = document.createElement('span');
      memo.className = 'manage-emoji';
      memo.setAttribute('data-testid', 'manage-emoji');
      memo.setAttribute('aria-hidden', 'true');
      memo.textContent = r.emoji || '';
      memo.hidden = !r.emoji;
      var name = document.createElement('p');
      name.className = 'manage-name';
      name.textContent = r.name;
      head.appendChild(memo);
      head.appendChild(name);
      var sub = document.createElement('p');
      sub.className = 'manage-sub';
      sub.textContent = [r.mini, r.more, r.max].map(function (t) { return t || '-'; }).join(' / ');
      info.appendChild(head);
      info.appendChild(sub);

      var actions = document.createElement('div');
      actions.className = 'manage-actions';
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-small';
      edit.setAttribute('data-testid', 'btn-edit');
      edit.setAttribute('data-action', 'edit');
      edit.textContent = '수정';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-small btn-danger';
      del.setAttribute('data-testid', 'btn-delete');
      del.setAttribute('data-action', 'delete');
      del.textContent = '삭제';
      actions.appendChild(edit);
      actions.appendChild(del);

      li.appendChild(info);
      li.appendChild(actions);
      frag.appendChild(li);
    });
    els.manageList.textContent = '';
    els.manageList.appendChild(frag);
    els.manageEmpty.hidden = routines.length !== 0;
  }

  els.manageList.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var item = btn.closest('[data-routine-id]');
    var id = item.getAttribute('data-routine-id');
    var r = store.getRoutine(id);
    if (!r) return;
    if (btn.getAttribute('data-action') === 'edit') {
      openSheet(r);
    } else {
      openConfirm(r);
    }
  });

  // ---------- 삭제 확인창 ----------
  var deleteId = null;

  function openConfirm(r) {
    deleteId = r.id;
    hideToast();
    $('confirm-text').textContent = '"' + r.name + '" 루틴을 삭제할까요? 이 루틴의 지난 기록도 함께 지워져요.';
    els.backdrop.hidden = false;
    els.confirm.hidden = false;
    $('btn-cancel-delete').focus();
  }

  function closeConfirm() {
    els.confirm.hidden = true;
    if (els.sheet.hidden) els.backdrop.hidden = true;
    deleteId = null;
  }

  $('btn-cancel-delete').addEventListener('click', closeConfirm);
  $('btn-confirm-delete').addEventListener('click', function () {
    var id = deleteId;
    closeConfirm();
    if (!id) return;
    store.deleteRoutine(id);
    checkSaveError();
    renderAll();
  });

  // ---------- 시트 (추가·수정) ----------
  function openSheet(routine) {
    editingId = routine ? routine.id : null;
    els.sheetTitle.textContent = routine ? '루틴 수정' : '루틴 추가';
    els.inputName.value = routine ? routine.name : '';
    els.inputMini.value = routine ? (routine.mini || '') : '';
    els.inputMore.value = routine ? (routine.more || '') : '';
    els.inputMax.value = routine ? (routine.max || '') : '';
    els.inputEmoji.value = routine ? (routine.emoji || '') : '';
    els.errorName.hidden = true;
    els.errorEmoji.hidden = true;
    hideToast();
    els.backdrop.hidden = false;
    els.sheet.hidden = false;
    els.inputName.focus();
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.backdrop.hidden = true;
    editingId = null;
  }

  els.sheet.addEventListener('submit', function (e) {
    e.preventDefault();
    var fields = {
      name: els.inputName.value,
      mini: els.inputMini.value,
      more: els.inputMore.value,
      max: els.inputMax.value,
      emoji: els.inputEmoji.value.trim()
    };
    if (!fields.name.trim()) {
      els.errorName.hidden = false;
      els.inputName.focus();
      return;
    }
    if (fields.emoji && !RT.emoji.isSingleEmoji(fields.emoji)) {
      els.errorEmoji.hidden = false;
      els.inputEmoji.focus();
      return;
    }
    if (editingId) store.updateRoutine(editingId, fields);
    else store.addRoutine(fields);
    checkSaveError();
    closeSheet();
    renderAll();
  });

  els.inputName.addEventListener('input', function () {
    if (els.inputName.value.trim()) els.errorName.hidden = true;
  });

  els.inputEmoji.addEventListener('input', function () {
    els.errorEmoji.hidden = true;
  });
  els.emojiPick.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-emoji]');
    if (!b) return;
    els.inputEmoji.value = b.getAttribute('data-emoji');
    els.errorEmoji.hidden = true;
  });

  $('btn-close').addEventListener('click', closeSheet);
  els.backdrop.addEventListener('click', function (e) {
    if (e.target !== els.backdrop) return;
    if (!els.confirm.hidden) closeConfirm();
    else closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!els.confirm.hidden) closeConfirm();
    else if (!els.sheet.hidden) closeSheet();
  });
  // iOS Safari 에서 :active 눌림이 보이도록
  document.addEventListener('touchstart', function () {}, { passive: true });

  $('btn-first-routine').addEventListener('click', function () { openSheet(null); });
  $('btn-add-routine').addEventListener('click', function () { openSheet(null); });

  // ---------- 탭 ----------
  var TAB_ORDER = ['today', 'log', 'manage'];
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

  function showTab(name, instant) {
    if (!instant && name === currentTab) return; // 같은 탭 다시 누름: 아무것도 안 함
    var prev = currentTab;
    currentTab = name;

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

  // ---------- 다시 그리기 ----------
  function renderAll() {
    renderToday();
    renderManage();
  }

  // 화면이 다시 보일 때: 상단 날짜·n/m·"오늘" 카드만 다시 그린다 (시트·입력 중인 글은 그대로)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') renderToday();
  });
  window.addEventListener('focus', renderToday);

  // ---------- 시작 ----------
  showLoadError();
  renderAll();
  showTab('today', true);
})(window.RT);
