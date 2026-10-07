window.RT = window.RT || {};

// 성장 캐릭터: 저장된 기록(logs)을 "읽기만" 해서 XP·레벨·모습을 보여 준다. 저장 코드 없음.
// 화면 그리기는 mount/render 안에만 있다 (나중에 3D 로 바꿔 끼울 때 이 둘만 교체).
(function (RT) {
  var XP = { mini: 3, more: 5, max: 8 };
  var STAGES = ['', '알', '아기', '꼬마', '어른'];
  var STAGE_ICON = ['', '🥚', '🐣', '🐥', '🦊'];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // 기록의 (날짜·루틴)마다 강도별 XP 합 (삭제된 루틴 기록도 포함)
  function computeXp(data) {
    var logs = data && data.logs;
    var sum = 0;
    if (!logs || typeof logs !== 'object') return 0;
    Object.keys(logs).forEach(function (d) {
      var day = logs[d];
      if (!day || typeof day !== 'object') return;
      Object.keys(day).forEach(function (id) {
        var lv = day[id];
        if (typeof lv === 'string' && has(XP, lv)) sum += XP[lv];
      });
    });
    return sum;
  }

  // 레벨 L 시작 XP = 6·L·(L−1)
  function startXp(L) { return 6 * L * (L - 1); }
  function levelOf(xp) {
    var L = 1;
    xp = Math.max(0, Number(xp) || 0);
    while (startXp(L + 1) <= xp) L++;
    return L;
  }
  function stageOf(level) {
    return level >= 7 ? 4 : level >= 5 ? 3 : level >= 3 ? 2 : 1;
  }

  var root = null;        // mount 한 자리
  var card = null;
  var refs = null;
  var lastLevel = null;
  var upTimer = null;

  function div(cls) { var e = document.createElement('div'); e.className = cls; return e; }
  function tid(el, id) { el.setAttribute('data-testid', id); return el; }

  function mount(el) {
    if (!el) return;
    unmount();
    root = el;
    card = tid(div('char-card'), 'char-card');
    var stage = div('char-stage');
    var pet = div('char-pet');
    pet.setAttribute('aria-hidden', 'true');
    ['char-ear char-ear-l', 'char-ear char-ear-r', 'char-body', 'char-eye char-eye-l', 'char-eye char-eye-r', 'char-shine'].forEach(function (c) { pet.appendChild(div(c)); });
    stage.appendChild(div('char-shadow'));
    stage.appendChild(pet);
    var info = div('char-info');
    var top = div('char-top');
    var lv = tid(document.createElement('strong'), 'char-level'); lv.className = 'char-level';
    var nm = tid(document.createElement('span'), 'char-stage-name'); nm.className = 'char-stage-name';
    top.appendChild(lv); top.appendChild(nm);
    var bar = tid(div('char-bar'), 'char-progress');
    var fill = div('char-fill');
    bar.appendChild(fill);
    var xpRow = document.createElement('p'); xpRow.className = 'char-xp-row';
    var xp = tid(document.createElement('strong'), 'char-xp');
    xpRow.appendChild(xp); xpRow.appendChild(document.createTextNode(' XP'));
    var next = tid(document.createElement('p'), 'char-next'); next.className = 'char-next';
    info.appendChild(top); info.appendChild(bar); info.appendChild(xpRow); info.appendChild(next);
    card.appendChild(stage); card.appendChild(info);
    root.appendChild(card);
    refs = { lv: lv, nm: nm, bar: bar, fill: fill, xp: xp, next: next };
    lastLevel = null;
  }

  function render(state) {
    if (!card) return;
    var data = state || (RT.store && RT.store.state) || {};
    var xp = computeXp(data);
    var L = levelOf(xp);
    var S = stageOf(L);
    var from = startXp(L), to = startXp(L + 1);
    var pct = Math.round(((xp - from) / (to - from)) * 100);
    card.setAttribute('data-xp', String(xp));
    card.setAttribute('data-level', String(L));
    card.setAttribute('data-stage', String(S));
    refs.lv.textContent = 'Lv' + L;
    refs.nm.textContent = STAGE_ICON[S] + ' ' + STAGES[S];
    refs.xp.textContent = String(xp);
    refs.bar.setAttribute('data-pct', String(pct));
    refs.fill.style.transform = 'scaleX(' + (pct / 100) + ')';
    refs.next.textContent = '다음 레벨까지 ' + (to - xp) + ' XP';
    // 레벨업 연출은 올라갈 때만 (처음 그릴 때·내려갈 때는 없음)
    if (lastLevel !== null && L > lastLevel) {
      if (upTimer) clearTimeout(upTimer);
      card.removeAttribute('data-levelup');
      void card.offsetWidth;
      card.setAttribute('data-levelup', '1');
      upTimer = setTimeout(function () { if (card) card.removeAttribute('data-levelup'); upTimer = null; }, 600);
    } else if (lastLevel !== null && L < lastLevel) {
      card.removeAttribute('data-levelup');
    }
    lastLevel = L;
  }

  function unmount() {
    if (upTimer) { clearTimeout(upTimer); upTimer = null; }
    if (root) root.textContent = '';
    root = null; card = null; refs = null; lastLevel = null;
  }

  RT.character = {
    computeXp: computeXp,
    levelOf: levelOf,
    stageOf: stageOf,
    mount: mount,
    render: render,
    unmount: unmount
  };
})(window.RT);
