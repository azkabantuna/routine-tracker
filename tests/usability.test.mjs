// 사용성 시험 (R2 계획 ①~⑦ 중 화면 넘침·겹침·빈 상태·입력(IME)·대비·움직임 줄이기·접근성·멈춤).
// 실행(레포 루트에서): node projects/routine-tracker/tests/usability.test.mjs
// 원칙: 모든 묶음에 '대조'(일부러 틀린 값을 넣으면 잡히는지) 검사를 둔다. 기대값은 계획 숫자 그대로.
// 목표값 표: logs/routine-tracker/targets.md. PERF_PHASE=before|after 로 강제, 없으면 '전' 칸이 없을 때만 전, 있으면 후를 쓴다.
import { run, check, note, info, sleep, tid, open, seedOf, R, openAddSheet, openCardMenu, NOW, BASE, fs, path, HERE } from './_lib.mjs';

const LOG_DIR = path.resolve(HERE, '../../../logs/routine-tracker');
const KO = '가나다라마바사아자차카타파하';
const LONG80 = Array.from({ length: 80 }, (_, i) => KO[i % KO.length]).join(''); // 띄어쓰기 없는 한글 80자
const D0 = '2026-10-07'; // _lib NOW 의 날짜
const TABS = [['오늘', 'tab-today'], ['캘린더', 'tab-calendar'], ['퓨처 셀프', 'tab-manage'], ['타이머', 'tab-timer']];
const WIDTHS = [[360, 740], [320, 640]];
const EMO_TWO = '\u{1F600}\u{1F600}';
const EMO_ZWJ = '\u{1F468}‍\u{1F469}‍\u{1F467}';
const seedLayout = {
  version: 1,
  routines: [
    { id: 'r_a', name: '운동', mini: '푸시업', more: '20분', max: '1시간', createdAt: '2026-10-01', order: 0, emoji: '🏃' },
    { id: 'r_b', name: LONG80, mini: '미니', more: '보통', max: '최대', createdAt: '2026-10-01', order: 1, emoji: '📚' },
    { id: 'r_c', name: '물', mini: '한 잔', more: '두 잔', max: '세 잔', createdAt: '2026-10-01', order: 2 },
  ],
  logs: { [D0]: { r_a: 'more' } },
  celebratedOn: null,
};
const seedNoEmo = seedOf([R('r_a', '운동', 0), R('r_c', '물', 1)]);
const seedEmpty = seedOf([]);

