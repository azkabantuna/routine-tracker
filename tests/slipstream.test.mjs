// 퓨처 셀프 ③ 시험(M12): 동작선(슬립스트림)·품질 자동 단계·안 보일 때 멈춤·reduced-motion·계약
// 실행(레포 루트에서): node projects/routine-tracker/tests/slipstream.test.mjs   (보통은 run.mjs 가 대신 켠 서버에서 돈다)
// 시간 대기는 상태 대기(waitForFunction)로 하고, 측정 창(2초·10초 등)은 페이지 안에서 잰다.
import { BASE, KEY, NOW, run, check, note, sleep, tid, getRaw, fixtureRaw, consoleErrors, externalRequests } from './_lib.mjs';

const CARD = tid('char-card');
const FN7 = ['mount', 'update', 'setActive', 'dispose', 'setLevel', 'setColor', 'getState'];
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const TUN = nrm([1.2, 0, -3]); // 터널 방향(계획 기준 1.2,0,-3)
// 동작선 흐름: 터널 방향과 내적 ≤ -0.5 이고 z>0 (카메라 쪽으로 흐름)
const flowOk = (dir) => Array.isArray(dir) && dir.length === 3 && dot(nrm(dir), TUN) <= -0.5 && dir[2] > 0;

// 공통 준비: 컨텍스트·외부 요청 차단·rAF 래핑(콜백 수 __rafN, busy 면 콜백마다 80ms 바쁜 루프).
// 리스너는 goto 전에 붙인다.
async function openSl(browser, { dsf = 1, reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf, timezoneId: 'Asia/Seoul', locale: 'ko-KR',
    isMobile: false, reducedMotion: reduced ? 'reduce' : 'no-preference',
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
    window.__rafN = 0;
    window.__busy = false;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      window.__rafN++;
      if (window.__busy) { const e = performance.now() + 80; while (performance.now() < e) { /* 진짜 끊김 흉내 */ } }
      cb(t);
    });
  });
  await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, fixtureRaw]);
  await page.goto(BASE);
  return { ctx, page };
}

// 관리 탭 진입 + 첫 프레임 준비 끝(rAF 5번 이상, 드로우콜 있음)까지 상태 대기
async function enterManage(page) {
  await page.click(tid('tab-manage'));
  await page.waitForFunction(() => !!(window.RT3D && window.RT3D.getState && window.RT3D.getState()), null, { timeout: 8000, polling: 100 });
  await page.waitForFunction(() => window.__rafN >= 5 && window.RT3D.getState().draws > 0, null, { timeout: 8000, polling: 100 });
}

// 페이지 안 샘플러: 10ms 간격으로 상태·속성을 __tl 에 쌓는다(t = 시작 후 ms)
function startSampler() {
  const T = (window.__tl = []);
  const t0 = (window.__t0 = performance.now());
  window.__tlTimer = setInterval(() => {
    const card = document.querySelector('[data-testid="char-card"]');
    const cv = document.querySelector('[data-testid="char-canvas"]');
    if (!card || !cv || !window.RT3D) return;
    const s = window.RT3D.getState();
    T.push({
      t: performance.now() - t0, phase: s.phase, aPhase: card.getAttribute('data-rt-phase'),
      q: s.quality, aQ: card.getAttribute('data-rt-quality'),
      count: s.streaks.count, visible: s.streaks.visible, opacity: s.streaks.opacity,
      rMin: s.streaks.rMin, rMax: s.streaks.rMax, dir: s.streaks.dir,
      glow: s.tunnel.glow, rot: s.tunnel.rot, draws: s.draws, dy: s.cloud.dy, pose: JSON.stringify(s.pose),
      ratio: cv.width / cv.clientWidth,
    });
  }, 10);
}
const runningReached = () => {
  const T = window.__tl; const r = T.find((s) => s.phase === 'running');
  return !!r && T[T.length - 1].t - r.t >= 700;
};

