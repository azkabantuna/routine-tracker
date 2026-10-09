// 미래 포털(밝은 햇살 문) 시험: 흑백 휘도(중심이 가장 밝음), 위치·크기, 구름 색·위치, 단어 대비, 앞면 빛 상태,
// 별가루(품질 1단계 절반·2단계 0), 저장 데이터 전후 같음, 외부 명령 7개.
// 실행(레포 루트에서): node projects/routine-tracker/tests/portal.test.mjs   (보통은 run.mjs 가 대신 켠 서버에서 돈다)
// 스크린샷은 디버그용이 아니라 휘도 측정용이다(PNG 를 zlib 로 직접 풀어 읽는다, pngjs 없음). 측정 중에는 DOM 단어 라벨을 가린다.
import zlib from 'node:zlib';
import { BASE, KEY, NOW, run, check, note, sleep, tid, getRaw, fixtureRaw, consoleErrors, externalRequests } from './_lib.mjs';

const CARD = tid('char-card');
const FWKEY = 'routineFutureWord';
const FWSEED = '미래의나';
const FN7 = ['mount', 'update', 'setActive', 'dispose', 'setLevel', 'setColor', 'getState'];
// 옛 빌드(HEAD) 실측 기준. 크기·위치·구름 값은 바꾸기 전과 같아야 한다(M11 값).
const OLD_D = 128.62;          // tunnel.d (±10%)
const OLD_CENTER = [249.7, 325.5]; // 중심(어두운 픽셀 무게중심 방식, ±10px)
const OLD_CLOUD = { x: 250.87, y: 224.5, w: 35.2, hh: 11.06 }; // ±2px
const CLOUD_RGB = [255, 241, 214]; // #FFF1D6
const WORD_RGB = [184, 71, 15];    // #B8470F

// ---------- PNG 디코더 (8비트 RGB/RGBA, 비인터레이스. zlib 내장만 사용) ----------
function decodePng(buf) {
  let p = 8; let w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`PNG 형식 미지원 bd=${bd} ct=${ct}`);
  const ch = ct === 6 ? 4 : 3; const stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0; const b = prev[x]; const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const Y = new Float32Array(w * h); // 휘도 0~1 (Rec.709 가중합, 감마 값 그대로)
  for (let i = 0; i < w * h; i++) Y[i] = (0.2126 * out[i * ch] + 0.7152 * out[i * ch + 1] + 0.0722 * out[i * ch + 2]) / 255;
  return { w, h, Y, out, ch };
}
const rgbAt = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.out[i], img.out[i + 1], img.out[i + 2]]; };
const annulus = (img, cx, cy, r0, r1) => {
  let s = 0, n = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const r = Math.hypot(x - cx, y - cy);
    if (r >= r0 && r < r1) { s += img.Y[y * img.w + x]; n++; }
  }
  return n ? s / n : NaN;
};
// 중심 찾기: 0.7d 안에서 휘도 0.9 미만 픽셀의 무게중심을 6번 되풀이(옛·새 빌드 모두 같은 자리 ±0.5px)
function centroidDark(img, gx, gy, d) {
  let cx = gx, cy = gy;
  for (let it = 0; it < 6; it++) {
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, Math.floor(cy - 0.7 * d)); y < Math.min(img.h, Math.ceil(cy + 0.7 * d)); y++) {
      for (let x = Math.max(0, Math.floor(cx - 0.7 * d)); x < Math.min(img.w, Math.ceil(cx + 0.7 * d)); x++) {
        if (Math.hypot(x - cx, y - cy) < 0.7 * d && img.Y[y * img.w + x] < 0.9) { sx += x; sy += y; n++; }
      }
    }
    if (n) { cx = sx / n; cy = sy / n; }
  }
  return [cx, cy];
}

