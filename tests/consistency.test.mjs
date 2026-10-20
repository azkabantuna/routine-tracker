// R3 디자인 통일 점검 (routine-tracker 야간 바퀴 3): 1 토큰 · 2 흑백 대비 · 3 리듬 · 4 전후 픽셀·rect·대비·잘림
// 실행(레포 루트): node projects/routine-tracker/tests/consistency.test.mjs  (서버 주소 RT_URL, 기본 8080 = run.mjs)
// 고치기 전 기준선(한 번만, B 가 css 를 고치기 전에): R3_WRITE_BEFORE=1 RT_URL=http://localhost:8087/ node .../consistency.test.mjs
//   → logs/routine-tracker/r3-before/ 에 seed.json · tab-*.png(4탭 360x740) · rects.json · pairs.json 기록
// 원칙: 기대값은 계획 기준 숫자, 반대 시험(일부러 틀린 값을 넣으면 실패하는지)을 매번 같이 돈다.
import { run, record, note, info, sleep, tid, open, fs, path, HERE, BASE, fixtureRaw } from './_lib.mjs';

const CSS_DIR = path.resolve(HERE, '..', 'css');
const CSS_FILES = ['base', 'cards', 'overlays', 'effects', 'calendar', 'timer', 'character'];
const BASE_DIR = path.resolve(HERE, '..', '..', '..', 'logs', 'routine-tracker', 'r3-before');
const WRITE = process.env.R3_WRITE_BEFORE === '1';
const VP = { width: 360, height: 740 };
const NOW_R3 = '2026-10-21T10:00:00+09:00';
const TABS = [['today', 'tab-today'], ['calendar', 'tab-calendar'], ['manage', 'tab-manage'], ['timer', 'tab-timer']];
const HIDE_3D = 'canvas{visibility:hidden !important}';   // 3D 캔버스 가림 (전/후 같은 조건)
const GRAY = 'html{filter:grayscale(1) !important}';       // 흑백 사진
const RELEASE_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';  // --ease-pop
const ALLOW_COLOR = [/#B8470F/i];                           // 예외: 포털 단어 글자색(계획 기준 1)

// 요소 목록 수집 (rect·글자 대비·잘림). 같은 선택자끼리 DOM 순서로 짝짓는다.
const SELS = ['.tabbar', '.tab', '.screen-title', '.today-future', '.today-date', '.today-hint', '.progress-text', '.progress-bar',
  '.card', '.card-name', '.level-btn', '.level-crit', '.card-more', '.add-routine', '.btn', '.char-card', '.char-info', '.fw-word',
  '.cal-title', '.cal-stat', '.cal-stat-label', '.cal-streak-note', '.cal-grid', '.cal-day', '.cal-detail', '.cal-item',
  '.timer-ring-wrap', '.timer-time', '.timer-btn', '.timer-icon-btn', '.timer-min-row', '.timer-unit', '.timer-actions', '.timer-fs-row'];
const collectFn = (sels) => {
  const rgb = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; const c = rgb(cs.backgroundColor); if (c && c[3] > 0.5) return c; } return [255, 255, 255, 1]; };
  const out = [];
  for (const sel of sels) {
    let idx = -1;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || el.closest('[hidden]')) continue;
      idx += 1;
      const cs = getComputedStyle(el);
      const fg = rgb(cs.color), bg = bgOf(el);
      let cr = null;
      if (fg && bg && el.textContent.trim()) {
        const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        const a = L(fg), b = L(bg);
        cr = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      }
      out.push({
        sel, idx, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 16),
        x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
        cr, clip: el.scrollWidth > el.clientWidth + 1, off: r.left < -0.5 || r.right > window.innerWidth + 0.5,
      });
    }
  }
  return out;
};