// 시나리오 1: 기본 화면, 정면→뒤돌기→달리기 전 구간 샘플
async function runningScenario(browser) {
  const { ctx, page } = await openSl(browser);
  try {
    await enterManage(page);
    await page.evaluate(startSampler);
    await page.waitForFunction(runningReached, null, { timeout: 15000, polling: 100 });
    return await page.evaluate(() => window.__tl);
  } finally { await ctx.close(); }
}

// 시나리오 2: 달리기 시작 뒤에 바쁜 루프를 켜서 품질이 1→2→3→4 로 내려가는지 본다(dsf 2: 비율 확인용)
async function busyScenario(browser) {
  const { ctx, page } = await openSl(browser, { dsf: 2 });
  try {
    await enterManage(page);
    await page.evaluate(startSampler);
    await page.waitForFunction(runningReached, null, { timeout: 15000, polling: 100 });
    await page.evaluate(() => { window.__busyAt = performance.now() - window.__t0; window.__busy = true; });
    await page.waitForFunction(() => window.__tl.length > 0 && window.__tl[window.__tl.length - 1].q === 4, null, { timeout: 45000, polling: 200 });
    const t4 = await page.evaluate(() => window.__tl.find((s) => s.q === 4).t);
    // 바쁜 루프를 끄고 3초 더 본다: 한 번 내려간 품질이 다시 올라가면 안 된다
    await page.evaluate(() => { window.__busy = false; });
    await page.waitForFunction((t) => window.__tl.length > 0 && window.__tl[window.__tl.length - 1].t - t >= 3000, t4, { timeout: 15000, polling: 200 });
    const T = await page.evaluate(() => window.__tl);
    const busyAt = await page.evaluate(() => window.__busyAt);
    return { T, busyAt };
  } finally { await ctx.close(); }
}

// 시나리오 3: 조용한 상태 10초(반대 확인)
async function quietScenario(browser) {
  const { ctx, page } = await openSl(browser);
  try {
    await enterManage(page);
    await page.evaluate(startSampler);
    await page.waitForFunction(() => window.__tl.length > 0 && window.__tl[window.__tl.length - 1].t >= 10000, null, { timeout: 20000, polling: 200 });
    const T = await page.evaluate(() => window.__tl);
    const perf = await page.evaluate(() => window.RT3D.getState().perf);
    return { T, perf };
  } finally { await ctx.close(); }
}

