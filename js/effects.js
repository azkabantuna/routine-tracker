window.RT = window.RT || {};

// 축포(색종이) + 이모지 입자. DOM + CSS @keyframes (transform·opacity 만).
// 강도가 클수록 개수·반경·시간이 커진다. 입자는 전역 배열 하나로 관리하고 80개를 넘기지 않는다.
// 정리는 animationend 가 아니라 안전 타이머로 한다 (움직임 줄이기·숨은 화면에서도 반드시 지워짐).
(function (RT) {
  var MAX_PARTICLES = 80;
  var COLORS = ['#FF7A3D', '#5FD3B0', '#FFD23F', '#FF8FB1', '#5BC0FF', '#B79CFF'];
  var DIST = [0.7, 0.85, 1.0];
  var FONT = 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif';

  // 시간은 ms. endTime(지연+길이)이 mini 800–1000 / more 1100–1400 / max 1600–2000 안에 들어오게 잡았다.
  var CFG = {
    mini: { confetti: 8, burst: 3, rain: 0, R: 80, size: 22, rainSize: 0, cw: 6, ch: 9, g: 40, life: 1200,
            cDur: 760, cDurStep: 40, cDelayMod: 4, cDelayStep: 20,
            bDur: 880, bDelayMod: 3, bDelayStep: 30, glow: false },
    more: { confetti: 24, burst: 4, rain: 4, R: 130, size: 28, rainSize: 28, cw: 8, ch: 12, g: 60, life: 1600,
            cDur: 1000, cDurStep: 50, cDelayMod: 6, cDelayStep: 20,
            bDur: 1150, bDelayMod: 4, bDelayStep: 40,
            rDur: 1000, rDurStep: 50, rMul: 3, rDelayStep: 60, glow: false },
    max:  { confetti: 40, burst: 6, rain: 10, R: 190, size: 36, rainSize: 32, cw: 10, ch: 15, g: 80, life: 2200,
            cDur: 1500, cDurStep: 60, cDelayMod: 5, cDelayStep: 50,
            bDur: 1700, bDelayMod: 6, bDelayStep: 40,
            rDur: 1100, rDurStep: 100, rMul: 7, rDelayStep: 40, glow: true, glowDur: 1800 }
  };

  var particles = [];   // 지금 화면에 있는 .confetti + .emoji-particle 전부 (전역 하나)
  var celebrations = []; // 지금 있는 .celebrate

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function removeCelebrate(c) {
    if (c.__timer) { clearTimeout(c.__timer); c.__timer = null; }
    if (c.parentNode) c.parentNode.removeChild(c);
    particles = particles.filter(function (p) { return p.__c !== c; });
    var i = celebrations.indexOf(c);
    if (i >= 0) celebrations.splice(i, 1);
  }

  // 새 입자 n 개를 넣을 자리를 만든다: 80 을 넘으면 오래된 것부터 지운다
  function makeRoom(n) {
    while (particles.length + n > MAX_PARTICLES && particles.length) {
      var old = particles.shift();
      var c = old.__c;
      if (old.parentNode) old.parentNode.removeChild(old);
      if (c && !c.querySelector('.confetti, .emoji-particle')) removeCelebrate(c);
    }
  }

  function el(tag, cls) {
    var e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  function setAnim(e, dur, delay) {
    e.style.animationDuration = dur + 'ms';
    e.style.animationDelay = delay + 'ms';
  }

  function celebrate(opts) {
    opts = opts || {};
    var level = opts.level;
    var cfg = CFG[level];
    if (!cfg) return null;
    if (reduced()) return null;

    var W = window.innerWidth || document.documentElement.clientWidth || 360;
    var H = window.innerHeight || document.documentElement.clientHeight || 640;
    var x = isFinite(opts.x) ? opts.x : W / 2;
    var y = isFinite(opts.y) ? opts.y : H / 2;
    var glyph = typeof opts.emoji === 'string' && opts.emoji ? opts.emoji : '✨';

    var total = cfg.confetti + cfg.burst + cfg.rain;
    makeRoom(total);

    var root = el('div', 'celebrate');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('data-level', level);
    root.setAttribute('data-count', String(cfg.confetti + cfg.burst + cfg.rain));
    root.setAttribute('data-burst', String(cfg.burst));
    root.setAttribute('data-rain', String(cfg.rain));

    var frag = document.createDocumentFragment();
    var made = [];
    var i;

    if (cfg.glow) {
      var glow = el('div', 'celebrate-glow');
      glow.style.left = (x - 180) + 'px';
      glow.style.top = (y - 180) + 'px';
      setAnim(glow, cfg.glowDur, 0);
      frag.appendChild(glow);
    }

    // 색종이: 각도는 고르게(+작은 흔들림), 거리는 R×[0.7, 0.85, 1.0] 순환 (무작위 없음)
    for (i = 0; i < cfg.confetti; i++) {
      var ca = ((i + 0.5) / cfg.confetti) * 360 + ((i * 37) % 11 - 5);
      var cr = cfg.R * DIST[i % 3];
      var rad = ca * Math.PI / 180;
      var c = el('div', 'confetti');
      c.setAttribute('data-i', String(i));
      c.style.width = cfg.cw + 'px';
      c.style.height = cfg.ch + 'px';
      c.style.left = (x - cfg.cw / 2) + 'px';
      c.style.top = (y - cfg.ch / 2) + 'px';
      c.style.background = COLORS[i % COLORS.length];
      c.style.setProperty('--dx', Math.round(Math.cos(rad) * cr) + 'px');
      c.style.setProperty('--dy', Math.round(Math.sin(rad) * cr) + 'px');
      c.style.setProperty('--rot', ((i % 2 ? 1 : -1) * (180 + (i * 47) % 180)) + 'deg');
      c.style.setProperty('--g', cfg.g + 'px');
      setAnim(c, cfg.cDur + (i % 3) * cfg.cDurStep, (i % cfg.cDelayMod) * cfg.cDelayStep);
      frag.appendChild(c);
      made.push(c);
    }

    // 이모지 터짐: 누른 버튼 중앙에서 퍼짐
    var burst = el('div', 'emoji-burst');
    var bs = Math.round(cfg.size * 1.25);
    for (i = 0; i < cfg.burst; i++) {
      var ba = (i / cfg.burst) * 360 - 90 + ((i * 29) % 9 - 4);
      var br = cfg.R * DIST[i % 3];
      var brad = ba * Math.PI / 180;
      var p = el('span', 'emoji-particle');
      p.setAttribute('data-kind', 'burst');
      p.setAttribute('data-i', String(i));
      p.textContent = glyph;
      p.style.fontSize = cfg.size + 'px';
      p.style.width = bs + 'px';
      p.style.height = bs + 'px';
      p.style.left = (x - bs / 2) + 'px';
      p.style.top = (y - bs / 2) + 'px';
      p.style.setProperty('--dx', Math.round(Math.cos(brad) * br) + 'px');
      p.style.setProperty('--dy', Math.round(Math.sin(brad) * br) + 'px');
      p.style.setProperty('--rot', ((i % 2 ? 1 : -1) * 20) + 'deg');
      p.style.setProperty('--g', cfg.g + 'px');
      setAnim(p, cfg.bDur, (i % cfg.bDelayMod) * cfg.bDelayStep);
      burst.appendChild(p);
      made.push(p);
    }
    frag.appendChild(burst);

    // 우수수: 화면 위쪽 밖에서 시작해 아래로. x 는 너비를 n칸으로 나눈 칸 중앙 ±20%
    if (cfg.rain) {
      var rain = el('div', 'emoji-rain');
      var rs = Math.round(cfg.rainSize * 1.25);
      var cell = W / cfg.rain;
      for (i = 0; i < cfg.rain; i++) {
        var jitter = (((i * 5) % 7) / 3 - 1) * 0.2; // -0.2 ~ +0.2 (결정적)
        var cx = (i + 0.5) * cell + jitter * cell;
        var rp = el('span', 'emoji-particle');
        rp.setAttribute('data-kind', 'rain');
        rp.setAttribute('data-i', String(i));
        rp.textContent = glyph;
        rp.style.fontSize = cfg.rainSize + 'px';
        rp.style.width = rs + 'px';
        rp.style.height = rs + 'px';
        rp.style.left = Math.round(cx - rs / 2) + 'px';
        rp.style.top = '-48px';
        rp.style.setProperty('--dx', ((i % 2 ? 1 : -1) * 12) + 'px');
        rp.style.setProperty('--dy', Math.round(H * 0.9) + 'px');
        rp.style.setProperty('--rot', ((i % 2 ? 1 : -1) * 40) + 'deg');
        setAnim(rp, cfg.rDur + (i % 3) * cfg.rDurStep, ((i * cfg.rMul) % cfg.rain) * cfg.rDelayStep);
        rain.appendChild(rp);
        made.push(rp);
      }
      frag.appendChild(rain);
    }

    root.appendChild(frag);
    made.forEach(function (n) { n.__c = root; });
    particles = particles.concat(made);
    celebrations.push(root);
    document.body.appendChild(root);
    root.__timer = setTimeout(function () { removeCelebrate(root); }, cfg.life);
    return root;
  }

  RT.effects = { celebrate: celebrate, MAX_PARTICLES: MAX_PARTICLES };
})(window.RT);
