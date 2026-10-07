window.RT = window.RT || {};

// 캘린더 탭: 저장된 기록을 "읽기만" 해서 달력·스트릭으로 보여 준다. (저장·수정 코드 없음)
(function (RT) {
  var root = document.getElementById('screen-calendar');
  if (!root) return;
  var $ = function (t) { return root.querySelector('[data-testid="' + t + '"]'); };
  var titleEl = $('cal-title'), gridEl = $('cal-grid'), streakEl = $('cal-streak');
  var streakNote = document.getElementById('cal-streak-note');
  var countEl = $('cal-month-count'), detailEl = $('cal-detail');

  var view = null;          // {y, m} (m: 0~11)
  var selected = null;      // 'YYYY-MM-DD' 또는 null
  var swallowClick = false; // 밀기 직후 날짜칸 클릭 무시

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function logs() { return (RT.store && RT.store.state && RT.store.state.logs) || {}; }
  function reduced() { return !!(RT.screens && RT.screens.reduced && RT.screens.reduced()); }

  function clearDetail() {
    selected = null;
    detailEl.textContent = '';
    var p = document.createElement('p');
    p.className = 'cal-hint';
    p.textContent = '날짜를 눌러 보세요';
    detailEl.appendChild(p);
  }

  function showDetail(date) {
    selected = date;
    var cells = gridEl.querySelectorAll('.cal-day');
    for (var i = 0; i < cells.length; i++) {
      cells[i].setAttribute('aria-pressed', cells[i].getAttribute('data-date') === date ? 'true' : 'false');
    }
    detailEl.textContent = '';
    var h = document.createElement('p');
    h.className = 'cal-detail-date';
    h.textContent = RT.koreanDate(date);
    detailEl.appendChild(h);

    var day = logs()[date];
    var items = [];
    if (day && typeof day === 'object') {
      for (var id in day) {
        if (!Object.prototype.hasOwnProperty.call(day, id)) continue;
        var lv = day[id];
        if (lv !== 'mini' && lv !== 'more' && lv !== 'max') continue;
        var r = RT.store.getRoutine(id);
        items.push({ name: r ? String(r.name) : '삭제된 루틴', level: lv, order: r ? (r.order || 0) : 1e9 });
      }
    }
    if (!items.length) {
      var e = document.createElement('p');
      e.className = 'cal-empty';
      e.setAttribute('data-testid', 'cal-empty');
      e.textContent = '기록이 없어요';
      detailEl.appendChild(e);
      return;
    }
    items.sort(function (a, b) { return a.order - b.order; });
    var ul = document.createElement('ul');
    ul.className = 'cal-list';
    for (var k = 0; k < items.length; k++) {
      var li = document.createElement('li');
      li.className = 'cal-item';
      li.setAttribute('data-level', items[k].level);
      li.textContent = items[k].name + ' · ' + items[k].level;
      ul.appendChild(li);
    }
    detailEl.appendChild(ul);
  }

  function renderStreak() {
    var info = RT.streakInfo(logs(), RT.today());
    streakEl.textContent = String(info.count);
    streakEl.setAttribute('data-streak-state', info.state);
    streakNote.textContent = info.state === 'today' ? '오늘까지 이어졌어요!'
      : info.state === 'pending' ? '오늘 하면 이어져요' : '오늘부터 시작해 봐요';
  }

  function renderMonth() {
    var today = RT.today();
    var first = new Date(view.y, view.m, 1);
    var lead = first.getDay(); // 일요일 시작
    var days = new Date(view.y, view.m + 1, 0).getDate();
    var L = logs();
    titleEl.textContent = view.y + '년 ' + (view.m + 1) + '월';

    var frag = document.createDocumentFragment();
    var count = 0;
    for (var c = 0; c < 42; c++) {
      var dn = c - lead + 1;
      if (dn < 1 || dn > days) {
        var pd = document.createElement('div');
        pd.className = 'cal-pad';
        pd.setAttribute('aria-hidden', 'true');
        frag.appendChild(pd);
        continue;
      }
      var date = view.y + '-' + pad(view.m + 1) + '-' + pad(dn);
      var lv = RT.dayLevel(L, date);
      if (lv) count++;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-day';
      b.setAttribute('data-testid', 'cal-day');
      b.setAttribute('data-date', date);
      b.setAttribute('data-level', lv || 'none');
      b.setAttribute('aria-pressed', date === selected ? 'true' : 'false');
      b.setAttribute('aria-label', RT.koreanDate(date) + (lv ? ' ' + lv : ' 기록 없음'));
      if (date === today) b.setAttribute('data-today', 'true');
      var num = document.createElement('span');
      num.className = 'cal-num';
      num.textContent = String(dn);
      b.appendChild(num);
      frag.appendChild(b);
    }
    gridEl.textContent = '';
    gridEl.appendChild(frag);
    countEl.textContent = String(count);
  }

  function refresh() {
    if (!view) { var n = new Date(); view = { y: n.getFullYear(), m: n.getMonth() }; clearDetail(); }
    renderStreak();
    renderMonth();
    if (selected) {
      // 선택한 날이 이 달에 있으면 상세를 최신 기록으로 다시 그림
      if (gridEl.querySelector('[data-date="' + selected + '"]')) showDetail(selected); else clearDetail();
    }
  }

  function move(delta) {
    var d = new Date(view.y, view.m + delta, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    clearDetail();
    renderStreak();
    renderMonth();
    gridEl.removeAttribute('data-anim');
    gridEl.setAttribute('data-dir', String(delta > 0 ? 1 : -1));
    if (!reduced()) {
      void gridEl.offsetWidth; // 처음부터 다시 시작
      gridEl.setAttribute('data-anim', 'slide');
    }
  }

  $('cal-prev').addEventListener('click', function () { move(-1); });
  $('cal-next').addEventListener('click', function () { move(1); });

  gridEl.addEventListener('click', function (e) {
    if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
    var cell = e.target.closest ? e.target.closest('.cal-day') : null;
    if (cell) showDetail(cell.getAttribute('data-date'));
  });

  // 가로 밀기 (터치·마우스 모두 pointer 이벤트, 세로 스크롤은 CSS touch-action: pan-y 로 살림)
  var sx = 0, sy = 0, sid = null;
  gridEl.addEventListener('pointerdown', function (e) {
    if (sid !== null) return;
    sid = e.pointerId; sx = e.clientX; sy = e.clientY; swallowClick = false;
  });
  function endSwipe(e, ok) {
    if (e.pointerId !== sid) return;
    sid = null;
    if (!ok) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swallowClick = true;
      setTimeout(function () { swallowClick = false; }, 400);
      move(dx < 0 ? 1 : -1);
    }
  }
  gridEl.addEventListener('pointerup', function (e) { endSwipe(e, true); });
  gridEl.addEventListener('pointercancel', function (e) { endSwipe(e, false); });

  RT.calendar = { refresh: refresh };
  refresh();
})(window.RT);
