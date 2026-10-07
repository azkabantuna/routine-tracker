// 루틴 추가·수정·삭제·강도·확인창 시험 (routines.js·screens.js·sheets.js)
// 실행(레포 루트에서): node projects/routine-tracker/tests/routines.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { run, check, sleep, tid, getStore, open, addRoutine, progress, noHScroll, openAddSheet, submitSheet, openConfirm, KEY, SEED2, SEED3 } from './_lib.mjs';

await run(async (browser) => {
  // ---------- (옛 m1) 빈 상태·추가·강도·수정·삭제·새로고침·HTML 안 해석 ----------
  const { ctx, page } = await open(browser, { acceptDialogs: true });
  await check('1. 빈 상태 안내·첫 루틴 버튼·가로 스크롤 없음·탭 3개·캘린더 탭 표시', async () => {
    const errs = [];
    if (!(await page.locator(tid('empty-state')).isVisible())) errs.push('empty-state 안 보임');
    if (!(await page.locator(tid('btn-first-routine')).isVisible())) errs.push('첫 루틴 버튼 안 보임');
    if (!(await noHScroll(page))) errs.push('가로 스크롤 있음');
    for (const t of ['tab-today', 'tab-calendar', 'tab-manage']) if (!(await page.locator(tid(t)).isVisible())) errs.push(t + ' 안 보임');
    await page.click(tid('tab-calendar'));
    if (!(await page.locator('#screen-calendar').isVisible())) errs.push('캘린더 화면 안 보임');
    if ((await page.locator(tid('tab-calendar')).getAttribute('aria-selected')) !== 'true') errs.push('tab-calendar aria-selected 아님');
    // 첫 루틴 버튼 → 시트 열림
    await page.click(tid('tab-today'));
    await page.click(tid('btn-first-routine'));
    if (!(await page.locator(tid('sheet')).isVisible())) errs.push('첫 루틴 버튼으로 시트 안 열림');
    await page.click(tid('btn-close'));
    return errs.length ? errs.join('; ') : true;
  });

  let idA, idB;
  await check('2. 루틴 추가 → 카드·기준 글자 / 빈 이름·공백 이름 저장 안 됨+안내', async () => {
    const errs = [];
    // 빈 이름
    await page.click(tid('tab-manage'));
    for (const bad of ['', '   ']) {
      await page.click(tid('btn-add-routine'));
      await page.fill(tid('input-name'), bad);
      await page.fill(tid('input-mini'), 'x');
      await page.click(tid('btn-save'));
      const err = page.locator(tid('error-name'));
      if (!(await err.isVisible())) errs.push(`이름 ${JSON.stringify(bad)}: 안내 안 보임`);
      else if ((await err.innerText()).trim() !== '루틴 이름을 적어 주세요') errs.push('안내 문구 다름');
      if (!(await page.locator(tid('sheet')).isVisible())) errs.push('시트가 닫힘');
      const s = await getStore(page);
      if (s && s.routines.length !== 0) errs.push(`이름 ${JSON.stringify(bad)}: routines.length=${s.routines.length}`);
      await page.click(tid('btn-close'));
    }
    // Enter 로도 빈 이름 저장 안 됨
    await page.click(tid('btn-add-routine'));
    await page.fill(tid('input-name'), '  ');
    await page.press(tid('input-name'), 'Enter');
    if (!(await page.locator(tid('error-name')).isVisible())) errs.push('Enter 빈 이름 안내 없음');
    await page.click(tid('btn-close'));

    await addRoutine(page, { name: '운동', mini: '푸시업 5개', more: '20분', max: '1시간' });
    const card = page.locator(tid('routine-card'));
    if ((await card.count()) !== 1) errs.push('카드 수 ' + (await card.count()));
    else {
      if (!(await card.locator('.card-name').innerText()).includes('운동')) errs.push('이름 안 보임');
      const crits = await card.locator('.level-crit').allInnerTexts();
      if (crits.join('|') !== '푸시업 5개|20분|1시간') errs.push('기준 글자: ' + crits.join('|'));
      for (const lv of ['mini', 'more', 'max']) {
        // 기준 글자가 그 버튼 아래(세로 위치가 더 아래)에 있는지
        const b = await card.locator(`[data-level="${lv}"]`).boundingBox();
        const c = await card.locator(`[data-level="${lv}"] + .level-crit`).boundingBox();
        if (!b || !c || c.y < b.y + b.height - 1) errs.push(lv + ' 기준이 버튼 아래 아님');
        if (b && (b.width < 44 || b.height < 44)) errs.push(`${lv} 버튼 ${b.width}x${b.height} < 44`);
      }
      if (!(await page.locator(tid('empty-state')).isHidden())) errs.push('루틴 있어도 empty-state 보임');
      idA = await card.getAttribute('data-routine-id');
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('4. mini → 눌림·done·n+1 / more 로 이동 / 다시 누르면 취소·n-1', async () => {
    const errs = [];
    await addRoutine(page, { name: '독서', mini: '1쪽', more: '10쪽', max: '1장' });
    idB = await page.locator(tid('routine-card')).nth(1).getAttribute('data-routine-id');
    const card = page.locator(`${tid('routine-card')}[data-routine-id="${idA}"]`);
    const pressed = async () => {
      const o = {};
      for (const lv of ['mini', 'more', 'max']) o[lv] = await card.locator(`[data-level="${lv}"]`).getAttribute('aria-pressed');
      return o;
    };
    const p0 = await progress(page);
    if (p0.n !== 0 || p0.m !== 2) errs.push(`시작 n/m=${p0.n}/${p0.m}`);
    await card.locator('[data-level="mini"]').click();
    let pr = await pressed();
    if (pr.mini !== 'true' || pr.more !== 'false' || pr.max !== 'false') errs.push('mini 후 pressed ' + JSON.stringify(pr));
    if ((await card.getAttribute('data-done')) !== 'true') errs.push('mini 후 data-done 아님');
    let p1 = await progress(page);
    if (p1.n !== 1) errs.push('mini 후 n=' + p1.n);
    const txt = await page.locator('#progress-text').innerText();
    if (txt.trim() !== '오늘 1/2 완료') errs.push('글자: ' + txt);
    const toast = page.locator(tid('toast'));
    if (!(await toast.isVisible()) || !(await toast.innerText()).includes('mini 도 한 거다!')) errs.push('mini 토스트 없음');
    await card.locator('[data-level="more"]').click();
    pr = await pressed();
    if (pr.mini !== 'false' || pr.more !== 'true' || pr.max !== 'false') errs.push('more 후 pressed ' + JSON.stringify(pr));
    if ((await progress(page)).n !== 1) errs.push('more 후 n 변함');
    await card.locator('[data-level="more"]').click();
    pr = await pressed();
    if ((await card.getAttribute('data-done')) !== 'false') errs.push('취소 후 data-done 아님');
    if (Object.values(pr).some((v) => v !== 'false')) errs.push('취소 후 pressed ' + JSON.stringify(pr));
    if ((await progress(page)).n !== 0) errs.push('취소 후 n=' + (await progress(page)).n);
    const s = await getStore(page);
    if (Object.keys(s.logs).length !== 0) errs.push('취소 후 logs 남음 ' + JSON.stringify(s.logs));
    return errs.length ? errs.join('; ') : true;
  });

  await check('3. 수정 즉시 반영 / 기록 있는 루틴 삭제 → 카드 사라짐·logs 에 id 없음·빈 날짜 없음', async () => {
    const errs = [];
    // 수정
    await page.click(tid('tab-manage'));
    await page.locator(`${tid('manage-item')}[data-routine-id="${idA}"] ${tid('btn-edit')}`).click();
    if ((await page.inputValue(tid('input-name'))) !== '운동') errs.push('수정 시 기존 이름 안 채워짐');
    await page.fill(tid('input-name'), '아침 운동');
    await page.fill(tid('input-more'), '30분');
    await page.click(tid('btn-save'));
    await page.click(tid('tab-today'));
    const card = page.locator(`${tid('routine-card')}[data-routine-id="${idA}"]`);
    if ((await card.locator('.card-name').innerText()).trim() !== '아침 운동') errs.push('이름 수정 반영 안 됨');
    const crits = await card.locator('.level-crit').allInnerTexts();
    if (crits[1] !== '30분') errs.push('기준 수정 반영 안 됨: ' + crits.join('|'));
    // 기록 만들기: 오늘 idA mini, idB more, + 과거 날짜에 idA 만 있는 날 seed
    await card.locator('[data-level="mini"]').click();
    await page.locator(`${tid('routine-card')}[data-routine-id="${idB}"] [data-level="more"]`).click();
    await page.evaluate(([k, a]) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.logs['2026-10-05'] = { [a]: 'max' };
      localStorage.setItem(k, JSON.stringify(s));
    }, [KEY, idA]);
    await page.reload();
    // 삭제
    await page.click(tid('tab-manage'));
    await page.locator(`${tid('manage-item')}[data-routine-id="${idA}"] ${tid('btn-delete')}`).click();
    await page.click(tid('btn-confirm-delete')); // R1(v2): 화면 안 확인창의 삭제 버튼
    await page.click(tid('tab-today'));
    // R1(v2): 카드 퇴장 연출(≈250ms)이 끝나 DOM 에서 빠질 때까지 기다린 뒤 확인
    await page.waitForSelector(`${tid('routine-card')}[data-routine-id="${idA}"]`, { state: 'detached', timeout: 1000 }).catch(() => {});
    if ((await page.locator(`${tid('routine-card')}[data-routine-id="${idA}"]`).count()) !== 0) errs.push('삭제 후 카드 남음');
    const s = await getStore(page);
    const raw = JSON.stringify(s.logs);
    if (raw.includes(idA)) errs.push('logs 에 id 남음 ' + raw);
    for (const [d, v] of Object.entries(s.logs)) if (Object.keys(v).length === 0) errs.push('빈 날짜 객체 ' + d);
    if (s.logs['2026-10-07']?.[idB] !== 'more') errs.push('다른 루틴 기록이 사라짐 ' + raw);
    if (s.routines.some((r) => r.id === idA)) errs.push('routines 에 남음');
    const p = await progress(page);
    if (p.n !== 1 || p.m !== 1) errs.push(`삭제 후 n/m=${p.n}/${p.m}`);
    return errs.length ? errs.join('; ') : true;
  });

  await check('6. 루틴 2개 + more 기록 후 새로고침 유지 / version:1, celebratedOn 키', async () => {
    const errs = [];
    // 현재 독서(idB, 오늘 more) 1개 → 하나 더 추가
    await addRoutine(page, { name: '물 마시기', mini: '1컵' });
    await page.reload();
    const cards = page.locator(tid('routine-card'));
    if ((await cards.count()) !== 2) errs.push('새로고침 후 카드 ' + (await cards.count()));
    const b = page.locator(`${tid('routine-card')}[data-routine-id="${idB}"]`);
    if ((await b.locator('[data-level="more"]').getAttribute('aria-pressed')) !== 'true') errs.push('more pressed 유지 안 됨');
    if ((await b.getAttribute('data-done')) !== 'true') errs.push('data-done 유지 안 됨');
    const p = await progress(page);
    if (p.n !== 1 || p.m !== 2) errs.push(`새로고침 후 n/m=${p.n}/${p.m}`);
    const s = await getStore(page);
    if (s.version !== 1) errs.push('version=' + s.version);
    if (!('celebratedOn' in s)) errs.push('celebratedOn 키 없음');
    return errs.length ? errs.join('; ') : true;
  });

  await check('기본: 사용자 글자 HTML 로 해석 안 됨', async () => {
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
    await page.reload();
    await addRoutine(page, { name: '<b>독서</b><img src=x onerror=alert(1)>' });
    const t = await page.locator(`${tid('routine-card')} .card-name`).innerText();
    const n = await page.locator(`${tid('routine-card')} .card-name b, ${tid('routine-card')} img`).count();
    return n === 0 && t.includes('<b>독서</b>') ? true : `text=${t}, elements=${n}`;
  });
  await ctx.close();

  // ---------- (옛 v2-m1) C5 제자리 갱신 / C6 확인창 ----------
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

  // ---------- (옛 v2-m2) 1-10 이름 HTML 안 해석 ----------
  {
    const { ctx, page } = await open(browser);
    await openAddSheet(page);
    await check('1-10 이름 "<b>안녕</b>" 글자 그대로(b 요소 0개·카드·관리 둘 다)', async () => {
      await submitSheet(page, '<b>안녕</b>', '');
      const m = await page.evaluate(() => ({ b: document.querySelectorAll('b').length, text: [...document.querySelectorAll('.manage-name, [data-testid="manage-name"]')].map((e) => e.textContent) }));
      await page.locator(tid('tab-today')).click();
      await sleep(300);
      const t = await page.evaluate(() => ({ b: document.querySelectorAll('b').length, names: [...document.querySelectorAll('.card-name')].map((e) => e.textContent) }));
      return (m.b === 0 && t.b === 0 && t.names.includes('<b>안녕</b>')) || JSON.stringify({ m, t });
    });
    await ctx.close();
  }
});
