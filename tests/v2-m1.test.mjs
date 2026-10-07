// routine-tracker v2 · M1(부드러운 움직임) R1 자동 시험 (검토봇 C)
// 실행: 레포 루트에서  node projects/routine-tracker/tests/v2-m1.test.mjs
// 먼저 서버: cd projects/routine-tracker && python3 -m http.server 8080
// 범위(R1): 누름감, 카드 등장·팝, 퇴장·제자리 갱신·확인창, 움직임 줄이기(탭 전환 제외),
//           스타일시트 검사, 회귀(옛 데이터 보존·깨진 데이터·콘솔·외부 요청).
// R2 로 미룸: 탭 전환(data-transition), rAF 부드러움 수치(CPU 4배), 360x640.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;
const getRaw = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const getStore = async (page) => JSON.parse((await getRaw(page)) || 'null');

// ---------- 시드 ----------
const R = (id, name, order) => ({ id, name, mini: id + '-mini', more: id + '-more', max: id + '-max', createdAt: '2026-10-01', order });
const SEED3 = { version: 1, routines: [R('r_a', '운동', 0), R('r_b', '독서', 1), R('r_c', '물', 2)], logs: {}, celebratedOn: null };
const SEED2 = { version: 1, routines: [R('r_a', '운동', 0), R('r_b', '독서', 1)], logs: {}, celebratedOn: null };

// 새 화면. seed: 객체/문자열/null. 첫 로드가 저장하지 않도록 addInitScript 로 "키가 없을 때만" 심는다.
async function open(browser, { seed = null, reduced = false, viewport = { width: 390, height: 844 } } = {}) {
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
  await page.addInitScript(() => {
    window.__animLog = [];
    const note = (el, how) => { if (el && el.getAttribute) window.__animLog.push(how + ':' + el.getAttribute('data-anim')); };
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'attributes') { if (m.target.hasAttribute('data-anim')) note(m.target, 'attr'); }
        else m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.hasAttribute('data-anim')) note(n, 'added'); });
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-anim'] });
  });
  if (seed !== null) {
    const raw = typeof seed === 'string' ? seed : JSON.stringify(seed);
    await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, raw]);
  }
  await page.goto(URL);
  return { ctx, page };
}

const scaleOf = (t) => { if (!t || t === 'none') return 1; const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : NaN; };
const cardIds = (page) => page.evaluate(() => [...document.querySelectorAll('#card-list > [data-routine-id]')].map((c) => c.getAttribute('data-routine-id')));

