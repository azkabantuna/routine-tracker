// 공용 도우미 (기능별 시험 파일이 가져다 씀). 직접 실행하는 파일 아님.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.RT_URL || 'http://localhost:8080/';
export const KEY = 'routineTracker';
export const NOW = '2026-10-07T10:00:00+09:00';
export const results = [];
export const consoleErrors = [];
export const externalRequests = [];
export const hosts = new Set();
export { fs, path };

// ---------- 보고 ----------
export function record(name, ok, reason) {
  results.push({ name, ok, reason });
  console.log(`${ok ? '✅' : '❌'} ${name}${reason ? ' — ' + reason : ''}`);
}
// check(이름, 함수)  : 함수가 true 를 돌려주면 통과, 문자열이면 실패 이유, 예외도 실패.
// check(이름, ok, 자세히): 이미 계산한 참/거짓을 바로 기록.
export async function check(name, fnOrOk, detail) {
  if (typeof fnOrOk !== 'function') return record(name, !!fnOrOk, fnOrOk ? '' : detail || 'false');
  try {
    const r = await fnOrOk();
    if (r === true) record(name, true);
    else record(name, false, typeof r === 'string' ? r : 'false');
  } catch (e) {
    record(name, false, '예외: ' + e.message.split('\n')[0]);
  }
}
export const info = (s) => console.log('ℹ ' + s);
export const note = (s) => console.log('   · ' + s);

// ---------- 작은 도구 ----------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tid = (id) => `[data-testid="${id}"]`;
export const getRaw = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
export const getStore = async (page) => JSON.parse((await getRaw(page)) || 'null');
export const scaleOf = (t) => { if (!t || t === 'none') return 1; const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : NaN; };
export const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
export const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
export const progress = async (page) => {
  const el = page.locator(tid('progress'));
  return { n: Number(await el.getAttribute('data-done-count')), m: Number(await el.getAttribute('data-total')) };
};

// ---------- 시드 ----------
export const fixtureRaw = fs.readFileSync(path.join(HERE, 'fixtures', 'old-seed.json'), 'utf8').trim();
export const R = (id, name, order, emoji) => {
  const o = { id, name, mini: id + '-mini', more: id + '-more', max: id + '-max', createdAt: '2026-10-01', order };
  if (emoji) o.emoji = emoji;
  return o;
};
export const seedOf = (routines) => ({ version: 1, routines, logs: {}, celebratedOn: null });
export const seedN = (n) => seedOf(Array.from({ length: n }, (_, i) => R('r_' + i, '루틴' + (i + 1), i)));
export const SEED2 = seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1)]);
export const SEED3 = seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1), R('r_c', '물', 2)]);
export const SEED_EMO = seedOf([R('r_a', '운동', 0, '🏃'), R('r_b', '독서', 1, '📚'), R('r_c', '물', 2)]);
export const SEED_2 = seedOf([R('r_a', '운동', 0, '🏃'), R('r_b', '독서', 1, '🏃')]);
export const SEED_NOEMO = seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1)]);