// 페이지 안 도우미(시험 전용). 앱 코드·data 속성은 바꾸지 않는다.
const LIB = () => {
  const isVis = (el) => {
    if (!el || !el.isConnected || el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const TARGET = 'button, input, select, textarea, .tab, .level-btn, .cal-day, [role=button]';
  const OVER = '.sheet-backdrop, .sheet, .card-menu, .confirm-sheet, .timer-cover';
  const label = (el) => {
    const id = el.getAttribute('data-testid');
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    const txt = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12);
    return (id ? '[' + id + ']' : el.tagName.toLowerCase() + (cls ? '.' + cls : '')) + ' "' + txt + '"';
  };
  const screenOf = (el) => {
    const s = el.closest('.screen');
    if (s) return s.id;
    return el.closest(OVER) ? 'overlay' : 'other';
  };
  const targets = () => [...document.querySelectorAll(TARGET)].filter(isVis);
  const small = () => {
    const all = targets();
    const bad = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const isDay = el.classList.contains('cal-day');
      const minW = isDay ? 40 : 44; // 320px 에서 cal-day 7칸 물리 한계(320/7≈45.7) — 폭 40 허용, 높이는 44
      if (r.width < minW || r.height < 44) bad.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' (' + screenOf(el) + ')');
    }
    return { n: all.length, bad, items: all.map((el) => { const r = el.getBoundingClientRect(); return { screen: screenOf(el), label: label(el), w: Math.round(r.width), h: Math.round(r.height) }; }) };
  };
  // 누르는 요소끼리 겹침 (탭바는 빼고: 탭바가 본문 위에 떠 있는 건 설계. 탭바 가림은 tabCover 가 스크롤 위치마다 본다)
  const overlaps = () => {
    const all = targets().filter((el) => !el.closest(OVER) && !el.closest('.tabbar'));
    const bad = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.contains(b) || b.contains(a)) continue;
        const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
        const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
        const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
        if (w > 1 && h > 1) bad.push(label(a) + ' ↔ ' + label(b));
      }
    }
    return { n: all.length, bad };
  };
  const overflow = () => {
    const bad = [];
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!isVis(el)) continue;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      if (el.clientWidth <= 2) continue; // 인라인 조각·시각적으로 숨긴 글자(폭 1~2px, 예: 퓨처 셀프 제목)는 제외
      n++;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.textOverflow === 'ellipsis') {
        if (r.right > innerWidth + 1 || r.left < -1) bad.push(label(el) + ' 말줄임인데 화면 밖');
        continue;
      }
      if (el.scrollWidth > el.clientWidth + 1) bad.push(label(el) + ' 글자 ' + el.scrollWidth + ' > 칸 ' + el.clientWidth);
    }
    return { n, bad };
  };
  const hScroll = () => {
    const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
    const out = [...document.querySelectorAll('body *')].filter((el) => isVis(el) && !el.closest('.timer-cover')).filter((el) => { const r = el.getBoundingClientRect(); return r.right > iw + 1 || r.left < -1; }).slice(0, 3).map((el) => label(el));
    return { ok: sw <= iw && out.length === 0, sw, iw, out };
  };
  const gridFit = () => {
    const g = document.querySelector('[data-testid="cal-grid"]');
    if (!g || !isVis(g)) return { n: 0, bad: ['cal-grid 안 보임'] };
    const gr = g.getBoundingClientRect();
    const days = [...g.querySelectorAll('[data-testid="cal-day"]')];
    const bad = days.filter((d) => { const r = d.getBoundingClientRect(); return r.left < gr.left - 0.5 || r.right > gr.right + 0.5; }).map((d) => d.dataset.date + ' grid 밖');
    const kids = [...g.children];
    const top0 = kids[0].getBoundingClientRect().top;
    const lefts = new Set(kids.filter((k) => Math.abs(k.getBoundingClientRect().top - top0) < 2).map((k) => Math.round(k.getBoundingClientRect().left)));
    if (lefts.size !== 7) bad.push('첫 줄 칸 ' + lefts.size + '개(7이어야 함)');
    return { n: days.length, bad };
  };
  const cardGeom = (id) => {
    const c = document.querySelector('[data-testid="routine-card"][data-routine-id="' + id + '"]');
    if (!c) return { missing: true };
    const cr = c.getBoundingClientRect();
    const nr = c.querySelector('.card-name').getBoundingClientRect();
    const mr = c.querySelector('[data-testid="btn-card-more"]').getBoundingClientRect();
    const menu = document.querySelector('[data-testid="card-menu"]');
    const mn = menu && isVis(menu) ? menu.getBoundingClientRect() : null;
    return {
      moreInCard: mr.left >= cr.left - 0.5 && mr.right <= cr.right + 0.5 && mr.top >= cr.top - 0.5 && mr.bottom <= cr.bottom + 0.5,
      nameLeftOfMore: nr.right <= mr.left + 1,
      menuOpen: !!mn,
      menuInView: mn ? (mn.left >= -0.5 && mn.right <= innerWidth + 0.5 && mn.top >= -0.5 && mn.bottom <= innerHeight + 0.5) : null,
    };
  };
  const emojiGap = () => [...document.querySelectorAll('[data-testid="routine-card"]')].map((c) => {
    const cr = c.getBoundingClientRect();
    const nr = c.querySelector('.card-name').getBoundingClientRect();
    const e = c.querySelector('[data-testid="routine-emoji"]');
    const gone = !e || getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0;
    return { id: c.dataset.routineId, nameGap: Math.round(nr.left - cr.left), emojiGone: gone, emojiText: e ? e.textContent : '' };
  });
  const P = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const Lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null; // 그림 배경 위 글자는 판정 못함(건너뛰고 개수 기록)
      const c = P(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const opac = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const contrast = (root) => {
    let n = 0, min = 99, skipped = 0, worst = null;
    const bad = [];
    const r0 = root || 'body';
    for (const el of [...document.querySelectorAll(r0), ...document.querySelectorAll(r0 + ' *')]) {
      if (!isVis(el)) continue;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      const fg0 = P(cs.color);
      if (!fg0) continue;
      const bg = bgOf(el);
      if (!bg) { skipped++; continue; }
      const fg = over({ r: fg0.r, g: fg0.g, b: fg0.b, a: fg0.a * opac(el) }, bg);
      const x = Lum(fg), y = Lum(bg);
      const r = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10);
      const need = (fs >= 24 || (fs >= 18.66 && fw >= 700)) ? 3 : 4.5;
      n++;
      if (r < min) worst = { el: label(el),글자: (el.textContent || '').trim().slice(0, 20), 대비: +r.toFixed(2), 필요: need, 글자색: cs.color, 배경: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', 글자크기: fs, 굵기: fw, 투명도곱: +opac(el).toFixed(2) };
      min = Math.min(min, r);
      if (r < need) bad.push(label(el) + ' ' + r.toFixed(2) + '<' + need);
    }
    return { n, min: n ? +min.toFixed(2) : null, bad, skipped, worst };
  };
  const nameOf = (el) => {
    const a = (el.getAttribute('aria-label') || '').trim();
    if (a) return a;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent).join(' ').trim(); if (t) return t; }
    if (el.tagName !== 'INPUT') { const t = (el.textContent || '').trim(); if (t) return t; }
    return (el.getAttribute('title') || '').trim();
  };
  const names = () => {
    const bad = [];
    let n = 0;
    for (const el of document.querySelectorAll('button, input, select, textarea, [role=button], [role=tab], [role=menuitem]')) {
      if (!isVis(el)) continue;
      n++;
      if (!nameOf(el)) bad.push(label(el));
    }
    return { n, bad };
  };
  const notFromChar = (a) => !(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#char-mount'));
  const anims = () => document.getAnimations().filter((a) => a.playState === 'running' && notFromChar(a)).map((a) => (a.animationName || a.constructor.name) + ' ' + (a.effect && a.effect.target ? label(a.effect.target) : ''));
  const anims3d = () => document.getAnimations().filter((a) => a.playState === 'running' && !notFromChar(a)).length;
  const textHits = () => {
    const t = document.body.innerText;
    const m = t.match(/undefined|null|NaN/g);
    return m ? m.join(',') : '';
  };
  // 탭바 가림 (지금 스크롤 위치에서): 탭바 위로 보이는 부분의 한가운데 점이 그 요소(또는 자식)여야 눌린다.
  const tabCover = () => {
    const tabTop = document.querySelector('.tabbar').getBoundingClientRect().top;
    const cands = targets().filter((el) => !el.closest(OVER) && !el.closest('.tabbar'));
    const bad = [];
    let n = 0;
    for (const t of cands) {
      const r = t.getBoundingClientRect();
      const top0 = Math.max(r.top, 0), bot0 = Math.min(r.bottom, tabTop, innerHeight);
      const l0 = Math.max(r.left, 0), r0 = Math.min(r.right, innerWidth);
      if (bot0 - top0 < 2 || r0 - l0 < 2) continue; // 탭바 위로 보이는 부분이 없음
      n++;
      const hit = document.elementFromPoint((l0 + r0) / 2, (top0 + bot0) / 2);
      if (!hit || !(hit === t || t.contains(hit))) bad.push(label(t) + ' 보이는 부분이 눌리지 않음 → ' + (hit ? label(hit) : 'null'));
    }
    return { n, bad };
  };
  // 끝까지 스크롤한 상태: 가장 아래 누를 수 있는 요소(+ 루틴 추가 버튼)가 탭바 위에 완전히 보여야 한다.
  const lastPress = () => {
    const tabTop = document.querySelector('.tabbar').getBoundingClientRect().top;
    let best = null;
    for (const t of targets().filter((el) => !el.closest(OVER) && !el.closest('.tabbar'))) {
      const r = t.getBoundingClientRect();
      if (!best || r.bottom > best.r.bottom) best = { el: t, r };
    }
    const add = document.querySelector('[data-testid="btn-add-routine"]');
    const addOk = !add || !isVis(add) || add.getBoundingClientRect().bottom <= tabTop + 0.5;
    if (!best) return { ok: false, name: '(요소 0개)', bottom: 0, tabTop: Math.round(tabTop), addOk };
    const ok = best.r.bottom <= tabTop + 0.5 && best.r.bottom <= innerHeight + 0.5 && best.r.top >= -0.5 && addOk;
    return { ok, name: label(best.el), bottom: Math.round(best.r.bottom), tabTop: Math.round(tabTop), addOk };
  };
  window.__u = { isVis, small, overlaps, overflow, hScroll, gridFit, cardGeom, emojiGap, contrast, names, anims, anims3d, textHits, tabCover, lastPress };
};
const U = (page, f, a) => page.evaluate(([fn, arg]) => window.__u[fn](arg), [f, a]);

