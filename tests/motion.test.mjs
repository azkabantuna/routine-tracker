// 움직임 시험: 누름감·튕김, 탭 전환, 카드 등장·팝·퇴장, 스타일시트 움직임 검사, 움직임 줄이기 (effects 의 축포는 effects.test.mjs)
// 실행(레포 루트에서): node projects/routine-tracker/tests/motion.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { consoleErrors, fs, path, HERE, run, check, note, sleep, tid, getStore, open, openConfirm, scaleOf, pct, seedN, fixtureRaw, SEED2, SEED3 } from './_lib.mjs';

const SEED3N = seedN(3);
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

await run(async (browser) => {
  // ================= (옛 v2-m1) 누름감·카드 등장/팝/퇴장·움직임 줄이기·스타일시트 =================
  async function pressFeel(page, sel, label, { reduced }) {
    const errs = [];
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const info = () => page.evaluate((s) => {
      const el = document.querySelector(s); const cs = getComputedStyle(el);
      return { transform: cs.transform, ease: cs.transitionTimingFunction, prop: cs.transitionProperty };
    }, sel);
    await page.mouse.move(cx, cy);
    await sleep(350);
    const before = await info();
    if (before.transform !== 'none') errs.push(`${label} 누르기 전 transform=${before.transform}`);
    await page.mouse.down();
    await sleep(150);
    const down = await info();
    const sc = scaleOf(down.transform);
    if (!(sc <= 0.96)) errs.push(`${label} 누른 150ms 뒤 scale=${sc} (${down.transform})`);
    await page.mouse.up();
    if (!reduced) {
      const after = await info();
      const okEase = /cubic-bezier\(0?\.34, 1\.56, 0?\.64, 1\)/.test(after.ease);
      if (!okEase) errs.push(`${label} 해제 후 이징=${after.ease}`);
      if (/all|box-shadow|width|height|top|left/.test(after.prop.replace(/\btransform\b/g, ''))) errs.push(`${label} transitionProperty=${after.prop}`);
    }
    return errs;
  }
  async function overshoot(page, sel, closeFn) {
    // 최대 3번 시도: 해제 후 100–300ms 구간 rAF 표본에서 scale>1 이 한 번이라도, 마지막은 ≈1
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const loc = page.locator(sel).first();
      const box = await loc.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(350);
      await page.mouse.down();
      await sleep(150);
      const p = page.evaluate(([s, ms]) => new Promise((res) => {
        const el = document.querySelector(s); const out = []; let t0 = null; const start = performance.now();
        window.addEventListener('pointerup', () => { if (t0 === null) t0 = performance.now(); }, { capture: true, once: true });
        const sc = (t) => { if (!t || t === 'none') return 1; const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : NaN; };
        (function step() {
          const now = performance.now();
          out.push({ t: now, s: sc(getComputedStyle(el).transform) });
          if ((t0 !== null && now - t0 > ms) || now - start > 6000) return res({ t0, out });
          requestAnimationFrame(step);
        })();
      }), [sel, 450]);
      await sleep(60);
      await page.mouse.up();
      const { t0, out } = await p;
      if (closeFn) await closeFn();
      if (t0 === null) { last = '해제 시각 못 잡음'; continue; }
      const win = out.filter((x) => x.t - t0 >= 100 && x.t - t0 <= 300);
      const max = Math.max(...win.map((x) => x.s));
      const fin = out[out.length - 1].s;
      last = `시도${attempt}: 표본 ${win.length}개, 최대 scale=${max.toFixed(4)}, 마지막=${fin.toFixed(4)}`;
      if (win.length >= 3 && max > 1.0005 && Math.abs(fin - 1) < 0.01) return { ok: true, note: last };
    }
    return { ok: false, note: last };
  }
  await check('C1 누름감 .level-btn/.btn/.tab: mouse.down 뒤 scale≤0.96, 누르기 전 none, 해제 이징 cubic-bezier(.34,1.56,.64,1), 금지 transition 속성 없음', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2 });
    const errs = [];
    errs.push(...(await pressFeel(page, '.level-btn', '.level-btn', { reduced: false })));
    await page.click(tid('tab-manage'));
    errs.push(...(await pressFeel(page, tid('btn-add-routine'), '.btn', { reduced: false })));
    await page.click(tid('btn-close'));
    errs.push(...(await pressFeel(page, tid('tab-log'), '.tab', { reduced: false })));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('C2 해제 오버슈트(튀어오름): 100–300ms 표본에서 scale>1, 마지막≈1 (3회 중 1회) — .level-btn/.btn/.tab', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2 });
    const errs = []; const notes = [];
    let r = await overshoot(page, '.level-btn', null);
    notes.push('level-btn ' + r.note); if (!r.ok) errs.push('.level-btn 오버슈트 못 봄: ' + r.note);
    await page.click(tid('tab-manage'));
    r = await overshoot(page, tid('btn-add-routine'), async () => { await page.click(tid('btn-close')); });
    notes.push('btn ' + r.note); if (!r.ok) errs.push('.btn 오버슈트 못 봄: ' + r.note);
    r = await overshoot(page, tid('tab-log'), null);
    notes.push('tab ' + r.note); if (!r.ok) errs.push('.tab 오버슈트 못 봄: ' + r.note);
    console.log('   · ' + notes.join(' | '));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 2. 카드 등장 =================
  await check('C3 카드 등장: 첫 로드 카드엔 data-anim 없음 / 추가 후 tab-today 클릭 직후 enter·animationName≠none·opacity<1 → 600ms 뒤 속성 없음·opacity 1', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2, animLog: true });
    const errs = [];
    await sleep(500);
    const first = await page.evaluate(() => ({ n: document.querySelectorAll('[data-anim]').length, log: window.__animLog.slice() }));
    if (first.n !== 0 || first.log.length) errs.push('첫 로드 data-anim: ' + JSON.stringify(first));
    await page.click(tid('tab-manage'));
    await page.click(tid('btn-add-routine'));
    await page.fill(tid('input-name'), '새 루틴');
    await page.click(tid('btn-save'));
    const hiddenPhase = await page.evaluate(() => document.querySelectorAll('[data-anim]').length);
    if (hiddenPhase !== 0) errs.push('오늘 화면이 숨겨진 동안 data-anim 개수=' + hiddenPhase);
    const s = await page.evaluate(() => {
      document.querySelector('[data-testid="tab-today"]').click();
      const cards = [...document.querySelectorAll('#card-list > [data-routine-id]')];
      const c = cards[cards.length - 1]; const cs = getComputedStyle(c);
      const olds = cards.slice(0, -1).map((x) => x.getAttribute('data-anim'));
      return { n: cards.length, anim: c.getAttribute('data-anim'), name: cs.animationName, op: parseFloat(cs.opacity), olds };
    });
    if (s.n !== 3) errs.push('카드 수 ' + s.n);
    if (s.anim !== 'enter') errs.push('새 카드 data-anim=' + s.anim);
    if (s.name === 'none') errs.push('animationName none');
    if (!(s.op < 1)) errs.push('첫 표본 opacity=' + s.op);
    if (s.olds.some((a) => a)) errs.push('기존 카드에 data-anim ' + s.olds);
    await sleep(600);
    const e = await page.evaluate(() => { const cs = [...document.querySelectorAll('#card-list > [data-routine-id]')]; const c = cs[cs.length - 1]; return { a: c.getAttribute('data-anim'), op: parseFloat(getComputedStyle(c).opacity), any: document.querySelectorAll('[data-anim]').length }; });
    if (e.a !== null || e.any !== 0) errs.push('600ms 뒤 data-anim 남음 ' + JSON.stringify(e));
    if (e.op !== 1) errs.push('600ms 뒤 opacity=' + e.op);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 3. 팝 =================
  await check('C4 완료 팝: 설정·변경에서 data-anim="pop" 이 생겼다 600ms 안에 사라짐 / 취소에서는 pop 없음', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2, animLog: true });
    const errs = [];
    const click = (lv) => page.evaluate((l) => {
      document.querySelector('[data-routine-id="r_a"] [data-level="' + l + '"]').click();
      return document.querySelector('[data-routine-id="r_a"]').getAttribute('data-anim');
    }, lv);
    const gone = async (label) => {
      await sleep(600);
      const a = await page.evaluate(() => document.querySelector('[data-routine-id="r_a"]').getAttribute('data-anim'));
      if (a !== null) errs.push(label + ' 600ms 뒤에도 data-anim=' + a);
    };
    let a = await click('mini'); if (a !== 'pop') errs.push('설정(mini) 직후 data-anim=' + a); await gone('설정');
    a = await click('more'); if (a !== 'pop') errs.push('변경(more) 직후 data-anim=' + a); await gone('변경');
    await page.evaluate(() => { window.__animLog.length = 0; });
    a = await click('more'); // 취소
    if (a !== null) errs.push('취소 직후 data-anim=' + a);
    await sleep(500);
    const log = await page.evaluate(() => window.__animLog.slice());
    if (log.length) errs.push('취소 뒤 data-anim 이 붙은 적 있음 ' + JSON.stringify(log));
    const st = await getStore(page);
    if (st.logs['2026-10-07']) errs.push('취소 뒤 로그 남음');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('C7 퇴장: btn-confirm-delete 직후 50ms 안 카드가 DOM 에 있으면서 data-leaving="true"(+aria-hidden), 800ms 안 count 0, store 반영, 남은 카드 노드 유지', async () => {
    const { ctx, page } = await open(browser, { seed: SEED3 });
    const errs = [];
    await page.evaluate(() => { document.querySelectorAll('#card-list > [data-routine-id]').forEach((c) => { c.__marker = 1; }); });
    await openConfirm(page, 'r_b');
    const r = await page.evaluate(() => new Promise((res) => {
      document.querySelector('[data-testid="btn-confirm-delete"]').click();
      const t0 = performance.now();
      setTimeout(() => {
        const c = document.querySelector('[data-routine-id="r_b"]');
        const at = { inDom: !!c, leaving: c && c.getAttribute('data-leaving'), aria: c && c.getAttribute('aria-hidden'), ms: Math.round(performance.now() - t0) };
        (function poll() {
          if (!document.querySelector('#card-list [data-routine-id="r_b"]')) return res({ at, gone: Math.round(performance.now() - t0) });
          if (performance.now() - t0 > 2000) return res({ at, gone: null });
          setTimeout(poll, 10);
        })();
      }, 30);
    }));
    if (!r.at.inDom || r.at.leaving !== 'true') errs.push(`${r.at.ms}ms 시점 inDom=${r.at.inDom} data-leaving=${r.at.leaving}`);
    if (r.at.aria !== 'true') errs.push('aria-hidden=' + r.at.aria);
    if (r.gone === null || r.gone > 800) errs.push('DOM 제거 ' + r.gone + 'ms');
    console.log(`   · data-leaving ${r.at.ms}ms 시점 확인, DOM 제거 ${r.gone}ms`);
    const st = await getStore(page);
    if (st.routines.some((x) => x.id === 'r_b')) errs.push('store 에 남음');
    const alive = await page.evaluate(() => [...document.querySelectorAll('#card-list > [data-routine-id]')].map((c) => c.getAttribute('data-routine-id') + ':' + c.__marker));
    if (alive.join() !== 'r_a:1,r_c:1') errs.push('남은 카드/마커 ' + alive);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 6. 움직임 줄이기 =================
  await check('C8 움직임 줄이기(reduce): data-anim 안 붙음(추가·팝), 삭제 100ms 안 DOM 제거, 누름 상태 transform 유지(scale≤0.96)', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2, reduced: true, animLog: true });
    const errs = [];
    const mq = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!mq) errs.push('reduce 가 적용 안 됨');
    // 팝: 눌러도 data-anim 없음
    const a = await page.evaluate(() => { document.querySelector('[data-routine-id="r_a"] [data-level="mini"]').click(); return document.querySelector('[data-routine-id="r_a"]').getAttribute('data-anim'); });
    if (a !== null) errs.push('reduce 팝 data-anim=' + a);
    // 추가: enter 없음
    await page.click(tid('tab-manage'));
    await page.click(tid('btn-add-routine'));
    await page.fill(tid('input-name'), '새 루틴');
    await page.click(tid('btn-save'));
    await page.click(tid('tab-today'));
    await sleep(150);
    const log = await page.evaluate(() => ({ log: window.__animLog.slice(), n: document.querySelectorAll('[data-anim]').length }));
    if (log.log.length || log.n) errs.push('reduce data-anim 붙음 ' + JSON.stringify(log));
    // 누름 유지
    errs.push(...(await pressFeel(page, '.level-btn', '.level-btn(reduce)', { reduced: true })));
    // 삭제 100ms
    await openConfirm(page, 'r_b');
    const r = await page.evaluate(() => new Promise((res) => {
      document.querySelector('[data-testid="btn-confirm-delete"]').click();
      setTimeout(() => res(!!document.querySelector('#card-list [data-routine-id="r_b"]')), 100);
    }));
    if (r) errs.push('reduce 삭제 100ms 뒤에도 카드가 DOM 에 있음');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 7. 스타일시트 검사 =================
  await check('C9 스타일시트: transition 속성은 transform/opacity 뿐(all·box-shadow·width·height·top·left 없음), @keyframes 는 transform/opacity 뿐, 진행 막대 scaleX', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2 });
    const r = await page.evaluate(() => {
      const bad = []; const trans = new Set(); const kf = {}; let fillRule = null;
      const ALLOWED = new Set(['transform', 'opacity']);
      function walk(rules, ctxLabel) {
        for (const rule of rules) {
          if (rule.type === CSSRule.KEYFRAMES_RULE) {
            const props = new Set();
            for (const k of rule.cssRules) for (let i = 0; i < k.style.length; i++) props.add(k.style[i]);
            kf[rule.name] = [...props];
            props.forEach((p) => { if (!ALLOWED.has(p) && !/^animation-/.test(p)) bad.push('@keyframes ' + rule.name + ' 에서 ' + p); });
          } else if (rule.cssRules && rule.type !== CSSRule.STYLE_RULE) walk(rule.cssRules, ctxLabel + ' ' + (rule.conditionText || ''));
          else if (rule.style) {
            const tp = rule.style.getPropertyValue('transition-property');
            if (tp) tp.split(',').map((s) => s.trim()).forEach((p) => { trans.add(p); if (p !== 'none' && !ALLOWED.has(p)) bad.push(rule.selectorText + ' transition-property=' + p); });
            if (/\ball\b/.test(rule.style.getPropertyValue('transition'))) bad.push(rule.selectorText + ' transition: all');
            const will = rule.style.getPropertyValue('will-change'); if (will && /width|height|top|left|box-shadow/.test(will)) bad.push('will-change ' + will);
            if (rule.selectorText && rule.selectorText.split(',').map((s) => s.trim()).includes('.progress-fill')) fillRule = { transform: rule.style.getPropertyValue('transform'), transition: rule.style.getPropertyValue('transition'), width: rule.style.getPropertyValue('width') };
          }
        }
      }
      for (const sh of document.styleSheets) { try { walk(sh.cssRules, ''); } catch (e) { bad.push('시트 못 읽음 ' + e.message); } }
      const fillInline = document.getElementById('progress-fill').style.transform;
      return { bad, trans: [...trans], kf, fillRule, fillInline, fillWidthInline: document.getElementById('progress-fill').style.width };
    });
    const errs = [...r.bad];
    if (!r.fillRule || !/scaleX/.test(r.fillRule.transform)) errs.push('.progress-fill 규칙 transform=' + JSON.stringify(r.fillRule));
    else if (/width/.test(r.fillRule.transition)) errs.push('.progress-fill transition 에 width');
    if (!/scaleX/.test(r.fillInline) || r.fillWidthInline) errs.push('막대 인라인 style transform=' + r.fillInline + ' width=' + r.fillWidthInline);
    console.log('   · transition-property 값: ' + r.trans.join(',') + ' | keyframes: ' + JSON.stringify(r.kf));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= (옛 v2-m1-r2) 탭 전환·누름 수치·부드러움·스타일시트 =================
  // ================= 1. 탭 전환 =================
  await check('T1 탭 전환 MutationObserver: tab-log 클릭 0–300ms 에 today=leave·log=enter 각 ≥1회, 기록 시점 두 화면 모두 hidden 아님, 새 훅(data-switching·data-dir·aria-hidden·animationName)', async () => {
    const out = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const { ctx, page } = await open(browser, { settle: 300, seed: SEED3N, observer: true, viewport });
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
      const { ctx, page } = await open(browser, { settle: 300, seed: SEED3N });
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

  await check('T4 움직임 줄이기 탭 전환: 50ms 에 보이는 화면 1·data-transition/data-bounce/data-switching 0, 관찰기에 해당 속성 변화 기록 없음', async () => {
    const { ctx, page } = await open(browser, { settle: 300, seed: SEED3N, reduced: true, observer: true });
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
    const { ctx, page } = await open(browser, { settle: 300, seed: SEED3N });
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
      const { ctx, page } = await open(browser, { settle: 300, seed: fixtureRaw });
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

  await check('S2 스타일시트: transition-property 는 transform/opacity 뿐(all·box-shadow·width·height·top·left 없음), @keyframes(tab-enter·tab-leave·btn-bounce 포함)는 transform/opacity 뿐, will-change 없음, 진행 막대 scaleX', async () => {
    const { ctx, page } = await open(browser, { settle: 300, seed: SEED3N });
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
});