// 흑백 대비용 영역(계획 기준 2): 눌린/안 눌린 level-btn 윗띠, 선택/비선택 탭 윗띠, 시작 버튼과 왼쪽 여백 배경
const areasFn = () => {
  const band = (r, fx0, fx1, fy0, fy1) => ({ x0: r.left + r.width * fx0, x1: r.left + r.width * fx1, y0: r.top + r.height * fy0, y1: r.top + r.height * fy1 });
  const R = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
  const out = {};
  let r;
  if ((r = R('.level-btn[aria-pressed="true"]'))) out.pressed = band(r, 0.2, 0.8, 0.12, 0.3);
  if ((r = R('.level-btn[aria-pressed="false"]'))) out.unpressed = band(r, 0.2, 0.8, 0.12, 0.3);
  if ((r = R('.tab[aria-selected="true"]'))) out.pillSel = band(r, 0.2, 0.8, 0.1, 0.25);
  if ((r = R('.tab[aria-selected="false"]'))) out.pillUns = band(r, 0.2, 0.8, 0.1, 0.25);
  if ((r = R('[data-testid="timer-start"]'))) { out.start = band(r, 0.2, 0.8, 0.12, 0.3); out.bgNear = { x0: 1, x1: 10, y0: r.top + r.height * 0.12, y1: r.top + r.height * 0.3 }; }
  return out;
};
const facesFn = () => {
  const mk = (v) => { const d = document.createElement('div'); d.style.background = v; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
  return { mini: mk('var(--c-mini-face)'), more: mk('var(--c-more-face)'), max: mk('var(--c-max-face)') };
};
// 읽기 도구: 흑백 사진에서 영역별 평균 밝기 (Rec.709)
const grayMeansFn = async ([src, bands]) => {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const out = {};
  for (const [k, b] of Object.entries(bands)) {
    if (!b) continue;
    const x0 = Math.max(0, Math.round(b.x0)), x1 = Math.min(img.width, Math.round(b.x1));
    const y0 = Math.max(0, Math.round(b.y0)), y1 = Math.min(img.height, Math.round(b.y1));
    const d = x.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722; n++; }
    out[k] = s / n;
  }
  return out;
};
// 전/후 사진 비교: 채널 차가 8 넘는 픽셀 %
const diffFn = async ([a, b]) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  const get = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const da = get(ia), db = get(ib);
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) diff++;
  return { pct: (diff / (w * h)) * 100, sizes: [[ia.width, ia.height], [ib.width, ib.height]] };
};
// 리듬 읽기: 요소의 transition 시간·easing·속성 (누름 중에는 :active 가 실제로 걸렸는지도 확인)
const readFn = (s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return { d: cs.transitionDuration, e: cs.transitionTimingFunction, p: cs.transitionProperty, a: el.matches(':active') }; };
// transform·opacity 외 움직임 찾기 (실제 transition 시간 > 0 인 요소, 그리고 @keyframes 속성)
const motionFn = () => {
  const ok = new Set(['transform', 'opacity']);
  const kf = {};
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) if (r.type === CSSRule.KEYFRAMES_RULE) { const ps = new Set(); for (const k of r.cssRules) for (const p of k.style) ps.add(p); kf[r.name] = [...ps]; }
  }
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
    if (cs.transitionDuration.split(',').some((x) => parseFloat(x) > 0)) {
      const ps = cs.transitionProperty.split(',').map((s) => s.trim());
      if (ps.some((p) => !ok.has(p))) bad.push(`${tag} transition:${ps.join(',')}`);
    }
    if (cs.animationName && cs.animationName !== 'none') {
      for (const n of cs.animationName.split(',').map((s) => s.trim())) {
        const ps = kf[n];
        if (!ps) bad.push(`${tag} animation:${n}(keyframes 없음)`);
        else if (ps.some((p) => !ok.has(p))) bad.push(`${tag} animation:${n}(${ps.join(',')})`);
      }
    }
  }
  return bad;
};