// 시나리오 4: 다른 탭(오늘)·document.hidden 에서 rAF 콜백 수 0, 돌아오면 재개, 재개 1초는 품질 판정 안 함
// 2초 측정 창은 "이동하는 순간"부터 연다(이동 뒤 늦게 재면 이동 직후 남은 프레임을 못 본다).
async function hiddenScenario(browser) {
  const { ctx, page } = await openSl(browser);
  const errs = [];
  const info = {};
  try {
    await enterManage(page);
    // A. 오늘 탭 클릭과 같은 순간부터 2초 동안 rAF 콜백 수와 끝 frameloop
    info.todayCalls = await page.evaluate((sel) => new Promise((res) => {
      // 탭 미끄러짐 연출(앱 기존 rAF, 약 0.5초)이 끝난 0.6초부터 2초까지 0 이어야 함 (M12 진행자: 처음엔 연출 rAF 까지 세서 실패)
      document.querySelector(sel).click();
      let a = 0; setTimeout(() => { a = window.__rafN; }, 600);
      setTimeout(() => res({ d: window.__rafN - a, fl: document.querySelector('[data-testid="char-card"]')?.getAttribute('data-frameloop') }), 2000);
    }), tid('tab-today'));
    // B. 관리 탭으로 돌아옴: 1초 안에 rAF 재개, 첫 phase 는 front
    const baseB = await page.evaluate(() => window.__rafN);
    await page.click(tid('tab-manage'));
    await page.waitForFunction((b) => window.__rafN > b, baseB, { timeout: 1000, polling: 20 });
    info.backPhase = await page.evaluate(() => document.querySelector('[data-rt-phase]')?.getAttribute('data-rt-phase'));
    info.backFrameloop = await page.evaluate(() => document.querySelector('[data-testid="char-card"]')?.getAttribute('data-frameloop'));
    // C. document.hidden 흉내: 숨김 이벤트가 오는 순간부터 2초 동안 rAF 0
    info.hiddenCalls = await page.evaluate(() => new Promise((res) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      // 흉내 숨김은 진짜 숨김과 달리 브라우저가 rAF 를 안 멈추므로, 앱이 멈추기까지 0.6초 여유 뒤 2초까지 0 이어야 함 (M12 진행자)
      let a = 0; setTimeout(() => { a = window.__rafN; }, 600);
      setTimeout(() => res({ d: window.__rafN - a, fl: document.querySelector('[data-testid="char-card"]')?.getAttribute('data-frameloop') }), 2000);
    }));
    // D. 다시 보임: 1초 안에 rAF 재개, phase front, 재개 1초 동안 quality 는 0 (판정 건너뜀)
    const baseD = await page.evaluate(() => {
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__rafN;
    });
    await page.waitForFunction((b) => window.__rafN > b, baseD, { timeout: 1000, polling: 20 });
    info.showPhase = await page.evaluate(() => document.querySelector('[data-rt-phase]')?.getAttribute('data-rt-phase'));
    await page.evaluate(() => { window.__busy = true; }); // 끊김 조건을 걸어도 재개 1초는 판정 안 함
    info.resumeQ = await page.evaluate(() => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const iv = setInterval(() => {
        out.push(window.RT3D.getState().quality);
        if (performance.now() - t0 >= 900) { clearInterval(iv); res(out); }
      }, 50);
    }));
    await page.waitForFunction(() => window.RT3D.getState().quality >= 1, null, { timeout: 8000, polling: 200 });
    info.afterQ = await page.evaluate(() => window.RT3D.getState().quality);
  } catch (e) {
    errs.push('진행 중 예외: ' + String(e.message).split('\n')[0]);
  } finally { await ctx.close(); }
  return { info, errs };
}

// 시나리오 5: reduced-motion: 2.2초 동안 100ms 간격
async function reducedScenario(browser) {
  const { ctx, page } = await openSl(browser, { reduced: true });
  try {
    await enterManage(page);
    return await page.evaluate(() => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const iv = setInterval(() => {
        const s = window.RT3D.getState();
        out.push({ t: performance.now() - t0, count: s.streaks.count, visible: s.streaks.visible, rot: s.tunnel.rot, dy: s.cloud.dy, pose: JSON.stringify(s.pose), q: s.quality });
        if (performance.now() - t0 >= 2200) { clearInterval(iv); res(out); }
      }, 100);
    }));
  } finally { await ctx.close(); }
}

// ---------- 판정 (순수 함수: 대조 입력에도 씀) ----------
const judgeReduced = (X) => {
  const e = [];
  if (!X.length) return '샘플 없음';
  if (X.some((s) => s.count !== 0)) e.push(`reduced 인데 동작선 count ${X.find((s) => s.count !== 0).count} (0 기대)`);
  if (X.some((s) => s.visible !== false)) e.push('reduced 인데 동작선 visible=true 순간 있음');
  if (X.some((s) => s.rot !== 0)) e.push(`reduced tunnel.rot=${X.find((s) => s.rot !== 0).rot} (0 고정 기대)`);
  if (X.some((s) => s.dy !== 0)) e.push(`reduced cloud.dy=${X.find((s) => s.dy !== 0).dy} (0 기대)`);
  if (X.some((s) => s.q !== 0)) e.push('reduced 인데 quality 가 0 이 아님');
  const p = X.find((s) => s.t >= X[0].t + 1000);
  if (!p) e.push('1초 뒤 샘플 없음');
  else if (p.pose !== X[0].pose) e.push('reduced 인데 pose 가 1초 사이 바뀜');
  return e.length ? e.join('; ') : true;
};