const browser = await chromium.launch();
try {
  // ================= 1. 버튼 누름감 =================
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
    const { ctx, page } = await open(browser, { seed: SEED2 });
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
    const { ctx, page } = await open(browser, { seed: SEED2 });
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

  // ================= 4. 제자리 갱신 =================
  await check('C5 제자리 갱신: 강도 누름·이름 수정·취소 뒤에도 다른 카드 __marker 유지, aria-pressed·data-current·aria-label·이름·순서·진행 막대 일치', async () => {
    const { ctx, page } = await open(browser, { seed: SEED3 });
    const errs = [];
    await page.evaluate(() => { document.querySelectorAll('#card-list > [data-routine-id]').forEach((c) => { c.__marker = c.getAttribute('data-routine-id'); }); });
    const verify = async (label) => {
      const s = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#card-list > [data-routine-id]')];
        const st = JSON.parse(localStorage.getItem('routineTracker'));
        const log = st.logs['2026-10-07'] || {};
        const routines = st.routines.slice().sort((a, b) => a.order - b.order);
        const out = { order: cards.map((c) => c.getAttribute('data-routine-id')), want: routines.map((r) => r.id), markers: cards.map((c) => c.__marker), bad: [] };
        cards.forEach((c) => {
          const id = c.getAttribute('data-routine-id'); const r = routines.find((x) => x.id === id); const lv = log[id] || null;
          if ((c.getAttribute('data-current') || null) !== lv) out.bad.push(id + ' data-current');
          if (c.getAttribute('data-done') !== String(!!lv)) out.bad.push(id + ' data-done');
          if (c.querySelector('.card-name').textContent !== r.name) out.bad.push(id + ' 이름');
          ['mini', 'more', 'max'].forEach((l) => {
            const b = c.querySelector('[data-level="' + l + '"]');
            if (b.getAttribute('aria-pressed') !== String(lv === l)) out.bad.push(id + ' aria-pressed ' + l);
            if (!b.getAttribute('aria-label').startsWith(r.name + ' ' + l)) out.bad.push(id + ' aria-label ' + l + '=' + b.getAttribute('aria-label'));
            if (c.querySelector('[data-level="' + l + '"] + .level-crit').textContent !== r[l]) out.bad.push(id + ' 기준 ' + l);
          });
        });
        const done = Object.keys(log).filter((id) => routines.some((r) => r.id === id)).length;
        const prog = document.querySelector('[data-testid="progress"]');
        if (prog.getAttribute('data-done-count') !== String(done)) out.bad.push('progress 개수');
        const tf = document.getElementById('progress-fill').style.transform;
        const pct = Math.round((done / routines.length) * 100) / 100;
        if (tf !== 'scaleX(' + pct + ')') out.bad.push('막대 ' + tf + ' != scaleX(' + pct + ')');
        return out;
      });
      if (s.order.join() !== s.want.join()) errs.push(label + ' 순서 ' + s.order + ' != ' + s.want);
      if (s.markers.join() !== s.order.join()) errs.push(label + ' __marker 사라짐 ' + JSON.stringify(s.markers));
      if (s.bad.length) errs.push(label + ' 불일치: ' + s.bad.slice(0, 4).join(', '));
    };
    await page.click('[data-routine-id="r_a"] [data-level="mini"]'); await verify('A mini');
    await page.click('[data-routine-id="r_b"] [data-level="max"]'); await verify('B max');
    await page.click('[data-routine-id="r_a"] [data-level="max"]'); await verify('A 변경');
    await page.click('[data-routine-id="r_a"] [data-level="max"]'); await verify('A 취소');
    // 이름·기준 수정 (관리 탭 → 시트 → 오늘)
    await page.click(tid('tab-manage'));
    await page.locator(`${tid('manage-item')}[data-routine-id="r_b"] ${tid('btn-edit')}`).click();
    await page.fill(tid('input-name'), '책 읽기');
    await page.fill(tid('input-more'), '20쪽');
    await page.click(tid('btn-save'));
    await page.click(tid('tab-today'));
    await verify('이름 수정');
    const nm = await page.locator('[data-routine-id="r_b"] .card-name').innerText();
    if (nm.trim() !== '책 읽기') errs.push('수정 이름 ' + nm);
    await sleep(100);
    // 포커스·visibilitychange 로 다시 그려도 제자리 갱신
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await verify('focus/visibility');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ================= 5. 확인창 =================
  async function openConfirm(page, id) {
    await page.click(tid('tab-manage'));
    await page.locator(`${tid('manage-item')}[data-routine-id="${id}"] ${tid('btn-delete')}`).click();
  }
  await check('C6 확인창: role=dialog·aria-modal·문구·취소 포커스 / 취소·Escape·배경 누르기=삭제 안 됨 / window.confirm 안 씀', async () => {
    const { ctx, page } = await open(browser, { seed: SEED2 });
    const errs = [];
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await openConfirm(page, 'r_a');
    const sheet = page.locator(tid('confirm-sheet'));
    if (!(await sheet.isVisible())) errs.push('확인창 안 보임');
    if ((await sheet.getAttribute('role')) !== 'dialog') errs.push('role');
    if ((await sheet.getAttribute('aria-modal')) !== 'true') errs.push('aria-modal');
    const txt = await page.locator(tid('confirm-text')).innerText();
    if (!txt.includes('"운동" 루틴을 삭제할까요?') || !txt.includes('지난 기록도 함께 지워져요')) errs.push('문구: ' + txt);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    if (focused !== 'btn-cancel-delete') errs.push('열릴 때 포커스=' + focused);
    const stillThere = async (label) => {
      const st = await getStore(page);
      const n = await page.locator(`${tid('routine-card')}[data-routine-id="r_a"]`).count();
      if (!st.routines.some((r) => r.id === 'r_a') || n !== 1) errs.push(label + ' 뒤 삭제됨(store=' + st.routines.length + ', 카드=' + n + ')');
      if (!(await sheet.isHidden())) errs.push(label + ' 뒤 확인창 안 닫힘');
    };
    await page.click(tid('btn-cancel-delete')); await stillThere('취소 버튼');
    await openConfirm(page, 'r_a'); await page.keyboard.press('Escape'); await stillThere('Escape');
    await openConfirm(page, 'r_a'); await page.mouse.click(195, 20); await stillThere('배경 누르기');
    // 취소 뒤 다시 열면 문구가 다른 루틴으로 바뀌어도 이름이 맞음
    await openConfirm(page, 'r_b');
    const t2 = await page.locator(tid('confirm-text')).innerText();
    if (!t2.includes('"독서"')) errs.push('두 번째 문구 ' + t2);
    await page.click(tid('btn-cancel-delete'));
    if (dialogs) errs.push('window.confirm 대화상자가 ' + dialogs + '번 열림');
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
    const { ctx, page } = await open(browser, { seed: SEED2, reduced: true });
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

  // ================= 8. 회귀 =================
  const fixtureRaw = fs.readFileSync(path.join(HERE, 'fixtures', 'old-seed.json'), 'utf8').trim();
  await check('C10 옛 데이터 고정값: old-seed.json 은 20일·루틴 3개이고 계획의 XP 규칙으로 계산하면 XP 320·Lv7·단계 4·70/80·88%·20일', async () => {
    const f = JSON.parse(fixtureRaw);
    const errs = [];
    const days = Object.keys(f.logs).sort();
    if (days.length !== 20 || days[0] !== '2026-09-17' || days[19] !== '2026-10-06') errs.push('날짜 ' + days.length + ' ' + days[0] + '~' + days[days.length - 1]);
    if (f.routines.length !== 3 || f.routines.some((r) => 'emoji' in r)) errs.push('루틴');
    if (f.celebratedOn !== '2026-10-06' || f.version !== 1) errs.push('celebratedOn/version');
    const XP = { mini: 3, more: 5, max: 8 }; const ids = new Set(f.routines.map((r) => r.id));
    let xp = 0, nd = 0; const cnt = { mini: 0, more: 0, max: 0 };
    for (const d of Object.values(f.logs)) { let any = false; for (const [id, lv] of Object.entries(d)) if (ids.has(id)) { xp += XP[lv]; cnt[lv]++; any = true; } if (any) nd++; }
    const starts = [0, 15, 40, 75, 120, 180, 250, 330, 420, 520]; let L = 1; while (L < 10 && xp >= starts[L]) L++;
    const into = xp - starts[L - 1], need = starts[L] - starts[L - 1];
    const stage = L <= 2 ? 1 : L <= 4 ? 2 : L <= 6 ? 3 : L <= 8 ? 4 : 5;
    const got = { xp, L, stage, into, need, pct: Math.round((into / need) * 100), nd, ...cnt };
    const want = { xp: 320, L: 7, stage: 4, into: 70, need: 80, pct: 88, nd: 20, mini: 20, more: 20, max: 20 };
    for (const k of Object.keys(want)) if (got[k] !== want[k]) errs.push(`${k}: ${got[k]} != ${want[k]}`);
    return errs.length ? errs.join('; ') : true;
  });

  await check('C11 옛 데이터 보존: 시드로 열기만 해도 localStorage 문자열 그대로(reload 후도), 루틴 3개·backup 키 없음·banner-error 안 보임, 오늘 mini 눌러도 과거 기록 불변', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    const errs = [];
    const chk = async (label) => {
      const raw = await getRaw(page);
      if (raw !== fixtureRaw) errs.push(label + ' localStorage 문자열이 시드와 다름');
      if ((await page.evaluate(() => localStorage.getItem('routineTracker.backup'))) !== null) errs.push(label + ' backup 키 있음');
      if (await page.locator(tid('banner-error')).isVisible()) errs.push(label + ' banner-error 보임');
      const n = await page.locator(tid('routine-card')).count();
      if (n !== 3) errs.push(label + ' 카드 ' + n);
      const a = await page.evaluate(() => document.querySelectorAll('[data-anim]').length);
      if (a) errs.push(label + ' data-anim ' + a);
    };
    await sleep(400); await chk('로드');
    await page.reload(); await sleep(400); await chk('reload');
    const seed = JSON.parse(fixtureRaw);
    await page.click('[data-routine-id="r_old_a"] [data-level="mini"]');
    const st = await getStore(page);
    const today = st.logs['2026-10-07'];
    delete st.logs['2026-10-07'];
    if (JSON.stringify(st.logs) !== JSON.stringify(seed.logs)) errs.push('과거 logs 가 바뀜');
    if (!today || today.r_old_a !== 'mini') errs.push('오늘 기록 안 됨');
    if (JSON.stringify(st.routines) !== JSON.stringify(seed.routines)) errs.push('routines 바뀜');
    if (st.celebratedOn !== '2026-10-06' || st.version !== 1) errs.push('celebratedOn/version 바뀜');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  for (const [label, raw, kind] of [
    ['깨진 글자', '{broken', 'corrupt'],
    ['version:2', '{"version":2,"routines":[{"id":"r_x","name":"x"}],"logs":{}}', 'v2'],
  ]) {
    await check(`C12 저장 데이터 ${label} → routineTracker.backup 에 원본 보관 + banner-error + 빈 상태, 움직임 코드 오류 없음`, async () => {
      const { ctx, page } = await open(browser, { seed: raw });
      const errs = [];
      if (!(await page.locator(tid('banner-error')).isVisible())) errs.push('banner-error 안 보임');
      const bk = await page.evaluate(() => localStorage.getItem('routineTracker.backup'));
      if (bk !== raw) errs.push('backup=' + bk);
      if (!(await page.locator(tid('empty-state')).isVisible())) errs.push('빈 상태 아님');
      if ((await page.locator(tid('routine-card')).count()) !== 0) errs.push('카드 있음');
      await page.click(tid('tab-manage')); await page.click(tid('btn-add-routine'));
      await page.fill(tid('input-name'), '복구'); await page.click(tid('btn-save')); await page.click(tid('tab-today'));
      if ((await page.locator(tid('routine-card')).count()) !== 1) errs.push('복구 뒤 추가 실패');
      await ctx.close();
      return errs.length ? errs.join('; ') : true;
    });
  }

  record('C13 콘솔 오류 0개 (console error + pageerror, 모든 시험 합산)', consoleErrors.length === 0, consoleErrors.join(' | '));
  record('C14 외부 요청 0개 (localhost 만)', externalRequests.length === 0, externalRequests.join(' | '));
  console.log('\nR2 로 미룬 기준(이 파일에서 시험하지 않음): 탭 전환(data-transition·연타·scrollWidth 390/360), 탭 전환 reduce 50ms, 부드러움 rAF 수치(CPU 4배·기준선 16.7ms), 360x640 회귀');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
