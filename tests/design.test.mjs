// M14 디자인 적용 시험 (base·cards·effects·screens·app·timer.css·overlays.css 의 새 기준)
// 대비(선택 탭·눌린 버튼·주황 버튼·오늘 한 줄) · 강도 면 명도 차 · 축포 입자와 글씨 겹침(400·800ms, 마우스·터치) ·
// 탭 전환 시점(150ms) · 오늘 탭 미래의 나 한 줄(저장 쓰기 0) · 360 탭바 · 동작 줄이기.
// 실행(레포 루트에서): node projects/routine-tracker/tests/design.test.mjs   (서버는 run.mjs 가 켜 주거나 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { run, check, sleep, tid, open, getRaw, seedOf, SEED_EMO, BASE } from './_lib.mjs';

const FW_KEY = 'routineFutureWord';
const DAY = (d) => `2026-10-${String(d).padStart(2, '0')}`;

// ---------- 대비 계산 (WCAG 상대 휘도) ----------
const parseRgb = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); return m ? m[1].split(',').slice(0, 3).map(Number) : null; };
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratioOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// 요소가 실제로 받는 computed 값: 글자색·굵기·높이·모서리, 바탕색(없으면 위로 올라가 첫 불투명 바탕). 바탕 그림이면 img:true
const styleOf = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  let e = el, bg = null, img = false;
  while (e) {
    const st = getComputedStyle(e);
    if (st.backgroundImage !== 'none') { img = true; break; }
    const m = st.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const alpha = m && m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1;
    if (m && alpha > 0.5) { bg = st.backgroundColor; break; }
    e = e.parentElement;
  }
  return { color: cs.color, bg: bg || 'rgb(255, 255, 255)', img, fw: Number(cs.fontWeight), h: el.getBoundingClientRect().height, rad: parseFloat(cs.borderTopLeftRadius), text: el.textContent.trim().slice(0, 30) };
}, sel);

const contrastOk = (s, min = 4.5) => {
  if (!s) return '요소 없음';
  if (s.img) return '바탕이 그림(gradient) — 대비 계산 불가';
  const r = ratioOf(parseRgb(s.color), parseRgb(s.bg));
  return r >= min || `대비 ${r.toFixed(2)} (글자 ${s.color} / 바탕 ${s.bg})`;
};

// 탭 전환 기록: 나가는 화면(#screen-today)의 data-transition=leave 가 찍힌 시각을 0 으로 잡고 75·150ms 에 opacity 를 읽는다.
const armSwitch = (page) => page.evaluate(() => {
  const T = document.getElementById('screen-today'), C = document.getElementById('screen-calendar');
  const rec = { pre: getComputedStyle(T).opacity, s: {} };
  window.__sw = rec;
  let t0 = null;
  const mo = new MutationObserver(() => {
    if (t0 !== null || T.getAttribute('data-transition') !== 'leave') return;
    t0 = performance.now();
    mo.disconnect();
    const snap = (k) => { rec.s[k] = { leave: getComputedStyle(T).opacity, enter: getComputedStyle(C).opacity, lt: T.getAttribute('data-transition'), et: C.getAttribute('data-transition'), at: Math.round(performance.now() - t0) }; };
    setTimeout(() => snap(75), 75);
    setTimeout(() => snap(150), 150);
  });
  mo.observe(T, { attributes: true, attributeFilter: ['data-transition'] });
});