// ---------- 판정 (순수 함수: 대조 입력에도 같은 함수를 쓴다) ----------
// 흑백 가장 밝음: 중심(0.15d) ≥0.85, 고리(0.3~0.45d)보다 ≥0.1 높고 바깥(0.55~0.7d, 포털 밖 배경)보다 밝거나 같음
const judgeBright = (img, cx, cy, d) => {
  const c = annulus(img, cx, cy, 0, 0.15 * d), ring = annulus(img, cx, cy, 0.3 * d, 0.45 * d), out = annulus(img, cx, cy, 0.55 * d, 0.7 * d);
  const e = [];
  if (!(c >= 0.85)) e.push(`중심 평균 ${c.toFixed(3)} (≥0.85 기대)`);
  if (!(c - ring >= 0.1)) e.push(`중심-고리 ${(c - ring).toFixed(3)} (고리 ${ring.toFixed(3)}, ≥0.1 기대)`);
  // 진행자: 0.55~0.7d 는 포털 지름(d) 바깥 = 크림 배경(흑백 ~0.93)이라 +0.1 은 불가능(흰색 최대 1.0). 요구 '가운데가 가장 밝다' → 중심 ≥ 바깥
  if (!(c - out >= 0)) e.push(`중심-바깥 ${(c - out).toFixed(3)} (바깥 ${out.toFixed(3)}, 중심이 바깥보다 밝거나 같아야 함)`);
  return e.length ? e.join('; ') : true;
};
// 대조용 가짜 배열: 중심만 어둡게 → 실패해야 하고, 바른 배열 → 통과해야 한다
const syntheticImg = (centerY) => {
  const w = 200, h = 200, cx = 100, cy = 100, d = 80; const Y = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x - cx, y - cy);
    Y[y * w + x] = r < 0.15 * d ? centerY : (r < 0.45 * d && r >= 0.3 * d) ? 0.7 : (r >= 0.55 * d && r < 0.7 * d) ? 0.5 : 0.8;
  }
  return { img: { w, h, Y, out: null, ch: 4 }, cx, cy, d };
};
// 품질 단계별 별가루·동작선 (샘플 배열)
const judgeStars = (S) => {
  const e = [];
  if (!S.length) return '샘플 없음';
  const q0 = S.filter((s) => s.q === 0);
  if (q0.some((s) => s.stars !== 24)) e.push(`품질 0 인데 별가루 ${q0.find((s) => s.stars !== 24).stars} (24 기대)`);
  const q1 = S.filter((s) => s.q === 1);
  if (!q1.length) e.push('품질 1단계 샘플 없음');
  else {
    if (q1.some((s) => s.stars !== 12)) e.push(`품질 1 별가루 ${q1.find((s) => s.stars !== 12).stars} (절반 12 기대)`);
    const r1 = q1.filter((s) => s.phase === 'running');
    if (!r1.length) e.push('품질 1단계 running 샘플 없음');
    else if (r1.some((s) => s.count !== 7)) e.push(`품질 1 동작선 ${r1.find((s) => s.count !== 7).count} (7 기대)`);
  }
  const q2 = S.filter((s) => s.q === 2);
  if (!q2.length) e.push('품질 2단계 샘플 없음');
  else if (q2.some((s) => s.stars !== 0)) e.push(`품질 2 별가루 ${q2.find((s) => s.stars !== 0).stars} (0 기대)`);
  const q3 = S.filter((s) => s.q >= 3);
  if (!q3.length) e.push('품질 3단계 샘플 없음');
  else if (q3.some((s) => s.light !== 0)) e.push(`품질 3 빛 ${q3.find((s) => s.light !== 0).light} (0 기대)`);
  return e.length ? e.join('; ') : true;
};
// 구름 y 는 dy 에 따라 움직인다(y = a + b·dy). 옛 빌드 실측: a 233.42, b -94.1, 잔차 0.01px
const OLD_Y_FIT = { a: 233.42, b: -94.1 };
const judgeCloudY = (pts) => {
  const n = pts.length; if (n < 10) return '샘플 부족';
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const vx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (vx < 1e-6) return 'dy 가 움직이지 않음';
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / vx, a = my - b * mx;
  const resid = Math.max(...pts.map((p) => Math.abs(p[1] - (a + b * p[0]))));
  const e = [];
  if (Math.abs(a - OLD_Y_FIT.a) > 2) e.push(`y 절편 ${a.toFixed(2)} (옛 ${OLD_Y_FIT.a} ±2)`);
  if (Math.abs(b - OLD_Y_FIT.b) > 3) e.push(`y 기울기 ${b.toFixed(2)} (옛 ${OLD_Y_FIT.b} ±3)`);
  if (resid > 1) e.push(`y 잔차 ${resid.toFixed(2)}px (dy 로 설명 안 됨)`);
  return e.length ? e.join('; ') : true;
};
// 구름 색: 가운데 5x5 중앙값이 #FFF1D6 ±14 (옛 #D2C6F8 이면 실패)
const judgeCloudColor = (rgb) => {
  const bad = rgb.some((v, i) => Math.abs(v - CLOUD_RGB[i]) > 14);
  return bad ? `구름 색 ${rgb.join(',')} (#FFF1D6 ±14 기대)` : true;
};
// 단어 대비(WCAG): 글자색 vs 알약 안쪽 픽셀(둥근 모서리 밖·테두리 2px 제외) 가운데 가장 어두운 5%
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumRgb = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const contrast = (a, b) => { const x = lumRgb(a), y = lumRgb(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// 알약 안쪽인지: 모서리 반지름 r(px), 테두리 m=2px 안쪽
const inPill = (x, y, w, h, r) => {
  const m = 2, rr = Math.max(0, Math.min(r, h / 2) - m);
  const x0 = m, y0 = m, x1 = w - m, y1 = h - m;
  if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
  const cx = x < x0 + rr ? x0 + rr : (x >= x1 - rr ? x1 - rr : x), cy = y < y0 + rr ? y0 + rr : (y >= y1 - rr ? y1 - rr : y);
  return Math.hypot(x - cx, y - cy) <= rr + 0.5;
};
let lastWordContrast = NaN;
const judgeWordContrast = (img, r) => {
  const pix = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (inPill(x, y, img.w, img.h, r)) pix.push(rgbAt(img, x, y));
  if (!pix.length) return '알약 안쪽 픽셀 없음';
  pix.sort((p, q) => lumRgb(p) - lumRgb(q));
  const worst = pix[Math.floor(0.05 * pix.length)];
  const c = contrast(WORD_RGB, worst);
  lastWordContrast = c;
  return c >= 4.5 ? true : `단어 대비 ${c.toFixed(2)} (≥4.5 기대, 알약 안 가장 어두운 5% 배경 ${worst.join(',')})`;
};

// ---------- 브라우저 준비 ----------
// 바쁜 루프(rAF 콜백마다 80ms)를 페이지 안에서 켤 수 있게 래핑. 리스너는 goto 전에 붙인다.
async function openPortal(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: 'Asia/Seoul', locale: 'ko-KR', isMobile: false, reducedMotion: 'no-preference' });
  await ctx.route('**/*', (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => {
    window.__rafN = 0; window.__busy = false;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      window.__rafN++;
      if (window.__busy) { const e = performance.now() + 80; while (performance.now() < e) { /* 끊김 흉내 */ } }
      cb(t);
    });
  });
  await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, fixtureRaw]);
  await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [FWKEY, FWSEED]);
  await page.goto(BASE);
  await page.click(tid('tab-manage'));
  await page.waitForFunction(() => !!(window.RT3D && window.RT3D.getState && window.RT3D.getState()), null, { timeout: 8000, polling: 100 });
  await page.waitForFunction(() => window.__rafN >= 5 && window.RT3D.getState().draws > 0, null, { timeout: 8000, polling: 100 });
  return { ctx, page };
}
// 캔버스 전체를 PNG 로 받아 해독. 라벨(.fw-layer)은 측정 동안만 가린다.
async function canvasImage(page, hideLabels) {
  await page.evaluate((hide) => document.querySelectorAll('.fw-layer').forEach((e) => { e.style.visibility = hide ? 'hidden' : ''; }), hideLabels);
  await sleep(120);
  const box = await page.locator(tid('char-canvas')).boundingBox();
  return decodePng(await page.screenshot({ clip: box, type: 'png' }));
}