async function goTab(page, t) {
  await page.click(tid(t));
  await sleep(t === 'tab-manage' ? 1000 : 450);
}

// 시트 여는 애니(280ms, 투명도 0→1)가 끝난 뒤에만 대비를 잰다. 진행 중에는 투명도 곱 때문에 대비가 1.00 으로 나온다.
// 끝 조건: 시트·배경의 실행 중 애니 0개 + 열린 뒤 350ms. 반환: 시트 투명도(1 이어야 함).
async function sheetSettled(page) {
  const t0 = Date.now();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || !(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.sheet, .sheet-backdrop'))), null, { timeout: 2000 });
  const left = 350 - (Date.now() - t0);
  if (left > 0) await sleep(left);
  return page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="sheet"]')).opacity);
}

// 진짜 IME 흉내: CDP 로 조합 글자를 넣고 Enter 를 누른 뒤 조합을 끝낸다. 이벤트 순서를 기록해 조합이 실제로 시작됐는지도 확인.
async function imeCase(page, sel, text) {
  await page.evaluate((s) => {
    const i = document.querySelector(s);
    window.__ev = [];
    ['compositionstart', 'compositionend'].forEach((t) => i.addEventListener(t, () => window.__ev.push(t)));
    i.addEventListener('keydown', (e) => window.__ev.push('keydown:' + e.key + ':' + e.keyCode + ':' + e.isComposing));
    i.focus();
  }, sel);
  const cdp = await page.context().newCDPSession(page);
  const enter = async () => { // 조합 중 Enter: IME 가 처리하는 키(keyCode 229, 글자 없음)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await sleep(200);
  };
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  await sleep(120);
  await enter(); // 조합 중 Enter
  const during = await page.evaluate(() => window.__ev.slice());
  await cdp.send('Input.insertText', { text }); // 조합 확정(compositionend)
  await sleep(150);
  const committed = await page.evaluate(() => window.__ev.slice());
  await cdp.detach();
  return { during, committed };
}

// 탭바 가림 검사: 문서 스크롤 0 → 끝까지 40px 씩 → 끝, 위치마다 탭바 위 보이는 부분이 눌리는지. 끝에서 마지막 요소 바닥 ≤ 탭바 위.
async function coverScan(page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const pos = [];
    for (let y = 0; y < max; y += 40) pos.push(y);
    pos.push(max);
    let n = 0;
    const bad = [];
    for (const y of pos) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await frame();
      const c = window.__u.tabCover();
      n += c.n;
      c.bad.forEach((b) => bad.push('y=' + y + ' ' + b));
    }
    window.scrollTo({ top: max, behavior: 'instant' });
    await frame();
    const end = window.__u.lastPress();
    window.scrollTo({ top: 0, behavior: 'instant' });
    await frame();
    return { max, steps: pos.length, n, bad, end };
  });
}

