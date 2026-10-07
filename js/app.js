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
    errorName: $('error-name')
  };

  var editingId = null; // 시트에서 수정 중인 루틴 id (추가면 null)
  var toastTimer = null;

  // ---------- 안내 (배너·토스트) ----------
  function showBanner(text) {
    els.banner.textContent = text;
    els.banner.hidden = false;
  }

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
      toastTimer = null;
    }, 2000);
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

  // ---------- 오늘 화면 ----------
  function renderToday() {
    var today = RT.today();
    var routines = store.getRoutines();
    var total = routines.length;
    var done = 0;

    els.todayDate.textContent = RT.koreanDate(today);

    var frag = document.createDocumentFragment();
    routines.forEach(function (r) {
      var level = store.getLevel(today, r.id);
      if (level) done++;
      frag.appendChild(buildCard(r, level));
    });
    els.cardList.textContent = '';
    els.cardList.appendChild(frag);

    els.emptyState.hidden = total !== 0;
    updateProgress(done, total);
  }

  function updateProgress(done, total) {
    els.progress.setAttribute('data-done-count', String(done));
    els.progress.setAttribute('data-total', String(total));
    els.progressInner.hidden = total === 0;
    els.progressText.textContent = '오늘 ' + done + '/' + total + ' 완료';
    var pct = total ? Math.round((done / total) * 100) : 0;
    els.progressFill.style.width = pct + '%';
  }

  function buildCard(r, level) {
    var li = document.createElement('li');
    li.className = 'card';
    li.setAttribute('data-testid', 'routine-card');
    li.setAttribute('data-routine-id', r.id);
    li.setAttribute('data-done', level ? 'true' : 'false');
    if (level) li.setAttribute('data-current', level);

    var name = document.createElement('h2');
    name.className = 'card-name';
    name.textContent = r.name;
    li.appendChild(name);

    var row = document.createElement('div');
    row.className = 'level-row';
    LEVELS.forEach(function (lv) {
      var col = document.createElement('div');
      col.className = 'level-col';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn level-' + lv;
      btn.setAttribute('data-level', lv);
      btn.setAttribute('aria-pressed', level === lv ? 'true' : 'false');
      btn.textContent = LEVEL_LABEL[lv];
      btn.setAttribute('aria-label', r.name + ' ' + lv + (r[lv] ? ': ' + r[lv] : ''));
      col.appendChild(btn);

      var crit = document.createElement('p');
      crit.className = 'level-crit';
      crit.textContent = r[lv] || '';
      col.appendChild(crit);

      row.appendChild(col);
    });
    li.appendChild(row);
    return li;
  }

  // 강도 버튼 누르기 (이벤트 위임)
  els.cardList.addEventListener('click', function (e) {
    var btn = e.target.closest('.level-btn');
    if (!btn) return;
    var card = btn.closest('[data-routine-id]');
    if (!card) return;
    var id = card.getAttribute('data-routine-id');
    var lv = btn.getAttribute('data-level');
    var result = store.toggleLevel(RT.today(), id, lv);
    checkSaveError();
    renderToday();
    if (result === 'mini') showToast('mini 도 한 거다!');
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
      var name = document.createElement('p');
      name.className = 'manage-name';
      name.textContent = r.name;
      var sub = document.createElement('p');
      sub.className = 'manage-sub';
      sub.textContent = [r.mini, r.more, r.max].map(function (t) { return t || '-'; }).join(' / ');
      info.appendChild(name);
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
      if (window.confirm('"' + r.name + '" 루틴을 삭제할까요?\n이 루틴의 지난 기록도 함께 지워져요.')) {
        store.deleteRoutine(id);
        checkSaveError();
        renderAll();
      }
    }
  });

  // ---------- 시트 (추가·수정) ----------
  function openSheet(routine) {
    editingId = routine ? routine.id : null;
    els.sheetTitle.textContent = routine ? '루틴 수정' : '루틴 추가';
    els.inputName.value = routine ? routine.name : '';
    els.inputMini.value = routine ? (routine.mini || '') : '';
    els.inputMore.value = routine ? (routine.more || '') : '';
    els.inputMax.value = routine ? (routine.max || '') : '';
    els.errorName.hidden = true;
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
      max: els.inputMax.value
    };
    if (!fields.name.trim()) {
      els.errorName.hidden = false;
      els.inputName.focus();
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

  $('btn-close').addEventListener('click', closeSheet);
  els.backdrop.addEventListener('click', function (e) {
    if (e.target === els.backdrop) closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !els.sheet.hidden) closeSheet();
  });

  $('btn-first-routine').addEventListener('click', function () { openSheet(null); });
  $('btn-add-routine').addEventListener('click', function () { openSheet(null); });

  // ---------- 탭 ----------
  function showTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var screens = document.querySelectorAll('.screen');
    for (var j = 0; j < screens.length; j++) {
      screens[j].hidden = screens[j].getAttribute('data-screen') !== name;
    }
    window.scrollTo(0, 0);
  }

  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) showTab(tab.getAttribute('data-tab'));
  });

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
  showTab('today');
})(window.RT);