// 상태 샘플러(10ms): 품질·별가루·동작선·빛·단계를 __ps 에 쌓는다
const startSampler = () => {
  window.__ps = []; const t0 = performance.now();
  window.__psTimer = setInterval(() => {
    if (!window.RT3D) return;
    const s = window.RT3D.getState();
    window.__ps.push({ t: performance.now() - t0, q: s.quality, phase: s.phase, stars: s.tunnel.stars, count: s.streaks.count, light: s.tunnel.light });
  }, 10);
};

await run(async (browser) => {
  // ----- 판정 대조: 가짜 배열로 판정 함수가 실제로 가려내는지 -----
  await check('P-대조. 흑백 판정: 바른 가짜 배열 통과, 중심만 어두운 가짜 배열 실패', () => {
    const good = syntheticImg(0.95); const bad = syntheticImg(0.3);
    const g = judgeBright(good.img, good.cx, good.cy, good.d);
    const b = judgeBright(bad.img, bad.cx, bad.cy, bad.d);
    if (g !== true) return `바른 배열이 실패함: ${g}`;
    if (b === true) return '중심만 어두운 배열이 통과함(판정이 느슨함)';
    return true;
  });
  await check('P-대조. 구름 y·단어 대비 판정: 옛 직선 통과·절편 어긋남 실패, 어두운 알약 배경 실패', () => {
    const line = (a, b) => Array.from({ length: 40 }, (_, i) => { const dy = -0.1 + i * 0.0045; return [dy, a + b * dy]; });
    if (judgeCloudY(line(233.42, -94.1)) !== true) return '옛 직선이 실패함';
    if (judgeCloudY(line(224.0, -94.1)) === true) return '절편 8px 어긋난 직선이 통과함';
    if (judgeCloudY(Array.from({ length: 40 }, () => [0.02, 230])) === true) return '안 움직이는 구름이 통과함';
    const light = { w: 96, h: 44, out: null, ch: 4 };
    const mk = (v) => { const Yb = Buffer.alloc(96 * 44 * 4); for (let i = 0; i < 96 * 44; i++) { Yb[i * 4] = v; Yb[i * 4 + 1] = v; Yb[i * 4 + 2] = v; Yb[i * 4 + 3] = 255; } return { ...light, out: Yb }; };
    if (judgeWordContrast(mk(250), 22) !== true) return '밝은 알약 배경이 실패함';
    if (judgeWordContrast(mk(120), 22) === true) return '어두운 배경(글자 대비 낮음)이 통과함';
    return true;
  });
  await check('P-대조. 별가루 판정: 1단계 별가루 24 는 실패, 2단계 0 과 1단계 12 는 통과', () => {
    const ok = [{ q: 0, stars: 24, count: 14, phase: 'running', light: 5 }, { q: 1, stars: 12, count: 7, phase: 'running', light: 5 }, { q: 2, stars: 0, count: 3, phase: 'running', light: 5 }, { q: 3, stars: 0, count: 0, phase: 'running', light: 0 }];
    const bad = ok.map((s) => (s.q === 1 ? { ...s, stars: 24 } : s));
    if (judgeStars(ok) !== true) return `바른 배열 실패: ${judgeStars(ok)}`;
    if (judgeStars(bad) === true) return '1단계 별가루 24 인데 통과함';
    return true;
  });

  // ----- 실제 장면: 저장 데이터 전 상태 -----
  const before = { tracker: null, future: null };
  let page = null, ctx = null;
  try {
    ({ ctx, page } = await openPortal(browser));
    before.tracker = await getRaw(page);
    before.future = await page.evaluate((k) => localStorage.getItem(k), FWKEY);
  } catch (e) {
    await check('P-준비. 관리 탭 3D 준비', false, String(e.message).split('\n')[0]);
  }
  if (!page) return;

  // ----- 흑백 휘도·위치·크기·구름 (running 상태, 품질 0) -----
  let img = null, C = null, st = null;
  try {
    await page.waitForFunction(() => window.RT3D.getState().phase === 'running', null, { timeout: 20000, polling: 50 });
    st = await page.evaluate(() => { const s = window.RT3D.getState(); return { tunnel: s.tunnel, cloud: s.cloud, quality: s.quality, phase: s.phase }; });
    img = await canvasImage(page, true);
    C = centroidDark(img, OLD_CENTER[0], OLD_CENTER[1], st.tunnel.d);
  } catch (e) {
    note('측정 준비 예외: ' + String(e.message).split('\n')[0]);
  }
  await check('P1. 흑백 가장 밝음: 중심(0.15d) ≥0.85, 고리보다 ≥0.1·바깥 배경 이상 (대조 입력은 P-대조)', () => {
    if (!img || !st) return '측정 값 없음';
    note(`중심 (${C[0].toFixed(1)},${C[1].toFixed(1)}) d=${st.tunnel.d.toFixed(2)} · 중심 ${annulus(img, C[0], C[1], 0, 0.15 * st.tunnel.d).toFixed(3)} · 고리 ${annulus(img, C[0], C[1], 0.3 * st.tunnel.d, 0.45 * st.tunnel.d).toFixed(3)} · 바깥 ${annulus(img, C[0], C[1], 0.55 * st.tunnel.d, 0.7 * st.tunnel.d).toFixed(3)}`);
    return judgeBright(img, C[0], C[1], st.tunnel.d);
  });
  await check(`P2. 위치·크기: tunnel.d ${OLD_D} ±10%, 중심 옛 자리 ±10px`, () => {
    if (!st) return '상태 없음';
    const e = [];
    if (Math.abs(st.tunnel.d - OLD_D) > OLD_D * 0.1) e.push(`d ${st.tunnel.d.toFixed(2)} (±10% 밖)`);
    if (!C || Math.abs(C[0] - OLD_CENTER[0]) > 10 || Math.abs(C[1] - OLD_CENTER[1]) > 10) e.push(`중심 (${C && C[0].toFixed(1)},${C && C[1].toFixed(1)}) (옛 자리 ±10px 밖)`);
    return e.length ? e.join('; ') : true;
  });
  await check('P3. 구름: x·w·hh 옛 값 ±2px, y 는 dy 직선(옛 절편·기울기), rot [0,0,0], 색 #FFF1D6(가운데 5x5 중앙값 ±14)', async () => {
    if (!st || !img) return '상태 없음';
    const yPts = await page.evaluate(async () => { const out = []; const t0 = performance.now(); while (performance.now() - t0 < 2000) { const s = window.RT3D.getState(); out.push([s.cloud.dy, s.cloud.y]); await new Promise((r) => setTimeout(r, 50)); } return out; });
    const c = st.cloud; const e = [];
    const yj = judgeCloudY(yPts); if (yj !== true) e.push(yj);
    if (Math.abs(c.x - OLD_CLOUD.x) > 2) e.push(`x ${c.x.toFixed(1)}`);
    if (Math.abs(c.w - OLD_CLOUD.w) > 2) e.push(`w ${c.w.toFixed(1)}`);
    if (Math.abs(c.hh - OLD_CLOUD.hh) > 2) e.push(`hh ${c.hh.toFixed(1)}`);
    if (!(Array.isArray(c.rot) && c.rot.every((v) => v === 0))) e.push(`rot ${JSON.stringify(c.rot)}`);
    const cx = Math.round(c.x), cy = Math.round(c.y);
    const patch = []; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) patch.push(rgbAt(img, cx + dx, cy + dy));
    const med = [0, 1, 2].map((k) => { const v = patch.map((p) => p[k]).sort((a, b) => a - b); return v[12]; });
    const col = judgeCloudColor(med); if (col !== true) e.push(col);
    return e.length ? e.join('; ') : true;
  });

  // ----- 단어 대비: 글자색(계산값) vs 알약 배경 픽셀(글자는 잠깐 투명) -----
  await check('P4. 단어 대비 ≥4.5: 글자색 #B8470F, 알약·구름 배경 가장 어두운 5% 기준', async () => {
    const info = await page.evaluate(() => {
      const fw = document.querySelector('[data-testid="future-word"]');
      if (!fw) return null;
      const cs = getComputedStyle(fw);
      return { color: cs.color, radius: parseFloat(cs.borderTopLeftRadius) || 0 };
    });
    if (!info) return '단어 요소 없음';
    if (info.color !== `rgb(${WORD_RGB.join(', ')})`) return `글자색 ${info.color} (rgb(184, 71, 15) 기대)`;
    await page.evaluate(() => { document.querySelectorAll('.fw-layer').forEach((e) => { e.style.visibility = ''; }); document.querySelector('[data-testid="future-word"]').style.color = 'transparent'; });
    await sleep(120);
    const box = await page.locator(tid('future-word')).boundingBox();
    const shot = decodePng(await page.screenshot({ clip: box, type: 'png' }));
    await page.evaluate(() => { document.querySelector('[data-testid="future-word"]').style.color = ''; });
    const wr = judgeWordContrast(shot, info.radius);
    note(`단어 대비(알약 안 가장 어두운 5%) ${lastWordContrast.toFixed(2)}`);
    return wr;
  });

  // ----- 저장 데이터·외부 명령 7개 (3D 기능 시작 전후) -----
  await check('P8. 외부 명령 7개: RT3D 키가 정확히 7개, 모두 function', async () => {
    const keys = await page.evaluate(() => Object.keys(window.RT3D).sort());
    const want = [...FN7].sort();
    if (JSON.stringify(keys) !== JSON.stringify(want)) return `키 ${JSON.stringify(keys)}`;
    const types = await page.evaluate((ks) => ks.map((k) => typeof window.RT3D[k]), keys);
    return types.every((t) => t === 'function') ? true : `함수 아님: ${types.join(',')}`;
  });

  // ----- 품질 단계별 별가루·동작선·빛 (바쁜 루프로 1→3단계, 측정 창은 페이지 안에서 잰다) -----
  let sampled = null;
  try {
    await page.evaluate(startSampler);
    await page.evaluate(() => { window.__busy = true; });
    await page.waitForFunction(() => window.__ps.some((s) => s.q >= 3), null, { timeout: 60000, polling: 200 });
    await page.evaluate(() => { window.__busy = false; });
    sampled = await page.evaluate(() => { clearInterval(window.__psTimer); return window.__ps; });
  } catch (e) {
    note('품질 측정 예외: ' + String(e.message).split('\n')[0]);
  }
  await check('P6. 성능 단계: 품질 1 별가루 절반(12)·동작선 7(running), 2 별가루 0, 3 빛 0 (샘플 전부)', () => {
    if (!sampled) return '품질 3단계 도달 못 함(60초)';
    const q = [0, 1, 2, 3].map((k) => sampled.filter((s) => s.q === k).length);
    note(`샘플 수 q0/q1/q2/q3 = ${q.join('/')}`);
    return judgeStars(sampled);
  });
  await check('P5. 앞면 빛: 품질 0 에서 tunnel.light>0(5), 품질 3(빛 끔)에서 0 — 픽셀 밝기 차는 미측정(아래 기록)', () => {
    const a = sampled && sampled.find((s) => s.q === 0), b = sampled && sampled.find((s) => s.q >= 3);
    if (!a) return '품질 0 샘플 없음';
    if (!(a.light > 0)) return `품질 0 빛 ${a.light} (>0 기대)`;
    if (!b) return '품질 3 샘플 없음';
    if (b.light !== 0) return `품질 3 빛 ${b.light} (0 기대)`;
    note('몸 영역 밝기 차 3~12%는 측정하지 않음: 달리기 중 자세가 계속 바뀌어 같은 장면 비교가 안 됨(rt3dT 는 시간을 멈추지 않음)');
    return true;
  });

  // ----- 저장 데이터 전후 같음 -----
  await check('P7. 저장: routineTracker·routineFutureWord 전후 === (바이트 동일)', async () => {
    const after = { tracker: await getRaw(page), future: await page.evaluate((k) => localStorage.getItem(k), FWKEY) };
    if (after.tracker !== before.tracker) return 'routineTracker 바뀜';
    if (after.future !== before.future) return `routineFutureWord 바뀜 (${JSON.stringify(before.future)} → ${JSON.stringify(after.future)})`;
    if (after.future !== FWSEED) return `routineFutureWord 값 ${JSON.stringify(after.future)} (심은 값 유지 기대)`;
    return true;
  });
  await check('P9. pageerror 0 (리스너는 goto 전에 붙임)', () => {
    const pe = consoleErrors.filter((m) => m.startsWith('pageerror'));
    return pe.length === 0 ? true : pe.slice(0, 3).join(' | ');
  });

  await ctx.close();
});