// 1) 360·320: 넘침·잘림·겹침·cal-day·시트·카드 메뉴 (+ 대조 400px) + 목표값 수집(360)
async function layoutAt(browser, w, h, collectTargets) {
  const tag = `${w}px`;
  const { ctx, page } = await open(browser, { seed: seedLayout, viewport: { width: w, height: h }, settle: 400 });
  await page.evaluate(LIB);
  const hs = [], tx = [], ov = [], gf = [], smallAll = [], smallItems = [], cvBad = [], endBad = [];
  let txN = 0, ovN = 0, gfN = 0, smallN = 0, cvN = 0, cvSteps = 0;
  for (const [name, t] of TABS) {
    await goTab(page, t);
    const x = await U(page, 'hScroll');
    if (!x.ok) hs.push(`${name} 문서 ${x.sw}>${x.iw}`);
    const o = await U(page, 'overflow'); txN += o.n; o.bad.forEach((b) => tx.push(`${name}: ${b}`));
    const q = await U(page, 'overlaps'); ovN += q.n; q.bad.forEach((b) => ov.push(`${name}: ${b}`));
    const cv = await coverScan(page); cvN += cv.n; cvSteps += cv.steps; cv.bad.forEach((b) => cvBad.push(`${name} ${b}`));
    if (!cv.end.ok) endBad.push(`${name}: 끝까지 스크롤 시 마지막 요소 ${cv.end.name} 바닥 ${cv.end.bottom} > 탭바 위 ${cv.end.tabTop}${cv.end.addOk ? '' : ' (루틴 추가 버튼 가림)'}`);
    const s = await U(page, 'small'); smallN += s.n; s.bad.forEach((b) => smallAll.push(`${name}: ${b}`)); smallItems.push(...s.items.map((i) => ({ ...i, tab: name })));
    if (t === 'tab-calendar') { const g = await U(page, 'gridFit'); gfN += g.n; g.bad.forEach((b) => gf.push(b)); }
  }
  // 긴 이름 시트
  await openAddSheet(page);
  await page.fill(tid('input-name'), LONG80);
  await sleep(120);
  const sheetBox = await page.locator(tid('sheet')).boundingBox();
  const sheetIn = sheetBox.x >= -0.5 && sheetBox.x + sheetBox.width <= w + 0.5;
  const so = await U(page, 'overflow'); txN += so.n;
  const sheetBad = [...so.bad];
  if (!sheetIn) sheetBad.push('시트 가로가 화면 밖');
  const sh = await U(page, 'hScroll'); if (!sh.ok) sheetBad.push(`시트 상태 문서 ${sh.sw}>${sh.iw}`);
  const ss = await U(page, 'small'); smallN += ss.n; ss.bad.forEach((b) => smallAll.push('시트: ' + b)); smallItems.push(...ss.items.map((i) => ({ ...i, tab: '시트' })));
  await page.click(tid('btn-close'));
  await sleep(300);
  // 긴 이름 카드 메뉴
  await page.click(tid('tab-today'));
  await sleep(450);
  await openCardMenu(page, 'r_b');
  const g = await U(page, 'cardGeom', 'r_b');
  const menuBad = [];
  if (!g.moreInCard) menuBad.push('긴 이름 카드: … 버튼이 카드 밖');
  if (!g.nameLeftOfMore) menuBad.push('긴 이름 카드: 이름이 … 버튼을 가림');
  if (!g.menuInView) menuBad.push('카드 메뉴가 화면 밖');
  const mo = await U(page, 'overflow'); txN += mo.n; mo.bad.forEach((b) => menuBad.push('메뉴 상태: ' + b));
  const mh = await U(page, 'hScroll'); if (!mh.ok) menuBad.push(`메뉴 상태 문서 ${mh.sw}>${mh.iw}`);
  const ms = await U(page, 'small'); smallN += ms.n; ms.bad.forEach((b) => smallAll.push('카드 메뉴: ' + b)); smallItems.push(...ms.items.map((i) => ({ ...i, tab: '카드 메뉴' })));
  check(`[${tag}] 4탭·시트·카드 메뉴 가로 넘침 0 (문서 scrollWidth ≤ innerWidth)`, hs.length === 0 && sh.ok && mh.ok && sheetIn, [...hs, ...(sh.ok ? [] : ['시트 ' + sh.sw]), ...(mh.ok ? [] : ['메뉴 ' + mh.sw])].join('; ') || '시트 가로 밖');
  check(`[${tag}] 글자 잘림 0 (말줄임 의도 제외) · 검사 ${txN}개`, tx.length === 0 && sheetBad.length === 0 && menuBad.filter((b) => b.startsWith('메뉴 상태')).length === 0, [...tx, ...sheetBad, ...menuBad.filter((b) => b.startsWith('메뉴 상태'))].slice(0, 5).join(' | '));
  check(`[${tag}] 긴 이름 카드: … 버튼 카드 안·이름이 가리지 않음·메뉴 화면 안`, g.moreInCard && g.nameLeftOfMore && g.menuInView, menuBad.filter((b) => !b.startsWith('메뉴 상태')).join(' | '));
  check(`[${tag}] 누르는 요소 겹침 0 (4탭 화면, 시트·메뉴·탭바 제외) · 검사 ${ovN}개`, ov.length === 0, ov.slice(0, 4).join(' | '));
  check(`[${tag}] 탭바 가림: 스크롤 어느 위치에서나 탭바 위 보이는 부분 눌림 가능 · 검사 ${cvN}개(${cvSteps}위치)`, cvBad.length === 0 && cvN > 0, cvBad.slice(0, 4).join(' | '));
  check(`[${tag}] 끝까지 스크롤 시 마지막 누를 요소(루틴 추가 포함) 탭바 위에 완전히 보임`, endBad.length === 0, endBad.slice(0, 4).join(' | '));
  check(`[${tag}] 캘린더 cal-day 7칸 모두 grid 안·한 줄 7칸 · 검사 ${gfN}칸`, gf.length === 0 && gfN > 0, gf.slice(0, 4).join(' | ') || '칸 0개');
  // 대조: 일부러 400px 요소를 넣으면 넘침이 잡혀야 함
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'ctl-wide'; d.style.cssText = 'width:400px;height:4px'; document.body.appendChild(d); });
  const ctl = await U(page, 'hScroll');
  check(`[${tag}] 대조: 400px 요소 주입 시 넘침이 잡힘`, !ctl.ok, `측정 ${ctl.sw}/${ctl.iw}`);
  await ctx.close();
  // 대조(탭바 가림): 본문 아래 여백(.screens 아래 padding)을 0 으로 주입하면 끝 검사가 실패해야 함 (새 창에서)
  {
    const c2 = await open(browser, { seed: seedLayout, viewport: { width: w, height: h }, settle: 400 });
    await c2.page.evaluate(LIB);
    await goTab(c2.page, 'tab-today');
    await c2.page.addStyleTag({ content: '.screens{padding-bottom:0 !important}' });
    const rv = await coverScan(c2.page);
    check(`[${tag}] 대조: 본문 아래 여백 0 주입 시 끝 검사가 실패 (끝 요소 ${rv.end.name} 바닥 ${rv.end.bottom} / 탭바 ${rv.end.tabTop})`, !rv.end.ok, '여백 0인데도 통과 → 끝 검사가 가림을 못 잡음');
    await c2.ctx.close();
  }
  return { smallItems, smallAll, smallN };
}

