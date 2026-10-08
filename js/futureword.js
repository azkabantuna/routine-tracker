window.RT = window.RT || {};

// 퓨처 셀프 단어: 3D 구름 위에 겹친 HTML 버튼에 "미래의 나" 단어를 적어 둔다.
// 저장은 localStorage 'routineFutureWord'(문자열) 하나만. 앱 본 저장 데이터는 읽지도 쓰지도 않는다.
(function (RT) {
  var KEY = 'routineFutureWord';
  var MAX = 12;
  var PLACEHOLDER = '미래의 나';

  var card = null, is3d = false, layer = null, btn = null, edit = null, input = null, saveBtn = null;
  var composing = false, editing = false, alive = false;
  var raf = 0, placed = false, io = null, reduced = false;

  function load() {
    try {
      var v = window.localStorage.getItem(KEY);
      return typeof v === 'string' ? v : '';
    } catch (e) { return ''; }
  }
  function store(v) {
    try {
      if (v) window.localStorage.setItem(KEY, v);
      else window.localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function clean(v) {
    return Array.from(String(v == null ? '' : v).trim()).slice(0, MAX).join('');
  }
  function el(tag, cls, tid) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (tid) e.setAttribute('data-testid', tid);
    return e;
  }

  function paint() {
    var w = load();
    btn.textContent = w || PLACEHOLDER;
    if (w) btn.removeAttribute('data-empty'); else btn.setAttribute('data-empty', '1');
  }

  function move(e, x, y) {
    var k = Math.round(x * 10) + ',' + Math.round(y * 10);
    if (e._fwk === k) return;
    e._fwk = k;
    e.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }

  function shown() {
    if (!card || document.visibilityState === 'hidden') return false;
    var s = card.closest ? card.closest('.screen') : null;
    if (s && s.hidden) return false;
    return card.getClientRects().length > 0;
  }

  function place() {
    if (!is3d || !window.RT3D || typeof window.RT3D.getState !== 'function') return;
    var c;
    try { c = window.RT3D.getState().cloud; } catch (err) { return; }
    if (!c || !isFinite(c.x) || !isFinite(c.y) || !(card.clientWidth > 0)) return;
    var target = editing ? edit : btn;
    var w = target.offsetWidth, h = target.offsetHeight;
    var x = c.x - w / 2, y = c.y - (c.hh || 0) - 6 - h;
    if (y < 122) y = 122;
    if (editing) x = Math.max(4, Math.min(card.clientWidth - 4 - w, x));
    move(target, x, y);
    if (!placed) { placed = true; layer.setAttribute('data-placed', '1'); }
  }

  function frame() {
    raf = 0;
    if (!alive || !shown()) return;
    place();
    if (!reduced || !placed) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (!alive || !is3d || raf || !shown()) return;
    raf = requestAnimationFrame(frame);
  }
  function restart() { placed = false; start(); }

  function openEdit() {
    if (editing) return;
    editing = true;
    input.value = load();
    btn.hidden = true;
    edit.hidden = false;
    if (is3d) { edit._fwk = ''; place(); start(); }
    input.focus();
    document.addEventListener('pointerdown', onOutside, true);
  }
  function closeEdit(doSave) {
    if (!editing) return;
    editing = false;
    composing = false;
    document.removeEventListener('pointerdown', onOutside, true);
    if (doSave) store(clean(input.value));
    edit.hidden = true;
    btn.hidden = false;
    btn._fwk = '';
    paint();
    if (is3d) { place(); start(); }
  }
  function onOutside(ev) {
    if (edit && edit.contains(ev.target)) return;
    closeEdit(true);
  }

  function mount(cardEl, threeD) {
    unmount();
    if (!cardEl) return;
    card = cardEl; is3d = !!threeD; alive = true; placed = false; editing = false; composing = false;
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    layer = el('div', 'fw-layer');
    layer.setAttribute('data-mode', is3d ? 'float' : 'flow');
    btn = el('button', 'fw-word', 'future-word');
    btn.type = 'button';
    btn.setAttribute('aria-label', '미래의 나 단어 적기');
    btn.addEventListener('click', openEdit);

    edit = el('div', 'fw-edit');
    edit.hidden = true;
    input = el('input', 'fw-input', 'future-word-input');
    input.type = 'text';
    input.maxLength = MAX;
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-label', '미래의 나 단어');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    saveBtn = el('button', 'fw-save', 'future-word-save');
    saveBtn.type = 'button';
    saveBtn.setAttribute('aria-label', '완료');
    saveBtn.textContent = '완료';
    saveBtn.addEventListener('click', function () { closeEdit(true); });

    input.addEventListener('compositionstart', function () { composing = true; });
    input.addEventListener('compositionend', function () {
      composing = false;
      var v = Array.from(input.value).slice(0, MAX).join('');
      if (v !== input.value) input.value = v;
    });
    input.addEventListener('input', function (ev) {
      if (composing || ev.isComposing) return;
      var v = Array.from(input.value).slice(0, MAX).join('');
      if (v !== input.value) input.value = v;
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        if (ev.isComposing || composing || ev.keyCode === 229) return;
        ev.preventDefault();
        closeEdit(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closeEdit(false);
      }
    });

    edit.appendChild(input);
    edit.appendChild(saveBtn);
    layer.appendChild(btn);
    layer.appendChild(edit);
    var host = null;
    if (!is3d) host = card.querySelector('.char-info');
    (host || card).appendChild(layer);
    paint();

    if (is3d) {
      window.addEventListener('resize', restart);
      document.addEventListener('visibilitychange', restart);
      if (typeof IntersectionObserver === 'function') {
        io = new IntersectionObserver(function (list) {
          for (var i = 0; i < list.length; i++) if (list[i].isIntersecting) { restart(); return; }
        });
        io.observe(card);
      }
      start();
    }
  }

  function unmount() {
    alive = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    window.removeEventListener('resize', restart);
    document.removeEventListener('visibilitychange', restart);
    document.removeEventListener('pointerdown', onOutside, true);
    if (io) { io.disconnect(); io = null; }
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    card = null; layer = btn = edit = input = saveBtn = null;
    is3d = false; editing = false; composing = false; placed = false;
  }

  RT.futureWord = { mount: mount, unmount: unmount, load: load };
})(window.RT);