// 축포 기록: .celebrate 가 생긴 시각을 0 으로 잡고 400·800ms 에 입자 박스가 카드 글씨 박스와 겹치는 개수를 센다.
const armCelebration = (page, cardIdx) => page.evaluate((cardIdx) => {
  const rec = { t0: null, snaps: {} };
  window.__m = rec;
  const card = () => document.querySelectorAll('[data-testid="routine-card"]')[cardIdx];
  const glyphs = () => {
    const out = [];
    const w = document.createTreeWalker(card(), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) if (b.width > 0 && b.height > 0) out.push(b);
    }
    return out;
  };
  // M14 진행자: 이모지 우수수(.emoji-rain 안)는 M2 요구('화면에 우수수 쏟아짐')라 겹침에서 빼고, 대신 흐림(opacity ≤0.5)을 따로 본다. 축포 터짐(색종이·터지는 이모지)만 글씨를 덮으면 안 됨
  const parts = () => [...document.querySelectorAll('.celebrate .confetti, .celebrate .emoji-particle')].filter((e) => !e.closest('.emoji-rain')).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const rainOk = () => [...document.querySelectorAll('.emoji-rain')].every((e) => parseFloat(getComputedStyle(e).opacity) <= 0.5);
  const snap = (k) => {
    const G = glyphs(), P = parts();
    const hit = P.filter((p) => G.some((g) => p.left < g.right && g.left < p.right && p.top < g.bottom && g.top < p.bottom)).length;
    rec.snaps[k] = { n: P.length, overlap: hit, glyphs: G.length, rainOk: rainOk(), at: Math.round(performance.now() - rec.t0) };
  };
  const mo = new MutationObserver(() => {
    if (rec.t0 !== null || !document.querySelector('.celebrate')) return;
    rec.t0 = performance.now();
    mo.disconnect();
    setTimeout(() => snap(400), 400);
    setTimeout(() => snap(800), 800);
  });
  mo.observe(document.body, { childList: true, subtree: true });
}, cardIdx);

// 저장 단어(routineFutureWord) 를 처음 로드 전에 심는 열기 도우미
async function openWith(browser, { seed, word, viewport, hasTouch = false, reduced = false }) {
  const o = await open(browser, { seed, viewport, hasTouch, reduced, goto: false });
  if (word !== undefined) await o.page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [FW_KEY, word]);
  await o.page.goto(BASE);
  await sleep(500);
  return o;
}

// 연속 3일 시드: 10-04~10-06 에 r_a mini 기록, 오늘(10-07) 기록 없음 → 어제까지 세면 3
const LOGS3 = { [DAY(4)]: { r_a: 'mini' }, [DAY(5)]: { r_a: 'mini' }, [DAY(6)]: { r_a: 'mini' } };
const SEED3 = { ...seedOf(SEED_EMO.routines), logs: LOGS3 };