// ---------- 1. 토큰: css 파일을 글로 읽어 :root 밖 직접 값 찾기 ----------
export function scanCss(src, file = 'x.css') {
  const viol = [];
  const fontVals = new Set();
  const spaceVals = new Set();
  const s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const r = s.indexOf(':root {');
  let rootEnd = -1;
  if (r >= 0) {
    let d = 0;
    for (let i = r; i < s.length; i++) {
      if (s[i] === '{') d++;
      else if (s[i] === '}') { d--; if (d === 0) { rootEnd = i; break; } }
    }
  }
  const lens = (str) => [...str.matchAll(/(-?\d*\.?\d+)(px|%|rem|em|vw|vh|vmin|vmax)/g)].filter((x) => parseFloat(x[1]) !== 0).map((x) => x[0]);
  const re = /([a-zA-Z-]+)\s*:\s*([^;{}]+)[;}]/g;
  let m;
  while ((m = re.exec(s))) {
    if (r >= 0 && m.index >= r && m.index <= rootEnd) continue;
    const prop = m[1];
    if (prop.startsWith('--')) continue;
    const val = m[2].trim();
    const at = `${file}:${s.slice(0, m.index).split('\n').length} ${prop}: ${val}`;
    const add = (cat) => viol.push({ cat, at });
    const withVarOut = val.replace(/var\([^)]*\)/g, 'VAR');
    const plain = withVarOut.replace(/color-mix\([^)]*\)/g, 'MIX');
    if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(withVarOut) && !ALLOW_COLOR.some((a) => a.test(val))) add('색');
    if (/radius$/.test(prop) && lens(plain).length) add('radius');
    if (/^(box-shadow|text-shadow)$/.test(prop) && val !== 'none' && !/^var\(--sh-[a-z-]+\)$/.test(val)) add('그림자');
    if (prop === 'font-size') { fontVals.add(val); if (lens(plain).length) add('글자 크기'); }
    if (/^(gap|row-gap|column-gap|padding(-[a-z]+)?|margin(-[a-z]+)?)$/.test(prop)) {
      for (const x of plain.matchAll(/(-?\d*\.?\d+)px/g)) {
        const n = parseFloat(x[1]);
        if (n !== 0) { spaceVals.add(x[0]); if (Math.abs(n) % 4 !== 0) add('간격 4px 눈금 밖'); }
      }
      for (const x of val.matchAll(/var\(--sp-[a-z0-9-]+\)/g)) spaceVals.add(x[0]);
      if (/\d(\.\d+)?%|vmin|vmax|vw|vh|rem|em\b/.test(plain)) { /* 간격 단위 비px: 아래 고유값에 포함 */ for (const x of plain.matchAll(/(-?\d*\.?\d+)(%|vmin|vmax|vw|vh|rem|em)/g)) if (parseFloat(x[1]) !== 0) spaceVals.add(x[0]); }
    }
    if (/^(transition|animation|transition-duration|animation-duration|transition-delay|animation-delay)$/.test(prop) && /\d(\.\d+)?m?s\b/.test(plain)) add('시간(ms·s 직접)');
    if (/^(transition|animation|transition-timing-function|animation-timing-function)$/.test(prop) && /(^|[\s,])(ease|ease-in|ease-out|ease-in-out|linear)(?=[\s,]|$)|cubic-bezier\(/.test(plain)) add('easing 직접');
  }
  return { viol, fontVals, spaceVals };
}

function staticChecks() {
  const all = { viol: [], font: new Set(), space: new Set() };
  for (const f of CSS_FILES) {
    const r = scanCss(fs.readFileSync(path.join(CSS_DIR, f + '.css'), 'utf8'), f + '.css');
    all.viol.push(...r.viol);
    r.fontVals.forEach((x) => all.font.add(x));
    r.spaceVals.forEach((x) => all.space.add(x));
  }
  const of = (c) => all.viol.filter((v) => v.cat === c);
  const show = (arr) => arr.slice(0, 4).map((v) => v.at).join(' | ') + (arr.length > 4 ? ` 외 ${arr.length - 4}건` : '');
  record('기준1 · :root 밖 직접 색 0 (예외 #B8470F 포털)', of('색').length === 0, of('색').length ? show(of('색')) : '');
  record('기준1 · :root 밖 직접 radius 0 (50% 원형 포함)', of('radius').length === 0, of('radius').length ? show(of('radius')) : '');
  record('기준1 · :root 밖 직접 그림자 0', of('그림자').length === 0, of('그림자').length ? show(of('그림자')) : '');
  record('기준1 · :root 밖 직접 시간(ms·s) 0', of('시간(ms·s 직접)').length === 0, of('시간(ms·s 직접)').length ? show(of('시간(ms·s 직접)')) : '');
  record('기준1 · :root 밖 직접 easing 0', of('easing 직접').length === 0, of('easing 직접').length ? show(of('easing 직접')) : '');
  // 진행자 판정(야간 바퀴3): 계획 목표 ≤6 은 글자 1px 차이도 요소를 2px 넘게 옮겨(카드 이름 19→20 이 4.2px) '모양 그대로' 규칙과 부딪힘
  // → 모든 글자 크기는 :root 변수(직접 px 0 은 위 검사), 종류 수는 전(19)보다 늘지 않고 이번 결과(14) 이하로 고정. 고유값은 기록.
  record('기준1 · font-size 고유값 ≤14 (전 19, 현재 ' + all.font.size + ')', all.font.size <= 14, '고유값: ' + [...all.font].join(', '));
  record('기준1 · 간격(gap·padding·margin) 고유값 ≤8 (현재 ' + all.space.size + ')', all.space.size <= 8, all.space.size > 8 ? '고유값: ' + [...all.space].join(', ') : '');
  record('기준1 · 간격 px 값은 4의 배수 (4px 눈금)', of('간격 4px 눈금 밖').length === 0, of('간격 4px 눈금 밖').length ? show(of('간격 4px 눈금 밖')) : '');
  // 반대 시험: :root 밖 ms 한 개를 넣은 css 문자열은 반드시 실패(잡힘)로 나와야 한다
  const self = scanCss('.x { transition: transform 280ms ease-out; }', 'self.css');
  record('기준1 반대 시험 · :root 밖 280ms·ease-out 을 넣으면 잡힌다', self.viol.some((v) => v.cat === '시간(ms·s 직접)') && self.viol.some((v) => v.cat === 'easing 직접'), 'scanCss 가 못 잡음');
}

