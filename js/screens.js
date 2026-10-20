window.RT = window.RT || {};

// 화면: 요소 찾기, 안내(배너·토스트), 움직임 도우미, 오늘 그리기·카드 길게 누르기 메뉴, 강도 버튼 처리.
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

  var toastTimer = null;     // 토스트 숨김 타이머 (이 파일에서만 씀)

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
    if (li === menuCard) closeCardMenu(false);
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
      var level = RT.routines.getLevel(today, r.id);
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
    updateHint(total);
  }

  // 연속 일수 3일 미만일 때만 안내 한 줄 (streak 읽기만, 저장 없음)
  function updateHint(total) {
    var h = document.getElementById('today-hint');
    if (!h) return;
    var n = RT.totalStreak ? RT.totalStreak(store.state.logs, RT.today()) : 0;
    h.hidden = !(total > 0 && n < 3);
    updateFuture(n);
  }

  // 오늘 탭 맨 위 '미래의 나' 한 줄: 단어(읽기만) + 연속 일수. 저장 쓰기 없음
  function updateFuture(n) {
    var f = document.getElementById('today-future');
    if (!f) return;
    if (n == null) n = RT.totalStreak ? RT.totalStreak(store.state.logs, RT.today()) : 0;
    var w = '';
    try { w = window.localStorage.getItem('routineFutureWord') || ''; } catch (e) {}
    w = Array.from(w.trim()).slice(0, 12).join('') || '미래의 나';
    var t = '🔮 ' + w + ' · ' + (n > 0 ? '🔥 ' + n + '일째' : '오늘부터 1일째');
    if (f.textContent !== t) f.textContent = t;
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
    store.getRoutines().forEach(function (r) { if (RT.routines.getLevel(today, r.id)) done++; });
    return done;
  }

  function createCard(r, level) {
    var li = document.createElement('li');
    li.className = 'card';
    li.setAttribute('data-testid', 'routine-card');
    li.setAttribute('data-routine-id', r.id);
    li.setAttribute('data-menu-open', '0');
    li.tabIndex = 0;

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
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn-small card-more';
    more.setAttribute('data-testid', 'btn-card-more');
    more.setAttribute('aria-label', '루틴 메뉴 열기');
    more.setAttribute('aria-haspopup', 'menu');
    more.textContent = '…';
    head.appendChild(more);
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
    var cy = card.getBoundingClientRect().top - 8; // 축포 시작점: 카드 위쪽 바깥 (글씨를 덮지 않게)
    var result = RT.routines.toggleLevel(RT.today(), id, lv);
    checkSaveError();
    updateCard(card, r, RT.routines.getLevel(RT.today(), id));
    updateProgress(countDone(), store.getRoutines().length);
    updateHint(store.getRoutines().length);
    renderCharacter();
    if (result) setAnim(card, 'pop', 370); // 취소(null)는 팝 없음
    if (result === 'mini') showToast('mini 도 한 거다!', 'mini');
    if (result && RT.effects) RT.effects.celebrate({ level: result, x: cx, y: cy, up: true, emoji: r.emoji || '' }); // 취소는 효과 없음
  });

  // ---------- 카드 메뉴 (길게 누르기 500ms · … 버튼 · 메뉴 키/Shift+F10 · 우클릭) ----------
  var LONG_MS = 500;
  var MOVE_CANCEL = 10;          // px: 이만큼 움직이면 길게 누르기 취소
  var menuEl = null;             // 열려 있는 card-menu (하나뿐)
  var menuCard = null;
  var press = null;              // { timer, x, y, card }
  var swallowClick = false;      // 길게 눌러 메뉴가 뜬 뒤 손 뗄 때 오는 click 은 버린다
  var swallowTimer = null;

  function closeCardMenu(focusBack) {
    if (!menuEl) return false;
    var card = menuCard;
    if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    if (card) card.setAttribute('data-menu-open', '0');
    menuEl = null; menuCard = null;
    if (focusBack && card && card.isConnected) {
      var more = card.querySelector('.card-more');
      (more || card).focus();
    }
    return true;
  }

  // pt: 누른 자리(client 좌표) 또는 null(키보드·… 버튼: 카드 오른쪽 위)
  function openCardMenu(card, pt, focusFirst) {
    if (!card || card.getAttribute('data-leaving') === 'true') return;
    if (menuEl && menuCard === card && !pt) return;
    closeCardMenu(false);
    var id = card.getAttribute('data-routine-id');
    var menu = document.createElement('div');
    menu.className = 'card-menu';
    menu.setAttribute('data-testid', 'card-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '루틴 메뉴');
    var edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'btn btn-small';
    edit.setAttribute('data-testid', 'btn-card-edit'); edit.setAttribute('role', 'menuitem');
    edit.textContent = '수정';
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'btn btn-small btn-danger';
    del.setAttribute('data-testid', 'btn-card-delete'); del.setAttribute('role', 'menuitem');
    del.textContent = '삭제';
    menu.appendChild(edit); menu.appendChild(del);
    edit.addEventListener('click', function () {
      var r = store.getRoutine(id); closeCardMenu(false);
      if (r) RT.sheets.openSheet(r);
    });
    del.addEventListener('click', function () {
      var r = store.getRoutine(id); closeCardMenu(false);
      if (r) RT.sheets.openConfirm(r);
    });
    card.appendChild(menu);
    var cr = card.getBoundingClientRect();
    var w = menu.offsetWidth || 200, h = menu.offsetHeight || 64;
    // … 버튼 바로 아래, 오른쪽 맞춤(이름을 가리지 않게). 카드 안에 맞추고, 아래가 탭바에 가리면 버튼 위로 뒤집는다.
    var more = card.querySelector('.card-more');
    var mr = more ? more.getBoundingClientRect() : { right: cr.right - 8, top: cr.top + 8, bottom: cr.top + 52 };
    var left = Math.min(Math.max(mr.right - cr.left - w, 4), Math.max(4, cr.width - w - 4));
    var top = mr.bottom - cr.top + 4;
    var tabbar = document.querySelector('.tabbar');
    var limit = (tabbar ? tabbar.getBoundingClientRect().top : window.innerHeight) - 8;
    if (cr.top + top + h > limit) top = Math.max(4, mr.top - cr.top - h - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menuEl = menu; menuCard = card;
    card.setAttribute('data-menu-open', '1');
    if (focusFirst) edit.focus();
  }

  function cancelPress() {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
  }

  els.cardList.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var card = e.target.closest('.card');
    if (!card || e.target.closest('.card-menu') || e.target.closest('.card-more')) return;
    if (card.getAttribute('data-leaving') === 'true') return;
    swallowClick = false;
    cancelPress();
    var p = { x: e.clientX, y: e.clientY, card: card, timer: null };
    p.timer = setTimeout(function () {
      if (press !== p) return;
      press = null;
      swallowClick = true;
      if (swallowTimer) clearTimeout(swallowTimer);
      swallowTimer = setTimeout(function () { swallowClick = false; }, 1500);
      openCardMenu(card, { x: p.x, y: p.y }, false);
    }, LONG_MS);
    press = p;
  });
  els.cardList.addEventListener('pointermove', function (e) {
    if (!press) return;
    if (Math.abs(e.clientX - press.x) > MOVE_CANCEL || Math.abs(e.clientY - press.y) > MOVE_CANCEL) cancelPress();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    els.cardList.addEventListener(t, cancelPress);
  });
  // 길게 눌러 메뉴가 뜬 뒤의 click 은 체크·강도로 가지 않게 막는다 (capture)
  els.cardList.addEventListener('click', function (e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation(); e.preventDefault();
  }, true);
  els.cardList.addEventListener('click', function (e) {
    var more = e.target.closest('.card-more');
    if (!more) return;
    var card = more.closest('.card');
    if (menuEl && menuCard === card) closeCardMenu(true);
    else openCardMenu(card, null, true);
  });
  // 키보드: 카드 안에서 메뉴 키 / Shift+F10, 마우스 우클릭
  els.cardList.addEventListener('keydown', function (e) {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    var card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    openCardMenu(card, null, true);
  });
  els.cardList.addEventListener('contextmenu', function (e) {
    var card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    if (menuEl && menuCard === card) return;
    openCardMenu(card, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null, !(e.clientX || e.clientY));
  });
  // 메뉴 바깥을 누르면 닫힘
  document.addEventListener('pointerdown', function (e) {
    if (!menuEl) return;
    if (e.target.closest && (e.target.closest('.card-menu') || e.target.closest('.card-more'))) return;
    closeCardMenu(false);
  }, true);

  // 캐릭터 카드: 처음 한 번 붙이고, 이후엔 다시 그리기만 (읽기 전용)
  function renderCharacter() {
    var c = RT.character;
    var slot = $('char-mount');
    if (!c || !c.mount || !slot) return;
    if (!slot.firstChild && !c.__mounted) { c.mount(slot); c.__mounted = true; }
    c.render(store.state);
  }

  // ---------- 다시 그리기 ----------
  function renderAll() {
    renderToday();
    renderCharacter();
  }

  RT.screens = {
    els: els,
    $: $,
    showBanner: showBanner,
    showToast: showToast,
    hideToast: hideToast,
    checkSaveError: checkSaveError,
    showLoadError: showLoadError,
    reduced: reduced,
    flushPendingEnter: flushPendingEnter,
    renderToday: renderToday,
    updateFuture: updateFuture,
    renderManage: renderCharacter,
    closeCardMenu: closeCardMenu,
    openCardMenu: openCardMenu,
    renderAll: renderAll
  };
})(window.RT);
