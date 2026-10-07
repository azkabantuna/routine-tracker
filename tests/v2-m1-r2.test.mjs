// routine-tracker v2 · M1(부드러운 움직임) R2 자동 시험 (검토봇 C)
// 실행: 레포 루트에서  node projects/routine-tracker/tests/v2-m1-r2.test.mjs
// 먼저 서버: cd projects/routine-tracker && python3 -m http.server 8080
// 범위(R2): 탭 전환, 움직임 줄이기 탭 50ms, 누름 수치(판정=계획 문구, 목표는 기록), CPU 4배 부드러움,
//           스타일시트 검사, 360x640 회귀, 옛 데이터 보존, 콘솔·외부 요청. (R1 항목은 v2-m1.test.mjs 가 다시 시험)
// 날짜: timezoneId Asia/Seoul + page.clock.setFixedTime 만 사용(clock.install 안 씀).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL = process.env.RT_URL || 'http://localhost:8080/';
const KEY = 'routineTracker';
const NOW = '2026-10-07T10:00:00+09:00';
const results = [];
const consoleErrors = [];
const externalRequests = [];

function record(name, ok, reason) {
  results.push({ name, ok, reason });
  console.log(`${ok ? '✅' : '❌'} ${name}${reason ? ' — ' + reason : ''}`);
}
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === true) record(name, true);
    else record(name, false, typeof r === 'string' ? r : 'false');
  } catch (e) {
    record(name, false, '예외: ' + e.message.split('\n')[0]);
  }
}
const note = (s) => console.log('   · ' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;
const getRaw = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);

const R = (id, name, order) => ({ id, name, mini: id + '-mini', more: id + '-more', max: id + '-max', createdAt: '2026-10-01', order });
const seedN = (n) => ({ version: 1, routines: Array.from({ length: n }, (_, i) => R('r_' + i, '루틴' + (i + 1), i)), logs: {}, celebratedOn: null });
const SEED3 = seedN(3);

