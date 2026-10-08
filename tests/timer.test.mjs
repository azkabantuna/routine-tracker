// 타이머 탭 시험 (timer.js · timer.css · index.html · app.js)
// 실행(레포 루트에서): node projects/routine-tracker/tests/timer.test.mjs   (서버는 run.mjs 가 켜 준다)
// 원칙: 시간은 page.clock(install→pauseAt→runFor/setSystemTime)으로만 흐른다. 기대값은 계획 숫자 그대로.
// 모든 검사는 틀리면 실패해야 한다(대조 포함). 리스너(pageerror·console)는 goto 전에 붙는다.
import { fs, path, HERE, run, check, sleep, tid, fixtureRaw, BASE, KEY, NOW, consoleErrors, externalRequests, hosts } from './_lib.mjs';

const T_KEY = 'routineTimer';
const C = 2 * Math.PI * 45; // 둘레 (반지름 45)
const TABS = ['tab-today', 'tab-calendar', 'tab-manage', 'tab-timer'];

// 가짜 시계로 연다: install → goto → 그 시각에서 멈춤. 시간은 runFor/setSystemTime 으로만 흐른다.
async function openT(browser, { seed = fixtureRaw, hasTouch = false, init = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR', hasTouch, isMobile: false,
    reducedMotion: 'no-preference',
  });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    hosts.add(u.hostname || u.protocol);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.clock.install({ time: new Date(NOW) });
  if (init) await page.addInitScript(init);
  if (seed !== null) await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, seed]);
  await page.goto(BASE);
  const now0 = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now0 + 1000);
  return { ctx, page };
}

const tab = (page, id) => page.click(tid(id));
const runFor = (page, ms) => page.clock.runFor(ms);
const nowMs = (page) => page.evaluate(() => Date.now());
const stateOf = (page) => page.locator('#screen-timer').getAttribute('data-timer-state');
const coverState = (page) => page.locator(tid('timer-cover')).getAttribute('data-timer-state');
const val = (page, id) => page.locator(tid(id)).innerText().then((s) => s.trim());
const ctxt = (page, id) => page.locator(tid(id)).evaluate((el) => (el.textContent || '').trim());
const ring = (page, id) => page.locator(tid(id)).evaluate((el) => ({
  ratio: parseFloat(el.getAttribute('data-timer-ratio')),
  left: Number(el.getAttribute('data-timer-left')),
  off: parseFloat(el.getAttribute('stroke-dashoffset')),
}));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), T_KEY);
const minVal = (page) => page.locator(tid('timer-min')).inputValue();
const minDis = (page) => page.locator(tid('timer-min')).isDisabled();
const vis = (page, id) => page.locator(tid(id)).isVisible();
const fillMin = (page, v) => page.fill(tid('timer-min'), v);