await run(async (browser) => {
  let runningT = null, busyR = null, quietR = null, hiddenR = null, reducedT = null;
  const getRunning = async () => (runningT ??= await runningScenario(browser));
  const getBusy = async () => (busyR ??= await busyScenario(browser));
  const getQuiet = async () => (quietR ??= await quietScenario(browser));
  const getHidden = async () => (hiddenR ??= await hiddenScenario(browser));
  const getReduced = async () => (reducedT ??= await reducedScenario(browser));

  // ========== M12-0 계약 ==========
  await check('M12-0. 계약: RT3D 키가 명령 7개 그대로(숨은 훅 없음)·명령 전부 function·data-rt-quality 0 으로 시작·routineTracker 문자열 전후 ===', async () => {
    const errs = [];
    const { ctx, page } = await openSl(browser);
    try {
      const raw0 = await getRaw(page);
      await enterManage(page);
      const keys = await page.evaluate(() => Object.keys(window.RT3D).sort());
      if (keys.join() !== FN7.slice().sort().join()) errs.push(`RT3D 키 ${keys.join(',')}`);
      const types = await page.evaluate((names) => names.map((n) => typeof window.RT3D[n]), FN7);
      types.forEach((t, i) => { if (t !== 'function') errs.push(`${FN7[i]} typeof=${t}`); });
      const q0 = await page.locator(CARD).getAttribute('data-rt-quality');
      if (q0 !== '0') errs.push(`시작 data-rt-quality=${q0} (0 기대)`);
      await page.click(tid('tab-today'));
      await page.click(tid('tab-manage'));
      const raw1 = await getRaw(page);
      if (raw0 === null || raw1 !== raw0) errs.push('routineTracker 문자열이 바뀜');
    } finally { await ctx.close(); }
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-1 동작선 등장 ==========
  await check('M12-1. 동작선: front·turning 에 count 0·visible false·opacity 0; running+0.1s opacity 0.35~0.65(<1); +0.35s opacity 1; +0.5s count 14·visible·opacity≥0.8; 드로우콜 front 30 → running +1~2(계획 ≤+2)', async () => {
    const T = await getRunning();
    const errs = [];
    const pre = T.filter((s) => s.phase === 'front' || s.phase === 'turning');
    if (!T.some((s) => s.phase === 'front')) errs.push('front 샘플 없음');
    if (!T.some((s) => s.phase === 'turning')) errs.push('turning 샘플 없음');
    const badPre = pre.filter((s) => s.count !== 0 || s.visible !== false || s.opacity !== 0);
    if (badPre.length) errs.push(`front/turning 에 동작선 ${badPre.length}회 (예: ${badPre[0].phase} count ${badPre[0].count} visible ${badPre[0].visible} opacity ${badPre[0].opacity}; 0·false·0 기대)`);
    const run = T.filter((s) => s.phase === 'running');
    if (!run.length) return 'running 샘플 없음';
    const r0 = run[0].t;
    const at = (ms) => {
      let best = null;
      for (const s of run) if (!best || Math.abs(s.t - (r0 + ms)) < Math.abs(best.t - (r0 + ms))) best = s;
      return best && Math.abs(best.t - (r0 + ms)) <= 40 ? best : null;
    };
    const s100 = at(100), s350 = at(350), s500 = at(500);
    if (!s100 || !s350 || !s500) errs.push('running +0.1/+0.35/+0.5s 샘플 없음');
    else {
      if (!(s100.opacity >= 0.35 && s100.opacity <= 0.65)) errs.push(`running+0.1s opacity ${s100.opacity?.toFixed(3)} (0.35~0.65 기대)`);
      if (!(s350.opacity >= 0.99)) errs.push(`running+0.35s opacity ${s350.opacity?.toFixed(3)} (1 기대)`);
      if (!(s500.count === 14 && s500.visible === true && s500.opacity >= 0.8)) errs.push(`running+0.5s count ${s500.count}·visible ${s500.visible}·opacity ${s500.opacity?.toFixed(3)} (14·true·≥0.8 기대)`);
    }
    const frontDraws = pre.filter((s) => s.phase === 'front').slice(-1)[0]?.draws;
    if (frontDraws !== 34) errs.push(`front 드로우콜 ${frontDraws} (stage4 34 기대: M11 30 + 미래 포털 순백 코어 1 + R1 조형 스카프 2·배낭 덮개 1)`);
    if (s500 && frontDraws !== undefined && (s500.draws - frontDraws < 1 || s500.draws - frontDraws > 2)) errs.push(`running 드로우콜 ${s500.draws} − front ${frontDraws} = ${s500.draws - frontDraws} (+1~2 기대: 계획 원문 ≤+2, 투명 인스턴스가 2번 그려짐)`);
    if (s500 && s500.draws > 39) errs.push(`running 드로우콜 ${s500.draws} (≤39 기대)`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-2 동작선 방향·반지름 ==========
  await check('M12-2. 동작선 방향: running 동안 dir 이 터널 반대(내적 ≤ −0.5, z>0), rMin≥0.6, rMax≤1.2; 대조(터널 쪽 방향·뒤집힌 방향)는 실패', async () => {
    const T = await getRunning();
    const run = T.filter((s) => s.phase === 'running' && s.count > 0);
    if (!run.length) return '동작선 샘플 없음';
    const errs = [];
    const badDir = run.filter((s) => !flowOk(s.dir));
    if (badDir.length) errs.push(`흐름 방향 ${JSON.stringify(badDir[0].dir)} (터널 반대·내적 ≤ −0.5, z>0 기대; 내적 ${dot(nrm(badDir[0].dir), TUN).toFixed(3)})`);
    const minR = Math.min(...run.map((s) => s.rMin)), maxR = Math.max(...run.map((s) => s.rMax));
    if (!(minR >= 0.6)) errs.push(`rMin ${minR} (≥0.6 기대)`);
    if (!(maxR <= 1.2)) errs.push(`rMax ${maxR} (≤1.2 기대)`);
    // 대조: 터널 쪽으로 흐르는 입력과 뒤집힌 입력은 실패해야 한다
    if (flowOk(TUN)) errs.push('대조 실패: 터널 쪽 방향을 통과시킴');
    if (flowOk([0, 0, -1])) errs.push('대조 실패: z<0 방향을 통과시킴');
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-3 반대 확인: 조용하면 quality 0 ==========
  await check('M12-3. 반대 확인: 바쁜 루프 없이 10초 동안 quality 0 유지·data-rt-quality="0"(샘플 300개 이상)', async () => {
    const { T, perf } = await getQuiet();
    note(`조용한 상태 perf.median ${perf?.median}ms (헤드리스 기대 ~40ms)`);
    const errs = [];
    if (T.length < 300) errs.push(`샘플 ${T.length}개 (300 이상 기대)`);
    const up = T.filter((s) => s.q !== 0);
    if (up.length) errs.push(`quality ${up[0].q} 로 올라감 ${up.length}회 (0 기대)`);
    const attr = T.filter((s) => s.aQ !== '0');
    if (attr.length) errs.push(`data-rt-quality=${attr[0].aQ} (0 기대) ${attr.length}회`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-4 끊기면 순서대로 줄임 ==========
  await check('M12-4a. 끊김: 바쁜 루프 뒤 품질 순서 정확히 0→1→2→3→4(건너뜀·역행 0), 1 도달 ≤4s, 4 도달 ≤10s, data-rt-quality 일치, 바쁜 루프 끈 뒤에도 4 유지', async () => {
    const { T, busyAt } = await getBusy();
    const errs = [];
    const seq = [];
    for (const s of T) if (!seq.length || seq[seq.length - 1] !== s.q) seq.push(s.q);
    if (seq.join(',') !== '0,1,2,3,4') errs.push(`품질 순서 ${seq.join('→')} (0→1→2→3→4 기대)`);
    const first = (q) => T.find((s) => s.q >= q);
    const t1 = first(1), t4 = first(4);
    note(`바쁜 루프 뒤 품질 도달: 1 ${t1 ? Math.round(t1.t - busyAt) : '-'}ms, 4 ${t4 ? Math.round(t4.t - busyAt) : '-'}ms`);
    // 계획 설계(시작 후 1초 건너뜀 + 샘플 5개 + 2초 지속)만으로 최소 ~3.4초 + 마운트 → 3초는 설계와 모순. 5초로 (M12 진행자)
    if (!t1 || t1.t - busyAt > 4000) errs.push(`quality 1 도달 ${t1 ? Math.round(t1.t - busyAt) : '없음'}ms (4000ms 안 기대, 단계당 1초 지속)`);
    if (!t4 || t4.t - busyAt > 10000) errs.push(`quality 4 도달 ${t4 ? Math.round(t4.t - busyAt) : '없음'}ms (10000ms 안 기대, 단계당 1초 지속)`);
    const badAttr = T.filter((s) => s.aQ !== String(s.q));
    if (badAttr.length) errs.push(`data-rt-quality 와 getState().quality 다름 ${badAttr.length}회`);
    if (t4 && T.filter((s) => s.t >= t4.t && s.q !== 4).length) errs.push('quality 4 뒤에 값이 바뀜(다시 올라감 포함)');
    // 대조: 같은 판정 함수에 순서가 바뀐 입력을 넣으면 실패해야 한다
    const seqOk = (q) => q.join(',') === '0,1,2,3,4';
    if (seqOk([0, 2, 1, 3, 4]) || !seqOk(seq)) errs.push('대조 실패: 순서 판정이 역순을 통과시키거나 실제 순서를 놓침');
    return errs.length ? errs.join('; ') : true;
  });

  await check('M12-4b. 단계별 값: q1 동작선 7(달리는 중)·q2 동작선 0·q3 이상 tunnel.glow false(q0~2 는 true)·q4 canvas 폭비 ≤1.51 (q0 는 dsf 2 에서 1.5 초과 = 대조)', async () => {
    const { T } = await getBusy();
    const errs = [];
    const by = (q) => T.filter((s) => s.q === q);
    const rs = T.find((s) => s.phase === 'running');
    const q0run = by(0).filter((s) => s.phase === 'running' && rs && s.t >= rs.t + 500);
    if (q0run.some((s) => s.count !== 14)) errs.push(`품질 0 동작선 ${q0run.find((s) => s.count !== 14).count} (14 기대)`);
    const q1run = by(1).filter((s) => s.phase === 'running');
    if (!q1run.length) errs.push('품질 1 에서 달리는 샘플 없음');
    else if (q1run.some((s) => s.count !== 7)) errs.push(`품질 1 동작선 ${q1run.find((s) => s.count !== 7).count} (7 기대)`);
    if (by(2).length === 0) errs.push('품질 2 샘플 없음');
    if (by(2).some((s) => s.count !== 0)) errs.push(`품질 2 동작선 ${by(2).find((s) => s.count !== 0).count} (0 기대)`);
    if (T.filter((s) => s.q >= 2).some((s) => s.count !== 0)) errs.push('품질 2 이후 동작선이 0 이 아님');
    if (T.filter((s) => s.q >= 3).some((s) => s.glow !== false)) errs.push('품질 3 이상인데 tunnel.glow 가 true');
    if (T.filter((s) => s.q < 3).some((s) => s.glow !== true)) errs.push('품질 0~2 인데 tunnel.glow 가 false');
    if (!by(4).length) errs.push('품질 4 샘플 없음');
    // 품질 4 로 바뀐 뒤 200ms 는 캔버스 크기 갱신 중일 수 있어 따로 센다(과도 기간), 그 뒤 값이 1.5 를 넘으면 실패
    const q4s = by(4), q4t0 = q4s.length ? q4s[0].t : 0;
    const trans = q4s.filter((s) => s.t - q4t0 < 200 && s.ratio > 1.51).length;
    const bad4 = q4s.filter((s) => s.t - q4t0 >= 200 && s.ratio > 1.51);
    if (trans) note(`품질 4 과도기(200ms 안) 폭비 1.5 초과 샘플 ${trans}개 (실패 아님, 기록)`);
    if (bad4.length) errs.push(`품질 4 canvas 폭비 ${bad4[0].ratio.toFixed(3)} (≤1.51 기대, 200ms 뒤 기준): 나쁜 샘플 ${bad4.length}개`);
    // 대조: dsf 2 에서 품질 0 의 비율은 1.5 를 넘어야 한다(아니면 위 비율 검사가 쓸모없음)
    if (!by(0).some((s) => s.ratio > 1.5)) errs.push('대조 실패: dsf 2 인데 품질 0 비율이 1.5 이하');
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-5 안 보일 때 멈춤 ==========
  await check('M12-5. 안 보일 때 멈춤: 오늘 탭·document.hidden 0.6~2초 rAF 0·frameloop never; 돌아오면 1초 안 rAF 재개·phase front; 재개 1초 동안 quality 0(판정 건너뜀)', async () => {
    const { info, errs } = await getHidden();
    if (info.todayCalls) {
      if (info.todayCalls.d !== 0) errs.push(`오늘 탭으로 옮긴 순간부터 2초 rAF ${info.todayCalls.d}회 (0 기대)`);
      if (info.todayCalls.fl !== 'never') errs.push(`오늘 탭 frameloop=${info.todayCalls.fl} (never 기대)`);
    }
    if (info.hiddenCalls) {
      if (info.hiddenCalls.d !== 0) errs.push(`숨김 순간부터 2초 rAF ${info.hiddenCalls.d}회 (0 기대)`);
      if (info.hiddenCalls.fl !== 'never') errs.push(`숨김 frameloop=${info.hiddenCalls.fl} (never 기대)`);
    }
    if (info.backFrameloop !== undefined && info.backFrameloop !== 'always') errs.push(`관리 복귀 frameloop=${info.backFrameloop} (always 기대)`);
    if (info.backPhase !== undefined && info.backPhase !== 'front') errs.push(`관리 복귀 첫 phase ${info.backPhase} (front 기대)`);
    if (info.showPhase !== undefined && info.showPhase !== 'front') errs.push(`보임 복귀 첫 phase ${info.showPhase} (front 기대)`);
    if (info.resumeQ && info.resumeQ.some((q) => q !== 0)) errs.push(`재개 1초 안 quality ${Math.max(...info.resumeQ)} (0 기대: 판정 건너뜀)`);
    if (info.afterQ !== undefined && info.afterQ < 1) errs.push(`재개 뒤 판정이 다시 안 돎(quality ${info.afterQ})`);
    // 대조: 복귀 뒤에는 rAF 가 실제로 돌아야 한다(위 0 이 "원래 안 돎"이 아님을 보임) — B·D 단계에서 확인함
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M12-6 reduced-motion ==========
  await check('M12-6. reduced-motion: 동작선 count 0·visible false, tunnel.rot 0 고정, cloud.dy 0, pose 1초 간격 같음, quality 0; 대조(회전·흔들림 입력)는 실패', async () => {
    const X = await getReduced();
    const errs = [];
    const j = judgeReduced(X);
    if (j !== true) errs.push(j);
    if (judgeReduced(X.map((s, i) => ({ ...s, rot: i * 0.05 }))) === true) errs.push('대조 실패: 회전하는 입력을 통과시킴');
    if (judgeReduced(X.map((s, i) => ({ ...s, pose: JSON.stringify({ yaw: i }) }))) === true) errs.push('대조 실패: 흔들리는 pose 를 통과시킴');
    return errs.length ? errs.join('; ') : true;
  });
});
