// 저장·불러오기·옛 데이터 보존 시험 (store.js·date.js 등)
// 실행(레포 루트에서): node projects/routine-tracker/tests/store.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import assert from 'node:assert';
import { BASE, run, check, info, sleep, tid, getRaw, getStore, open, fixtureRaw, KEY, countNow } from './_lib.mjs';

await run(async (browser) => {
  // ---------- (옛 m1) 깨진 저장 데이터 / 08:30 KST 날짜 키 ----------
  {
    const { ctx, page } = await open(browser);
  await check('기본: 깨진 저장 데이터 → 배너 + backup, 오류 없이 빈 상태', async () => {
    const errs = [];
    await page.evaluate((k) => localStorage.setItem(k, '{broken'), KEY);
    await page.reload();
    if (!(await page.locator(tid('banner-error')).isVisible())) errs.push('배너 안 보임');
    const bk = await page.evaluate((k) => localStorage.getItem(k + '.backup'), KEY);
    if (bk !== '{broken') errs.push('backup=' + bk);
    if (!(await page.locator(tid('empty-state')).isVisible())) errs.push('빈 상태 아님');
    return errs.length ? errs.join('; ') : true;
  });
    await ctx.close();
  }
  {
    const t5 = await open(browser, { now: '2026-10-07T08:30:00+09:00', goto: false });
    await check('5. 08:30 KST 에 mini → logs 키 "2026-10-07"', async () => {
      const p = t5.page;
      await p.goto(BASE);
      await p.evaluate(([k]) => localStorage.setItem(k, JSON.stringify({
        version: 1, routines: [{ id: 'r_test1', name: '운동', mini: '5개', more: '', max: '', createdAt: '2026-10-07', order: 0 }], logs: {}, celebratedOn: null,
      })), [KEY]);
      await p.reload();
      await p.locator('[data-routine-id="r_test1"] [data-level="mini"]').click();
      const s = await getStore(p);
      const keys = Object.keys(s.logs);
      const dateText = await p.locator(tid('today-date')).innerText();
      if (keys.length === 1 && keys[0] === '2026-10-07' && s.logs['2026-10-07'].r_test1 === 'mini' && dateText.includes('10월 7일')) return true;
      return `logs 키=${JSON.stringify(keys)}, 날짜글자=${dateText}`;
    });
    await t5.ctx.close();
  }

  // ---------- (옛 v2-m1) C10~C12 ----------
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

  // ---------- (옛 v2-m1-r2) D1 ----------
  await check('D1 OLD 시드 불변: 시드로 열기·탭 3개 왕복·reload 뒤에도 localStorage 문자열 그대로, backup 키 없음, banner-error 안 보임, 카드 3개 (390·360)', async () => {
    const errs = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport, settle: 300 });
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

  // ---------- (옛 v2-m2) 14. 옛 기록 보존 ----------
  {
    const rawSeed = fixtureRaw;
    const seedObj = JSON.parse(rawSeed);
    const { ctx, page } = await open(browser, { seed: rawSeed });
    await sleep(600);
    const after = await getRaw(page);
    await check('14-1 OLD 시드 열기만: localStorage 문자열 시드와 완전 동일', async () => after === rawSeed || `다름 (시드 ${rawSeed.length}자, 현재 ${after && after.length}자)`);
    await check('14-2 backup 키 없음 · banner-error 안 보임 · 카드 3개', async () => {
      const o = await page.evaluate(() => ({ b: localStorage.getItem('routineTracker.backup'), banner: !document.querySelector('[data-testid="banner-error"]').hidden, cards: document.querySelectorAll('[data-testid="routine-card"]').length, keys: Object.keys(localStorage) }));
      return (o.b === null && !o.banner && o.cards === 3) || JSON.stringify(o);
    });
    // 이모지 추가 + 강도 누름
    await page.locator(tid('tab-manage')).click();
    await page.locator(tid('btn-edit')).first().click();
    await page.locator(tid('sheet')).waitFor({ state: 'visible' });
    await page.locator(tid('input-emoji')).fill('🏃');
    await page.locator(tid('btn-save')).click();
    await sleep(200);
    await page.locator(tid('tab-today')).click();
    await sleep(400);
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="mini"]').click();
    const burst = await countNow(page);
    await sleep(500);
    const s = await getStore(page);
    await check('14-3 이모지 추가+mini 누른 뒤: emoji·오늘 로그 두 곳만 시드와 다름, 나머지(루틴 필드·20일 logs·celebratedOn "2026-10-06") 깊은 비교 동일, version 1, backup 없음', async () => {
      const exp = JSON.parse(rawSeed);
      exp.routines[0].emoji = '🏃';
      exp.logs['2026-10-07'] = { r_old_a: 'mini' };
      try { assert.deepStrictEqual(s, exp); } catch (e) { return '깊은 비교 실패: ' + JSON.stringify(s).slice(0, 300); }
      const backup = await page.evaluate(() => localStorage.getItem('routineTracker.backup'));
      return (s.version === 1 && s.celebratedOn === '2026-10-06' && backup === null && Object.keys(s.logs).length === 21) || 'version/celebratedOn/backup/logs 수 이상';
    });
    await check('14-4 옛 루틴에 이모지 추가 후 mini 누르면 효과(8/3)', async () => (burst.present && burst.confetti === 8 && burst.emoji === 3) || JSON.stringify(burst));
    await sleep(3000);
    // 나머지 루틴 다른 키 순서·값 유지(아이디 기준)
    await check('14-5 시드의 나머지 두 루틴 객체(키 순서까지) 문자열 동일', async () => JSON.stringify(s.routines.slice(1)) === JSON.stringify(seedObj.routines.slice(1)) || '다름');
    await ctx.close();
  }
});
