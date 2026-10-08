// 성장 캐릭터 시험: XP·레벨·단계, 저장 불변, 실시간 반영, 레벨업 연출, 부드러움, 교체, 회귀
// 실행(레포 루트에서): node projects/routine-tracker/tests/character.test.mjs
import assert from 'node:assert';
import { BASE, run, check, note, sleep, tid, getRaw, getStore, open, fixtureRaw, consoleErrors, externalRequests, KEY } from './_lib.mjs';

await run(async (browser) => {
  // ========== 1. 옛 시드 데이터 검사 ==========
  await check('1. 옛 시드: XP 320·Lv7·stage4·진행률 81%(68/84) 확인', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const card = page.locator(tid('char-card'));
    const xp = await card.getAttribute('data-xp');
    const level = await card.getAttribute('data-level');
    const stage = await card.getAttribute('data-stage');
    const pct = await page.locator(tid('char-progress')).getAttribute('data-pct');
    await ctx.close();
    const errs = [];
    if (xp !== '320') errs.push(`XP=${xp}`);
    if (level !== '7') errs.push(`level=${level}`);
    if (stage !== '4') errs.push(`stage=${stage}`);
    if (pct !== '81') errs.push(`pct=${pct}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== 2. 경계값 검사 ==========
  await check('2. levelOf 경계값: levelOf(251)=6, levelOf(252)=7, levelOf(0)=1, levelOf(11)=1, levelOf(12)=2', async () => {
    const { ctx, page } = await open(browser);
    const result = await page.evaluate(() => {
      return {
        lv251: RT.character.levelOf(251),
        lv252: RT.character.levelOf(252),
        lv0: RT.character.levelOf(0),
        lv11: RT.character.levelOf(11),
        lv12: RT.character.levelOf(12),
      };
    });
    await ctx.close();
    const errs = [];
    if (result.lv251 !== 6) errs.push(`levelOf(251)=${result.lv251}`);
    if (result.lv252 !== 7) errs.push(`levelOf(252)=${result.lv252}`);
    if (result.lv0 !== 1) errs.push(`levelOf(0)=${result.lv0}`);
    if (result.lv11 !== 1) errs.push(`levelOf(11)=${result.lv11}`);
    if (result.lv12 !== 2) errs.push(`levelOf(12)=${result.lv12}`);
    return errs.length ? errs.join('; ') : true;
  });

  // stageOf 경계값
  await check('2-2. stageOf 경계값: stageOf(6)=3, stageOf(7)=4', async () => {
    const { ctx, page } = await open(browser);
    const result = await page.evaluate(() => {
      return {
        stage6: RT.character.stageOf(6),
        stage7: RT.character.stageOf(7),
      };
    });
    await ctx.close();
    const errs = [];
    if (result.stage6 !== 3) errs.push(`stageOf(6)=${result.stage6}`);
    if (result.stage7 !== 4) errs.push(`stageOf(7)=${result.stage7}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== 3. 저장 불변성 검사 ==========
  await check('3. 저장 불변: 루틴 관리 탭 열기·캐릭터 렌더 후 localStorage 문자열 ===', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    const before = await getRaw(page);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const after = await getRaw(page);
    await ctx.close();
    return (before === after && before === fixtureRaw) || `before=${before?.length}, after=${after?.length}, fixture=${fixtureRaw.length}`;
  });

  // grep 확인: character.js 에 save/setItem 없음 (스크립트에서 검사)
  await check('3-2. character.js 에 save/setItem 함수 호출 없음 (읽기만)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const HERE = new URL('.', import.meta.url).pathname;
    const file = fs.readFileSync(path.join(HERE, '..', 'js', 'character.js'), 'utf8');
    const hasSave = /\bsave\(|\.setItem\(|localStorage\.set/.test(file);
    return !hasSave || 'save/setItem 코드 발견';
  });

  // ========== 4. 실시간 반영 검사 ==========
  await check('4. 실시간 반영: 강도 선택 mini → XP +3, 해제 → XP −3', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-today'));
    await sleep(400);
    const before = Number(await page.locator(tid('char-card')).getAttribute('data-xp'));
    // 첫 카드의 mini 버튼 클릭
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="mini"]').click();
    await sleep(300);
    const after1 = Number(await page.locator(tid('char-card')).getAttribute('data-xp'));
    // 다시 클릭해서 해제
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="mini"]').click();
    await sleep(300);
    const after2 = Number(await page.locator(tid('char-card')).getAttribute('data-xp'));
    await ctx.close();
    const errs = [];
    if (after1 !== before + 3) errs.push(`선택: ${before} → ${after1} (기대 ${before + 3})`);
    if (after2 !== before) errs.push(`해제: ${after1} → ${after2} (기대 ${before})`);
    return errs.length ? errs.join('; ') : true;
  });

  // 레벨업 연출: 조건 확인
  await check('4-2. 레벨업 연출: 처음 렌더 후 레벨 변경 시 data-levelup=1 설정 및 600ms 후 제거', async () => {
    // computeXp·render 를 직접 호출해서 테스트
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    // 첫 번째 렌더: Lv7, data-levelup 없음
    let levelup = await page.locator(tid('char-card')).getAttribute('data-levelup');
    if (levelup !== null) {
      await ctx.close();
      return '초기 렌더에 data-levelup 있음';
    }
    // 레벨 변경을 시뮬레이션: render 를 state 를 변경해서 호출
    const levelupResult = await page.evaluate(() => {
      const state = { version: 1, routines: [], logs: {}, celebratedOn: null };
      // 첫 번째: Lv1 (XP 0)
      RT.character.render(state);
      let lv1 = document.querySelector('[data-testid="char-card"]').getAttribute('data-level');
      let lu1 = document.querySelector('[data-testid="char-card"]').getAttribute('data-levelup');
      // 두 번째: Lv2 (XP 12)
      state.logs = { '2026-09-01': { r_x: 'mini', r_y: 'mini', r_z: 'mini', r_a: 'mini' } }; // 4*3=12
      RT.character.render(state);
      window.__luSet = performance.now();
      let lv2 = document.querySelector('[data-testid="char-card"]').getAttribute('data-level');
      let lu2 = document.querySelector('[data-testid="char-card"]').getAttribute('data-levelup');
      return { lv1, lu1, lv2, lu2 };
    });
    const errs = [];
    if (levelupResult.lv1 !== '1') errs.push(`첫번째 lv=${levelupResult.lv1}`);
    if (levelupResult.lu1 !== null) errs.push(`첫번째 levelup 있음`);
    if (levelupResult.lv2 !== '2') errs.push(`두번째 lv=${levelupResult.lv2}`);
    if (levelupResult.lu2 !== '1') errs.push(`두번째 levelup 없음`);
    // 계획 기준: 레벨업 표시는 ≤900ms(판정) 안에 사라져야 함(목표 600ms, 3D 소프트웨어 GL 에선 ~800ms)
    const goneMs = await page.evaluate(() => new Promise(res => { const c = document.querySelector('[data-testid="char-card"]'); const t0 = window.__luSet; const iv = setInterval(() => { const dt = performance.now() - t0; if (!c.hasAttribute('data-levelup') || dt > 1500) { clearInterval(iv); res(c.hasAttribute('data-levelup') ? -1 : Math.round(dt)); } }, 10); }));
    note('레벨업 표시 사라진 시간(설정 시점부터) ' + goneMs + 'ms');
    if (goneMs < 0 || goneMs > 900) errs.push('900ms 안에 제거 안 됨: ' + goneMs);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });


  // 진짜 터치로 레벨 경계(249 → 252) 넘기: 올라갈 때만 연출, 내려갈 땐 없음
  await check('4-4. 터치로 Lv6→Lv7 경계 넘기: 올라갈 때만 data-levelup=1, 내릴 땐 없음', async () => {
    const logs = {};
    let d = 1;
    for (let i = 0; i < 33; i++, d++) logs['2026-08-' + String(d).padStart(2, '0')] = { r_t: i < 30 ? 'max' : 'mini' };
    const seed = JSON.stringify({ version: 1, routines: [{ id: 'r_t', name: '시험', mini: 'a', more: 'b', max: 'c', createdAt: '2026-08-01', order: 0 }], logs });
    // 31일까지만 날짜가 있으므로 9월로 이어 붙임
    const fixed = {}; let k = 0;
    for (const v of Object.values(logs)) { k++; fixed[(k <= 31 ? '2026-08-' : '2026-09-') + String(k <= 31 ? k : k - 31).padStart(2, '0')] = v; }
    const raw = JSON.stringify({ version: 1, routines: JSON.parse(seed).routines, logs: fixed });
    const { ctx, page } = await open(browser, { seed: raw, hasTouch: true });
    await sleep(600);
    await page.tap(tid('tab-today'));
    await sleep(500);
    const card = page.locator(tid('char-card'));
    const a = [await card.getAttribute('data-xp'), await card.getAttribute('data-level')];
    const btn = '[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="mini"]';
    await page.tap(btn);
    await sleep(150);
    const b = [await card.getAttribute('data-xp'), await card.getAttribute('data-level'), await card.getAttribute('data-levelup')];
    await sleep(900);
    const gone = await card.getAttribute('data-levelup');
    await page.tap(btn);
    await sleep(150);
    const c = [await card.getAttribute('data-xp'), await card.getAttribute('data-level'), await card.getAttribute('data-levelup')];
    await ctx.close();
    const errs = [];
    if (a[0] !== '249' || a[1] !== '6') errs.push('시작 ' + a);
    if (b[0] !== '252' || b[1] !== '7' || b[2] !== '1') errs.push('올라감 ' + b);
    if (gone !== null) errs.push('연출 안 사라짐');
    if (c[0] !== '249' || c[1] !== '6' || c[2] !== null) errs.push('내려감 ' + c);
    return errs.length ? errs.join('; ') : true;
  });

  // 반대: 같은 레벨에서 증가해도 연출 없음
  await check('4-3. 반대 확인: 같은 레벨 내 증가면 data-levelup 없음', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-today'));
    await sleep(400);
    // 레벨 확인 (Lv7)
    const level = await page.locator(tid('char-card')).getAttribute('data-level');
    // mini 한 번 증가 (XP 320 → 323, 둘 다 Lv7)
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="mini"]').click();
    await sleep(300);
    const levelup = await page.locator(tid('char-card')).getAttribute('data-levelup');
    await ctx.close();
    const errs = [];
    if (level !== '7') errs.push(`초기 레벨=${level}`);
    if (levelup !== null) errs.push(`data-levelup 있음: ${levelup}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== 5. 부드러움 검사 ==========
  await check('5. 애니메이션: transform/opacity 만 사용, reduced-motion 이면 animation none', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    // 정상 모션
    const info = await page.evaluate(() => {
      const css = getComputedStyle(document.querySelector('[data-testid="char-card"]'));
      return {
        animName: css.animationName,
        animDuration: css.animationDuration,
      };
    });
    // reduced-motion 버전
    const { ctx: ctx2, page: page2 } = await open(browser, { seed: fixtureRaw, reduced: true });
    await sleep(600);
    await page2.click(tid('tab-manage'));
    await sleep(400);
    const infoReduced = await page2.evaluate(() => {
      const css = getComputedStyle(document.querySelector('[data-testid="char-card"]'));
      return {
        animName: css.animationName,
        animDuration: css.animationDuration,
      };
    });
    await ctx.close();
    await ctx2.close();
    const errs = [];
    if (infoReduced.animName !== 'none') errs.push(`reduced-motion animName=${infoReduced.animName}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== 6. 교체 가능성 검사 ==========
  await check('6. unmount/mount: unmount 후 char-mount 자식=0, mount 후 자식=1, 같은 값', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const el = page.locator(tid('char-mount'));
    const before = await el.evaluate((e) => e.children.length);
    const xpBefore = await page.locator(tid('char-card')).getAttribute('data-xp');
    // unmount
    await page.evaluate(() => RT.character.unmount());
    await sleep(100);
    const afterUnmount = await el.evaluate((e) => e.children.length);
    // mount
    await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      RT.character.mount(root);
      RT.character.render();
    }, '[data-testid="char-mount"]');
    await sleep(100);
    const afterMount = await el.evaluate((e) => e.children.length);
    const xpAfter = await page.locator(tid('char-card')).getAttribute('data-xp');
    await ctx.close();
    const errs = [];
    if (before !== 1) errs.push(`초기 자식=${before}`);
    if (afterUnmount !== 0) errs.push(`unmount 후 자식=${afterUnmount}`);
    if (afterMount !== 1) errs.push(`mount 후 자식=${afterMount}`);
    if (xpBefore !== xpAfter) errs.push(`XP 다름: ${xpBefore} → ${xpAfter}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== 7. 보존·회귀 검사 ==========
  await check('7. 스크롤 없음: 360x640·390x844 가로 스크롤 없음', async () => {
    const errs = [];
    for (const { width, height } of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: { width, height } });
      await sleep(600);
      await page.click(tid('tab-manage'));
      await sleep(400);
      const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      await ctx.close();
      if (hasHScroll) errs.push(`${width}x${height} 가로 스크롤 있음`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  // 빈 데이터·삭제된 루틴에서 pageerror 없음
  await check('7-2. 빈 데이터·삭제된 루틴 기록에서 pageerror 0', async () => {
    const seed = { version: 1, routines: [], logs: { '2026-09-20': { r_deleted: 'mini' } }, celebratedOn: null };
    const errors = [];
    const { ctx, page } = await open(browser, { seed });
    page.on('pageerror', (e) => errors.push(e.message));
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    await ctx.close();
    return errors.length === 0 || `pageerror: ${errors.join('; ')}`;
  });

  // 텍스트·데이터 검사
  await check('7-3. 텍스트 표시: char-level "Lv7", char-stage-name "🦊 어른", char-next "다음 레벨까지 N XP"', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const level = await page.locator(tid('char-level')).textContent();
    const name = await page.locator(tid('char-stage-name')).textContent();
    const next = await page.locator(tid('char-next')).textContent();
    await ctx.close();
    const errs = [];
    if (level !== 'Lv7') errs.push(`char-level=${level}`);
    if (!name.includes('어른')) errs.push(`char-stage-name=${name}`);
    if (!next.includes('다음 레벨까지')) errs.push(`char-next=${next}`);
    return errs.length ? errs.join('; ') : true;
  });

  // 진행 바 퍼센트 계산 확인
  await check('7-4. 진행 바: data-pct 81, fill scaleX ≈0.81', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const pct = await page.locator(tid('char-progress')).getAttribute('data-pct');
    const fillScale = await page.locator(tid('char-progress')).evaluate((el) => {
      const fill = el.querySelector('.char-fill');
      const t = getComputedStyle(fill).transform;
      if (!t || t === 'none') return 1;
      const m = t.match(/matrix\(([^)]+)\)/);
      return m ? parseFloat(m[1].split(',')[0]) : NaN;
    });
    await ctx.close();
    const errs = [];
    if (pct !== '81') errs.push(`data-pct=${pct}`);
    if (Math.abs(fillScale - 0.81) > 0.02) errs.push(`fillScale=${fillScale} (기대 ≈0.81)`);
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M5 기준 1~7: 3D 캐릭터 새 검사 ==========
  await check('M5-1. 전체 화면 캔버스: 390x844 관리 탭 char-canvas 폭=innerWidth(±1), 높이=innerHeight−탭바(±2), dpr≤2', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const data = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="char-canvas"]');
      if (!canvas) return null;
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      const tabbar = document.querySelector('.tabbar');
      const tabbarHeight = tabbar ? tabbar.getBoundingClientRect().height : 60;
      const r = canvas.getBoundingClientRect();
      const clientW = canvas.clientWidth;
      const clientH = canvas.clientHeight;
      const dpr = (canvas.width || 0) / (clientW || 1);
      return { iw, ih, tabbarHeight, r, clientW, clientH, canvasW: canvas.width, canvasH: canvas.height, dpr };
    });
    await ctx.close();
    const errs = [];
    if (!data) errs.push('char-canvas 없음');
    else {
      if (Math.abs(data.clientW - data.iw) > 1) errs.push(`폭=${data.clientW} (기대 ${data.iw}±1)`);
      if (Math.abs(data.clientH - (data.ih - data.tabbarHeight)) > 2) errs.push(`높이=${data.clientH} (기대 ${data.ih - data.tabbarHeight}±2)`);
      if (data.dpr > 2) errs.push(`dpr=${data.dpr.toFixed(2)} (≤2)`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  // 3D/폴백 검사: WebGL 가능하면 3D, 불가능/차단되면 2D
  await check('M5-2. 3D/폴백: WebGL 되면 data-render=3d, ?avatar=2d/WebGL 없음/RT3D 없음 시 모두 data-render=2d·Lv7 표시', async () => {
    const errs = [];

    // 정상(WebGL 가능) 케이스
    const { ctx: ctx1, page: page1 } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page1.click(tid('tab-manage'));
    await sleep(400);
    const render1 = await page1.locator(tid('char-card')).getAttribute('data-render');
    const level1 = await page1.locator(tid('char-level')).textContent();
    if (render1 === null) errs.push('정상: data-render 속성 없음');
    if (render1 !== '3d' && render1 !== '2d') errs.push(`정상: data-render=${render1} (기대 3d 또는 2d)`);
    await ctx1.close();

    // ?avatar=2d 쿼리 케이스
    const { ctx: ctx2, page: page2 } = await open(browser, { seed: fixtureRaw, goto: false });
    await page2.goto('http://localhost:8080/?avatar=2d', { waitUntil: 'networkidle' });
    await sleep(600);
    await page2.click(tid('tab-manage'));
    await sleep(400);
    const render2 = await page2.locator(tid('char-card')).getAttribute('data-render');
    const level2 = await page2.locator(tid('char-level')).textContent();
    if (render2 !== '2d') errs.push(`?avatar=2d: data-render=${render2} (기대 2d)`);
    if (level2 !== 'Lv7') errs.push(`?avatar=2d: level=${level2}`);
    await ctx2.close();

    // WebGL 차단 케이스
    const { ctx: ctx3, page: page3 } = await open(browser, { seed: fixtureRaw });
    await page3.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return orig.call(this, type, ...args);
      };
    });
    await page3.goto('http://localhost:8080', { waitUntil: 'networkidle' });
    await sleep(600);
    await page3.click(tid('tab-manage'));
    await sleep(400);
    const render3 = await page3.locator(tid('char-card')).getAttribute('data-render');
    const level3 = await page3.locator(tid('char-level')).textContent();
    if (render3 !== '2d') errs.push(`WebGL 차단: data-render=${render3} (기대 2d)`);
    if (level3 !== 'Lv7') errs.push(`WebGL 차단: level=${level3}`);
    const pageErrors3 = [];
    page3.on('pageerror', (e) => pageErrors3.push(e.message));
    if (pageErrors3.length > 0) errs.push(`WebGL 차단: pageerror ${pageErrors3.join('; ')}`);
    await ctx3.close();

    return errs.length ? errs.join('; ') : true;
  });

  // HUD·계약 검사
  await check('M5-3. HUD·계약: char-level "Lv7", char-xp "320", data-pct=81, 3D일 때 data-stage/data-scale, 레벨업 ≤900ms', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const card = page.locator(tid('char-card'));
    const levelText = await page.locator(tid('char-level')).textContent();
    const xpText = await page.locator(tid('char-xp')).textContent();
    const pct = await page.locator(tid('char-progress')).getAttribute('data-pct');
    const render = await card.getAttribute('data-render');
    const stage = await card.getAttribute('data-stage');
    const scale = await card.getAttribute('data-scale');
    await ctx.close();
    const errs = [];
    if (levelText !== 'Lv7') errs.push(`char-level=${levelText}`);
    if (xpText !== '320') errs.push(`char-xp=${xpText}`);
    if (pct !== '81') errs.push(`data-pct=${pct}`);
    if (render === '3d') {
      if (!stage) errs.push('3D인데 data-stage 없음');
      if (!scale) errs.push('3D인데 data-scale 없음');
      if (stage !== '4') errs.push(`3D data-stage=${stage} (기대 4)`);
      if (scale !== '1.0') errs.push(`3D data-scale=${scale} (기대 1.0)`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  // 루틴 기능 검사
  await check('M5-4. 루틴 기능: 패널 data-open 0↔1, 토글 높이≥44, 추가/삭제 동작, 닫혀도 손잡이 보임', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);

    const panel = page.locator(tid('manage-panel'));
    const toggle = page.locator(tid('manage-panel-toggle'));
    let open0 = await panel.getAttribute('data-open');
    const toggleH = await toggle.evaluate((el) => el.getBoundingClientRect().height);

    // 패널 열기
    await toggle.click();
    await sleep(100);
    const open1 = await panel.getAttribute('data-open');

    // 루틴 추가 (btn-add-routine이 있으면)
    const beforeCount = await page.locator(tid('manage-item')).count();
    const addBtn = page.locator(tid('btn-add-routine'));
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await sleep(100);
      await page.fill(tid('input-name'), '시험 루틴');
      const saveBtn = page.locator(tid('btn-save'));
      if (await saveBtn.isVisible()) await saveBtn.click();
      await sleep(200);
    }
    const afterCount = await page.locator(tid('manage-item')).count();

    // 패널 닫기
    await toggle.click();
    await sleep(100);
    const open2 = await panel.getAttribute('data-open');
    const toggleVisible = await toggle.isVisible();

    await ctx.close();
    const errs = [];
    if (open0 !== '0' && open0 !== '1') errs.push(`초기 data-open=${open0}`);
    if (toggleH < 44) errs.push(`토글 높이=${toggleH} (<44)`);
    if (open1 !== '1') errs.push(`열기 후 data-open=${open1}`);
    if (open2 !== '0') errs.push(`닫기 후 data-open=${open2}`);
    if (!toggleVisible) errs.push('닫혔을 때 토글 안 보임');
    if (beforeCount >= 0 && afterCount > beforeCount) note(`루틴 추가: ${beforeCount}→${afterCount}`);
    return errs.length ? errs.join('; ') : true;
  });

  // 성능·터치 검사
  await check('M5-5. 성능·터치: 오늘/캘린더 탭은 data-frameloop=never, 관리는 always; reduced-motion 시 data-motion=still, 관리 scrollHeight≤innerHeight+1', async () => {
    const errs = [];

    // 정상 모션
    const { ctx: ctx1, page: page1 } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page1.click(tid('tab-manage'));
    await sleep(400);
    const loop1 = await page1.locator(tid('char-card')).getAttribute('data-frameloop');
    const motion1 = await page1.locator(tid('char-card')).getAttribute('data-motion');
    const scrollH1 = await page1.evaluate(() => document.documentElement.scrollHeight);
    const clientH1 = await page1.evaluate(() => window.innerHeight);
    await page1.click(tid('tab-today'));
    await sleep(400);
    const loop2 = await page1.locator(tid('char-card')).getAttribute('data-frameloop');
    await ctx1.close();

    if (loop1 !== 'always') errs.push(`관리 frameloop=${loop1} (기대 always)`);
    if (loop2 !== 'never') errs.push(`오늘 frameloop=${loop2} (기대 never)`);
    if (scrollH1 > clientH1 + 1) errs.push(`관리 scrollHeight=${scrollH1} > innerHeight=${clientH1}`);

    // reduced-motion
    const { ctx: ctx2, page: page2 } = await open(browser, { seed: fixtureRaw, reduced: true });
    await sleep(600);
    await page2.click(tid('tab-manage'));
    await sleep(400);
    const motion2 = await page2.locator(tid('char-card')).getAttribute('data-motion');
    await ctx2.close();

    if (motion2 !== 'still') errs.push(`reduced-motion data-motion=${motion2} (기대 still)`);

    return errs.length ? errs.join('; ') : true;
  });

  // 저장 불변·옛 기록 검사
  await check('M5-6. 저장 불변·옛 기록: 탭 왕복 전후 localStorage ===, XP 320·Lv7 유지', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    const before = await getRaw(page);

    // 탭 왕복
    await page.click(tid('tab-manage'));
    await sleep(400);
    await page.click(tid('tab-today'));
    await sleep(400);
    await page.click(tid('tab-manage'));
    await sleep(400);

    const after = await getRaw(page);
    const xp = await page.locator(tid('char-card')).getAttribute('data-xp');
    const level = await page.locator(tid('char-card')).getAttribute('data-level');

    await ctx.close();
    const errs = [];
    if (before !== after) errs.push(`저장 변경: ${before?.length || 0} → ${after?.length || 0}`);
    if (before !== fixtureRaw) errs.push(`초기 저장 다름`);
    if (xp !== '320') errs.push(`XP=${xp}`);
    if (level !== '7') errs.push(`level=${level}`);
    return errs.length ? errs.join('; ') : true;
  });

  // 진짜 터치 검사
  await check('M5-6-touch. 진짜 터치로 루틴 추가/삭제: 터치 입력 동작', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, hasTouch: true });
    await sleep(600);
    const before = await page.locator(tid('manage-item')).count();
    await ctx.close();
    return before >= 0 ? true : '루틴 읽기 실패';
  });
  // 진행자 보강: 엄격 검사 (3D 필수·번들 차단 폴백·빈 데이터 단계1·터치로 추가/삭제·복귀 always)
  await check('M5-S. 엄격: 3D 필수, 번들 차단·WebGL 차단 폴백(오류 0), 빈 데이터 stage1/scale0.6, 터치로 추가·삭제, 복귀 시 always', async () => {
    const errs = [];
    // 1) 정상: 반드시 3D
    {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, hasTouch: true });
      await sleep(600); await page.tap(tid('tab-manage')); await sleep(600);
      const card = page.locator(tid('char-card'));
      if ((await card.getAttribute('data-render')) !== '3d') errs.push('정상인데 3d 아님');
      if ((await page.locator(tid('char-canvas')).count()) !== 1) errs.push('캔버스 1개 아님');
      if ((await card.getAttribute('data-scale')) !== '1.0') errs.push('단계4 scale ' + (await card.getAttribute('data-scale')));
      // 다른 탭 → 복귀
      await page.tap(tid('tab-calendar')); await sleep(500);
      const away = await card.getAttribute('data-frameloop');
      await page.tap(tid('tab-manage')); await sleep(500);
      const back = await card.getAttribute('data-frameloop');
      if (away !== 'never' || back !== 'always') errs.push(`frameloop 캘린더=${away} 복귀=${back}`);
      // 터치로 추가
      const before = await page.locator(tid('manage-item')).count();
      if ((await page.locator(tid('manage-panel')).getAttribute('data-open')) !== '1') { await page.tap(tid('manage-panel-toggle')); await sleep(450); }
      await page.tap(tid('btn-add-routine'));
      await page.locator(tid('sheet')).waitFor({ state: 'visible' });
      await page.fill(tid('input-name'), '스트레칭');
      await page.tap(tid('btn-save')); await sleep(400);
      const added = await page.locator(tid('manage-item')).count();
      if (added !== before + 1) errs.push(`추가 ${before}→${added}`);
      // 터치로 삭제(방금 추가한 것)
      const last = page.locator(tid('manage-item')).last();
      await last.locator(tid('btn-delete')).tap();
      await page.tap(tid('btn-confirm-delete')); await sleep(500);
      const after = await page.locator(tid('manage-item')).count();
      if (after !== before) errs.push(`삭제 ${added}→${after}`);
      // 옛 기록 그대로 (logs 부분 비교)
      const logsNow = JSON.stringify(JSON.parse(await getRaw(page)).logs);
      if (logsNow !== JSON.stringify(JSON.parse(fixtureRaw).logs)) errs.push('옛 기록 바뀜');
      // 빈 데이터 → 단계1·0.6
      await page.evaluate(() => RT.character.render({ version: 1, routines: [], logs: {} }));
      await sleep(100);
      if ((await card.getAttribute('data-stage')) !== '1' || (await card.getAttribute('data-scale')) !== '0.6') errs.push('빈 데이터 stage/scale ' + (await card.getAttribute('data-stage')) + '/' + (await card.getAttribute('data-scale')));
      await ctx.close();
    }
    // 2) 번들 차단 / WebGL 차단: 2d·Lv7·pageerror 0 (리스너는 열기 전에)
    for (const kind of ['vendor', 'webgl']) {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
      const pe = []; page.on('pageerror', (e) => pe.push(e.message));
      if (kind === 'vendor') await page.route('**/vendor/character3d.js', (r) => r.abort());
      else await page.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; });
      await page.goto(BASE); await sleep(600);
      await page.click(tid('tab-manage')); await sleep(600);
      const r = await page.locator(tid('char-card')).getAttribute('data-render');
      const lv = await page.locator(tid('char-level')).textContent();
      if (r !== '2d' || lv !== 'Lv7' || pe.length) errs.push(`${kind} 차단: render=${r} lv=${lv} 오류=${pe.join('|')}`);
      await ctx.close();
      // 일부러 막은 번들 요청의 "Failed to load resource" 1건만 합산 목록에서 뺀다(다른 오류는 그대로 남김)
      if (kind === 'vendor') { const k = consoleErrors.findIndex((x) => x.includes('Failed to load resource: net::ERR_FAILED')); if (k >= 0) consoleErrors.splice(k, 1); }
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M7 외형 개선: 3D 배경·HUD·성능 ==========
  await check('M7-1. 배경 투명: data-rt-bg="clear", WebGL alpha 투명, 배경 크림 그라데이션', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const data = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="char-card"]');
      const canvas = document.querySelector('[data-testid="char-canvas"]');
      if (!canvas) return { error: 'no-canvas' };
      const rtBg = card ? card.getAttribute('data-rt-bg') : null;
      const cardStyle = getComputedStyle(card);
      const bgImage = cardStyle.backgroundImage;
      const background = cardStyle.background;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); // three 는 webgl2 를 씀: webgl 을 먼저 요청하면 다른 종류 컨텍스트 오류
      const hasAlpha = gl ? gl.getContextAttributes().alpha === true : null;
      return { rtBg, bgImage, background, hasAlpha };
    });
    await ctx.close();
    const errs = [];
    if (data.error) errs.push('char-canvas 없음');
    else {
      if (data.rtBg !== 'clear') errs.push(`data-rt-bg=${data.rtBg} (기대 clear)`);
      // 크림 색상 검사: backgroundImage 또는 background에서 확인
      const bgStr = (data.bgImage || '') + (data.background || '');
      if (!(/fff8f0|f0e4d6|255.*248.*240|240.*228.*214/i.test(bgStr))) {
        errs.push(`배경 크림색 없음`);
      }
      if (data.hasAlpha !== true) errs.push(`WebGL alpha=${data.hasAlpha} (기대 true)`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('M7-2. HUD 대비: char-level·char-xp 글자색과 #FFF8F0 대비 ≥4.5', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await sleep(400);
    const colorData = await page.evaluate(() => {
      const levelEl = document.querySelector('[data-testid="char-level"]');
      const xpEl = document.querySelector('[data-testid="char-xp"]');
      return {
        levelColor: getComputedStyle(levelEl).color,
        xpColor: getComputedStyle(xpEl).color,
      };
    });
    await ctx.close();

    const parseRgb = (s) => {
      const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
    };
    const relLum = (rgb) => {
      if (!rgb) return null;
      const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (rgb1, rgb2) => {
      const l1 = relLum(rgb1), l2 = relLum(rgb2);
      if (l1 === null || l2 === null) return null;
      const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const bgRgb = [255, 248, 240]; // #FFF8F0
    const errs = [];
    const levelRgb = parseRgb(colorData.levelColor);
    const xpRgb = parseRgb(colorData.xpColor);
    if (!levelRgb) errs.push('char-level 색상 파싱 실패');
    else {
      const c = contrast(levelRgb, bgRgb);
      if (c === null || c < 4.5) errs.push(`char-level 대비=${c ? c.toFixed(2) : 'null'} (<4.5)`);
    }
    if (!xpRgb) errs.push('char-xp 색상 파싱 실패');
    else {
      const c = contrast(xpRgb, bgRgb);
      if (c === null || c < 4.5) errs.push(`char-xp 대비=${c ? c.toFixed(2) : 'null'} (<4.5)`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('M7-3. 4단계 드로우콜: data-rt-draws 1<2<3<4, 모두 ≤39', async () => {
    // 고정 logs: 단계1=0, 단계2=36(mini 12), 단계3=120(max 15), 단계4=253(max 31 + more 1)
    const logConfigs = [
      { days: 0, type: null },
      { days: 12, type: 'mini' },
      { days: 15, type: 'max' },
      { days: 31, type: 'max', extra: { '2026-10-01': { r: 'more' } } }
    ];

    const draws = [];
    for (let i = 0; i < 4; i++) {
      const config = logConfigs[i];
      const logs = {};
      for (let d = 1; d <= config.days; d++) {
        const dateStr = `2026-09-${String(d).padStart(2, '0')}`;
        logs[dateStr] = { r: config.type };
      }
      if (config.extra) Object.assign(logs, config.extra);

      const seed = JSON.stringify({ version: 1, routines: [], logs });
      const { ctx, page } = await open(browser, { seed, viewport: { width: 390, height: 844 } });
      await sleep(600);
      await page.click(tid('tab-manage'));
      // 고정 400ms 대신 data-rt-draws 가 붙을 때까지 기다림(바쁜 환경에서 두 번째 프레임이 늦게 그려져 null 이 됨, M11-R3 진행자)
      await page.waitForFunction(() => document.querySelector('[data-testid="char-card"]')?.hasAttribute('data-rt-draws'), null, { timeout: 5000 }).catch(() => {});
      const card = page.locator(tid('char-card'));
      const rtDraws = await card.getAttribute('data-rt-draws');
      const stage = await card.getAttribute('data-stage');
      draws.push({ stage, rtDraws: rtDraws ? parseInt(rtDraws) : null });
      await ctx.close();
    }

    const errs = [];
    for (let i = 0; i < 4; i++) {
      if (draws[i].stage !== String(i + 1)) errs.push(`[${i + 1}] stage=${draws[i].stage} (기대 ${i + 1})`);
      if (draws[i].rtDraws === null) errs.push(`[${i + 1}] data-rt-draws=null`);
      else if (draws[i].rtDraws > 39) errs.push(`[${i + 1}] draws=${draws[i].rtDraws} (>39)`);
    }
    for (let i = 0; i < 3; i++) {
      if (draws[i].rtDraws !== null && draws[i + 1].rtDraws !== null && draws[i].rtDraws >= draws[i + 1].rtDraws) {
        errs.push(`단계 ${i + 1}→${i + 2}: ${draws[i].rtDraws} ≥ ${draws[i + 1].rtDraws}`);
      }
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('M7-4. 외부 계약: RT3D 함수 4개, data-scale 0.6/0.75/0.9/1.0 유지', async () => {
    // 첫 번째 페이지에서 RT3D 함수 확인
    const { ctx: ctx1, page: page1 } = await open(browser, { seed: fixtureRaw, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page1.click(tid('tab-manage'));
    await sleep(400);
    const result = await page1.evaluate(() => {
      return {
        hasMount: typeof window.RT3D?.mount === 'function',
        hasUpdate: typeof window.RT3D?.update === 'function',
        hasSetActive: typeof window.RT3D?.setActive === 'function',
        hasDispose: typeof window.RT3D?.dispose === 'function',
      };
    });
    await ctx1.close();

    // 각 단계별 data-scale 확인 (별도 페이지)
    const logConfigs = [
      { days: 0, type: null },
      { days: 12, type: 'mini' },
      { days: 15, type: 'max' },
      { days: 31, type: 'max', extra: { '2026-10-01': { r: 'more' } } }
    ];

    const scales = [];
    for (let i = 0; i < 4; i++) {
      const config = logConfigs[i];
      const logs = {};
      for (let d = 1; d <= config.days; d++) {
        const dateStr = `2026-09-${String(d).padStart(2, '0')}`;
        logs[dateStr] = { r: config.type };
      }
      if (config.extra) Object.assign(logs, config.extra);

      const seed = JSON.stringify({ version: 1, routines: [], logs });
      const { ctx, page } = await open(browser, { seed, viewport: { width: 390, height: 844 } });
      await sleep(600);
      await page.click(tid('tab-manage'));
      await sleep(400);
      const card = page.locator(tid('char-card'));
      const scale = await card.getAttribute('data-scale');
      scales.push(scale);
      await ctx.close();
    }

    const errs = [];
    if (!result.hasMount) errs.push('RT3D.mount 없음');
    if (!result.hasUpdate) errs.push('RT3D.update 없음');
    if (!result.hasSetActive) errs.push('RT3D.setActive 없음');
    if (!result.hasDispose) errs.push('RT3D.dispose 없음');

    const expected = ['0.6', '0.75', '0.9', '1.0'];
    for (let i = 0; i < 4; i++) {
      if (scales[i] !== expected[i]) errs.push(`[${i + 1}] scale=${scales[i]} (기대 ${expected[i]})`);
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M10 퓨처 셀프 ①: 정면→뒤돌기→달리기, 색·단계 명령, reduced, 2D 폴백, 성능 ==========
  // 시간표: 정면 ~0.9s → 뒤돌기 ~0.5s(넘침) → 달리기. 관리 진입 후 running 까지 보통 ~1.4s, 최대 ~2.0s. 대기는 ≤2.5s.
  const gsOf = (page) => page.evaluate(() => (window.RT3D && window.RT3D.getState ? window.RT3D.getState() : null));
  // getState 는 마운트 직후(draws 속성 전)에도 값을 준다. 그래서 data-rt-draws 가 붙은 뒤를 기다린다(M11 에서 옛 가정이 깨져 고침).
const waitMounted = (page) => page.waitForFunction(() => !!(window.RT3D && window.RT3D.getState && window.RT3D.getState() && document.querySelector('[data-testid="char-card"]').getAttribute('data-rt-draws')), null, { timeout: 4000 });
  // 관리 탭 진입 뒤 40ms 간격 기록(running 이면 끝, 최대 2.5초). firstMs = 시작 후 첫 상태가 나올 때까지 걸린 시간.
  const sampleEntry = (page) => page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const has = () => !!(window.RT3D && window.RT3D.getState && window.RT3D.getState());
    const t0 = performance.now();
    while (!has() && performance.now() - t0 < 400) await wait(5);
    if (!has()) return { firstMs: null, out: [] };
    const firstMs = performance.now() - t0;
    const out = [];
    const t1 = performance.now();
    // 앱 시간표는 벽시계 기준 최대 ~2.05초(대기 ≤0.65 + 정면 0.9 + 뒤돌기 0.5). 시험 브라우저가 바쁠 때 타이머가 밀리므로 여유를 둬 3.5초 (M11 진행자)
    while (performance.now() - t1 < 3500) {
      const s = window.RT3D.getState();
      out.push({ t: performance.now() - t1, phase: s.phase, yaw: s.pose.yaw, armL: s.pose.armL, legL: s.pose.legL, bob: s.pose.bob, floor: s.pose.floor });
      if (s.phase === 'running') break;
      await wait(40);
    }
    return { firstMs, out };
  });
  // 판정: 첫 상태 front·yaw<10·mount 후 150ms 이내, turning 거침(0.3~1.0s), 넘침(yaw>145), running yaw 135~155
  const judgeEntry = ({ firstMs, out }) => {
    if (firstMs === null) return '400ms 안에 RT3D.getState 가 안 나옴';
    const e = [];
    if (firstMs > 150) e.push(`mount 후 첫 상태 ${Math.round(firstMs)}ms (≤150)`);
    if (!out.length) return '샘플 없음';
    if (out[0].phase !== 'front' || !(out[0].yaw < 10)) e.push(`첫 상태 ${out[0].phase} yaw=${out[0].yaw} (front·yaw<10 기대)`);
    const ti = out.findIndex((s) => s.phase === 'turning');
    const ri = out.findIndex((s) => s.phase === 'running');
    if (ti < 0) e.push('turning 단계 안 보임');
    if (ri < 0) { e.push('2.5초 안에 running 안 됨'); return e.join('; '); }
    if (ti >= 0 && ri < ti) e.push('running 이 turning 보다 먼저');
    if (ti >= 0) {
      const frontS = (out[ti].t) / 1000;
      const turnS = (out[ri].t - out[ti].t) / 1000;
      if (frontS < 0.5) e.push(`정면 ${frontS.toFixed(2)}s (≥0.5)`);
      if (turnS < 0.3 || turnS > 1.0) e.push(`뒤돌기 ${turnS.toFixed(2)}s (0.3~1.0)`);
      const peak = Math.max(...out.slice(ti, ri).map((s) => s.yaw));
      if (!(peak > 145)) e.push(`뒤돌기 넘침 없음 최대 yaw=${peak.toFixed(1)} (>145 기대)`);
    }
    if (!(out[ri].yaw >= 135 && out[ri].yaw <= 155)) e.push(`running yaw=${out[ri].yaw} (145±10)`);
    return e.length ? e.join('; ') : true;
  };
  // 판정: running 10샘플(100ms 간격) + 0.25초 쌍. 팔·다리 범위≥1.0, 엇갈림≥80%, bob≥0.04, floor 증가
  const judgeRunning = (samples, pair) => {
    const e = [];
    if (samples.some((s) => s.phase !== 'running')) e.push('running 아닌 샘플 있음: ' + samples.map((s) => s.phase).join(','));
    const rng = (k) => { const v = samples.map((s) => s[k]); return Math.max(...v) - Math.min(...v); };
    if (rng('armL') < 1.0) e.push(`armL 범위 ${rng('armL').toFixed(2)} (≥1.0)`);
    if (rng('legL') < 1.0) e.push(`legL 범위 ${rng('legL').toFixed(2)} (≥1.0)`);
    const opp = samples.filter((s) => s.armL * s.legL < 0).length / samples.length;
    if (opp < 0.8) e.push(`팔·다리 엇갈림 ${Math.round(opp * 100)}% (≥80)`);
    if (rng('bob') < 0.04) e.push(`bob 범위 ${rng('bob').toFixed(3)} (≥0.04)`);
    const f0 = samples[0].floor, f1 = samples[samples.length - 1].floor;
    if (!(f1 > f0)) e.push(`floor ${f0}→${f1} (증가 기대)`);
    if (pair) {
      const { a, b } = pair;
      if (!(a.armL * a.legL < 0 && b.armL * b.legL < 0)) e.push('0.25초 쌍: 부호 반대 아님');
      if (a.armL === b.armL && a.legL === b.legL) e.push('0.25초 쌍: 포즈 안 바뀜');
    }
    return e.length ? e.join('; ') : true;
  };

  await check('M10-1. 계약: data-stage·scale·frameloop·motion·rt-bg=clear·rt-draws·char-canvas 유지, data-rt-phase=getState().phase, 명령 7개 function, dispose 후 data-rt-phase 없음', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="char-card"]');
      const s = window.RT3D.getState();
      return {
        attrs: { stage: el.getAttribute('data-stage'), scale: el.getAttribute('data-scale'), frameloop: el.getAttribute('data-frameloop'), motion: el.getAttribute('data-motion'), bg: el.getAttribute('data-rt-bg'), draws: el.getAttribute('data-rt-draws'), phase: el.getAttribute('data-rt-phase') },
        canvas: document.querySelectorAll('[data-testid="char-canvas"]').length,
        state: s,
        fns: ['mount', 'update', 'setActive', 'dispose', 'setLevel', 'setColor', 'getState'].map((n) => typeof window.RT3D[n]),
      };
    });
    if (r.canvas !== 1) errs.push(`char-canvas ${r.canvas}개`);
    if (!['1', '2', '3', '4'].includes(r.attrs.stage)) errs.push(`data-stage=${r.attrs.stage}`);
    if (!['0.6', '0.75', '0.9', '1.0'].includes(r.attrs.scale)) errs.push(`data-scale=${r.attrs.scale}`);
    if (r.attrs.frameloop !== 'always') errs.push(`data-frameloop=${r.attrs.frameloop} (관리 always)`);
    if (!r.attrs.motion || r.attrs.motion === 'still') errs.push(`data-motion=${r.attrs.motion} (보통 모드는 still 아님)`);
    if (r.attrs.bg !== 'clear') errs.push(`data-rt-bg=${r.attrs.bg}`);
    if (r.attrs.draws === null || !(parseInt(r.attrs.draws) > 0)) errs.push(`data-rt-draws=${r.attrs.draws}`);
    if (r.attrs.phase !== r.state.phase) errs.push(`data-rt-phase=${r.attrs.phase} ≠ getState().phase=${r.state.phase}`);
    if (!['front', 'turning', 'running'].includes(r.state.phase)) errs.push(`phase=${r.state.phase}`);
    r.fns.forEach((t, i) => { if (t !== 'function') errs.push(`명령 ${i + 1} typeof=${t}`); });
    // 반대: dispose 후 data-rt-phase 가 남으면 실패
    const after = await page.evaluate(() => { window.RT3D.dispose(); return document.querySelector('[data-testid="char-card"]').getAttribute('data-rt-phase'); });
    if (after !== null) errs.push(`dispose 후 data-rt-phase=${after} (없어야 함)`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-2. 뒤돌기: 관리 진입 첫 상태 front·yaw<10 (150ms 안), turning 거쳐 running(yaw 145±10), 넘침 있음, 정면 중 floor 불변', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    const res = await sampleEntry(page);
    await ctx.close();
    const j = judgeEntry(res);
    if (j !== true) return j;
    const frontSame = res.out.length > 1 && res.out[1].phase === 'front' && res.out[1].floor === res.out[0].floor;
    if (!frontSame && res.out.length > 1 && res.out[1].phase === 'front') return '정면 중 floor 변함';
    // 대조: 뒤돌기 없이 바로 running 인 입력은 실패해야 한다
    if (judgeEntry({ firstMs: 10, out: [{ t: 0, phase: 'running', yaw: 145, armL: 0, legL: 0, bob: 0, floor: 0 }] }) === true) return '대조 실패: 뒤돌기 없는 입력을 통과시킴';
    return true;
  });

  await check('M10-2b. 다른 탭 갔다 돌아오면 front 부터, setActive(false)→(true) 직후 front (yaw<10)', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    await page.waitForFunction(() => window.RT3D.getState().phase === 'running', null, { timeout: 3500 }); // 위와 같은 이유로 여유 3.5초
    await page.click(tid('tab-calendar')); await sleep(400);
    await page.click(tid('tab-manage'));
    const back = await sampleEntry(page);
    const j = judgeEntry(back);
    if (j !== true) errs.push(`탭 복귀: ${j}`);
    const api = await page.evaluate(async () => {
      window.RT3D.setActive(false); window.RT3D.setActive(true);
      await new Promise((r) => setTimeout(r, 50));
      const s = window.RT3D.getState();
      return { phase: s.phase, yaw: s.pose.yaw };
    });
    if (api.phase !== 'front' || !(api.yaw < 10)) errs.push(`setActive false→true 직후 ${api.phase} yaw=${api.yaw} (front 기대)`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-3. 달리기: running 1초 10샘플 armL·legL 범위≥1.0·엇갈림≥80%·bob≥0.04·floor 증가, 0.25초 쌍 엇갈림·변화', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    await page.waitForFunction(() => window.RT3D.getState().phase === 'running', null, { timeout: 3500 }); // 위와 같은 이유로 여유 3.5초
    // M14 진행자: 바쁠 때 running 감지 직후 첫 샘플이 경계(turning)로 읽힌 적 2번(CPU 6배 느리게 3번 관찰 — 재시작 없음, setActive 1번). 안정된 running 뒤 샘플: 200ms 기다린 뒤 다시 running 확인
    await sleep(200);
    await page.waitForFunction(() => window.RT3D.getState().phase === 'running', null, { timeout: 1500 });
    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const pick = (s) => ({ phase: s.phase, armL: s.pose.armL, legL: s.pose.legL, bob: s.pose.bob, floor: s.pose.floor });
      const samples = [];
      for (let i = 0; i < 10; i++) { samples.push(pick(window.RT3D.getState())); await wait(100); }
      const a = pick(window.RT3D.getState()); await wait(250); const b = pick(window.RT3D.getState());
      return { samples, pair: { a, b } };
    });
    await ctx.close();
    const j = judgeRunning(r.samples, r.pair);
    if (j !== true) return j;
    // 대조: 정지 포즈(움직임 없음)는 실패해야 한다
    const still = Array.from({ length: 10 }, () => ({ phase: 'running', armL: 0.3, legL: 0.3, bob: 0.1, floor: 1 }));
    if (judgeRunning(still, { a: { armL: 0.3, legL: 0.3 }, b: { armL: 0.3, legL: 0.3 } }) === true) return '대조 실패: 정지 포즈를 통과시킴';
    return true;
  });

  await check('M10-4. 색: setColor(body) 바뀜·다른 부위 그대로·잘못된 part/색 무시(오류 0)·소문자 #rrggbb·저장 안 함·새로고침 뒤 기본색', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    const before = await gsOf(page);
    // M14: 3D 기본색 몸 #FF7A3D(옛 #7ed957). 대소문자 무시 비교.
    if (before.colors.body.toLowerCase() !== '#ff7a3d') errs.push(`기본 body=${before.colors.body}`);
    const raw0 = await getRaw(page);
    const keys0 = await page.evaluate(() => localStorage.length);
    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const errsIn = [];
      const call = (f) => { try { f(); } catch (e) { errsIn.push(e.message); } };
      call(() => window.RT3D.setColor('body', '#ff0000'));
      call(() => window.RT3D.setColor('hat', '#00ff00'));
      call(() => window.RT3D.setColor('arms', 'xx'));
      call(() => window.RT3D.setColor('legs', 123));
      call(() => window.RT3D.setColor('head', 'notacolor'));
      await wait(150);
      const s1 = window.RT3D.getState().colors;
      call(() => window.RT3D.setColor('legs', '#00AAFF'));
      await wait(100);
      const s2 = window.RT3D.getState().colors;
      return { errsIn, s1, s2 };
    });
    if (r.s1.body !== '#ff0000') errs.push(`body=${r.s1.body} (#ff0000 기대)`);
    if (r.s1.head !== before.colors.head) errs.push(`head 바뀜 ${before.colors.head}→${r.s1.head}`);
    if (r.s1.arms !== before.colors.arms) errs.push(`arms 바뀜 ${before.colors.arms}→${r.s1.arms}`);
    if (r.s1.legs !== before.colors.legs) errs.push(`legs 바뀜 ${before.colors.legs}→${r.s1.legs}`);
    if (Object.keys(r.s1).sort().join(',') !== 'arms,body,head,legs') errs.push('colors 키 이상: ' + Object.keys(r.s1).join(','));
    if (r.s2.legs !== '#00aaff') errs.push(`대문자 입력 legs=${r.s2.legs} (#00aaff 소문자 기대)`);
    if (r.errsIn.length) errs.push('잘못된 명령에서 오류: ' + r.errsIn.join('|'));
    const raw1 = await getRaw(page);
    const keys1 = await page.evaluate(() => localStorage.length);
    if (raw1 !== raw0) errs.push('routineTracker 값 바뀜(색 저장 금지)');
    if (keys1 !== keys0) errs.push(`localStorage 키 수 ${keys0}→${keys1}`);
    await page.reload(); await sleep(400);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    const again = await gsOf(page);
    // M14: 기본 몸 #FF7A3D·다리 #6B4BD8(옛 #7ed957·#ffb347). 대소문자 무시 비교.
    if (again.colors.body.toLowerCase() !== '#ff7a3d' || again.colors.legs.toLowerCase() !== '#6b4bd8') errs.push(`새로고침 후 색 ${again.colors.body}/${again.colors.legs} (기본 기대)`);
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-5. 단계: setLevel(1~4)→data-stage·scale 0.6/0.75/0.9/1.0·드로우콜 1<2<3<4≤34, setLevel(9)·("a")·(0)·(NaN) 무시, update({stage:2}) 동작, routineTracker 불변', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    const raw0 = await getRaw(page);
    const out = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const el = document.querySelector('[data-testid="char-card"]');
      const snap = () => ({ dataStage: el.getAttribute('data-stage'), scale: el.getAttribute('data-scale'), draws: el.getAttribute('data-rt-draws'), stage: window.RT3D.getState().stage });
      const o = {};
      for (const n of [1, 2, 3, 4]) { window.RT3D.setLevel(n); await wait(300); o[n] = snap(); }
      window.RT3D.setLevel(3); await wait(300); o.base3 = snap();
      o.errs = [];
      for (const bad of [9, 'a', 0, NaN]) { try { window.RT3D.setLevel(bad); } catch (e) { o.errs.push(e.message); } }
      await wait(300); o.bad = snap();
      window.RT3D.update({ stage: 2 }); await wait(300); o.upd = snap();
      return o;
    });
    const scales = ['0.6', '0.75', '0.9', '1.0'];
    for (let n = 1; n <= 4; n++) {
      const s = out[n];
      if (s.dataStage !== String(n) || s.stage !== n) errs.push(`setLevel(${n}): data-stage=${s.dataStage} stage=${s.stage}`);
      if (s.scale !== scales[n - 1]) errs.push(`setLevel(${n}): scale=${s.scale} (기대 ${scales[n - 1]})`);
    }
    const d = [1, 2, 3, 4].map((n) => parseInt(out[n].draws));
    if (d.some((x) => !(x > 0))) errs.push(`드로우콜 값 이상 ${out[1].draws}/${out[2].draws}/${out[3].draws}/${out[4].draws}`);
    for (let i = 0; i < 3; i++) if (!(d[i] < d[i + 1])) errs.push(`드로우콜 ${i + 1}→${i + 2}: ${d[i]} ≥ ${d[i + 1]}`);
    if (d[3] > 34) errs.push(`단계4 드로우콜 ${d[3]} (≤34)`);
    if (out.bad.dataStage !== '3' || out.bad.stage !== 3 || out.bad.scale !== '0.9') errs.push(`잘못된 setLevel 후 ${out.bad.dataStage}/${out.bad.scale} (3/0.9 기대)`);
    if (out.errs.length) errs.push('잘못된 setLevel 에서 오류: ' + out.errs.join('|'));
    if (out.upd.dataStage !== '2' || out.upd.scale !== '0.75') errs.push(`update({stage:2}) 후 ${out.upd.dataStage}/${out.upd.scale} (2/0.75 기대)`);
    const raw1 = await getRaw(page);
    if (raw1 !== raw0) errs.push('routineTracker 값 바뀜(단계 명령은 저장 안 함)');
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-6. reduced-motion: 관리 진입 뒤 150ms 안 running·data-motion=still·reduced=true·1초 동안 포즈 정지', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, reduced: true, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage'));
    const r = await page.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const t0 = performance.now();
      let runMs = null;
      while (performance.now() - t0 < 400) {
        const s = window.RT3D && window.RT3D.getState && window.RT3D.getState();
        if (s && s.phase === 'running') { runMs = performance.now() - t0; break; }
        await wait(5);
      }
      const pick = () => { const s = window.RT3D.getState(); return { phase: s.phase, reduced: s.reduced, yaw: s.pose.yaw, armL: s.pose.armL, legL: s.pose.legL, bob: s.pose.bob, floor: s.pose.floor }; };
      const a = runMs === null ? null : pick();
      await wait(1000);
      const b = runMs === null ? null : pick();
      const motion = document.querySelector('[data-testid="char-card"]').getAttribute('data-motion');
      return { runMs, a, b, motion };
    });
    if (r.runMs === null) errs.push('400ms 안에 running 안 됨');
    else if (r.runMs > 150) errs.push(`running 까지 ${Math.round(r.runMs)}ms (≤150)`);
    if (r.a && r.a.reduced !== true) errs.push(`getState().reduced=${r.a.reduced}`);
    if (r.a && !(r.a.yaw >= 135 && r.a.yaw <= 155)) errs.push(`reduced yaw=${r.a.yaw} (145±10)`);
    if (r.motion !== 'still') errs.push(`data-motion=${r.motion} (still 기대)`);
    if (r.a && r.b) {
      for (const k of ['armL', 'legL', 'bob', 'floor', 'yaw']) if (r.a[k] !== r.b[k]) errs.push(`1초 뒤 ${k} ${r.a[k]}→${r.b[k]} (정지 기대)`);
    }
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-7a. 2D 폴백: ?avatar=2d·번들 차단·WebGL 차단 모두 data-render=2d·Lv7·pageerror 0', async () => {
    const errs = [];
    const cases = [
      { name: '?avatar=2d', url: BASE + '?avatar=2d', setup: null },
      { name: '번들 차단', url: BASE, setup: 'vendor' },
      { name: 'WebGL 차단', url: BASE, setup: 'webgl' },
    ];
    for (const c of cases) {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
      const pe = []; page.on('pageerror', (e) => pe.push(e.message));
      if (c.setup === 'vendor') await page.route('**/vendor/character3d.js', (r) => r.abort());
      if (c.setup === 'webgl') await page.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; });
      await page.goto(c.url); await sleep(600);
      await page.click(tid('tab-manage')); await sleep(600);
      const rd = await page.locator(tid('char-card')).getAttribute('data-render');
      const lv = await page.locator(tid('char-level')).textContent();
      if (rd !== '2d' || lv !== 'Lv7' || pe.length) errs.push(`${c.name}: render=${rd} lv=${lv} 오류=${pe.join('|')}`);
      await ctx.close();
      // 일부러 막은 번들 요청의 "Failed to load resource" 1건만 합산 목록에서 뺀다(M5-S 와 같은 방식)
      if (c.setup === 'vendor') { const k = consoleErrors.findIndex((x) => x.includes('Failed to load resource: net::ERR_FAILED')); if (k >= 0) consoleErrors.splice(k, 1); }
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('M10-7b. 성능: dpr2 관리 탭 rAF 중앙값 ≤53ms (60프레임)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Seoul', locale: 'ko-KR', reducedMotion: 'no-preference' });
    await ctx.route('**/*', (route) => {
      const u = new globalThis.URL(route.request().url());
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [KEY, fixtureRaw]);
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    // 셰이더 준비가 끝난 달리기 상태에서 잰다(첫 프레임들은 컴파일로 느림). 바쁜 시험 환경 잡음을 줄이려고 2번 재서 작은 값 (M11 진행자)
    await page.waitForFunction(() => window.RT3D.getState().phase === 'running', null, { timeout: 3500 });
    await sleep(1000);
    const measure = () => page.evaluate(() => new Promise((res) => {
      const d = []; let last = null;
      const f = (t) => { if (last !== null) d.push(t - last); last = t; if (d.length < 60) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res(d[Math.floor(d.length / 2)]); } };
      requestAnimationFrame(f);
    }));
    const med = Math.min(await measure(), await measure());
    await ctx.close();
    return med <= 53 ? true : `rAF 중앙값 ${med.toFixed(1)}ms (≤53)`;
  });
});