// 2) 빈 상태 3종 + 'undefined|null|NaN' 0 (4탭 전체)
async function emptyStates(browser) {
  let { ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 });
  await page.evaluate(LIB);
  const first = await page.locator(tid('btn-first-routine')).isVisible();
  check('[빈 상태] 루틴 0개: 첫 루틴 만들기 버튼 보임', first, 'btn-first-routine 안 보임');
  await goTab(page, 'tab-calendar');
  const cm = (await page.locator(tid('cal-month-count')).innerText()).trim();
  const days = await page.locator(tid('cal-day')).count();
  const none = await page.locator('[data-testid="cal-day"][data-level="none"]').count();
  const dots = await page.locator('.cal-dot, [data-testid="cal-dot"]').count();
  const streak = (await page.locator(tid('cal-streak')).innerText()).trim();
  check(`[빈 상태] 기록 없는 달: 이번 달 0일·점 0·연속 0 (칸 ${days}개 검사)`, cm === '0' && days > 0 && none === days && dots === 0 && streak === '0', `month "${cm}" 칸${days}/없음${none} 점${dots} 연속"${streak}"`);
  await ctx.close();

  ({ ctx, page } = await open(browser, { seed: seedLayout, settle: 400 }));
  await page.evaluate(LIB);
  await page.click(tid('tab-today'));
  const eg = await U(page, 'emojiGap');
  const r_c = eg.find((c) => c.id === 'r_c');
  const r_a = eg.find((c) => c.id === 'r_a');
  check('[빈 상태] 이모지 없는 루틴 카드: 빈 네모 없음(이모지 칸 숨김/폭 0)', !!r_c && r_c.emojiGone && r_c.emojiText === '', JSON.stringify(r_c));
  check('[빈 상태] 이모지 없는 카드: 이름이 이모지 자리 틈 없이 당겨짐(이름 왼쪽 여백 < 이모지 카드)', !!r_c && !!r_a && r_c.nameGap < r_a.nameGap, `없음 ${r_c && r_c.nameGap} / 있음 ${r_a && r_a.nameGap}`);
  // 대조: 이모지 칸에 글자 'NaN' 을 넣으면 텍스트 검사가 잡혀야 함 (아래 4탭 검사에서 같이 씀)
  const states = [['루틴 0개', seedEmpty], ['이모지 없는 카드', seedNoEmo], ['긴 이름·이모지 카드', seedLayout]];
  const hits = [];
  let checked = 0;
  for (const [sname, seed] of states) {
    const o = await open(browser, { seed, settle: 400 });
    const p2 = o.page;
    await p2.evaluate(LIB);
    for (const [name, t] of TABS) {
      await goTab(p2, t);
      const h = await U(p2, 'textHits');
      checked++;
      if (h) hits.push(`${sname}/${name}: ${h}`);
    }
    if (sname === '루틴 0개') {
      // 기록 없는 날 상세 (빈 날 문구)
      await goTab(p2, 'tab-calendar');
      await p2.locator('[data-testid="cal-day"][data-today="true"]').click();
      await sleep(200);
      const det = await U(p2, 'textHits');
      checked++;
      if (det) hits.push(`${sname}/캘린더 날짜 상세: ${det}`);
    }
    await o.ctx.close();
  }
  check(`[빈 상태] 4탭 전체 글자에 undefined·null·NaN 0 · 검사 ${checked}회(3상태×4탭+상세)`, hits.length === 0, hits.join(' | '));
  // 대조
  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await page.evaluate(LIB);
  await page.evaluate(() => { document.getElementById('today-hint').textContent = 'NaN'; document.getElementById('today-hint').hidden = false; });
  check('[빈 상태] 대조: 글자 NaN 주입 시 검사가 잡음', (await U(page, 'textHits')) === 'NaN');
  await ctx.close();
}

