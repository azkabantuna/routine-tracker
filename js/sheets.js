window.RT = window.RT || {};

// 루틴 시트(추가·수정)와 삭제 확인창.
(function (RT) {
  var routines = RT.routines;
  var screens = RT.screens;
  var els = screens.els;
  var $ = screens.$;
  var hideToast = screens.hideToast;
  var checkSaveError = screens.checkSaveError;

  var editingId = null; // 시트에서 수정 중인 루틴 id (추가면 null)

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
    routines.deleteRoutine(id);
    checkSaveError();
    screens.renderAll();
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
    if (editingId) routines.updateRoutine(editingId, fields);
    else routines.addRoutine(fields);
    checkSaveError();
    closeSheet();
    screens.renderAll();
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

  $('btn-first-routine').addEventListener('click', function () { openSheet(null); });
  $('btn-add-routine').addEventListener('click', function () { openSheet(null); });

  RT.sheets = {
    openSheet: openSheet,
    closeSheet: closeSheet,
    openConfirm: openConfirm,
    closeConfirm: closeConfirm
  };
})(window.RT);