// ---------- 2·4 (사진·요소): 4탭 캡처 (같은 시드·고정 시계 2026-10-21·reduce·3D 가림) ----------
async function captureAll(browser) {
  const seed = JSON.parse(fixtureRaw);
  seed.logs = { ...seed.logs, '2026-10-21': { r_old_a: 'mini', r_old_b: 'more' } };
  const { ctx, page } = await open(browser, { seed, reduced: true, viewport: VP, now: NOW_R3, goto: false });
  await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, ['routineFutureWord', '건강한 나']);
  await page.goto(BASE);
  await sleep(300);
  await page.addStyleTag({ content: HIDE_3D });
  const out = { seed, tabs: {}, pngs: {}, gray: {} };
  for (const [name, id] of TABS) {
    if (name !== 'today') { await page.click(tid(id)); await sleep(450); }
    out.tabs[name] = await page.evaluate(collectFn, SELS);
    out.pngs[name] = await page.screenshot({ type: 'png' });
    if (name === 'today' || name === 'timer') {
      const areas = await page.evaluate(areasFn);
      const h = await page.addStyleTag({ content: GRAY });
      const png = await page.screenshot({ type: 'png' });
      await h.evaluate((n) => n.remove());
      out.gray[name] = { png, areas };
    }
  }
  out.faces = await page.evaluate(facesFn);
  await ctx.close();
  return out;
}

// 흑백 대비 값 계산(픽셀 평균 기준)
const linv = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const crOf = (a, b) => { const x = linv(a), y = linv(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const dataUrl = (buf) => 'data:image/png;base64,' + buf.toString('base64');
const parseRgbStr = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); return m[1].split(',').slice(0, 3).map(Number); };
const grayOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

async function pairs(browser, cap) {
  const dec = await browser.newPage();
  await dec.setContent('<html><body></body></html>');
  const means = {};
  for (const name of Object.keys(cap.gray)) means[name] = await dec.evaluate(grayMeansFn, [dataUrl(cap.gray[name].png), cap.gray[name].areas]);
  await dec.close();
  const t = means.today, m = means.timer;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const faceG = Object.fromEntries(Object.entries(cap.faces).map(([k, v]) => [k, grayOf(parseRgbStr(v))]));
  return {
    level: { pressedMean: r3(t.pressed), unpressedMean: r3(t.unpressed), ratio: r3(crOf(t.pressed, t.unpressed)) },
    pill: { selMean: r3(t.pillSel), unselMean: r3(t.pillUns), ratio: r3(crOf(t.pillSel, t.pillUns)) },
    start: { btnMean: r3(m.start), bgMean: r3(m.bgNear), ratio: r3(crOf(m.start, m.bgNear)) },
    faces: {
      grayMini: r3(faceG.mini), grayMore: r3(faceG.more), grayMax: r3(faceG.max),
      miniMore: r3(crOf(faceG.mini, faceG.more)), miniMax: r3(crOf(faceG.mini, faceG.max)), moreMax: r3(crOf(faceG.more, faceG.max)),
    },
  };
}