// 3) 입력: 80자 한글 저장·이모지 2개 거부·ZWJ 1개 통과·IME 조합 중 Enter 저장 0 (시트·구름 단어)
async function inputs(browser) {
  // 3-1 긴 이름 저장 후 360 에서 넘침 0, … 버튼 카드 안
  let { ctx, page } = await open(browser, { seed: seedEmpty, viewport: { width: 360, height: 740 }, settle: 400 });
  await page.evaluate(LIB);
  await openAddSheet(page);
  await page.fill(tid('input-name'), LONG80);
  await page.locator(tid('btn-save')).click();
  await sleep(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('routineTracker') || 'null'));
  const cnt = st ? st.routines.length : -1;
  check('[입력] 80자 한글(띄어쓰기 없음) 저장 → 루틴 1개 · 이름 80자 그대로', cnt === 1 && st.routines[0].name === LONG80, `개수 ${cnt}`);
  const g = await U(page, 'cardGeom', st && st.routines[0] ? st.routines[0].id : 'none');
  const ov = await U(page, 'overflow');
  const hs = await U(page, 'hScroll');
  check('[입력] 80자 이름 카드: 가로 넘침 0·… 버튼 카드 안·이름 잘림(말줄임 제외) 0', hs.ok && g.moreInCard && ov.bad.length === 0, [...(hs.ok ? [] : ['문서 ' + hs.sw]), ...(g.moreInCard ? [] : ['… 버튼 밖']), ...ov.bad.slice(0, 3)].join(' | '));
  await ctx.close();

  // 3-2 이모지 두 개 → 오류 표시, 저장 0
  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await openAddSheet(page);
  const bad = await submitSheetLocal(page, '테스트', EMO_TWO);
  const saved2 = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routineTracker') || 'null'); return s ? s.routines.length : 0; });
  check('[입력] 이모지 여러 개(😀😀) → error-emoji 표시, 저장 0', bad.err && bad.sheet && saved2 === 0, `오류표시 ${bad.err} 시트열림 ${bad.sheet} 저장 ${saved2}`);
  await ctx.close();

  // 3-3 ZWJ 가족 이모지 1개 → 통과
  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await openAddSheet(page);
  await submitSheetLocal(page, '가족', EMO_ZWJ);
  await sleep(200);
  const z = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routineTracker') || 'null'); return s ? s.routines.map((r) => r.emoji) : []; });
  check('[입력] ZWJ 가족 이모지 1개 → 저장 통과(루틴 1개, 이모지 그대로)', z.length === 1 && z[0] === EMO_ZWJ, JSON.stringify(z));
  await ctx.close();

  // 3-4 IME: 대조(조합 밖 Enter 는 실제로 저장) → 조합 중 Enter 는 저장 0 → 조합 확정 후 Enter 는 정확히 1개
  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await openAddSheet(page);
  await page.fill(tid('input-name'), '대조');
  await page.locator(tid('input-name')).focus();
  await page.keyboard.press('Enter');
  await sleep(300);
  const ctrlCount = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routineTracker') || 'null'); return s ? s.routines.length : 0; });
  check('[입력] 대조: 조합 밖 Enter 는 실제로 1개 저장됨(시험 도구 확인)', ctrlCount === 1, `저장 ${ctrlCount}`);
  await ctx.close();

  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await openAddSheet(page);
  // 빈 칸에서 조합 시작(채워 둔 글자 뒤에 붙지 않게 fill 안 함)
  const ime = await imeCase(page, tid('input-name'), '한');
  const midSaved = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routineTracker') || 'null'); return s ? s.routines.length : 0; });
  const sheetOpenDuring = await page.locator(tid('sheet')).isVisible();
  check('[입력] 조합 중 Enter(keyCode 229) → 저장 0·시트 열린 채', ime.during.some((e) => e.startsWith('compositionstart')) && midSaved === 0 && sheetOpenDuring, `이벤트 ${ime.during.join(',')} 저장 ${midSaved} 시트 ${sheetOpenDuring}`);
  // 조합 확정 뒤 Enter 한 번
  await page.locator(tid('input-name')).focus();
  await page.keyboard.press('Enter');
  await sleep(300);
  const after = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('routineTracker') || 'null'); return s ? s.routines.map((r) => r.name) : []; });
  check('[입력] 조합 확정 뒤 Enter → 루틴 정확히 1개(이름 "한")', after.length === 1 && after[0] === '한', JSON.stringify(after));
  await ctx.close();

  // 3-5 구름 단어: 조합 중 Enter 저장 0, 확정 뒤 Enter 1번
  ({ ctx, page } = await open(browser, { seed: seedEmpty, settle: 400 }));
  await goTab(page, 'tab-manage');
  await sleep(800);
  const fwOpen = await page.locator(tid('future-word')).count();
  if (fwOpen) {
    await page.locator(tid('future-word')).click();
    await sleep(250);
    const fw = await imeCase(page, tid('future-word-input'), '미');
    const fwMid = await page.evaluate(() => localStorage.getItem('routineFutureWord'));
    check('[입력] 구름 단어 조합 중 Enter → 저장 0', fw.during.length > 0 && !fwMid, `이벤트 ${fw.during.join(',')} 저장 "${fwMid}"`);
    await page.locator(tid('future-word-input')).focus();
    await page.keyboard.press('Enter');
    await sleep(300);
    const fwEnd = await page.evaluate(() => localStorage.getItem('routineFutureWord'));
    check('[입력] 구름 단어 조합 확정 뒤 Enter → 저장 "미" 1회', fwEnd === '미', `저장 "${fwEnd}"`);
  } else {
    check('[입력] 구름 단어 입력 칸 찾기', false, 'future-word 버튼 없음');
  }
  await ctx.close();
}

// 시트에 이름·이모지를 넣고 저장 누름. {err, sheet} 반환 (submitSheet 와 같은 뜻, 대기만 짧게)
async function submitSheetLocal(page, name, emoji) {
  await page.locator(tid('input-name')).fill(name);
  await page.locator(tid('input-emoji')).fill(emoji);
  await page.locator(tid('btn-save')).click();
  await sleep(150);
  return page.evaluate(() => {
    const e = document.querySelector('[data-testid="error-emoji"]');
    const s = document.querySelector('[data-testid="sheet"]');
    return { err: !e.hidden && getComputedStyle(e).display !== 'none', sheet: !s.hidden && getComputedStyle(s).display !== 'none' };
  });
}