async function open(browser, { seed = null, reduced = false, viewport = { width: 390, height: 844 }, observer = false } = {}) {
  const ctx = await browser.newContext({
    viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.route('**/*', (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.clock.setFixedTime(new Date(NOW));
  if (observer) {
    // 문서 전체 관찰: data-transition·hidden·data-bounce·data-switching·data-dir 변화를 시각과 함께 기록
    await page.addInitScript(() => {
      window.__mo = [];
      window.__t0 = performance.now();
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target;
          window.__mo.push({
            t: performance.now(), attr: m.attributeName, id: el.id || el.className || el.tagName,
            val: el.getAttribute(m.attributeName),
            hiddenToday: document.getElementById('screen-today')?.hidden,
            hiddenLog: document.getElementById('screen-log')?.hidden,
            hiddenManage: document.getElementById('screen-manage')?.hidden,
          });
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-transition', 'hidden', 'data-bounce', 'data-switching', 'data-dir'] });
    });
  }
  if (seed !== null) {
    const raw = typeof seed === 'string' ? seed : JSON.stringify(seed);
    await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, raw]);
  }
  await page.goto(URL);
  await sleep(300);
  return { ctx, page };
}

const scaleOf = (t) => { if (!t || t === 'none') return 1; const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : NaN; };
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
const SCREENS = ['today', 'log', 'manage'];
const state = (page) => page.evaluate(() => ({
  visible: [...document.querySelectorAll('.screen')].filter((s) => !s.hidden).map((s) => s.id),
  selected: [...document.querySelectorAll('.tab')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.getAttribute('data-tab')),
  trans: document.querySelectorAll('[data-transition]').length,
  switching: document.querySelector('.screens').getAttribute('data-switching'),
  dir: document.querySelector('.screens').getAttribute('data-dir'),
  ariaHidden: document.querySelectorAll('.screen[aria-hidden]').length,
  bounce: document.querySelectorAll('[data-bounce]').length,
}));

// 페이지 안에서 정해진 시각에 탭을 클릭 (Playwright 왕복 지연을 없앰). seq=[[탭이름, 지연ms], ...]
const clickSeq = (page, seq) => page.evaluate((seq) => new Promise((res) => {
  const t0 = performance.now(); const times = [];
  seq.forEach(([name, at]) => setTimeout(() => { times.push(Math.round(performance.now() - t0)); document.querySelector(`[data-testid="tab-${name}"]`).click(); }, at));
  setTimeout(() => res(times), Math.max(...seq.map((s) => s[1])) + 5);
}), seq);

const browser = await chromium.launch();
try {
  // ================= 1. 탭 전환 =================
  await check('T1 탭 전환 MutationObserver: tab-log 클릭 0–300ms 에 today=leave·log=enter 각 ≥1회, 기록 시점 두 화면 모두 hidden 아님, 새 훅(data-switching·data-dir·aria-hidden·animationName)', async () => {
    const out = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const { ctx, page } = await open(browser, { seed: SEED3, observer: true, viewport });
      const errs = [];
      await page.evaluate(() => { window.__mo.length = 0; });
      const r = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now();
        document.querySelector('[data-testid="tab-log"]').click();
        const at150 = {};
        setTimeout(() => {
          const T = document.getElementById('screen-today'), L = document.getElementById('screen-log'), S = document.querySelector('.screens');
          at150.hiddenToday = T.hidden; at150.hiddenLog = L.hidden;
          at150.todayAria = T.getAttribute('aria-hidden'); at150.switching = S.getAttribute('data-switching'); at150.dir = S.getAttribute('data-dir');
          at150.todayAnim = getComputedStyle(T).animationName; at150.logAnim = getComputedStyle(L).animationName;
          at150.todayTrans = T.getAttribute('data-transition'); at150.logTrans = L.getAttribute('data-transition');
        }, 150);
        setTimeout(() => res({ mo: window.__mo.map((m) => ({ ...m, t: Math.round(m.t - t0) })), at150 }), 300);
      }));
      const mo = r.mo;
      const leave = mo.filter((m) => m.attr === 'data-transition' && m.id === 'screen-today' && m.val === 'leave');
      const enter = mo.filter((m) => m.attr === 'data-transition' && m.id === 'screen-log' && m.val === 'enter');
      if (!leave.length) errs.push('today leave 기록 없음');
      if (!enter.length) errs.push('log enter 기록 없음');
      if (leave.length && enter.length) {
        const both = [...leave, ...enter].some((m) => m.hiddenToday === false && m.hiddenLog === false);
        if (!both) errs.push('기록 시점에 두 화면이 동시에 보인 순간 없음');
        note(`${viewport.width}x${viewport.height}: leave ${leave[0].t}ms enter ${enter[0].t}ms, 기록 시점 hidden(today/log)=${leave[0].hiddenToday}/${leave[0].hiddenLog}`);
      }
      const a = r.at150;
      if (a.hiddenToday || a.hiddenLog) errs.push('150ms 두 화면 hidden: ' + JSON.stringify(a));
      if (a.switching !== 'true') errs.push('data-switching=' + a.switching);
      if (a.dir !== '1') errs.push('data-dir=' + a.dir);
      if (a.todayAria !== 'true') errs.push('떠나는 화면 aria-hidden=' + a.todayAria);
      if (a.todayAnim !== 'tab-leave') errs.push('떠나는 animationName=' + a.todayAnim);
      if (a.logAnim !== 'tab-enter') errs.push('들어오는 animationName=' + a.logAnim);
      await sleep(600);
      const s = await state(page);
      if (s.visible.join() !== 'screen-log') errs.push('600ms 뒤 보이는 화면 ' + s.visible);
      if (s.selected.join() !== 'log') errs.push('aria-selected ' + s.selected);
      if (s.trans !== 0 || s.switching !== null || s.dir !== null || s.ariaHidden !== 0) errs.push('600ms 뒤 잔여 속성 ' + JSON.stringify(s));
      // 반대 방향(log → today): dir=-1
      await page.evaluate(() => document.querySelector('[data-testid="tab-today"]').click());
      await sleep(60);
      const d = await state(page);
      if (d.dir !== '-1') errs.push('되돌아가기 data-dir=' + d.dir);
      await ctx.close();
      out.push(...errs.map((e) => `${viewport.width}: ${e}`));
    }
    return out.length ? out.join('; ') : true;
  });

  await check('T2 연타 150ms 간격 3탭(되돌아가기·처음 탭으로 끝나기 포함 6가지): 마지막 탭만 보임·aria-selected 1·data-transition 0·data-switching/dir/aria-hidden 없음', async () => {
    const orders = [
      ['log', 'manage', 'today'], // 처음 탭으로 끝남
      ['log', 'today', 'log'], // 떠나는 화면으로 되돌아감
      ['log', 'today', 'manage'],
      ['manage', 'log', 'today'],
      ['manage', 'today', 'manage'],
      ['log', 'manage', 'log'],
    ];
    const errs = [];
    for (const order of orders) {
      const { ctx, page } = await open(browser, { seed: SEED3 });
      const before = consoleErrors.length;
      await clickSeq(page, order.map((n, i) => [n, i * 150]));
      await sleep(80);
      const mid = await state(page);
      if (mid.visible.length < 1) errs.push(order + ' 연타 중 보이는 화면 0개');
      await sleep(900);
      const s = await state(page);
      const last = order[order.length - 1];
      if (s.visible.join() !== 'screen-' + last) errs.push(`${order}: 보이는 화면 ${s.visible}`);
      if (s.selected.join() !== last) errs.push(`${order}: aria-selected ${s.selected}`);
      if (s.trans || s.switching !== null || s.dir !== null || s.ariaHidden) errs.push(`${order}: 잔여 ${JSON.stringify(s)}`);
      if (consoleErrors.length !== before) errs.push(`${order}: 콘솔 오류`);
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('T3 전환 중 매 rAF documentElement.scrollWidth ≤ innerWidth (390x844·360x640 × 순서 today→log→manage·manage→today·log→today)', async () => {
    const errs = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      for (const [start, steps] of [['today', ['log', 'manage']], ['manage', ['today']], ['log', ['today']]]) {
        const { ctx, page } = await open(browser, { seed: seedN(6), viewport });
        if (start !== 'today') { await page.click(tid('tab-' + start)); await sleep(500); }
        const r = await page.evaluate((steps) => new Promise((res) => {
          let maxOver = -999, frames = 0, stop = false, worstW = 0;
          (function step() {
            const over = document.documentElement.scrollWidth - window.innerWidth;
            if (over > maxOver) maxOver = over;
            worstW = Math.max(worstW, document.body.scrollWidth - window.innerWidth);
            frames++;
            if (!stop) requestAnimationFrame(step);
          })();
          steps.forEach((n, i) => setTimeout(() => document.querySelector(`[data-testid="tab-${n}"]`).click(), 50 + i * 500));
          setTimeout(() => { stop = true; res({ maxOver, frames, worstW }); }, 50 + steps.length * 500 + 300);
        }), steps);
        note(`${viewport.width}x${viewport.height} ${start}→${steps.join('→')}: scrollWidth−innerWidth 최대=${r.maxOver}, 프레임 ${r.frames}`);
        if (r.maxOver > 0) errs.push(`${viewport.width} ${start}→${steps}: 넘침 ${r.maxOver}px`);
        await ctx.close();
      }
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('T4 움직임 줄이기 탭 전환: 50ms 에 보이는 화면 1·data-transition/data-bounce/data-switching 0, 관찰기에 해당 속성 변화 기록 없음', async () => {
    const { ctx, page } = await open(browser, { seed: SEED3, reduced: true, observer: true });
    const errs = [];
    await page.evaluate(() => { window.__mo.length = 0; });
    for (const n of ['log', 'manage', 'today']) {
      const r = await page.evaluate((n) => new Promise((res) => {
        document.querySelector(`[data-testid="tab-${n}"]`).click();
        setTimeout(() => res({
          vis: [...document.querySelectorAll('.screen')].filter((s) => !s.hidden).map((s) => s.id),
          trans: document.querySelectorAll('[data-transition]').length, bounce: document.querySelectorAll('[data-bounce]').length,
          sw: document.querySelector('.screens').getAttribute('data-switching'),
        }), 50);
      }), n);
      if (r.vis.join() !== 'screen-' + n) errs.push(n + ' 50ms 보이는 화면 ' + r.vis);
      if (r.trans || r.bounce || r.sw !== null) errs.push(n + ' 50ms 잔여 ' + JSON.stringify(r));
      await sleep(150);
    }
    await sleep(500);
    const bad = await page.evaluate(() => window.__mo.filter((m) => m.attr !== 'hidden').map((m) => m.attr + '=' + m.val));
    if (bad.length) errs.push('reduce 에서 전환·튕김 속성 변화 ' + bad.join(','));
    const s = await state(page);
    if (s.visible.join() !== 'screen-today') errs.push('최종 ' + s.visible);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 2. 누름 수치 =================
  async function pressNumbers(page, sel, label, afterClose) {
    const res = { label, p150: null, win: [], max500: null, det136: null, endTransform: null, endBounce: null, ease: null, prop: null, before: null, animName: null, judged: false };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const loc = page.locator(sel).first();
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(400);
      const info = () => page.evaluate((s) => { const cs = getComputedStyle(document.querySelector(s)); return { t: cs.transform, ease: cs.transitionTimingFunction, prop: cs.transitionProperty }; }, sel);
      res.before = (await info()).t;
      await page.mouse.down();
      await sleep(150);
      res.p150 = scaleOf((await info()).t);
      // mouse.up 전에 시작하는 500ms rAF 표본
      const sampler = page.evaluate(([s, ms]) => new Promise((resv) => {
        const el = document.querySelector(s); const out = []; let t0 = null; const start = performance.now();
        window.addEventListener('pointerup', () => { if (t0 === null) t0 = performance.now(); }, { capture: true, once: true });
        const sc = (t) => { if (!t || t === 'none') return 1; const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : NaN; };
        (function step() {
          const now = performance.now();
          out.push({ t: now, s: sc(getComputedStyle(el).transform) });
          if ((t0 !== null && now - t0 > ms) || now - start > 6000) return resv({ t0, out });
          requestAnimationFrame(step);
        })();
      }), [sel, 500]);
      await sleep(60);
      await page.mouse.up();
      const after = await info();
      res.ease = after.ease; res.prop = after.prop;
      const { t0, out } = await sampler;
      const w = out.filter((x) => t0 !== null && x.t - t0 >= 100 && x.t - t0 <= 300).map((x) => x.s);
      const w2 = out.filter((x) => t0 !== null && x.t - t0 >= 0).map((x) => x.s);
      res.win.push(Math.max(...w)); res.max500 = Math.max(res.max500 ?? 0, ...w2);
      res.animName = res.animName || 'n/a';
      await sleep(600);
      const end = await page.evaluate((s) => { const el = document.querySelector(s); return { t: getComputedStyle(el).transform, b: el.hasAttribute('data-bounce') }; }, sel);
      res.endTransform = end.t; res.endBounce = end.b;
      if (afterClose) await afterClose();
      if (w.length >= 3 && Math.max(...w) > 1.0005 && res.p150 <= 0.96 && end.t === 'none' && !end.b) { res.judged = true; res.attempts = attempt; break; }
    }
    // 결정적 확인: btn-bounce 를 currentTime=136 으로 두고 transform 읽기 + 실행 중 animationName
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
    await page.mouse.down(); await sleep(150); await page.mouse.up();
    res.det136 = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const a = el.getAnimations().find((x) => x.animationName === 'btn-bounce');
      if (!a) return { found: false, names: el.getAnimations().map((x) => x.animationName), cssName: getComputedStyle(el).animationName };
      const cssName = getComputedStyle(el).animationName;
      a.pause(); a.currentTime = 136;
      const t = getComputedStyle(el).transform; const m = t.match(/matrix\(([^)]+)\)/);
      return { found: true, cssName, scale: m ? parseFloat(m[1].split(',')[0]) : NaN };
    }, sel);
    await sleep(600);
    if (afterClose) await afterClose();
    return res;
  }

  const pressRows = [];
  await check('P1 누름감 판정(계획 문구): .level-btn/.btn/.tab 눌림 150ms scale≤0.96·누르기 전 none·해제 이징 cubic-bezier(.34,1.56,.64,1)·금지 속성 없음·해제 후 100–300ms scale>1(3회 중 1회)·450ms 뒤 none/data-bounce 없음', async () => {
    const { ctx, page } = await open(browser, { seed: SEED3 });
    const errs = [];
    const rows = [];
    rows.push(await pressNumbers(page, '[data-routine-id="r_1"] .level-btn', '.level-btn', null));
    await page.click(tid('tab-manage')); await sleep(500);
    rows.push(await pressNumbers(page, tid('btn-add-routine'), '.btn', async () => { await page.click(tid('btn-close')); await sleep(300); }));
    rows.push(await pressNumbers(page, tid('tab-log'), '.tab', null));
    for (const r of rows) {
      pressRows.push(r);
      if (r.before !== 'none') errs.push(`${r.label} 누르기 전 ${r.before}`);
      if (!(r.p150 <= 0.96)) errs.push(`${r.label} 150ms scale=${r.p150}`);
      if (!/cubic-bezier\(0?\.34, 1\.56, 0?\.64, 1\)/.test(r.ease)) errs.push(`${r.label} 이징 ${r.ease}`);
      if (/all|box-shadow|width|height|top|left/.test(r.prop.replace(/\btransform\b/g, ''))) errs.push(`${r.label} transitionProperty ${r.prop}`);
      if (!r.judged) errs.push(`${r.label} 3회 시도 중 100–300ms scale>1 + 450ms 뒤 none 못 봄: win=${r.win.map((x) => x.toFixed(4))}, end=${r.endTransform}, bounce속성=${r.endBounce}`);
      note(`${r.label}: 눌림150ms=${r.p150.toFixed(4)} | 해제 100–300ms 최대=${Math.max(...r.win).toFixed(4)} (시도 ${r.win.map((x) => x.toFixed(4)).join('/')}) | rAF 500ms 최대=${r.max500.toFixed(4)} | 600ms 뒤 transform=${r.endTransform}, data-bounce=${r.endBounce}`);
    }
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('P2 누름 목표 기록(판정 아님→ 실제 숫자로 ✅/❌): 눌림 ≤0.92, 해제 후 최대 ≥1.04 (getAnimations btn-bounce currentTime=136), rAF 500ms 최대 ≥1.02 지지', async () => {
    const errs = [];
    for (const r of pressRows) {
      const d = r.det136;
      const ok1 = r.p150 <= 0.92;
      const ok2 = d && d.found && d.scale >= 1.04;
      note(`${r.label}: 눌림 ${r.p150.toFixed(4)} (목표≤0.92 ${ok1 ? '달성' : '미달'}) | currentTime=136 scale=${d && d.found ? d.scale.toFixed(4) : JSON.stringify(d)} (목표≥1.04 ${ok2 ? '달성' : '미달'}) | rAF 최대 ${r.max500.toFixed(4)} (≥1.02 ${r.max500 >= 1.02 ? '지지' : '불충분'}) | 튕김 중 animationName=${d && d.cssName}`);
      if (!ok1) errs.push(`${r.label} 눌림 ${r.p150}`);
      if (!ok2) errs.push(`${r.label} 해제 후 ${d && d.scale}`);
      if (d && d.found && d.cssName !== 'btn-bounce') errs.push(`${r.label} animationName=${d.cssName}`);
    }
    return pressRows.length === 3 ? (errs.length ? errs.join('; ') : true) : 'P1 결과 없음';
  });

  // ================= 3. 부드러움 (CPU 4배) =================
  async function baseline(rate) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const iv = await page.evaluate(() => new Promise((res) => {
      const out = []; let last = null; const t0 = performance.now();
      (function step(t) { if (last !== null) out.push(t - last); last = t; if (performance.now() - t0 > 2000) return res(out); requestAnimationFrame(step); })(performance.now());
    }));
    await ctx.close();
    return { median: pct(iv, 0.5), p95: pct(iv, 0.95), max: Math.max(...iv), n: iv.length };
  }
  async function smooth(page, label, rate, plan) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await page.evaluate(({ plan }) => new Promise((res) => {
      const iv = []; let last = null; let stop = false; let lt = [];
      try { new PerformanceObserver((l) => { lt.push(...l.getEntries().map((e) => e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* 없으면 기록 안 함 */ }
      (function step(t) { if (last !== null) iv.push(t - last); last = t; if (!stop) requestAnimationFrame(step); })(performance.now());
      plan.actions.forEach((a, i) => setTimeout(() => document.querySelector(a.sel).click(), 100 + i * plan.gap));
      setTimeout(() => { stop = true; setTimeout(() => res({ iv, lt }), 50); }, 100 + (plan.actions.length - 1) * plan.gap + 300);
    }), { plan });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const o = { label, rate, n: r.iv.length, median: pct(r.iv, 0.5), p95: pct(r.iv, 0.95), max: Math.max(...r.iv), longtaskMax: r.lt.length ? Math.max(...r.lt) : 0, longtasks: r.lt.length };
    return o;
  }
  const judge = (o) => {
    const e = [];
    if (o.n < 30) e.push(`표본 ${o.n}<30`);
    if (!(o.median <= 22)) e.push(`중앙값 ${o.median.toFixed(1)}>22`);
    if (!(o.p95 <= 50)) e.push(`p95 ${o.p95.toFixed(1)}>50`);
    if (!(o.max <= 150)) e.push(`최대 ${o.max.toFixed(1)}>150`);
    return e;
  };
  const fmt = (o) => `${o.label}(CPU ${o.rate}x): 표본 ${o.n}, 중앙 ${o.median.toFixed(1)}, p95 ${o.p95.toFixed(1)}, 최대 ${o.max.toFixed(1)}ms, longtask ${o.longtasks}개 최대 ${o.longtaskMax.toFixed(0)}ms`;

  await check('S1 부드러움(CPU 4배): (가) 탭 전환 3회(500ms 간격) (나) 카드 팝 5회(400ms 간격) 각각 중앙≤22·p95≤50·최대≤150ms·표본≥30. 빈 페이지 기준선 병기', async () => {
    const b1 = await baseline(1), b4 = await baseline(4);
    note(`빈 페이지 기준선: 1배 중앙 ${b1.median.toFixed(1)}/p95 ${b1.p95.toFixed(1)}/최대 ${b1.max.toFixed(1)}ms (n=${b1.n}), 4배 중앙 ${b4.median.toFixed(1)}/p95 ${b4.p95.toFixed(1)}/최대 ${b4.max.toFixed(1)}ms (n=${b4.n})`);
    const errs = [];
    for (const rate of [1, 4]) {
      const { ctx, page } = await open(browser, { seed: fs.readFileSync(path.join(HERE, 'fixtures', 'old-seed.json'), 'utf8').trim() });
      const tabs = await smooth(page, '탭 전환 3회', rate, { gap: 500, actions: [{ sel: tid('tab-log') }, { sel: tid('tab-manage') }, { sel: tid('tab-today') }] });
      await sleep(600);
      const lv = (l) => ({ sel: `[data-routine-id="r_old_a"] [data-level="${l}"]` });
      const pops = await smooth(page, '카드 팝 5회', rate, { gap: 400, actions: [lv('mini'), lv('more'), lv('max'), lv('mini'), lv('more')] });
      note(fmt(tabs)); note(fmt(pops));
      if (rate === 4) {
        const e1 = judge(tabs), e2 = judge(pops);
        if (e1.length) errs.push('탭 전환 ' + e1.join(','));
        if (e2.length) errs.push('카드 팝 ' + e2.join(','));
      }
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 4. 스타일시트 =================
  await check('S2 스타일시트: transition-property 는 transform/opacity 뿐(all·box-shadow·width·height·top·left 없음), @keyframes(tab-enter·tab-leave·btn-bounce 포함)는 transform/opacity 뿐, will-change 없음, 진행 막대 scaleX', async () => {
    const { ctx, page } = await open(browser, { seed: SEED3 });
    const r = await page.evaluate(() => {
      const bad = []; const kf = {}; const trans = new Set(); let fillRule = null; const will = [];
      const ALLOWED = new Set(['transform', 'opacity']);
      function walk(rules) {
        for (const rule of rules) {
          if (rule.type === CSSRule.KEYFRAMES_RULE) {
            const props = new Set();
            for (const k of rule.cssRules) for (let i = 0; i < k.style.length; i++) props.add(k.style[i]);
            kf[rule.name] = [...props];
            props.forEach((p) => { if (!ALLOWED.has(p) && !/^animation-/.test(p) && !/^--/.test(p)) bad.push('@keyframes ' + rule.name + ' 에서 ' + p); });
          } else if (rule.cssRules && rule.type !== CSSRule.STYLE_RULE) walk(rule.cssRules);
          else if (rule.style) {
            const tp = rule.style.getPropertyValue('transition-property');
            if (tp) tp.split(',').map((s) => s.trim()).forEach((p) => { trans.add(p); if (p !== 'none' && !ALLOWED.has(p)) bad.push(rule.selectorText + ' transition-property=' + p); });
            const sh = rule.style.getPropertyValue('transition');
            if (sh) sh.split(',').forEach((part) => { const prop = part.trim().split(/\s+/)[0]; if (prop && prop !== 'none' && !ALLOWED.has(prop) && !/^[\d.]/.test(prop)) bad.push(rule.selectorText + ' transition=' + part.trim()); });
            if (rule.style.getPropertyValue('will-change')) will.push(rule.selectorText);
            if (rule.selectorText && rule.selectorText.split(',').map((s) => s.trim()).includes('.progress-fill')) fillRule = rule.style.getPropertyValue('transform');
          }
        }
      }
      for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) { bad.push('시트 못 읽음 ' + e.message); } }
      return { bad, kf, trans: [...trans], fillRule, will, inline: document.getElementById('progress-fill').style.transform };
    });
    const errs = [...r.bad];
    for (const n of ['tab-enter', 'tab-leave', 'btn-bounce']) if (!r.kf[n]) errs.push('keyframes ' + n + ' 없음');
    if (!/scaleX/.test(r.fillRule || '') || !/scaleX/.test(r.inline)) errs.push('막대 scaleX 아님');
    if (r.will.length) errs.push('will-change 사용: ' + r.will);
    note('keyframes: ' + JSON.stringify(r.kf) + ' | transition-property: ' + r.trans.join(','));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 5. 360x640 회귀 =================
  const geom = (page, screenSel) => page.evaluate((sel) => {
    const iw = window.innerWidth; const out = { sw: document.documentElement.scrollWidth - iw, clip: [], overlap: [], tabbarTop: document.querySelector('.tabbar').getBoundingClientRect().top };
    const root = document.querySelector(sel);
    root.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.left < -0.5 || r.right > iw + 0.5) out.clip.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '~' + Math.round(r.right));
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.clip.push('내용 잘림 ' + (el.className || el.tagName));
    });
    const boxes = (q) => [...root.querySelectorAll(q)].map((e) => e.getBoundingClientRect());
    const inter = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    for (const q of ['#card-list > [data-routine-id]', '.level-btn', '[data-testid="manage-item"]']) {
      const b = boxes(q);
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (inter(b[i], b[j])) out.overlap.push(q + ' ' + i + '/' + j);
    }
    const lastSel = sel === '#screen-today' ? '#card-list > [data-routine-id]' : '[data-testid="manage-item"]';
    const items = root.querySelectorAll(lastSel);
    window.scrollTo(0, document.documentElement.scrollHeight);
    out.items = items.length;
    out.gap = items.length ? out.tabbarTop - items[items.length - 1].getBoundingClientRect().bottom : null;
    return out;
  }, screenSel);

  await check('R360 회귀 360x640·390x844(오늘·관리, 카드 5·6개): 가로 스크롤·잘림·겹침 없음, 마지막 카드~탭바 ≥16px, 토스트와 .screen-title 비겹침', async () => {
    const errs = [];
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
      for (const n of [5, 6]) {
        const { ctx, page } = await open(browser, { seed: seedN(n), viewport });
        for (const [tab, sel] of [['today', '#screen-today'], ['manage', '#screen-manage']]) {
          if (tab !== 'today') { await page.click(tid('tab-' + tab)); await sleep(500); }
          const g = await geom(page, sel);
          const tag = `${viewport.width}x${viewport.height} ${tab} ${n}개`;
          note(`${tag}: scrollWidth−innerWidth=${g.sw}, 마지막~탭바 ${g.gap == null ? '-' : g.gap.toFixed(1)}px, 잘림 ${g.clip.length}, 겹침 ${g.overlap.length}`);
          if (g.sw > 0) errs.push(tag + ' 가로 스크롤 ' + g.sw);
          if (g.clip.length) errs.push(tag + ' 잘림 ' + g.clip.slice(0, 3));
          if (g.overlap.length) errs.push(tag + ' 겹침 ' + g.overlap.slice(0, 3));
          if (!(g.gap >= 16)) errs.push(tag + ' 마지막 카드~탭바 ' + g.gap);
          await page.screenshot({ path: path.join(HERE, `r2-${viewport.width}x${viewport.height}-${tab}-${n}.png`) });
        }
        if (n === 6) {
          await page.click(tid('tab-today')); await sleep(500);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.click('[data-routine-id="r_0"] [data-level="mini"]');
          await sleep(100);
          const t = await page.evaluate(() => {
            const toast = document.querySelector('[data-testid="toast"]'); const tr = toast.getBoundingClientRect();
            const ti = document.querySelector('#screen-today .screen-title').getBoundingClientRect(); const tb = document.querySelector('.tabbar').getBoundingClientRect();
            return { hidden: toast.hidden, text: toast.textContent, toast: [tr.top, tr.bottom], title: [ti.top, ti.bottom], tabbarTop: tb.top, z: getComputedStyle(toast).zIndex };
          });
          const tag = `${viewport.width}x${viewport.height} 토스트`;
          note(`${tag}: ${JSON.stringify(t)}`);
          if (t.hidden) errs.push(tag + ' 안 뜸');
          else if (t.toast[0] < t.title[1] && t.toast[1] > t.title[0]) errs.push(tag + ' 제목과 겹침');
          else if (t.toast[1] > t.tabbarTop + 0.5) errs.push(tag + ' 탭바와 겹침');
        }
        await ctx.close();
      }
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 6. 옛 데이터 =================
  const fixtureRaw = fs.readFileSync(path.join(HERE, 'fixtures', 'old-seed.json'), 'utf8').trim();
  await check('D1 OLD 시드 불변: 시드로 열기·탭 3개 왕복·reload 뒤에도 localStorage 문자열 그대로, backup 키 없음, banner-error 안 보임, 카드 3개 (390·360)', async () => {
    const errs = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport });
      const chk = async (label) => {
        if ((await getRaw(page)) !== fixtureRaw) errs.push(`${viewport.width} ${label}: 문자열 달라짐`);
        if ((await page.evaluate(() => localStorage.getItem('routineTracker.backup'))) !== null) errs.push(label + ' backup');
        if (await page.locator(tid('banner-error')).isVisible()) errs.push(label + ' banner-error');
        if ((await page.locator(tid('routine-card')).count()) !== 3) errs.push(label + ' 카드 수');
      };
      await chk('로드');
      for (const n of ['log', 'manage', 'today']) { await page.click(tid('tab-' + n)); await sleep(400); }
      await chk('탭 왕복');
      await page.reload(); await sleep(400); await chk('reload');
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  record('E1 콘솔 오류 0개 (console error + pageerror, 이 파일의 모든 시험 합산)', consoleErrors.length === 0, consoleErrors.join(' | '));
  record('E2 외부 요청 0개 (localhost 만)', externalRequests.length === 0, externalRequests.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