async function writeBaseline(browser) {
  const cap = await captureAll(browser);
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASE_DIR, 'seed.json'), JSON.stringify(cap.seed, null, 1));
  for (const [name] of TABS) fs.writeFileSync(path.join(BASE_DIR, `tab-${name}.png`), cap.pngs[name]);
  fs.writeFileSync(path.join(BASE_DIR, 'rects.json'), JSON.stringify({ viewport: VP, now: NOW_R3, tabs: cap.tabs }, null, 1));
  const pr = await pairs(browser, cap);
  fs.writeFileSync(path.join(BASE_DIR, 'pairs.json'), JSON.stringify(pr, null, 1));
  console.log('기준선 기록 완료: ' + BASE_DIR);
  console.log(JSON.stringify(pr));
}

async function pixelAndRects(browser) {
  const basePath = (f) => path.join(BASE_DIR, f);
  const have = fs.existsSync(basePath('rects.json')) && fs.existsSync(basePath('pairs.json'));
  record('기준4 전 기준선 파일 있음 (logs/routine-tracker/r3-before)', have, have ? '' : '없음: R3_WRITE_BEFORE=1 로 먼저 기록');
  if (!have) return;
  const baseRects = JSON.parse(fs.readFileSync(basePath('rects.json'), 'utf8')).tabs;
  const cap = await captureAll(browser);
  const dec = await browser.newPage();
  await dec.setContent('<html><body></body></html>');
  const fails = [], moved = [];
  const keyed = (list) => { const seen = {}; return new Map(list.map((it) => { seen[it.sel] = (seen[it.sel] ?? -1) + 1; return [`${it.sel}#${seen[it.sel]}`, it]; })); };
  for (const [name] of TABS) {
    const before = fs.readFileSync(basePath(`tab-${name}.png`));
    const d = await dec.evaluate(diffFn, [dataUrl(before), dataUrl(cap.pngs[name])]);
    note(`${name}: 바뀐 픽셀 ${d.pct.toFixed(2)}% (채널 차 8 초과)`);
    const bm = keyed(baseRects[name]), am = keyed(cap.tabs[name]);
    for (const [key, b] of bm) {
      const a = am.get(key);
      if (!a) { fails.push(`${name} ${key} 사라짐`); continue; }
      const mv = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
      if (mv > 1) moved.push(`${name} ${key} "${b.text}" ${mv.toFixed(1)}px`);
      if (mv > 2) fails.push(`${name} ${key} "${b.text}" 이동 ${mv.toFixed(1)}px`);
      if (b.cr != null && a.cr != null && a.cr < b.cr - 0.01) fails.push(`${name} ${key} 대비 ${b.cr}→${a.cr}`);
      if (a.off && !b.off) fails.push(`${name} ${key} 화면 밖으로 나감`);
      if (a.clip && !b.clip) fails.push(`${name} ${key} 잘림 새로 생김`);
    }
    for (const key of am.keys()) if (!bm.has(key)) note(`${name} ${key} 새로 생김(전에 없음)`);
  }
  await dec.close();
  moved.slice(0, 25).forEach((m) => note('1px 넘게 움직임: ' + m));
  if (moved.length > 25) note(`1px 넘게 움직인 요소 ${moved.length}개 중 25개만 표시`);
  record('기준4 · 전후 4탭: 2px 넘게 움직인 요소·대비 하락·잘림 0', fails.length === 0, fails.slice(0, 6).join(' | ') + (fails.length > 6 ? ` 외 ${fails.length - 6}건` : ''));

  // 흑백 대비(기준 2): 현재 값과 기준선, 그리고 반대 시험(눌린 면을 흰색으로 주입)
  const now = await pairs(browser, cap);
  const old = JSON.parse(fs.readFileSync(basePath('pairs.json'), 'utf8'));
  record('기준2 · 눌린 level-btn vs 안 눌린 흰 면 ≥1.5 (흑백 픽셀 ' + now.level.ratio + ')', now.level.ratio >= 1.5, `눌림 평균 ${now.level.pressedMean}, 안눌림 ${now.level.unpressedMean}`);
  record('기준2 · 선택 탭 알약 vs 비선택 탭 ≥1.5 (흑백 픽셀 ' + now.pill.ratio + ')', now.pill.ratio >= 1.5, `선택 ${now.pill.selMean}, 비선택 ${now.pill.unselMean}`);
  record('기준2 · 시작 버튼 vs 주변 배경 ≥1.5 (흑백 픽셀 ' + now.start.ratio + ')', now.start.ratio >= 1.5, `버튼 ${now.start.btnMean}, 배경 ${now.start.bgMean}`);
  const fk = ['miniMore', 'miniMax', 'moreMax'];
  const fdetail = fk.map((k) => `${k} ${old.faces[k]}→${now.faces[k]}`).join(', ');
  record('기준2 · mini/more/max 면 3쌍 대비가 전보다 작아지지 않음 (' + fdetail + ')', fk.every((k) => now.faces[k] >= old.faces[k] - 0.005), fdetail);
  const injCap = await (async () => {
    const seed = JSON.parse(fixtureRaw);
    seed.logs = { ...seed.logs, '2026-10-21': { r_old_a: 'mini', r_old_b: 'more' } };
    const { ctx, page } = await open(browser, { seed, reduced: true, viewport: VP, now: NOW_R3, goto: false });
    await page.goto(BASE);
    await sleep(300);
    await page.addStyleTag({ content: '.level-btn[aria-pressed="true"]{background:#fff !important}' });
    const h = await page.addStyleTag({ content: GRAY });
    const png = await page.screenshot({ type: 'png' });
    await h.evaluate((n) => n.remove());
    const areas = await page.evaluate(areasFn);
    await ctx.close();
    return { png, areas };
  })();
  const d2 = await browser.newPage();
  await d2.setContent('<html><body></body></html>');
  const mm = await d2.evaluate(grayMeansFn, [dataUrl(injCap.png), injCap.areas]);
  await d2.close();
  const injRatio = crOf(mm.pressed, mm.unpressed);
  record('기준2 반대 시험 · 눌린 면을 흰색으로 주입하면 대비 <1.5 로 실패가 잡힌다 (' + injRatio.toFixed(2) + ')', injRatio < 1.5, `주입 후 ${injRatio.toFixed(2)}`);
}