// 4) 대비·이름·움직임 줄이기
async function a11y(browser) {
  let { ctx, page } = await open(browser, { seed: seedLayout, settle: 400 });
  await page.evaluate(LIB);
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'ctl-c'; p.textContent = '대비 대조'; p.style.cssText = 'color:#aaa;background:#fff;font-size:16px;position:fixed;top:0;left:0;z-index:99999'; document.body.appendChild(p); });
  const ctl = await U(page, 'contrast', '#ctl-c');
  check('[접근성] 대조: 회색 #aaa 글자(흰 배경) 대비 4.5 미달로 잡힘', ctl.n === 1 && ctl.bad.length === 1, JSON.stringify(ctl));
  await page.evaluate(() => document.getElementById('ctl-c').remove());
  let cn = 0, cmin = 99, cbad = [], cskip = 0, cworst = null;
  const noteWorst = (where, w) => { if (w && (!cworst || w.대비 < cworst.대비)) cworst = { where, ...w }; };
  for (const [name, t] of TABS) {
    await goTab(page, t);
    const c = await U(page, 'contrast', 'body');
    cn += c.n; cskip += c.skipped; if (c.min !== null) cmin = Math.min(cmin, c.min);
    noteWorst(name, c.worst);
    c.bad.forEach((b) => cbad.push(name + ': ' + b));
  }
  await openAddSheet(page);
  const sheetOp = await sheetSettled(page);
  const cs = await U(page, 'contrast', 'body');
  cn += cs.n; cskip += cs.skipped; cs.bad.forEach((b) => cbad.push('시트: ' + b));
  noteWorst('시트(열린 뒤)', cs.worst);
  await page.click(tid('btn-close'));
  console.log(`   · 대비 최저 요소: ${JSON.stringify(cworst)}`);
  check(`[접근성] 보이는 글자 대비 ≥4.5(큰 글자 ≥3) · 검사 ${cn}개 · 최저 ${cmin === 99 ? '-' : cmin} · 시트 투명도 ${sheetOp} · 그림 배경 건너뜀 ${cskip}개`, cbad.length === 0 && cn > 0, cbad.length + '개 실패 · ' + cbad.slice(0, 14).join(' | '));
  await ctx.close();

  ({ ctx, page } = await open(browser, { seed: seedLayout, settle: 400 }));
  await page.evaluate(LIB);
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'ctl-b'; b.className = 'btn'; document.body.appendChild(b); });
  const nc = await U(page, 'names');
  check('[접근성] 대조: 이름 없는 버튼 주입 시 aria 검사가 잡음', nc.bad.some((b) => b.includes('ctl-b') || b.includes('button')), nc.bad.slice(0, 3).join(' | '));
  await page.evaluate(() => document.getElementById('ctl-b').remove());
  let nn = 0; const nbad = [];
  for (const [name, t] of TABS) {
    await goTab(page, t);
    const x = await U(page, 'names');
    nn += x.n; x.bad.forEach((b) => nbad.push(name + ': ' + b));
  }
  await openAddSheet(page);
  const xs = await U(page, 'names'); nn += xs.n; xs.bad.forEach((b) => nbad.push('시트: ' + b));
  await page.click(tid('btn-close'));
  check(`[접근성] 글자 없는·기호만 버튼 aria-label 누락 0 · 검사 ${nn}개`, nbad.length === 0 && nn > 0, nbad.slice(0, 6).join(' | '));
  await ctx.close();

  // 움직임 줄이기: 탭 4개·강도 누름 뒤 실행 중 애니 0 (3D 제외)
  const cc = await open(browser, { seed: seedLayout, reduced: false, settle: 400 });
  await cc.page.evaluate(LIB);
  await cc.page.evaluate(() => { const s = document.createElement('style'); s.textContent = '@keyframes ctlspin{from{opacity:0}to{opacity:1}}'; document.head.appendChild(s); const d = document.createElement('div'); d.id = 'ctl-a'; d.style.cssText = 'animation:ctlspin 1s infinite;position:fixed'; document.body.appendChild(d); });
  await sleep(50);
  const ca = await U(cc.page, 'anims');
  check('[움직임] 대조: 줄이기 꺼진 페이지에 무한 애니를 넣으면 검사가 잡음', ca.some((x) => x.includes('ctlspin')), ca.slice(0, 2).join(' | '));
  await cc.ctx.close();
  const r = await open(browser, { seed: seedLayout, reduced: true, settle: 400 });
  const rp = r.page;
  await rp.evaluate(LIB);
  for (const [, t] of TABS) await goTab(rp, t);
  await goTab(rp, 'tab-today');
  await rp.locator(tid('routine-card')).first().locator('.level-btn[data-level="max"]').click();
  await sleep(80);
  const running = await U(rp, 'anims');
  const n3d = await U(rp, 'anims3d');
  check(`[움직임] 줄이기 켬: 탭 4개·강도 누름 뒤 CSS·WAAPI 실행 중 0 (3D 제외, 3D 애니 ${n3d}개 참고)`, running.length === 0, running.slice(0, 5).join(' | '));
  await r.ctx.close();
}