await run(async (browser) => {
  // ---------- D0 계산 점검 (반대 확인 포함) ----------
  await check('D0 계산 점검: 흰 글자 on #FF7A3D = 2.5~2.7 이고 4.5 미만(반대: #FF7A3D 위 흰 글자는 실패)', () => {
    const r = ratioOf([255, 255, 255], hexRgb('#FF7A3D'));
    return (r >= 2.5 && r <= 2.7 && r < 4.5) || `계산 ${r.toFixed(3)}`;
  });
  await check('D0b 계산 점검: 검정 on 흰 = 21', () => (Math.abs(ratioOf([0, 0, 0], [255, 255, 255]) - 21) < 0.01) || 'bad');

  // ---------- D1·D3·D4·D5·D6 기본 화면 ----------
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(400);
    await check('D1 선택 탭(오늘): 글자/알약 대비 ≥4.5 · 굵기 ≥700 · 알약 높이 ≤56(블라인드에서 고른 탭 칸 전체 알약) · 모서리 ≥ 높이/2', async () => {
      const s = await styleOf(page, '.tab[aria-selected="true"]');
      if (!s) return '선택 탭 없음';
      const c = contrastOk(s);
      if (c !== true) return c;
      if (s.fw < 700) return `굵기 ${s.fw}`;
      if (s.h > 56) return `높이 ${s.h}`; // 진행자: 블라인드 비교에서 D 가 고른 안(1-나)은 탭 칸 전체를 감싸는 알약(52px) — 계획의 36 은 추측값이었음
      return s.rad >= s.h / 2 - 1 || `모서리 ${s.rad}px (높이 ${s.h})`;
    });
    await check('D5 오늘 탭 미래의 나 한 줄(today-future, 저장 단어 없음): 글자/바탕 대비 ≥4.5', async () => contrastOk(await styleOf(page, tid('today-future'))));
    await page.click(tid('tab-timer'));
    await sleep(300);
    await check('D3 타이머 시작 버튼(주황 바탕): 글자 대비 ≥4.5', async () => contrastOk(await styleOf(page, tid('timer-start'))));
    await check('D3b 타이머 시작 글자색이 흰색이 아님(흰 글자 2.6 은 실패 기준)', async () => {
      const s = await styleOf(page, tid('timer-start'));
      return (s && s.color !== 'rgb(255, 255, 255)') || `글자 ${s && s.color}`;
    });
    await page.click(tid('tab-manage'));
    await sleep(300);
    await check('D4 루틴 추가 버튼(주황 바탕): 글자/바탕 대비 ≥4.5', async () => contrastOk(await styleOf(page, tid('btn-add-routine'))));
    await ctx.close();
  }

  // ---------- D2 눌린 mini/more/max 글자·면 대비 (면 색은 눌렸을 때만 강도 색이 보인다. 안 눌린 면은 모두 같은 흰 면) ----------
  const pressedFace = {};
  for (const lv of ['mini', 'more', 'max']) {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(300);
    await page.locator(`[data-testid="routine-card"] .level-btn[data-level="${lv}"]`).first().click();
    await sleep(500);
    const s = await styleOf(page, `.level-btn[data-level="${lv}"][aria-pressed="true"]`);
    pressedFace[lv] = s && !s.img ? parseRgb(s.bg) : null;
    await check(`D2-${lv} 눌린 ${lv} 글자/면 대비 ≥4.5 (aria-pressed=true 가 있어야 함)`, () => contrastOk(s));
    await ctx.close();
  }
  // M14 진행자: 다시 채점에서 '눌린 면을 연하게 해 흑백 사다리를 만든 것'이 mini 성취감을 떨어뜨려 되돌림(진한 원래 색 + 진한 글자).
  // 한 카드에서 눌린 건 하나뿐이라 흑백에서 필요한 건 '눌림 vs 안 눌림(흰 면)' 구분 → 그 기준으로 바꿈
  await check('D6 눌린 mini/more/max 면 vs 안 눌린 흰 면: 흑백 명도 차 ≥1.5 (반대: 흰 면끼리면 1.00 으로 실패)', () => {
    if (!pressedFace.mini || !pressedFace.more || !pressedFace.max) return `면 계산 불가 ${JSON.stringify(pressedFace)}`;
    const white = [255, 255, 255];
    if (ratioOf(white, white) >= 1.5) return '대조 실패';
    const bad = ['mini', 'more', 'max'].filter((lv) => ratioOf(pressedFace[lv], white) < 1.5).map((lv) => `${lv} ${ratioOf(pressedFace[lv], white).toFixed(2)}`);
    return bad.length ? `미달: ${bad.join(', ')}` : true;
  });

  // ---------- T 탭 전환 시점: 마우스·터치 ----------
  for (const mode of ['mouse', 'touch']) {
    const { ctx, page } = await open(browser, { seed: SEED_EMO, hasTouch: mode === 'touch' });
    await sleep(400);
    await armSwitch(page);
    if (mode === 'touch') await page.tap(tid('tab-calendar')); else await page.click(tid('tab-calendar'));
    await sleep(400);
    const s = await page.evaluate(() => window.__sw);
    await check(`T1-${mode} 탭 전환: 시작 전 나가는 화면 opacity ≥0.99(보정) · 75ms 나감 ≤0.5(측정 지연 ~40ms 감안, M14 진행자)·들어옴 ≤0.5 · 150ms 나감 ≤0.05`, () => {
      if (!s || !s.s['75'] || !s.s['150']) return '전환 기록 없음(data-transition=leave 안 찍힘)';
      if (parseFloat(s.pre) < 0.99) return `보정 실패 시작 opacity ${s.pre}`;
      const a = s.s['75'], b = s.s['150'];
      if (parseFloat(a.leave) > 0.5) return `75ms 나감 ${a.leave}`;
      if (parseFloat(a.enter) > 0.5) return `75ms 들어옴 ${a.enter}`;
      return parseFloat(b.leave) <= 0.05 || `150ms 나감 ${b.leave} (150ms 에 둘 다 >.5 면 실패)`;
    });
    await ctx.close();
  }

  // ---------- K 축포 입자와 글씨 겹침 (400·800ms) ----------
  for (const [mode, lv] of [['mouse', 'mini'], ['mouse', 'more'], ['mouse', 'max'], ['touch', 'mini']]) {
    const { ctx, page } = await open(browser, { seed: SEED_EMO, hasTouch: mode === 'touch' });
    await sleep(400);
    await armCelebration(page, 0);
    const loc = page.locator(`[data-testid="routine-card"] .level-btn[data-level="${lv}"]`).first();
    if (mode === 'touch') await loc.tap(); else await loc.click();
    await sleep(1000);
    const m = await page.evaluate(() => window.__m);
    await check(`K1-${mode}-${lv} 완료 400·800ms: 입자>0 · 카드 글씨 박스와 겹침 0`, () => {
      const a = m && m.snaps[400], b = m && m.snaps[800];
      if (!a || !b) return '시점 기록 없음';
      if (a.n === 0 || b.n === 0) return `입자 없음 (400ms ${a.n} · 800ms ${b.n})`;
      if (a.rainOk === false || b.rainOk === false) return '우수수가 흐리지 않음(opacity >0.5)';
      return (a.overlap === 0 && b.overlap === 0) || `겹침 400ms ${a.overlap} · 800ms ${b.overlap} (입자 ${a.n}/${b.n}, 글씨 박스 ${a.glyphs})`;
    });
    await ctx.close();
  }
  {
    // 대조: 일부러 카드 가운데서 터뜨리면 겹침 >0 이어야 한다(검사가 실제로 겹침을 잡는지 확인)
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(400);
    await armCelebration(page, 0);
    await page.evaluate(() => {
      const r = document.querySelectorAll('[data-testid="routine-card"]')[0].getBoundingClientRect();
      window.RT.effects.celebrate({ level: 'more', x: r.left + r.width / 2, y: r.top + r.height / 2, emoji: '🏃' });
    });
    await sleep(1000);
    const m = await page.evaluate(() => window.__m);
    await check('K2 대조: 카드 가운데서 터뜨리면 겹침 >0 (400ms)', () => (m.snaps[400] && m.snaps[400].overlap > 0) || `겹침 ${JSON.stringify(m.snaps[400] || null)}`);
    await ctx.close();
  }

  // ---------- R 동작 줄이기: 축포·탭 전환 움직임 0 ----------
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO, reduced: true });
    await sleep(400);
    await page.locator(`[data-testid="routine-card"] .level-btn[data-level="max"]`).first().click();
    await sleep(100);
    const a = await page.evaluate(() => document.querySelectorAll('.celebrate, .confetti, .emoji-particle').length);
    await sleep(400);
    const b = await page.evaluate(() => document.querySelectorAll('.celebrate, .confetti, .emoji-particle').length);
    await check('R1 동작 줄이기: 축포 요소 0개 (100ms·500ms)', () => (a === 0 && b === 0) || `100ms ${a} · 500ms ${b}`);
    const r = await page.evaluate(async () => {
      const sleepI = (ms) => new Promise((res) => setTimeout(res, ms));
      document.querySelector('[data-testid="tab-calendar"]').click();
      await sleepI(20);
      const scr = document.querySelector('.screens');
      const running = document.getAnimations().filter((an) => an.playState === 'running' && scr && an.effect && an.effect.target && scr.contains(an.effect.target)).length;
      return { running, enter: getComputedStyle(document.getElementById('screen-calendar')).opacity };
    });
    await check('R2 동작 줄이기: 탭 전환 20ms 에 실행 중인 움직임 0 · 들어오는 화면 opacity 1(즉시)', () => (r.running === 0 && parseFloat(r.enter) >= 0.99) || JSON.stringify(r));
    await ctx.close();
  }

  // ---------- F 오늘 탭 미래의 나 한 줄 ----------
  {
    const { ctx, page } = await openWith(browser, { seed: SEED3, word: '달리기' });
    const t0 = await page.textContent(tid('today-future'));
    const raw0 = await getRaw(page);
    const fw0 = await page.evaluate((k) => localStorage.getItem(k), FW_KEY);
    const keys0 = await page.evaluate(() => Object.keys(localStorage).sort().join(','));
    await page.click(tid('tab-manage'));
    await sleep(200);
    await page.click(tid('tab-today'));
    await sleep(500);
    const t1 = await page.textContent(tid('today-future'));
    const raw1 = await getRaw(page);
    const fw1 = await page.evaluate((k) => localStorage.getItem(k), FW_KEY);
    const keys1 = await page.evaluate(() => Object.keys(localStorage).sort().join(','));
    await check('F1 오늘 탭 미래의 나: 저장 단어 "달리기"·연속 3일 "3일째" 표시 (시드: 10-04~06 mini → 3)', () => (t0.includes('달리기') && t0.includes('3일째') && t1 === t0) || `표시: ${t0} / 다시 연 뒤: ${t1}`);
    await check('F2 쓰기 0: routineTracker·routineFutureWord 값과 키 목록 전후 ===', () => (raw0 === raw1 && fw0 === fw1 && keys0 === keys1) || `바뀜 (키 ${keys0} → ${keys1})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(400);
    const t = await page.textContent(tid('today-future'));
    // 진행자: 저장 단어가 없으면 계획대로 "미래의 나"(이전 기대 '꾸준한 나'는 잘못)
    await check('F3 저장 단어 없음·연속 0: "미래의 나"·"오늘부터 1일째" 표시', () => (t.includes('미래의 나') && t.includes('오늘부터 1일째')) || `표시: ${t}`);
    await ctx.close();
  }

  // ---------- L 360x640 ----------
  {
    const { ctx, page } = await openWith(browser, { seed: SEED3, word: '꾸준히달려가는나의미래입', viewport: { width: 360, height: 640 } });
    await check('L1 360x640 탭바: 가로 넘침 0 · 탭 폭 합 ≤ 화면 폭 −8 · 탭 글자 줄 1 · 탭 4개', async () => {
      const o = await page.evaluate(() => {
        const bar = document.querySelector('.tabbar');
        const tabs = [...bar.querySelectorAll('.tab')];
        const lines = tabs.map((t) => {
          const tops = new Set();
          const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = w.nextNode())) {
            if (!n.textContent.trim() || (n.parentElement && n.parentElement.closest('.tab-icon'))) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            for (const b of rg.getClientRects()) tops.add(Math.round(b.top));
          }
          return tops.size;
        });
        return { sw: bar.scrollWidth, cw: bar.clientWidth, docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth, sumW: tabs.reduce((a, t) => a + t.getBoundingClientRect().width, 0), lines, n: tabs.length };
      });
      const ok = o.sw <= o.cw && o.docSw <= o.docCw && o.sumW <= 360 - 8 + 0.5 && // 진행자: 328 은 근거 없는 값 — 넘침 0 과 여백 4px 씩이 기준
         o.lines.every((x) => x === 1) && o.n === 4;
      return ok || JSON.stringify(o);
    });
    await check('L2 360x640 오늘 탭 미래의 나 한 줄(12자 단어·연속 3): 높이 ≤28 · 가로 넘침 0', async () => {
      const o = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="today-future"]');
        if (!el) return null;
        return { h: el.getBoundingClientRect().height, sw: el.scrollWidth, cw: el.clientWidth, t: el.textContent.trim() };
      });
      if (!o) return '요소 없음';
      return (o.h <= 28 && o.sw <= o.cw) || JSON.stringify(o);
    });
    await ctx.close();
  }
});