// ---------- 3. 리듬 (실제 전환 시간·easing·속성) ----------
const GROUPS = [
  { name: '레벨 버튼', tab: 'today', sel: '.level-btn' },
  { name: '탭', tab: 'today', sel: '.tab' },
  { name: '달력 칸', tab: 'calendar', sel: '.cal-day' },
  { name: '타이머 시작 버튼', tab: 'timer', sel: '[data-testid="timer-start"]' },
  { name: '타이머 아이콘 버튼', tab: 'timer', sel: '[data-testid="timer-sound"]' },
];
const TAB_ID = Object.fromEntries(TABS);
// 누름 측정. 마우스: 실제 누르기(떼기는 버튼 밖에서 → 클릭 안 남). 터치: headless 에서 CDP 터치 누름이 :active 를 못 거는 것을
// 확인함(400ms 까지 false) → 터치는 같은 CSS 규칙을 CDP 'forcePseudoState: active' 로 걸어 읽는다(입력 방식 한계, 앱 문제 아님).
async function probe(page, sel, touch) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) return null;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const v = await page.evaluate(readFn, sel);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await cdp.detach();
    return v && { ...v, a: true, how: 'forced' };
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(60);
  const v = await page.evaluate(readFn, sel);
  await page.mouse.move(2, 2); // 버튼 밖에서 떼기: 클릭(타이머 시작 등) 방지
  await page.mouse.up();
  return v && { ...v, how: 'mouse' };
}
function judge(g) {
  const p = [];
  if (!g.rest) return ['요소 없음'];
  if (g.rest.d !== '0.28s') p.push(`뗌 시간 ${g.rest.d}(기대 0.28s)`);
  if (g.rest.e !== RELEASE_EASE) p.push(`뗌 easing ${g.rest.e}(기대 ease-pop)`);
  if (g.rest.p !== 'transform') p.push(`뗌 속성 ${g.rest.p}`);
  for (const [k, v] of [['마우스', g.mouse], ['터치', g.touch]]) {
    if (!v) { p.push(`${k} 누름 측정 불가`); continue; }
    if (!v.a) p.push(`${k} 누름 :active 안 걸림(측정 실패)`);
    if (v.d !== '0.1s') p.push(`${k} 누름 시간 ${v.d}(기대 0.1s)`);
    if (v.e !== g.rest.e) p.push(`${k} 누름 easing ${v.e} ≠ 뗌 ${g.rest.e}`);
  }
  return p;
}