// 5) 멈춤: 감싼 requestAnimationFrame 호출 수 2초
const RAF_INIT = () => {
  window.__raf = 0;
  const o = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { window.__raf++; return o(cb); };
};
const rafRead = (page) => page.evaluate(() => { const v = window.__raf; window.__raf = 0; return v; });
const setVis = (page, v) => page.evaluate((state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);

async function stopTests(browser) {
  // 5-1 타이머 실행 중 다른 탭 (계측 확인 → 2초 ≤2)
  let o = await open(browser, { seed: seedNoEmo, goto: false, settle: 0 });
  await o.page.addInitScript(RAF_INIT);
  await o.page.goto(BASE);
  await sleep(400);
  await goTab(o.page, 'tab-timer');
  await o.page.click(tid('timer-start'));
  await sleep(300);
  await rafRead(o.page);
  await sleep(1000);
  const ctl = await rafRead(o.page);
  check(`[멈춤] 대조: 타이머 탭에서 실행 중 1초 rAF 가 20 초과로 계측됨 (측정 ${ctl})`, ctl > 20, `측정 ${ctl}`);
  await goTab(o.page, 'tab-today');
  await sleep(400);
  await rafRead(o.page);
  await sleep(2000);
  const other = await rafRead(o.page);
  check(`[멈춤] 타이머 실행 중 다른 탭: 2초 rAF ≤2 (측정 ${other})`, other <= 2, `측정 ${other}`);
  await o.ctx.close();

  // 5-2 퓨처 셀프(3D) 숨김 → ≤2, 다시 보이면 >0
  o = await open(browser, { seed: seedNoEmo, goto: false, settle: 0 });
  await o.page.addInitScript(RAF_INIT);
  await o.page.goto(BASE);
  await sleep(300);
  await goTab(o.page, 'tab-manage');
  await sleep(1200);
  await rafRead(o.page);
  await sleep(1000);
  const vis3d = await rafRead(o.page);
  check(`[멈춤] 대조: 퓨처 셀프 보이는 상태 1초 rAF 가 20 초과 (측정 ${vis3d})`, vis3d > 20, `측정 ${vis3d}`);
  await setVis(o.page, 'hidden');
  await sleep(400);
  await rafRead(o.page);
  await sleep(2000);
  const hid3d = await rafRead(o.page);
  check(`[멈춤] 퓨처 셀프 숨김(visibilityState hidden): 2초 rAF ≤2 (측정 ${hid3d})`, hid3d <= 2, `측정 ${hid3d}`);
  await setVis(o.page, 'visible');
  await sleep(300);
  await rafRead(o.page);
  await sleep(1000);
  const back3d = await rafRead(o.page);
  check(`[멈춤] 다시 보이면 재개: 1초 rAF >0 (측정 ${back3d})`, back3d > 0, `측정 ${back3d}`);
  await o.ctx.close();

  // 5-3 타이머 실행 중 숨김 → ≤2, 다시 보이면 >0
  o = await open(browser, { seed: seedNoEmo, goto: false, settle: 0 });
  await o.page.addInitScript(RAF_INIT);
  await o.page.goto(BASE);
  await sleep(300);
  await goTab(o.page, 'tab-timer');
  await o.page.click(tid('timer-start'));
  await sleep(300);
  await setVis(o.page, 'hidden');
  await sleep(400);
  await rafRead(o.page);
  await sleep(2000);
  const hidT = await rafRead(o.page);
  check(`[멈춤] 타이머 실행 중 화면 숨김: 2초 rAF ≤2 (측정 ${hidT})`, hidT <= 2, `측정 ${hidT}`);
  await setVis(o.page, 'visible');
  await sleep(300);
  await rafRead(o.page);
  await sleep(1000);
  const backT = await rafRead(o.page);
  check(`[멈춤] 타이머 다시 보이면 재개: 1초 rAF >0 (측정 ${backT})`, backT > 0, `측정 ${backT}`);
  await o.ctx.close();
}

// 목표값 표 (44px 미만). PERF_PHASE 또는 자동: '전' 섹션이 없으면 전, 있으면 후.
function writeTargets(items, badList, smallN) {
  const file = path.join(LOG_DIR, 'targets.md');
  let txt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# 누르는 요소 44px 미만 목록 (routine-tracker, R2)\n기준: 보이는 button·input·.tab·.level-btn·.cal-day·[role=button] 가 44×44 이상(cal-day 는 폭 40 이상 허용: 320px 에서 7칸 물리 한계 320/7≈45.7).\n';
  const phase = process.env.PERF_PHASE || (/^## 전/m.test(txt) ? 'after' : 'before');
  const heading = phase === 'before' ? '전' : '후';
  const small = items.filter((i) => i.w < (i.label.includes('cal-day') ? 40 : 44) || i.h < 44);
  const lines = [`- 측정 ${new Date().toISOString().slice(0, 10)} · 360×740 · 검사 요소 ${smallN}개 · 44px 미만 ${small.length}개`];
  lines.push('| 화면 | 요소(선택자·글자) | 크기 w×h |', '|---|---|---|');
  for (const i of small) lines.push(`| ${i.tab} | ${i.label} | ${i.w}×${i.h} |`);
  const block = `\n## ${heading}\n` + lines.join('\n') + '\n';
  const re = new RegExp(`\\n## ${heading}[\\s\\S]*?(?=\\n## |$)`);
  txt = re.test(txt) ? txt.replace(re, block) : txt + block;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(file, txt);
  info(`targets.md ${heading} 기록: 44px 미만 ${small.length}개 (검사 ${smallN}개)`);
  return small.length;
}

run(async (browser) => {
  // 1) 360·320 레이아웃 (360 에서 목표값 수집)
  const first = await layoutAt(browser, WIDTHS[0][0], WIDTHS[0][1], true);
  const second = await layoutAt(browser, WIDTHS[1][0], WIDTHS[1][1], false);
  check(`[목표] 누르는 요소 44×44 이상 (320, cal-day 폭 40 허용) · 검사 ${second.smallN}개`, second.smallAll.length === 0 && second.smallN > 0, second.smallAll.slice(0, 6).join(' | '));
  // 목표값 (44px 미만): 360 레이아웃의 요소 수집 결과
  const smallBefore = writeTargets(first.smallItems, first.smallAll, first.smallN);
  check(`[목표] 누르는 요소 44×44 이상 (4탭·시트·카드 메뉴, 360) · 44px 미만 ${smallBefore}개`, first.smallAll.length === 0 && first.smallN > 0, first.smallAll.slice(0, 6).join(' | '));
  // 대조: 30px 버튼을 넣으면 목표 검사가 잡혀야 함
  {
    const { ctx, page } = await open(browser, { seed: seedEmpty, viewport: { width: 360, height: 740 }, settle: 400 });
    await page.evaluate(LIB);
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'ctl-small'; b.textContent = 'x'; b.style.cssText = 'position:fixed;top:0;left:0;width:30px;height:30px;padding:0'; document.body.appendChild(b); });
    const s = await U(page, 'small');
    check('[목표] 대조: 30px 버튼 주입 시 44px 검사가 잡음', s.bad.some((b) => b.includes('30x30')), s.bad.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // 2) 빈 상태
  await emptyStates(browser);
  // 3) 입력
  await inputs(browser);
  // 4) 대비·이름·움직임
  await a11y(browser);
  // 5) 멈춤
  await stopTests(browser);
  note('검사 묶음: 레이아웃 360·320 / 빈 상태 3종 / 입력 5종 / 대비·이름·움직임 / 멈춤 6묶음(rAF 계측)');
}).catch((e) => { console.error(e); process.exit(1); });