await run(async (browser) => {
  // ===== 흐름 1: 기본값·입력·저장·새로고침·잘못된 입력 =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');

    await check('2. 첫 로드 기본: "25:00"·분 25·ratio 1.000·left 1500·idle(시작 보임, 일시정지·전체화면 숨김)', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '25:00') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await minVal(page)) !== '25') errs.push('분 ' + (await minVal(page)));
      const r = await ring(page, 'timer-ring');
      if (r.ratio !== 1) errs.push('ratio ' + r.ratio);
      if (r.left !== 1500) errs.push('left ' + r.left);
      if ((await stateOf(page)) !== 'idle') errs.push('state ' + (await stateOf(page)));
      if (!(await vis(page, 'timer-start'))) errs.push('시작 안 보임');
      if (await vis(page, 'timer-pause')) errs.push('일시정지 보임(idle)');
      if (await vis(page, 'timer-fs')) errs.push('전체화면 보임(idle)');
      return errs.length ? errs.join('; ') : true;
    });

    await check('3. 분 40 입력 → "40:00"·저장 {"minutes":40}·새로고침 후 분 40 유지', async () => {
      const errs = [];
      await fillMin(page, '40');
      if ((await val(page, 'timer-time')) !== '40:00') errs.push('입력 후 글자 ' + (await val(page, 'timer-time')));
      if ((await stored(page)) !== '{"minutes":40}') errs.push('저장 ' + (await stored(page)));
      await page.reload();
      await tab(page, 'tab-timer');
      if ((await minVal(page)) !== '40') errs.push('새로고침 후 분 ' + (await minVal(page)));
      if ((await val(page, 'timer-time')) !== '40:00') errs.push('새로고침 후 글자 ' + (await val(page, 'timer-time')));
      if ((await stored(page)) !== '{"minutes":40}') errs.push('새로고침 후 저장 ' + (await stored(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await check('4. 잘못된 분(0·181·"abc"·1.5·빈칸) → 에러 보임·글자 "40:00"·저장 40 그대로, 떠날 때 40 으로 복원', async () => {
      const errs = [];
      for (const bad of ['0', '181', 'abc', '1.5', '']) {
        await fillMin(page, bad);
        if (!(await vis(page, 'timer-min-error'))) errs.push(`"${bad}" 에러 안 보임`);
        if ((await val(page, 'timer-time')) !== '40:00') errs.push(`"${bad}" 글자 바뀜`);
        if ((await stored(page)) !== '{"minutes":40}') errs.push(`"${bad}" 저장 바뀜`);
      }
      await page.press(tid('timer-min'), 'Tab');
      if ((await minVal(page)) !== '40') errs.push('떠난 뒤 값 ' + (await minVal(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await check('5. 1·180 은 허용: "1:00"→"180:00"·저장 1→180·에러 숨김', async () => {
      const errs = [];
      await fillMin(page, '1');
      if (await vis(page, 'timer-min-error')) errs.push('1 인데 에러 보임');
      if ((await val(page, 'timer-time')) !== '1:00') errs.push('1 글자 ' + (await val(page, 'timer-time')));
      if ((await stored(page)) !== '{"minutes":1}') errs.push('1 저장 ' + (await stored(page)));
      await fillMin(page, '180');
      if (await vis(page, 'timer-min-error')) errs.push('180 인데 에러 보임');
      if ((await val(page, 'timer-time')) !== '180:00') errs.push('180 글자 ' + (await val(page, 'timer-time')));
      if ((await stored(page)) !== '{"minutes":180}') errs.push('180 저장 ' + (await stored(page)));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 2: 1분 시계 — 30초·점프·일시정지·이어서·끝·초기화 =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');

    await check('6a. 시작 전(idle) 분 입력 가능', async () => ((await minDis(page)) === false ? true : '시작 전인데 분 입력 disabled'));

    await page.click(tid('timer-start'));
    await check('6b. 달리는 중: 분 입력 disabled·시작 버튼 숨김·일시정지 보임·state running', async () => {
      const errs = [];
      if ((await minDis(page)) !== true) errs.push('분 입력 disabled 아님');
      if (await vis(page, 'timer-start')) errs.push('시작 보임(running)');
      if (!(await vis(page, 'timer-pause'))) errs.push('일시정지 안 보임');
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await runFor(page, 30000);
    await check('7. 1분 설정 후 시작, 30초 뒤 "0:30"·left 30·ratio 0.500±0.02·링 dashoffset = 둘레×0.5 ±1', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:30') errs.push('글자 ' + (await val(page, 'timer-time')));
      const r = await ring(page, 'timer-ring');
      if (r.left !== 30) errs.push('left ' + r.left);
      if (!(Math.abs(r.ratio - 0.5) <= 0.02)) errs.push('ratio ' + r.ratio);
      if (!(Math.abs(r.off - C * 0.5) <= 1)) errs.push('offset ' + r.off + ' (기대 ' + (C * 0.5).toFixed(2) + ')');
      return errs.length ? errs.join('; ') : true;
    });

    const t1 = await nowMs(page);
    await page.clock.setSystemTime(t1 + 20000); // 시각만 20초 점프 (타이머는 안 돎)
    await runFor(page, 300);
    await check('8. 시각만 20초 점프(setSystemTime) → "0:10"·left 10 (1초씩 세는 구현이면 "0:29" 로 실패)', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:10') errs.push('글자 ' + (await val(page, 'timer-time')));
      const r = await ring(page, 'timer-ring');
      if (r.left !== 10) errs.push('left ' + r.left);
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-pause'));
    await runFor(page, 20000);
    await check('9a. 일시정지 중 20초 흘러도 "0:10"·state paused·분 입력 disabled·버튼 "이어서"', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:10') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'paused') errs.push('state ' + (await stateOf(page)));
      if ((await minDis(page)) !== true) errs.push('분 입력 disabled 아님(paused)');
      if (!(await vis(page, 'timer-start'))) errs.push('이어서 버튼 안 보임');
      if ((await ctxt(page, 'timer-start')) !== '이어서') errs.push('버튼 글자 ' + (await ctxt(page, 'timer-start')));
      if (!(await vis(page, 'timer-fs'))) errs.push('전체화면 안 보임(paused)');
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-start')); // 이어서
    await runFor(page, 5000);
    await check('9b. 이어서 → 5초 뒤 "0:05"·running (멈춘 시간부터 이어짐)', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:05') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await runFor(page, 6000);
    await check('9c. 끝 → "0:00"·state done·ratio 0.000·"끝" 보임·전체화면 숨김·버튼 "다시 시작"·분 입력 가능', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:00') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'done') errs.push('state ' + (await stateOf(page)));
      const r = await ring(page, 'timer-ring');
      if (r.ratio !== 0) errs.push('ratio ' + r.ratio);
      if (!(await vis(page, 'timer-done'))) errs.push('끝 문구 안 보임');
      if (await vis(page, 'timer-fs')) errs.push('전체화면 보임(done)');
      if ((await ctxt(page, 'timer-start')) !== '다시 시작') errs.push('버튼 ' + (await ctxt(page, 'timer-start')));
      if ((await minDis(page)) !== false) errs.push('끝난 뒤 분 입력 disabled');
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-reset'));
    await check('10. 초기화 → 설정값 "1:00"·idle·ratio 1.000·left 60·분 1·버튼 "시작"', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '1:00') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'idle') errs.push('state ' + (await stateOf(page)));
      const r = await ring(page, 'timer-ring');
      if (r.ratio !== 1) errs.push('ratio ' + r.ratio);
      if (r.left !== 60) errs.push('left ' + r.left);
      if ((await minVal(page)) !== '1') errs.push('분 ' + (await minVal(page)));
      if ((await ctxt(page, 'timer-start')) !== '시작') errs.push('버튼 ' + (await ctxt(page, 'timer-start')));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 3: 전체화면 버튼 표시 · 검은 덮개(마우스) =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');

    await check('11. 전체화면 버튼: idle 숨김 → running 보임(글자 0·aria-label·svg) → paused 보임 → 초기화 후 숨김 → 끝난 뒤 숨김', async () => {
      const errs = [];
      const fsBtn = page.locator(tid('timer-fs'));
      if (await fsBtn.isVisible()) errs.push('idle 에서 보임');
      await page.click(tid('timer-start'));
      if (!(await fsBtn.isVisible())) errs.push('running 에서 안 보임');
      else {
        const inner = await fsBtn.innerText();
        if (inner.trim() !== '') errs.push('글자 "' + inner + '"');
        if (!(await fsBtn.getAttribute('aria-label'))) errs.push('aria-label 없음');
        if ((await fsBtn.locator('svg').count()) < 1) errs.push('svg 아이콘 없음');
      }
      await page.click(tid('timer-pause'));
      if (!(await fsBtn.isVisible())) errs.push('paused 에서 안 보임');
      await page.click(tid('timer-reset'));
      if (await fsBtn.isVisible()) errs.push('초기화 후 보임');
      await page.click(tid('timer-start'));
      await runFor(page, 60000);
      if (await fsBtn.isVisible()) errs.push('끝난 뒤(done) 보임');
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-reset'));
    await page.click(tid('timer-start'));
    await runFor(page, 10000); // "0:50"
    await page.click(tid('timer-fs'));
    await check('12. 덮개(마우스): 뷰포트 전체·배경 rgb(0,0,0)·탭바 가운데가 덮개 안·직계 자식 ring·time·close 뿐·글자 "0:50" 만', async () => {
      const errs = [];
      if (!(await vis(page, 'timer-cover'))) return '덮개 안 열림';
      const info = await page.evaluate(() => {
        const cover = document.getElementById('timer-cover');
        const r = cover.getBoundingClientRect();
        const bar = document.querySelector('nav.tabbar').getBoundingClientRect();
        const hit = document.elementFromPoint(innerWidth / 2, bar.top + bar.height / 2);
        return {
          vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height,
          bg: getComputedStyle(cover).backgroundColor,
          hitInCover: !!(hit && hit.closest('[data-testid="timer-cover"]')),
          kids: [...cover.children].map((c) => c.getAttribute('data-testid')).sort(),
          text: cover.innerText.trim(),
        };
      });
      if (Math.abs(info.x) > 1 || Math.abs(info.y) > 1) errs.push(`덮개 위치 ${info.x},${info.y}`);
      if (Math.abs(info.w - info.vw) > 1 || Math.abs(info.h - info.vh) > 1) errs.push(`덮개 크기 ${info.w}x${info.h} (뷰포트 ${info.vw}x${info.vh})`);
      if (info.bg !== 'rgb(0, 0, 0)') errs.push('배경 ' + info.bg);
      if (!info.hitInCover) errs.push('탭바 가운데가 덮개 밖(탭바가 위)');
      const want = ['timer-cover-close', 'timer-cover-ring', 'timer-cover-time'];
      if (JSON.stringify(info.kids) !== JSON.stringify(want)) errs.push('직계 자식 ' + info.kids.join(','));
      if (info.text !== '0:50') errs.push('덮개 글자 "' + info.text + '"');
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-cover-close'));
    await runFor(page, 5000);
    await check('13. 덮개 닫기 → 덮개 숨김·running 유지·5초 뒤 "0:45"', async () => {
      const errs = [];
      if (await vis(page, 'timer-cover')) errs.push('덮개 아직 보임');
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      if ((await val(page, 'timer-time')) !== '0:45') errs.push('글자 ' + (await val(page, 'timer-time')));
      return errs.length ? errs.join('; ') : true;
    });

    await page.click(tid('timer-fs'));
    await runFor(page, 50000);
    await check('14. 덮개 중 0:00 → 덮개 "0:00"·덮개 data-timer-state=done·ring ratio 0·"끝"(::after) 보임', async () => {
      const errs = [];
      if (!(await vis(page, 'timer-cover'))) errs.push('덮개 안 보임');
      if ((await ctxt(page, 'timer-cover-time')) !== '0:00') errs.push('덮개 글자 ' + (await ctxt(page, 'timer-cover-time')));
      if ((await coverState(page)) !== 'done') errs.push('덮개 state ' + (await coverState(page)));
      const r = await ring(page, 'timer-cover-ring');
      if (r.ratio !== 0) errs.push('덮개 ratio ' + r.ratio);
      const after = await page.evaluate(() => getComputedStyle(document.getElementById('timer-cover'), '::after').content);
      if (!after.includes('끝')) errs.push('::after ' + after);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 4: 탭 왕복·숨김 복귀·글자 갱신 횟수 =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));

    await tab(page, 'tab-calendar');
    await runFor(page, 10000);
    await tab(page, 'tab-timer');
    await check('15. 캘린더 갔다 옴(10초): "0:50"·running 계속 줄어듦', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:50') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await tab(page, 'tab-today'); await runFor(page, 3000);
    await tab(page, 'tab-manage'); await runFor(page, 3000);
    await tab(page, 'tab-calendar'); await runFor(page, 4000);
    await tab(page, 'tab-timer');
    await check('16. 오늘·관리·캘린더 돌며 10초 흘러도 "0:40"·running', async () => {
      const errs = [];
      if ((await val(page, 'timer-time')) !== '0:40') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      return errs.length ? errs.join('; ') : true;
    });

    await page.evaluate(() => {
      window.__tm = 0;
      new MutationObserver((ms) => { window.__tm += ms.length; })
        .observe(document.querySelector('[data-testid="timer-time"]'), { childList: true, characterData: true, subtree: true });
    });
    await runFor(page, 1000);
    await check('17a. 1초 동안 글자 "0:39"로 바뀌고 변경은 1회 이하(MutationObserver)', async () => {
      const n = await page.evaluate(() => window.__tm);
      const txt = await val(page, 'timer-time');
      if (txt !== '0:39') return '글자 ' + txt;
      if (n > 1) return '1초 동안 DOM 변경 ' + n + '회';
      return true;
    });

    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const t2 = await nowMs(page);
    await page.clock.setSystemTime(t2 + 20000); // 숨은 동안 시각만 20초 지남
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
    const shown = await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      return document.querySelector('[data-testid="timer-time"]').textContent.trim();
    });
    await check('17b. 숨김 뒤 visible 복귀 즉시 다시 계산: 20초 지났으면 "0:19" (복귀 시 갱신 없으면 "0:39" 로 실패)', () => (shown === '0:19' ? true : '복귀 직후 글자 ' + shown));
    await ctx.close();
  }

  // ===== 흐름 5: 진짜 터치(hasTouch + tap) =====
  {
    const { ctx, page } = await openT(browser, { hasTouch: true });
    await page.tap(tid('tab-timer'));
    await page.tap(tid('timer-start'));
    await runFor(page, 3000); // 25:00 → 24:57
    await page.tap(tid('timer-fs'));
    await check('18. 진짜 터치로 덮개 열기: 뷰포트 전체·배경 rgb(0,0,0)·탭바 가운데가 덮개 안·자식 ring·time·close 뿐·글자 "24:57"', async () => {
      const errs = [];
      if (!(await vis(page, 'timer-cover'))) return '덮개 안 열림';
      const info = await page.evaluate(() => {
        const cover = document.getElementById('timer-cover');
        const r = cover.getBoundingClientRect();
        const bar = document.querySelector('nav.tabbar').getBoundingClientRect();
        const hit = document.elementFromPoint(innerWidth / 2, bar.top + bar.height / 2);
        return {
          vw: innerWidth, vh: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height,
          bg: getComputedStyle(cover).backgroundColor,
          hitInCover: !!(hit && hit.closest('[data-testid="timer-cover"]')),
          kids: [...cover.children].map((c) => c.getAttribute('data-testid')).sort(),
          text: cover.innerText.trim(),
        };
      });
      if (Math.abs(info.x) > 1 || Math.abs(info.y) > 1 || Math.abs(info.w - info.vw) > 1 || Math.abs(info.h - info.vh) > 1) errs.push(`덮개 rect ${info.x},${info.y} ${info.w}x${info.h}`);
      if (info.bg !== 'rgb(0, 0, 0)') errs.push('배경 ' + info.bg);
      if (!info.hitInCover) errs.push('탭바 가운데가 덮개 밖');
      const want = ['timer-cover-close', 'timer-cover-ring', 'timer-cover-time'];
      if (JSON.stringify(info.kids) !== JSON.stringify(want)) errs.push('직계 자식 ' + info.kids.join(','));
      if (info.text !== '24:57') errs.push('덮개 글자 "' + info.text + '"');
      return errs.length ? errs.join('; ') : true;
    });

    await page.tap(tid('timer-cover-close'));
    await runFor(page, 1000);
    await check('19. 진짜 터치로 닫기 → 덮개 숨김·running 유지·"24:56"', async () => {
      const errs = [];
      if (await vis(page, 'timer-cover')) errs.push('덮개 아직 보임');
      if ((await stateOf(page)) !== 'running') errs.push('state ' + (await stateOf(page)));
      if ((await val(page, 'timer-time')) !== '24:56') errs.push('글자 ' + (await val(page, 'timer-time')));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 6: 전체화면·깨우기 API 가 없거나 거부하는 환경 — 오류 0 =====
  const envA = () => {
    try { delete Element.prototype.requestFullscreen; } catch (e) { /* 무시 */ }
    try { Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true }); } catch (e) { /* 무시 */ }
  };
  const envB = () => {
    const rej = () => Promise.reject(new DOMException('거부됨', 'NotAllowedError'));
    Element.prototype.requestFullscreen = rej;
    Document.prototype.exitFullscreen = rej;
    Object.defineProperty(navigator, 'wakeLock', { value: { request: rej }, configurable: true });
  };
  for (const [label, init, applied] of [
    ['환경 A(requestFullscreen·wakeLock 지움)', envA, 'typeof navigator.wakeLock === "undefined" && typeof Element.prototype.requestFullscreen === "undefined"'],
    ['환경 B(requestFullscreen·wakeLock 거부)', envB, 'navigator.wakeLock.request("screen").then(() => "ok", () => "rej")'],
  ]) {
    const n0 = consoleErrors.length;
    const { ctx, page } = await openT(browser, { init });
    await tab(page, 'tab-timer');
    await page.click(tid('timer-start'));
    await page.click(tid('timer-fs'));
    await sleep(100);
    const coverOpen = await vis(page, 'timer-cover');
    const envOk = await page.evaluate(`(${applied})`);
    await page.click(tid('timer-cover-close'));
    await sleep(100);
    await page.click(tid('timer-fs'));
    await sleep(100);
    await page.click(tid('timer-cover-close'));
    await check(`20. ${label}: 덮개 열고 닫아도 pageerror·console error 0 (환경 적용 확인 포함)`, () => {
      const errs = [];
      if (!coverOpen) errs.push('덮개 안 열림');
      if (envOk === false || envOk === 'ok') errs.push('환경 미적용: ' + String(envOk));
      if (consoleErrors.length - n0 !== 0) errs.push('오류 ' + consoleErrors.slice(n0).join(' | '));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 7: 전체 흐름 전후 routineTracker 동일 + 분 유지 =====
  {
    const { ctx, page } = await openT(browser, { seed: fixtureRaw });
    const before = await page.evaluate((k) => localStorage.getItem(k), 'routineTracker');
    await tab(page, 'tab-timer');
    await fillMin(page, '40');
    await page.click(tid('timer-start'));
    await runFor(page, 5000);
    await page.click(tid('timer-pause'));
    await runFor(page, 1000);
    await page.click(tid('timer-start'));
    await runFor(page, 2000);
    await page.click(tid('timer-fs'));
    await runFor(page, 1000);
    await page.click(tid('timer-cover-close'));
    await tab(page, 'tab-calendar');
    await runFor(page, 3000);
    await tab(page, 'tab-timer');
    await page.click(tid('timer-reset'));
    await page.reload();
    await tab(page, 'tab-timer');
    await check('21. 타이머 전체 흐름(입력·시작·일시정지·덮개·탭·초기화·새로고침) 전후 routineTracker 문자열 완전 동일', async () => {
      const after = await page.evaluate((k) => localStorage.getItem(k), 'routineTracker');
      if (before === null) return 'routineTracker 가 처음부터 없음';
      return after === before ? true : '전후 다름';
    });
    await check('22. 새로고침 후 분 40 유지: 글자 "40:00"·저장 {"minutes":40}', async () => {
      const errs = [];
      if ((await minVal(page)) !== '40') errs.push('분 ' + (await minVal(page)));
      if ((await val(page, 'timer-time')) !== '40:00') errs.push('글자 ' + (await val(page, 'timer-time')));
      if ((await stored(page)) !== '{"minutes":40}') errs.push('저장 ' + (await stored(page)));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 8: 3D 연결 (타이머 탭 never · 관리 탭 always) =====
  {
    const { ctx, page } = await openT(browser);
    await page.click(tid('tab-timer'));
    await sleep(500);
    const a = await page.locator(tid('char-card')).getAttribute('data-frameloop');
    await page.click(tid('tab-manage'));
    await sleep(500);
    const b = await page.locator(tid('char-card')).getAttribute('data-frameloop');
    await check('23. 3D: 타이머 탭 char-card data-frameloop=never, 관리 탭 always', () => (a === 'never' && b === 'always' ? true : `타이머=${a} 관리=${b}`));
    await ctx.close();
  }

  // ===== 흐름 9: 타이머 버튼 꾸밈 없음 (정적 · 마우스 누름 · 진짜 터치 누름 · 기존 버튼 대조) =====
  {
    const { ctx, page } = await openT(browser, { hasTouch: true });
    const cdp = await page.context().newCDPSession(page);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    const STATIC_IDS = ['timer-start', 'timer-pause', 'timer-reset', 'timer-fs', 'timer-cover-close'];
    const styleOf = (id) => page.locator(tid(id)).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, img: cs.backgroundImage, bg: cs.backgroundColor, tf: cs.transform, active: el.matches(':active'), cls: el.getAttribute('class') || '' };
    });
    // 누른 상태만 보고 바로 취소한다(클릭이 일어나지 않게 버튼 밖에서 놓음/touchCancel). 상태는 안 바뀐다.
    const mousePress = async (id) => {
      const b = await page.locator(tid(id)).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const st = await styleOf(id);
      await page.mouse.move(1, 1);
      await page.mouse.up();
      return st;
    };
    const touchPress = async (id) => {
      const b = await page.locator(tid(id)).boundingBox();
      await page.evaluate(() => { window.__touchHit = null; document.addEventListener('touchstart', (e) => { window.__touchHit = (e.target.closest('[data-testid]') || {}).dataset?.testid ?? null; }, { capture: true, once: true }); });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await sleep(150);
      const st = await styleOf(id);
      st.hit = await page.evaluate(() => window.__touchHit); // 진짜 터치가 이 버튼에 닿았는지 (CDP 터치는 :active 를 안 켜는 경우가 있어 함께 본다)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      return st;
    };
    const mouseRes = {};
    const touchRes = {};
    const staticRes = {};
    for (const id of STATIC_IDS) staticRes[id] = await styleOf(id); // 숨은 버튼도 computed 값은 읽힌다

    await check('25a. 타이머 버튼 5개(시작·일시정지·초기화·전체화면·닫기 아이콘): box-shadow "none"·background-image 에 gradient 없음·background-color rgb(255, 255, 255) 또는 투명', () => {
      const errs = [];
      for (const id of STATIC_IDS) {
        const s = staticRes[id];
        if (s.shadow !== 'none') errs.push(`${id} box-shadow ${s.shadow}`);
        if (/gradient/i.test(s.img)) errs.push(`${id} 그라데이션 ${s.img}`);
        // 덮개 닫기 버튼은 검은 덮개 위라 검정(=덮개색)도 꾸밈 아님
        if (!['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', 'transparent'].concat(id === 'timer-cover-close' ? ['rgb(0, 0, 0)'] : []).includes(s.bg)) errs.push(`${id} 배경색 ${s.bg}`);
      }
      return errs.length ? errs.join('; ') : true;
    });

    await check('25e. 타이머 버튼 5개에 앱 공통 .btn 계열 클래스 없음(대조: "btn btn-primary" 는 잡힘)', () => {
      const re = /(^|\s)btn(\s|-|$)/;
      if (!re.test('btn btn-primary')) return '대조 실패: 검사식이 btn 을 못 잡음';
      const bad = STATIC_IDS.filter((id) => re.test(staticRes[id].cls));
      return bad.length ? '.btn 계열 붙음: ' + bad.join(',') : true;
    });

    // 누름 상태 수집: idle 에서 시작·초기화 → 시작 눌러 달리기 → 일시정지·전체화면 → 덮개 → 닫기
    for (const id of ['timer-start', 'timer-reset']) { mouseRes[id] = await mousePress(id); touchRes[id] = await touchPress(id); }
    await page.click(tid('timer-start')); // 달리는 중: 일시정지·전체화면 보임
    for (const id of ['timer-pause', 'timer-fs']) { mouseRes[id] = await mousePress(id); touchRes[id] = await touchPress(id); }
    await page.click(tid('timer-fs')); // 덮개 열림: 닫기 아이콘 보임
    mouseRes['timer-cover-close'] = await mousePress('timer-cover-close');
    touchRes['timer-cover-close'] = await touchPress('timer-cover-close');

    const pressFail = (res, touch) => Object.entries(res)
      .filter(([id, s]) => !(touch ? (s.hit === id && s.tf === 'none') : (s.active && s.tf === 'none')))
      .map(([id, s]) => `${id}(:active ${s.active}, 터치 닿음 ${s.hit}, transform ${s.tf})`);

    await check('25b. 마우스로 누르는 동안(down): 시작·초기화·일시정지·전체화면·닫기 모두 :active 이고 transform none', () => {
      const f = pressFail(mouseRes);
      return f.length ? f.join('; ') : true;
    });

    await check('25c. 진짜 터치로 누르는 동안(CDP touchStart): 같은 5개 모두 터치가 그 버튼에 닿고 transform none', () => {
      const f = pressFail(touchRes, true);
      return f.length ? f.join('; ') : true;
    });

    await check('25d. 대조(기존 버튼 꾸밈 유지): btn-add-routine 의 box-shadow 가 none 이 아님', async () => {
      const bs = await page.locator(tid('btn-add-routine')).evaluate((el) => getComputedStyle(el).boxShadow);
      return bs !== 'none' ? true : 'btn-add-routine box-shadow none (기존 꾸밈이 사라짐)';
    });
    await ctx.close();
  }

  // ===== 디자인 없음 (정적 검사 + 대조) =====
  // 끄는 선언(box-shadow·transition·animation: none 뒤 ; 또는 })만 허용. 켜는 선언·값 있는 그림자·gradient·@keyframes 는 실패.
  await check('24. timer.css 에 켜는 box-shadow·gradient·animation·transition·@keyframes 0개 (끄기 선언만 허용, 대조 포함)', () => {
    const re = /box-shadow|gradient|animation|transition|@keyframes/;
    const offOk = /\b(box-shadow|transition|animation)\s*:\s*none\s*(?=[;}])/g;
    const strip = (s) => s.replace(offOk, '');
    if (!re.test('.x{transition:all 1s}')) return '대조 실패: 검사식이 transition 을 못 잡음';
    if (re.test(strip('.x{transition: none;animation:none;box-shadow:none}'))) return '대조 실패: 끄기 선언(none)이 허용 안 됨';
    if (!re.test(strip('.x{transition:none, transform 1s}'))) return '대조 실패: 켜는 선언(none 뒤 쉼표)이 통과됨';
    if (!re.test(strip('.x{box-shadow:0 2px 4px #000}'))) return '대조 실패: 그림자 값이 통과됨';
    const css = fs.readFileSync(path.join(HERE, '..', 'css', 'timer.css'), 'utf8');
    if (css.length < 200) return 'timer.css 가 비정상적으로 짧음';
    const hits = strip(css).match(new RegExp(re.source, 'g')) || [];
    return hits.length ? '금지 문자열 ' + hits.join(',') : true;
  });
});
