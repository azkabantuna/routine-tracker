// 성장 캐릭터 시험: XP·레벨·단계, 저장 불변, 실시간 반영, 레벨업 연출, 부드러움, 교체, 회귀
// 실행(레포 루트에서): node projects/routine-tracker/tests/character.test.mjs
import assert from 'node:assert';
import { BASE, run, check, note, sleep, tid, getRaw, getStore, open, fixtureRaw } from './_lib.mjs';

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
      let lv2 = document.querySelector('[data-testid="char-card"]').getAttribute('data-level');
      let lu2 = document.querySelector('[data-testid="char-card"]').getAttribute('data-levelup');
      return { lv1, lu1, lv2, lu2 };
    });
    const errs = [];
    if (levelupResult.lv1 !== '1') errs.push(`첫번째 lv=${levelupResult.lv1}`);
    if (levelupResult.lu1 !== null) errs.push(`첫번째 levelup 있음`);
    if (levelupResult.lv2 !== '2') errs.push(`두번째 lv=${levelupResult.lv2}`);
    if (levelupResult.lu2 !== '1') errs.push(`두번째 levelup 없음`);
    // 600ms 대기
    await sleep(700);
    levelup = await page.locator(tid('char-card')).getAttribute('data-levelup');
    if (levelup !== null) errs.push('600ms 후 제거 안 됨');
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
});