// ---------- 새 화면 ----------
// seed: 객체/문자열/null(첫 로드가 저장하지 않도록 "키가 없을 때만" 심음).
// 옵션: reduced·viewport·hasTouch·noSegmenter·observer(탭 전환 관찰)·animLog(data-anim 기록)·
//       now(고정 시각)·goto(false 면 이동 안 함)·settle(이동 뒤 기다릴 ms)·acceptDialogs
export async function open(browser, { seed = null, reduced = false, viewport = { width: 390, height: 844 }, hasTouch = false, noSegmenter = false, observer = false, animLog = false, now = NOW, goto = true, settle = 0, acceptDialogs = false } = {}) {
  const ctx = await browser.newContext({
    viewport, timezoneId: 'Asia/Seoul', locale: 'ko-KR', hasTouch, isMobile: false,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.route('**/*', (route) => {
    const u = new globalThis.URL(route.request().url());
    hosts.add(u.hostname || u.protocol);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  if (acceptDialogs) page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date(now));
  if (noSegmenter) await page.addInitScript(() => { delete Intl.Segmenter; });
  if (animLog) {
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
  }
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
            hiddenLog: document.getElementById('screen-calendar')?.hidden,
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
  if (goto) await page.goto(BASE);
  if (settle) await sleep(settle);
  return { ctx, page };
}

// ---------- 화면 조작 도우미 ----------
// 오늘 탭으로 가서 '+ 루틴 추가'(카드 목록 아래) 누르기
export async function goToday(page) {
  if ((await page.locator(tid('tab-today')).getAttribute('aria-selected')) !== 'true') {
    await page.click(tid('tab-today'));
    await sleep(350);
  }
}
// 오늘 탭 카드를 길게 눌러(마우스 600ms) card-menu 열기. id 없으면 첫 카드
export async function openCardMenu(page, id) {
  await goToday(page);
  const card = id ? page.locator(`${tid('routine-card')}[data-routine-id="${id}"]`) : page.locator(tid('routine-card')).first();
  const box = await card.locator('.card-name').boundingBox();
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(650);
  await page.mouse.up();
  await page.locator(tid('card-menu')).waitFor({ state: 'visible' });
  return card;
}
// 진짜 터치(CDP)로 locator 한 점을 ms 동안 누르기. 누른 자리는 left px 안쪽
export async function touchHold(page, locator, ms = 650, dx = 6) {
  const box = await locator.boundingBox();
  const x = box.x + dx, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
// 터치로 카드 길게 눌러 card-menu 열기
export async function openCardMenuTouch(page, id) {
  await goToday(page);
  const card = id ? page.locator(`${tid('routine-card')}[data-routine-id="${id}"]`) : page.locator(tid('routine-card')).first();
  await touchHold(page, card.locator('.card-name'), 650);
  await page.locator(tid('card-menu')).waitFor({ state: 'visible' });
  return card;
}
export async function editRoutineVia(page, id) {
  await openCardMenu(page, id);
  await page.locator(tid('btn-card-edit')).click();
}
export async function addRoutine(page, { name, mini = '', more = '', max = '' }) {
  await goToday(page);
  await page.click(tid('btn-add-routine'));
  await page.fill(tid('input-name'), name);
  await page.fill(tid('input-mini'), mini);
  await page.fill(tid('input-more'), more);
  await page.fill(tid('input-max'), max);
  await page.click(tid('btn-save'));
  await page.click(tid('tab-today'));
}
// 오늘 화면이 숨겨진 채(다른 탭)로 시트만 열기: 숨은 화면에 카드가 생기는 경우를 시험할 때
export async function openAddSheetHidden(page) {
  await page.evaluate(() => window.RT.sheets.openSheet(null));
  await page.locator(tid('sheet')).waitFor({ state: 'visible' });
}
export async function openAddSheet(page) {
  await goToday(page);
  await page.locator(tid('btn-add-routine')).click();
  await page.locator(tid('sheet')).waitFor({ state: 'visible' });
}
export async function submitSheet(page, name, emoji) {
  await page.locator(tid('input-name')).fill(name);
  await page.locator(tid('input-emoji')).fill(emoji);
  await page.locator(tid('btn-save')).click();
  await sleep(120);
  return page.evaluate(() => ({
    err: !document.querySelector('[data-testid="error-emoji"]').hidden && getComputedStyle(document.querySelector('[data-testid="error-emoji"]')).display !== 'none',
    sheet: !document.querySelector('[data-testid="sheet"]').hidden && getComputedStyle(document.querySelector('[data-testid="sheet"]')).display !== 'none',
  }));
}
export async function openConfirm(page, id) {
  await openCardMenu(page, id);
  await page.locator(tid('btn-card-delete')).click();
}
export const countNow = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('.celebrate')];
  const c = all[all.length - 1];
  if (!c) return { present: false };
  return { present: true, level: c.getAttribute('data-level'), confetti: c.querySelectorAll('.confetti').length, emoji: c.querySelectorAll('.emoji-particle').length, count: c.getAttribute('data-count'), burst: c.getAttribute('data-burst'), rain: c.getAttribute('data-rain') };
});

// ---------- 실행 틀: 브라우저 열기 → 시험 → 공통 점검(콘솔·외부 요청) → 결과·종료 코드 ----------
export async function run(fn) {
  const browser = await chromium.launch();
  try {
    await fn(browser);
  } catch (e) {
    record('시험 진행 중 예외(남은 시험 건너뜀)', false, String(e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
  record('콘솔 오류 0개 (console error + pageerror, 이 파일의 모든 시험 합산)', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  record('외부 요청 0개 (localhost 만)', externalRequests.length === 0, externalRequests.join(', '));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('실패:\n' + failed.map((f) => `  ❌ ${f.name} — ${f.reason}`).join('\n'));
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}
