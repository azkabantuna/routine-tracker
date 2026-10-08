// 타이머 탭 시험 (timer.js · timer.css · index.html · app.js)
// 실행(레포 루트에서): node projects/routine-tracker/tests/timer.test.mjs   (서버는 run.mjs 가 켜 준다)
// 원칙: 시간은 page.clock(install→pauseAt→runFor/setSystemTime)으로만 흐른다. 기대값은 계획 숫자 그대로.
// 모든 검사는 틀리면 실패해야 한다(대조 포함). 리스너(pageerror·console)는 goto 전에 붙는다.
import { fs, path, HERE, run, check, sleep, tid, fixtureRaw, BASE, KEY, NOW, consoleErrors, externalRequests, hosts } from './_lib.mjs';

const T_KEY = 'routineTimer';
const C = 2 * Math.PI * 45; // 둘레 (반지름 45)
const TABS = ['tab-today', 'tab-calendar', 'tab-manage', 'tab-timer'];

// 가짜 시계로 연다: install → goto → 그 시각에서 멈춤. 시간은 runFor/setSystemTime 으로만 흐른다.
// reduce: 움직임 줄이기 설정 여부. init: goto 전에 실행할 가짜 환경(AudioContext·rAF 세기 등)
async function openT(browser, { seed = fixtureRaw, hasTouch = false, init = null, reduce = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR', hasTouch, isMobile: false,
    reducedMotion: reduce ? 'reduce' : 'no-preference',
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

// ---- M9 도우미 ----
const scaleYOf = (t) => { const m = /scaleY\(([^)]+)\)/.exec(t || ''); return m ? parseFloat(m[1]) : NaN; };
const msOf = (d) => (d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000);
// 칸 목록: sel 안의 .timer-tile 전부 (data-tile-i 순서대로)
const tilesOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' .timer-tile')].map((t) => ({
  i: Number(t.getAttribute('data-tile-i')), st: t.getAttribute('data-tile'),
  y: t.querySelector('.timer-fill').style.transform, pop: t.classList.contains('tile-pop'),
  anim: getComputedStyle(t).animationName, delay: getComputedStyle(t).animationDelay,
})), sel);
const rootTiles = (page) => tilesOf(page, '[data-testid="timer-tiles"]');
const offOf = (page) => page.locator(tid('timer-ring')).evaluate((el) => parseFloat(el.getAttribute('stroke-dashoffset')));
const rafCount = (page) => page.evaluate(() => window.__raf);
const rafReset = (page) => page.evaluate(() => { window.__raf = 0; });
const textW = (page, id) => page.locator(tid(id)).evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; });
// 가짜 환경: rAF 호출 수 세기 (goto 전에 붙인다)
const rafInit = () => {
  window.__raf = 0;
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { window.__raf++; return orig.call(window, cb); };
};
// 가짜 환경: 종료 축포 호출 수 세기 (goto 뒤, RT 가 있은 뒤에 붙인다)
const wrapCel = (page) => page.evaluate(() => {
  window.__cel = 0;
  const o = RT.effects.celebrate;
  RT.effects.celebrate = function (opt) { window.__cel++; return o.call(this, opt); };
});
// 가짜 환경: AudioContext (goto 전에 붙인다). 만든 개수·오실레이터 시작/끝 시각·주파수·gain 최고값을 기록
const audioInit = () => {
  const A = window.__ac = { made: 0, osc: [], gainMax: 0 };
  const note = (v) => { if (typeof v === 'number' && v > A.gainMax) A.gainMax = v; };
  class FakeAudioContext {
    constructor() { A.made++; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() {
      const rec = { freq: 0, start: null, stop: null };
      A.osc.push(rec);
      return {
        type: '',
        frequency: { set value(v) { rec.freq = v; }, get value() { return rec.freq; } },
        connect() {},
        start(t) { rec.start = t; },
        stop(t) { rec.stop = t; },
      };
    }
    createGain() { return { gain: { setValueAtTime(v) { note(v); }, linearRampToValueAtTime(v) { note(v); } }, connect() {} }; }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
};
// 가짜 환경: 저장된 칸 보기 = 타일 (goto 전에 붙인다)
const tilesInit = () => { localStorage.setItem('routineTimerView', 'tiles'); };

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
    await check('12. 덮개(마우스): 뷰포트 전체·배경 rgb(0,0,0)·탭바 가운데가 덮개 안·직계 자식 ring·tiles·time·close 뿐(tiles 는 칸 보기용)·글자 "0:50" 만', async () => {
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
      const want = ['timer-cover-close', 'timer-cover-ring', 'timer-cover-tiles', 'timer-cover-time'];
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
    await check('18. 진짜 터치로 덮개 열기: 뷰포트 전체·배경 rgb(0,0,0)·탭바 가운데가 덮개 안·자식 ring·tiles·time·close 뿐·글자 "24:57"', async () => {
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
      const want = ['timer-cover-close', 'timer-cover-ring', 'timer-cover-tiles', 'timer-cover-time'];
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

  // ===== 흐름 9: 타이머 버튼 누름 (정적 · 마우스 누름 · 진짜 터치 누름 · 기존 버튼 대조) =====
  {
    const { ctx, page } = await openT(browser, { hasTouch: true });
    const cdp = await page.context().newCDPSession(page);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    const STATIC_IDS = ['timer-start', 'timer-pause', 'timer-reset', 'timer-fs', 'timer-cover-close'];
    // 쉬는 때 배경색 (시작 = 주황 알약, 나머지 흰 바탕, 덮개 닫기 = 검정)
    const WANT_BG = { 'timer-start': 'rgb(255, 122, 61)', 'timer-pause': 'rgb(255, 255, 255)', 'timer-reset': 'rgb(255, 255, 255)', 'timer-fs': 'rgb(255, 255, 255)', 'timer-cover-close': 'rgb(0, 0, 0)' };
    const styleOf = (id) => page.locator(tid(id)).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, img: cs.backgroundImage, bg: cs.backgroundColor, tf: cs.transform, color: cs.color, bc: cs.borderTopColor, active: el.matches(':active'), cls: el.getAttribute('class') || '' };
    });
    // 누른 상태만 보고 바로 취소한다(클릭이 일어나지 않게 버튼 밖에서 놓음/touchCancel). 상태는 안 바뀐다.
    const mousePress = async (id) => {
      const b = await page.locator(tid(id)).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await sleep(250); // 누름 전환(transition 120ms)이 끝난 뒤에 읽는다
      const st = await styleOf(id);
      await page.mouse.move(1, 1);
      await page.mouse.up();
      return st;
    };
    const touchPress = async (id) => {
      const b = await page.locator(tid(id)).boundingBox();
      await page.evaluate(() => { window.__touchHit = null; document.addEventListener('touchstart', (e) => { window.__touchHit = (e.target.closest('[data-testid]') || {}).dataset?.testid ?? null; }, { capture: true, once: true }); });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
      await sleep(250);
      const st = await styleOf(id);
      st.hit = await page.evaluate(() => window.__touchHit); // 진짜 터치가 이 버튼에 닿았는지
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      return st;
    };
    const mouseRes = {};
    const touchRes = {};
    const staticRes = {};
    for (const id of STATIC_IDS) staticRes[id] = await styleOf(id); // 숨은 버튼도 computed 값은 읽힌다

    // 누름 때 바뀌어도 되는 것은 transform 뿐: 그림자·배경·글자색·테두리색이 쉬는 때와 같아야 한다
    const sameAsIdle = (id, s) => {
      const base = staticRes[id];
      return s.shadow === base.shadow && s.img === base.img && s.bg === base.bg && s.color === base.color && s.bc === base.bc;
    };

    await check('25a. 타이머 버튼 5개 쉬는 때: box-shadow "none"·그라데이션 없음·배경색이 계획 값(시작 rgb(255, 122, 61), 나머지 흰 바탕, 닫기 검정)', () => {
      const errs = [];
      for (const id of STATIC_IDS) {
        const s = staticRes[id];
        if (s.shadow !== 'none') errs.push(`${id} box-shadow ${s.shadow}`);
        if (/gradient/i.test(s.img)) errs.push(`${id} 그라데이션 ${s.img}`);
        if (s.bg !== WANT_BG[id]) errs.push(`${id} 배경색 ${s.bg} (기대 ${WANT_BG[id]})`);
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

    // 실패 = 눌렀는데 transform 이 안 바뀌었거나(scale 없음), 그림자·배경·글자색·테두리색이 바뀐 것
    const pressFail = (res, touch) => Object.entries(res)
      .filter(([id, s]) => !((touch ? s.hit === id : s.active) && s.tf !== 'none' && sameAsIdle(id, s)))
      .map(([id, s]) => `${id}(${touch ? '터치 닿음 ' + s.hit : ':active ' + s.active}, transform ${s.tf}, 그림자·배경 그대로 ${sameAsIdle(id, s)})`);

    await check('25b. 마우스로 누르는 동안(down): 시작·초기화·일시정지·전체화면·닫기 모두 :active 이고 transform 만 바뀜(scale)', () => {
      const f = pressFail(mouseRes);
      return f.length ? f.join('; ') : true;
    });

    await check('25c. 진짜 터치로 누르는 동안(CDP touchStart): 같은 5개 모두 터치가 그 버튼에 닿고 transform 만 바뀜(scale)', () => {
      const f = pressFail(touchRes, true);
      return f.length ? f.join('; ') : true;
    });

    await check('25d. 대조(기존 버튼 꾸밈 유지): btn-add-routine 의 box-shadow 가 none 이 아님', async () => {
      const bs = await page.locator(tid('btn-add-routine')).evaluate((el) => getComputedStyle(el).boxShadow);
      return bs !== 'none' ? true : 'btn-add-routine box-shadow none (기존 꾸밈이 사라짐)';
    });
    await ctx.close();
  }

  // ===== 흐름 10: 색·링 모양 (1분 설정) =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    const readColors = () => page.evaluate(() => ({
      ring: document.querySelector('[data-testid="timer-ring"]').getAttribute('data-timer-color'),
      root: document.getElementById('screen-timer').getAttribute('data-timer-color'),
      cover: document.querySelector('[data-testid="timer-cover"]').getAttribute('data-timer-color'),
    }));
    const cIdle = await readColors();
    await page.click(tid('timer-start'));
    await runFor(page, 30000);
    const cHalf = await readColors();
    await runFor(page, 30000);
    const cDone = await readColors();
    await check('26. 색 경계 3점(1분 설정, 화면·링·덮개 모두): 60초(ratio 1)=rgb(77,168,255) · 30초(0.5)=rgb(197,197,62) · 0초(0)=rgb(255,122,61)', () => {
      const errs = [];
      const want = [[cIdle, 'rgb(77,168,255)', '60초'], [cHalf, 'rgb(197,197,62)', '30초'], [cDone, 'rgb(255,122,61)', '0초']];
      for (const [got, w, label] of want) for (const k of ['ring', 'root', 'cover']) if (got[k] !== w) errs.push(`${label} ${k} ${got[k]} (기대 ${w})`);
      return errs.length ? errs.join('; ') : true;
    });

    await check('27. 링: 선 끝 stroke-linecap round · 선 색 그라데이션 url(#timer-grad)(덮개는 timer-cover-grad) · 정지점 2개', async () => {
      const r = await page.evaluate(() => {
        const pick = (sel) => {
          const cs = getComputedStyle(document.querySelector(sel));
          const gid = (cs.stroke.match(/#([\w-]+)/) || [])[1] || '';
          const g = document.getElementById(gid);
          return { cap: cs.strokeLinecap, grad: gid, stops: g ? g.querySelectorAll('stop').length : 0 };
        };
        return { ring: pick('[data-testid="timer-ring"] .timer-arc'), cover: pick('[data-testid="timer-cover-ring"] .timer-arc') };
      });
      const errs = [];
      if (r.ring.cap !== 'round') errs.push('화면 링 cap ' + r.ring.cap);
      if (r.ring.grad !== 'timer-grad') errs.push('화면 링 선 ' + r.ring.grad);
      if (r.ring.stops !== 2) errs.push('화면 정지점 ' + r.ring.stops);
      if (r.cover.cap !== 'round') errs.push('덮개 링 cap ' + r.cover.cap);
      if (r.cover.grad !== 'timer-cover-grad') errs.push('덮개 링 선 ' + r.cover.grad);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 11: 숫자 폭 (tabular-nums) =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    await runFor(page, 1000);
    const txtA = await val(page, 'timer-time');
    const wA = await textW(page, 'timer-time');
    await runFor(page, 48000);
    const txtB = await val(page, 'timer-time');
    const wB = await textW(page, 'timer-time');
    const fvn = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="timer-time"]')).fontVariantNumeric);
    const ctl = await page.evaluate(() => {
      const src = document.querySelector('[data-testid="timer-time"]');
      const c = src.cloneNode(true);
      c.removeAttribute('data-testid');
      c.style.fontVariantNumeric = 'normal';
      c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0'; c.style.whiteSpace = 'nowrap';
      document.body.appendChild(c);
      const w = (t) => { c.textContent = t; const r = document.createRange(); r.selectNodeContents(c); return r.getBoundingClientRect().width; };
      const out = [w('0:59'), w('0:11')];
      c.remove();
      return out;
    });
    await check('28. 숫자: tabular-nums · "0:59"→"0:11" 바뀌어도 숫자 글자 폭 차이 ≤0.5px (대조: 기본 숫자 폭으로 재면 차이가 0.5px 넘어야 함)', () => {
      const errs = [];
      if (txtA !== '0:59') errs.push('앞 글자 ' + txtA);
      if (txtB !== '0:11') errs.push('뒤 글자 ' + txtB);
      if (fvn !== 'tabular-nums') errs.push('font-variant-numeric ' + fvn);
      if (!(Math.abs(wA - wB) <= 0.5)) errs.push(`폭 ${wA.toFixed(2)}→${wB.toFixed(2)}`);
      if (!(Math.abs(ctl[0] - ctl[1]) > 0.5)) errs.push(`대조 실패: 기본 숫자 폭도 같아 구분 못 함 (${ctl[0].toFixed(2)}, ${ctl[1].toFixed(2)})`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 12: 보기 스위치 (진짜 터치 tap) · 칸 25개·단위 =====
  {
    const { ctx, page } = await openT(browser, { hasTouch: true });
    await page.tap(tid('tab-timer'));
    await fillMin(page, '1');
    const viewState = () => page.evaluate(() => ({
      view: document.getElementById('screen-timer').getAttribute('data-timer-view'),
      ringP: document.querySelector('[data-testid="timer-view-ring"]').getAttribute('aria-pressed'),
      tilesP: document.querySelector('[data-testid="timer-view-tiles"]').getAttribute('aria-pressed'),
    }));
    const s0 = await viewState();
    await page.tap(tid('timer-view-tiles'));
    const s1 = await viewState();
    const v1 = await page.evaluate(() => localStorage.getItem('routineTimerView'));
    const t1 = await stored(page);
    await page.reload();
    await page.tap(tid('tab-timer'));
    const s2 = await viewState();
    const t2 = await stored(page);
    const tl = await rootTiles(page);
    const cl = await tilesOf(page, '[data-testid="timer-cover-tiles"]');
    const unit1 = await ctxt(page, 'timer-unit');
    await fillMin(page, '25');
    const unit2 = await ctxt(page, 'timer-unit');
    await fillMin(page, '1');
    await page.tap(tid('timer-view-ring'));
    const s3 = await viewState();
    const v3 = await page.evaluate(() => localStorage.getItem('routineTimerView'));

    await check('29. 보기 스위치(진짜 터치 tap): 누르면 data-timer-view tiles·aria-pressed 바뀜·routineTimerView "tiles"·새로고침 뒤 유지·routineTimer 형식 {"minutes":1} 그대로·되돌리면 ring', () => {
      const errs = [];
      if (s0.view !== 'ring' || s0.ringP !== 'true') errs.push('처음 ' + JSON.stringify(s0));
      if (s1.view !== 'tiles' || s1.tilesP !== 'true' || s1.ringP !== 'false') errs.push('탭 뒤 ' + JSON.stringify(s1));
      if (v1 !== 'tiles') errs.push('저장 routineTimerView ' + v1);
      if (t1 !== '{"minutes":1}') errs.push('routineTimer ' + t1);
      if (s2.view !== 'tiles' || s2.tilesP !== 'true') errs.push('새로고침 뒤 ' + JSON.stringify(s2));
      if (t2 !== '{"minutes":1}') errs.push('새로고침 뒤 routineTimer ' + t2);
      if (s3.view !== 'ring' || s3.ringP !== 'true') errs.push('되돌린 뒤 ' + JSON.stringify(s3));
      if (v3 !== 'ring') errs.push('되돌린 저장 ' + v3);
      return errs.length ? errs.join('; ') : true;
    });

    await check('30. 타일 25칸(화면·덮개, data-tile-i 0..24 순서) · 단위 "1칸 = 2.4초"(1분) · 25분이면 "1칸 = 1분"', () => {
      const errs = [];
      const idx = tl.map((t) => t.i).join(',');
      if (tl.length !== 25 || idx !== [...Array(25).keys()].join(',')) errs.push(`화면 칸 ${tl.length}개 [${idx}]`);
      if (cl.length !== 25) errs.push('덮개 칸 ' + cl.length + '개');
      if (unit1 !== '1칸 = 2.4초') errs.push('1분 단위 "' + unit1 + '"');
      if (unit2 !== '1칸 = 1분') errs.push('25분 단위 "' + unit2 + '"');
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 13: 칸 채움 (타일 보기 고정) =====
  {
    const { ctx, page } = await openT(browser, { init: tilesInit });
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    // 1칸 = 60÷25 = 2.4초 → 3.6초면 칸0 full·칸1 절반(1.2/2.4)·칸2 empty (처음 5초로 적은 건 진행자 계산 실수: 5초는 2.08칸)
    await runFor(page, 3600);
    const t5 = await rootTiles(page);
    await check('31. 1분 시작 후 3.6초: 칸0 full·칸1 filling·칸2 empty, 칸1 scaleY 0.5±0.1', () => {
      const errs = [];
      if (t5[0].st !== 'full') errs.push('칸0 ' + t5[0].st);
      if (t5[1].st !== 'filling') errs.push('칸1 ' + t5[1].st);
      if (t5[2].st !== 'empty') errs.push('칸2 ' + t5[2].st);
      const y1 = scaleYOf(t5[1].y);
      if (!(y1 > 0 && y1 < 1)) errs.push('칸1 scaleY ' + y1);
      if (!(Math.abs(y1 - 0.5) <= 0.1)) errs.push(`칸1 scaleY ${y1} (기대 0.5±0.1)`);
      return errs.length ? errs.join('; ') : true;
    });

    await runFor(page, 26400); // 3.6 + 26.4 = 30초
    const t30 = await rootTiles(page);
    await check('32. 30초: 칸 0~11 full · 칸 12 filling(scaleY 0.5±0.05) · 칸 13~24 empty', () => {
      const errs = [];
      for (let i = 0; i < 12; i++) if (t30[i].st !== 'full') errs.push(`칸${i} ${t30[i].st}`);
      if (t30[12].st !== 'filling') errs.push('칸12 ' + t30[12].st);
      const y12 = scaleYOf(t30[12].y);
      if (!(Math.abs(y12 - 0.5) <= 0.05)) errs.push('칸12 scaleY ' + y12);
      for (let i = 13; i < 25; i++) if (t30[i].st !== 'empty') errs.push(`칸${i} ${t30[i].st}`);
      return errs.length ? errs.join('; ') : true;
    });
    // 진행자 추가(M9-R3): 칸이 실제로 받는 색이 지금 타이머 색인가 (중간 요소가 기본값으로 가리면 늘 파랑 — D 가 찾은 버그)
    const tileCol = await page.evaluate(() => {
      const root = document.getElementById('screen-timer');
      const fill = document.querySelector('[data-testid="timer-tiles"] .timer-tile[data-tile-i="0"] .timer-fill') || document.querySelector('[data-testid="timer-tiles"] .timer-tile[data-tile-i="0"]');
      return { want: root.getAttribute('data-timer-color'), got: getComputedStyle(fill).getPropertyValue('--timer-color').trim() };
    });
    await check('32b. 30초 칸이 받는 --timer-color = 화면 data-timer-color(rgb(197, 197, 62) 근처, 시작색 파랑 아님)', () => {
      const norm = (c) => (c || '').replace(/\s+/g, '');
      if (norm(tileCol.got) !== norm(tileCol.want)) return `칸 색 ${tileCol.got} ≠ 화면 색 ${tileCol.want}`;
      if (/77,168,255/.test(norm(tileCol.got)) || /4da8ff/i.test(tileCol.got)) return '칸 색이 시작색(파랑) 그대로';
      return true;
    });
    await ctx.close();
  }

  // ===== 흐름 14: 칸이 가득 찰 때 톡 (tile-pop) =====
  {
    const { ctx, page } = await openT(browser, { init: tilesInit });
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    await runFor(page, 2000); // 칸0 = 0.83 (아직 full 아님)
    const a = await rootTiles(page);
    await runFor(page, 450); // 2.45초: 칸0 은 2.4초에 full
    const b = await rootTiles(page);
    await check('33. 칸0 이 full 되는 순간 tile-pop 클래스·animation 생김 (대조: 아직 안 찬 칸5 는 tile-pop 없음)', () => {
      const errs = [];
      if (a[0].st === 'full') errs.push('2초에 벌써 full');
      if (b[0].st !== 'full') errs.push('칸0 ' + b[0].st);
      if (!b[0].pop) errs.push('tile-pop 클래스 없음');
      if (b[0].anim !== 'tile-pop') errs.push('animation-name ' + b[0].anim);
      if (b[5].pop || b[5].st === 'full') errs.push('대조: 칸5 가 벌써 찬 상태/pop');
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 15: 링 연속 움직임 =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    const o0 = await offOf(page);
    await runFor(page, 500);
    const o1 = await offOf(page);
    const txt = await val(page, 'timer-time');
    await check('34. 링 dashoffset 이 초 사이(0.5초, 글자는 아직 "1:00")에도 변함 (1초마다만 갱신하면 실패)', () => {
      const errs = [];
      if (txt !== '1:00') errs.push('글자 ' + txt + ' (0.5초 안이어야 1:00)');
      if (!(o1 > o0 + 0.05)) errs.push(`dashoffset ${o0.toFixed(3)}→${o1.toFixed(3)} 안 변함`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 16: 그림 루프(rAF) — 다른 탭·숨김에서 멈추고 돌아오면 재개 =====
  {
    const { ctx, page } = await openT(browser, { init: rafInit });
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    await rafReset(page);
    await runFor(page, 1000);
    const aRun = await rafCount(page);
    await tab(page, 'tab-calendar');
    await rafReset(page);
    await runFor(page, 1000);
    const aCal = await rafCount(page);
    await tab(page, 'tab-timer');
    await rafReset(page);
    await runFor(page, 1000);
    const aBack = await rafCount(page);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await rafReset(page);
    await runFor(page, 1000);
    const aHid = await rafCount(page);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await rafReset(page);
    await runFor(page, 1000);
    const aVis = await rafCount(page);
    await check('35. rAF: 돌 때(1초) >0 · 다른 탭 ≤2 · 돌아오면 >0 · 숨김 ≤2 · 보이면 다시 >0 (window.requestAnimationFrame 호출 수)', () => {
      const errs = [];
      if (!(aRun > 0)) errs.push('돌 때 호출 ' + aRun);
      if (!(aCal <= 2)) errs.push('캘린더 탭 호출 ' + aCal);
      if (!(aBack > 0)) errs.push('돌아온 뒤 호출 ' + aBack);
      if (!(aHid <= 2)) errs.push('숨김 호출 ' + aHid);
      if (!(aVis > 0)) errs.push('보이게 된 뒤 호출 ' + aVis);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 17: 끝 효과 (맥박·물결·축포 1번·덮개 위) =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await wrapCel(page);
    await page.click(tid('timer-start'));
    await page.click(tid('timer-fs')); // 덮개를 열어 둔 채 끝나게
    await runFor(page, 60000);
    const fx = await page.evaluate(() => {
      const cover = document.querySelector('[data-testid="timer-cover"]');
      const cel = document.querySelectorAll('.celebrate[data-level="max"]');
      const ms = (d) => (d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000);
      const delays = (sel) => [0, 12, 24].map((i) => ms(getComputedStyle(document.querySelector(sel + ' .timer-tile[data-tile-i="' + i + '"]')).animationDelay));
      return {
        root: document.getElementById('screen-timer').getAttribute('data-timer-fx'),
        cover: cover.getAttribute('data-timer-fx'),
        wrap: getComputedStyle(document.querySelector('#screen-timer .timer-ring-wrap')).animationName,
        d1: delays('[data-testid="timer-tiles"]'),
        d2: delays('[data-testid="timer-cover-tiles"]'),
        cel: window.__cel,
        celN: cel.length,
        celZ: cel.length ? getComputedStyle(cel[0]).zIndex : null,
        coverZ: getComputedStyle(cover).zIndex,
        coverOpen: !cover.hidden,
      };
    });
    await check('36. 끝: data-timer-fx=done(화면·덮개) · 링 맥박+빛 animation "timer-pulse, timer-glow" · 칸 0·12·24 delay 0·360·720ms(화면·덮개) · 축포 정확히 1번 · 덮개 열림이면 축포 z-index 31 > 덮개 30', () => {
      const errs = [];
      if (fx.root !== 'done') errs.push('화면 fx ' + fx.root);
      if (fx.cover !== 'done') errs.push('덮개 fx ' + fx.cover);
      if (fx.wrap !== 'timer-pulse, timer-glow') errs.push('wrap animation ' + fx.wrap);
      if (JSON.stringify(fx.d1) !== '[0,360,720]') errs.push('화면 칸 delay ' + JSON.stringify(fx.d1));
      if (JSON.stringify(fx.d2) !== '[0,360,720]') errs.push('덮개 칸 delay ' + JSON.stringify(fx.d2));
      if (fx.cel !== 1) errs.push('축포 호출 ' + fx.cel + '번');
      if (fx.celN !== 1) errs.push('축포 요소 ' + fx.celN + '개');
      if (!fx.coverOpen) errs.push('덮개가 닫힘');
      if (fx.celZ !== '31') errs.push('축포 z-index ' + fx.celZ);
      if (fx.coverZ !== '30') errs.push('덮개 z-index ' + fx.coverZ);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 18: 소리 (가짜 AudioContext) =====
  {
    const { ctx, page } = await openT(browser, { init: audioInit });
    const made0 = await page.evaluate(() => window.__ac.made);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    const made1 = await page.evaluate(() => window.__ac.made);
    await runFor(page, 60000);
    const A = await page.evaluate(() => window.__ac);
    await check('37. 소리 3음: 로드 직후 AudioContext 0개 · 시작 뒤 생김 · 끝에 오실레이터 3개(523.25·659.25·783.99Hz, 0.12초 간격, 각 0.6초 안에 끝) · gain 최고 0 초과 ≤0.15', () => {
      const errs = [];
      if (made0 !== 0) errs.push('로드 직후 ' + made0 + '개');
      if (!(made1 >= 1)) errs.push('시작 뒤 ' + made1 + '개');
      if (A.osc.length !== 3) errs.push('오실레이터 ' + A.osc.length + '개');
      else {
        const f = A.osc.map((o) => o.freq);
        if (JSON.stringify(f) !== '[523.25,659.25,783.99]') errs.push('주파수 ' + JSON.stringify(f));
        const s = A.osc.map((o) => o.start);
        if (Math.abs(s[1] - s[0] - 0.12) > 1e-6 || Math.abs(s[2] - s[1] - 0.12) > 1e-6) errs.push('간격 ' + JSON.stringify(s));
        A.osc.forEach((o, i) => { if (!(o.stop - o.start <= 0.6 + 1e-9)) errs.push(`${i}번 길이 ${(o.stop - o.start).toFixed(2)}`); });
      }
      if (!(A.gainMax > 0 && A.gainMax <= 0.15)) errs.push('gain 최고 ' + A.gainMax);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 19: 소리 끔 (저장·새로고침 유지) =====
  {
    const { ctx, page } = await openT(browser, { init: audioInit });
    await tab(page, 'tab-timer');
    const p0 = await page.locator(tid('timer-sound')).getAttribute('aria-pressed');
    await page.click(tid('timer-sound'));
    const p1 = await page.locator(tid('timer-sound')).getAttribute('aria-pressed');
    const sv1 = await page.evaluate(() => localStorage.getItem('routineTimerSound'));
    const inner = await page.locator(tid('timer-sound')).innerText();
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    await runFor(page, 60000);
    const osc = (await page.evaluate(() => window.__ac.osc.length));
    await page.reload();
    await tab(page, 'tab-timer');
    const p2 = await page.locator(tid('timer-sound')).getAttribute('aria-pressed');
    const sv2 = await page.evaluate(() => localStorage.getItem('routineTimerSound'));
    await check('38. 소리 끔: 처음 aria-pressed true → 누르면 false · routineTimerSound "off" · 끝에도 오실레이터 0 · 글자 "" · 새로고침 뒤 유지', () => {
      const errs = [];
      if (p0 !== 'true') errs.push('처음 ' + p0);
      if (p1 !== 'false') errs.push('누른 뒤 ' + p1);
      if (sv1 !== 'off') errs.push('저장 ' + sv1);
      if (inner !== '') errs.push('글자 "' + inner + '"');
      if (osc !== 0) errs.push('끝난 뒤 오실레이터 ' + osc + '개');
      if (p2 !== 'false' || sv2 !== 'off') errs.push(`새로고침 뒤 ${p2}/${sv2}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 20: 움직임 줄이기 =====
  {
    const { ctx, page } = await openT(browser, { reduce: true, init: rafInit });
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await wrapCel(page);
    await page.click(tid('timer-start'));
    await rafReset(page);
    await runFor(page, 1000);
    const rafRun = await rafCount(page);
    await runFor(page, 59000);
    const an = await page.evaluate(() => ({
      fx: document.getElementById('screen-timer').getAttribute('data-timer-fx'),
      wrap: getComputedStyle(document.querySelector('#screen-timer .timer-ring-wrap')).animationName,
      svg: getComputedStyle(document.querySelector('#screen-timer .timer-svg')).animationName,
      tile: getComputedStyle(document.querySelector('[data-testid="timer-tiles"] .timer-tile')).animationName,
      cel: window.__cel,
    }));
    await check('39. 움직임 줄이기: 돌 때 rAF 호출 0 · 끝나도 맥박·물결 animation none · 축포 0번 (끝 표시 done 은 그대로)', () => {
      const errs = [];
      if (rafRun !== 0) errs.push('rAF 호출 ' + rafRun);
      if (an.fx !== 'done') errs.push('fx ' + an.fx);
      if (an.wrap !== 'none') errs.push('wrap ' + an.wrap);
      if (an.svg !== 'none') errs.push('링 svg ' + an.svg);
      if (an.tile !== 'none') errs.push('칸 ' + an.tile);
      if (an.cel !== 0) errs.push('축포 ' + an.cel + '번');
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 흐름 21: 덮개에서 두 보기 =====
  {
    const { ctx, page } = await openT(browser);
    await tab(page, 'tab-timer');
    await fillMin(page, '1');
    await page.click(tid('timer-start'));
    await runFor(page, 30000);
    await page.click(tid('timer-fs'));
    const ringMode = { ring: await vis(page, 'timer-cover-ring'), tiles: await vis(page, 'timer-cover-tiles') };
    await page.click(tid('timer-cover-close'));
    await page.click(tid('timer-view-tiles'));
    await page.click(tid('timer-fs'));
    const tilesMode = { ring: await vis(page, 'timer-cover-ring'), tiles: await vis(page, 'timer-cover-tiles') };
    const look = await page.evaluate(() => {
      const full = document.querySelector('[data-testid="timer-cover-tiles"] .timer-tile[data-tile="full"] .timer-fill');
      return {
        bar: full ? getComputedStyle(full).backgroundImage : null,
        bg: getComputedStyle(document.getElementById('timer-cover')).backgroundColor,
      };
    });
    await check('40. 덮개: 링 보기면 링만·타일 보기면 타일만 보임 · 찬 칸 색이 검은 배경과 다름(rgb(197, 197, 62) 포함, 덮개 배경 rgb(0, 0, 0))', () => {
      const errs = [];
      if (!(ringMode.ring === true && ringMode.tiles === false)) errs.push('링 보기 ' + JSON.stringify(ringMode));
      if (!(tilesMode.tiles === true && tilesMode.ring === false)) errs.push('타일 보기 ' + JSON.stringify(tilesMode));
      if (look.bg !== 'rgb(0, 0, 0)') errs.push('덮개 배경 ' + look.bg);
      if (!look.bar || !/rgb\(\s*197,\s*197,\s*62\s*\)/.test(look.bar)) errs.push('찬 칸 색 ' + look.bar);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ===== 디자인 규칙 (정적 검사 + 대조) =====
  // 새 기준: transition·@keyframes 의 속성은 transform·opacity 만. box-shadow·gradient·animation 자체는 허용.
  await check('24. timer.css: transition·@keyframes 속성은 transform·opacity 만 (대조 포함)', () => {
    const bad = (css) => {
      const out = [];
      for (const m of css.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]*)/g)) {
        for (const part of m[2].split(',')) {
          const p = part.trim().split(/\s+/)[0] || '';
          if (!['transform', 'opacity', 'none'].includes(p)) out.push(m[1] + ' ' + p);
        }
      }
      const kf = /@keyframes\s+[\w-]+\s*\{/g;
      let m;
      while ((m = kf.exec(css))) {
        let depth = 1;
        let i = kf.lastIndex;
        while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
        const body = css.slice(kf.lastIndex, i - 1);
        for (const pm of body.matchAll(/([a-z-]+)\s*:/g)) if (!['transform', 'opacity'].includes(pm[1])) out.push('@keyframes ' + pm[1]);
      }
      return out;
    };
    if (bad('.x{transition: width 1s}').length !== 1) return '대조 실패: transition width 를 못 잡음';
    if (bad('@keyframes k{0%{width:0}100%{width:9px}}').length === 0) return '대조 실패: keyframes width 를 못 잡음';
    if (bad('.x{transition: transform 1s, opacity 1s}@keyframes k{0%{transform:scale(1)}100%{opacity:0}}').length !== 0) return '대조 실패: 허용 값이 막힘';
    if (bad('.x{transition: none}').length !== 0) return '대조 실패: transition none 이 막힘';
    const css = fs.readFileSync(path.join(HERE, '..', 'css', 'timer.css'), 'utf8');
    if (css.length < 200) return 'timer.css 가 비정상적으로 짧음';
    const hits = bad(css);
    return hits.length ? '금지 속성 ' + hits.join(', ') : true;
  });
});