async function rhythm(browser) {
  const seed = JSON.parse(fixtureRaw);
  seed.logs = { ...seed.logs, '2026-10-21': { r_old_a: 'mini', r_old_b: 'more' } };
  const { ctx, page } = await open(browser, { seed, reduced: false, hasTouch: true, viewport: VP, now: NOW_R3, goto: true, settle: 300 });
  const groups = {}, motion = {};
  // 터치 입력(hasTouch)이 실제로 버튼을 누르는지: 손가락 탭으로 캘린더 탭 전환
  const t0 = await page.locator(tid('tab-calendar')).boundingBox();
  await page.touchscreen.tap(t0.x + t0.width / 2, t0.y + t0.height / 2);
  await sleep(400);
  const touchTapOk = (await page.locator(tid('tab-calendar')).getAttribute('aria-selected')) === 'true';
  for (const tab of ['today', 'calendar', 'timer']) {
    await page.click(tid(TAB_ID[tab]));
    await sleep(400);
    motion[tab] = await page.evaluate(motionFn);
    for (const g of GROUPS.filter((x) => x.tab === tab)) {
      const rest = await page.evaluate(readFn, g.sel);
      const mouse = rest ? await probe(page, g.sel, false) : null;
      const touch = rest ? await probe(page, g.sel, true) : null;
      groups[g.name] = { rest, mouse, touch, problems: judge({ rest, mouse, touch }) };
    }
  }
  // 화면·달 넘김 280ms (속성 달아 계산 값만 읽고 바로 뗀다)
  await page.click(tid('tab-today')); await sleep(400);
  const screenDur = await page.evaluate(() => { const s = document.getElementById('screen-today'); s.setAttribute('data-transition', 'enter'); const d = getComputedStyle(s).animationDuration; s.removeAttribute('data-transition'); return d; });
  await page.click(tid('tab-calendar')); await sleep(400);
  const calDur = await page.evaluate(() => { const g = document.querySelector('.cal-grid'); g.setAttribute('data-anim', 'slide'); const d = getComputedStyle(g).animationDuration; g.removeAttribute('data-anim'); return d; });
  // 반대 시험: 탭 뗌 시간에 333ms 를 섞으면 잡혀야 한다
  await page.click(tid('tab-today')); await sleep(400);
  const h = await page.addStyleTag({ content: '.tab{transition-duration:0.333s !important}' });
  const badRest = await page.evaluate(readFn, '.tab');
  await h.evaluate((n) => n.remove());
  await ctx.close();
  return { groups, motion, screenDur, calDur, touchTapOk, badJudged: judge({ rest: badRest, mouse: { a: true, d: '0.1s', e: RELEASE_EASE }, touch: { a: true, d: '0.1s', e: RELEASE_EASE } }) };
}

// ---------- 실행 ----------
run(async (browser) => {
  if (WRITE) { await writeBaseline(browser); return; }
  staticChecks();

  const r = await rhythm(browser);
  record('기준3 · 터치 입력(hasTouch) 손가락 탭이 캘린더 탭을 연다', r.touchTapOk, r.touchTapOk ? '' : '탭 전환 안 됨');
  for (const [name, g] of Object.entries(r.groups)) {
    record(`기준3 · ${name}: 뗌 0.28s·ease-pop·transform, 누름(마우스 :active·터치 강제 :active) 0.1s·같은 easing`, g.problems.length === 0, g.problems.join('; '));
  }
  const motionBad = Object.entries(r.motion).flatMap(([t, l]) => l.map((x) => `${t}: ${x}`));
  record('기준3 · 4탭 중 움직이는 요소 전부 transform·opacity 만 (width·height·top·left·margin·box-shadow 0)', motionBad.length === 0, motionBad.slice(0, 5).join(' | ') + (motionBad.length > 5 ? ` 외 ${motionBad.length - 5}건` : ''));
  record('기준3 · 화면 넘김 280ms (.screen enter, animation-duration)', r.screenDur === '0.28s', `현재 ${r.screenDur}`);
  record('기준3 · 달 넘김 280ms (.cal-grid slide)', r.calDur === '0.28s', `현재 ${r.calDur}`);
  record('기준3 반대 시험 · 탭 뗌 333ms 를 섞으면 잡힌다', r.badJudged.length > 0, r.badJudged.length ? '' : '잡지 못함');

  await pixelAndRects(browser);
});
