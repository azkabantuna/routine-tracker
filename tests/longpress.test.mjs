// 카드 길게 누르기·카드 메뉴 시험 (screens.js 메뉴, sheets.js 시트·삭제 확인창, index.html 탭 이름)
// 실행(레포 루트에서): node projects/routine-tracker/tests/longpress.test.mjs   (서버는 run.mjs 가 켜 주거나 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { run, check, note, sleep, tid, getRaw, getStore, open, goToday, openCardMenu, openCardMenuTouch, touchHold, R, seedOf } from './_lib.mjs';

const TODAY = '2026-10-07'; // _lib 의 NOW 날짜
// 루틴 2개(r_a 운동, r_b 독서) + 오늘 기록: 운동 mini, 독서 more
const SEEDL = seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1)]);
SEEDL.logs = { [TODAY]: { r_a: 'mini', r_b: 'more' } };

const card = (page, id) => page.locator(`${tid('routine-card')}[data-routine-id="${id}"]`);
const menuCount = (page) => page.locator(tid('card-menu')).count();
const menuOpenAttr = (page, id) => card(page, id).getAttribute('data-menu-open');
const levelOf = async (page, id) => { const s = await getStore(page); return (s && s.logs && s.logs[TODAY] && s.logs[TODAY][id]) || null; };
const cardCenter = async (page, id) => { const b = await card(page, id).locator('.card-name').boundingBox(); return { x: b.x + 6, y: b.y + b.height / 2 }; };

// 진짜 터치(CDP)로 40px 움직여 취소 / 3px 흔들림은 취소하지 않음
async function touchMove(page, id, dx, holdMs) {
  const p = await cardCenter(page, id);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await sleep(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + dx, y: p.y }] });
  await sleep(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

await run(async (browser) => {
  // 1. 탭 이름 · 옛 이름 0 · manage-list 0 · 3D 마운트 1
  {
    const { ctx, page } = await open(browser, { seed: SEEDL });
    await check('1. 탭3 글자 "퓨처 셀프"·앱 안 "루틴 관리" 글자 0·manage-list/manage-item 0개·char-mount 1개', async () => {
      const errs = [];
      const tabTxt = ((await page.locator(tid('tab-manage')).textContent()) || '').replace(/\s+/g, ' ').trim();
      if (!tabTxt.includes('퓨처 셀프')) errs.push(`tab-manage 글자 "${tabTxt}"`);
      const body = await page.evaluate(() => {
        const attrs = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].map((e) => (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '') + (e.getAttribute('placeholder') || '')).join(' ');
        return { text: document.body.textContent || '', attrs };
      });
      if (body.text.includes('루틴 관리')) errs.push('본문 글자에 "루틴 관리" 남음');
      if (body.attrs.includes('루틴 관리')) errs.push('속성(aria-label 등)에 "루틴 관리" 남음');
      const lists = await page.locator(`${tid('manage-list')}, ${tid('manage-item')}, #manage-list`).count();
      if (lists !== 0) errs.push(`manage-list/manage-item ${lists}개`);
      const mounts = await page.locator(tid('char-mount')).count();
      if (mounts !== 1) errs.push(`char-mount ${mounts}개`);
      note(`탭3 "${tabTxt}" · 본문 "루틴 관리" 0 기대 · manage 요소 ${lists}개 · char-mount ${mounts}개`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // 2. 마우스 300ms 짧게 누름 → 메뉴 없음(누른 중·뗀 뒤), 기록 그대로, 이어서 강도 누르기 정상
  {
    const { ctx, page } = await open(browser, { seed: SEEDL });
    await check('2. 마우스 300ms 짧게 누름: 누른 중·뗀 뒤 card-menu 0개 · routineTracker 글자 그대로 · 이어서 max 누르면 기록 max', async () => {
      await goToday(page);
      const raw0 = await getRaw(page);
      const p = await cardCenter(page, 'r_a');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(300);
      const during = await menuCount(page);
      await page.mouse.up();
      await sleep(150);
      const after = await menuCount(page);
      const raw1 = await getRaw(page);
      await card(page, 'r_a').locator('.level-btn[data-level="max"]').click();
      const lv = await levelOf(page, 'r_a');
      const errs = [];
      if (during !== 0) errs.push(`300ms 누른 중 메뉴 ${during}개 (기대 0)`);
      if (after !== 0) errs.push(`뗀 뒤 메뉴 ${after}개 (기대 0)`);
      if (raw1 !== raw0) errs.push('짧게 누름 뒤 routineTracker 바뀜');
      if (lv !== 'max') errs.push(`이어서 max 누른 기록 ${lv} (기대 max)`);
      note(`중 ${during} · 뗀 뒤 ${after} · 저장 글자 ${raw1 === raw0 ? '같음' : '다름'} · 누른 뒤 기록 ${lv}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // 3. 마우스 650ms 길게 → card-menu 보임 · 카드 data-menu-open 1 · 기록·data-current 불변
  {
    const { ctx, page } = await open(browser, { seed: SEEDL });
    await check('3. 마우스 650ms 길게: card-menu 보임 · data-menu-open 1 · 떼도 routineTracker·data-current(mini) 불변', async () => {
      await goToday(page);
      const raw0 = await getRaw(page);
      const cur0 = await card(page, 'r_a').getAttribute('data-current');
      await openCardMenu(page, 'r_a');
      const visible = await page.locator(tid('card-menu')).isVisible();
      const open1 = await menuOpenAttr(page, 'r_a');
      const raw1 = await getRaw(page);
      const cur1 = await card(page, 'r_a').getAttribute('data-current');
      const errs = [];
      if (!visible) errs.push('card-menu 안 보임');
      if (open1 !== '1') errs.push(`data-menu-open ${open1} (기대 1)`);
      if (raw1 !== raw0) errs.push('길게 누른 뒤 routineTracker 바뀜');
      if (cur1 !== cur0) errs.push(`data-current ${cur0} → ${cur1}`);
      note(`메뉴 보임 ${visible} · data-menu-open ${open1} · data-current ${cur0}→${cur1}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // 4. 움직이면 취소: 30px 끌면 메뉴 0 · 3px 흔들림은 취소 안 됨(메뉴 1)
  {
    const { ctx, page } = await open(browser, { seed: SEEDL });
    await check('4. 마우스: 30px 끌고 700ms → card-menu 0 · 3px 흔들고 600ms → card-menu 1(반대 확인)', async () => {
      await goToday(page);
      const errs = [];
      const p = await cardCenter(page, 'r_a');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(100);
      await page.mouse.move(p.x + 30, p.y, { steps: 3 });
      await sleep(700);
      await page.mouse.up();
      const moved = await menuCount(page);
      if (moved !== 0) errs.push(`30px 움직인 뒤 메뉴 ${moved}개 (기대 0)`);
      await sleep(100);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(100);
      await page.mouse.move(p.x + 3, p.y, { steps: 1 });
      await sleep(500);
      const small = await menuCount(page);
      await page.mouse.up();
      if (small !== 1) errs.push(`3px 흔들림 뒤 메뉴 ${small}개 (기대 1)`);
      note(`30px 끌기 뒤 메뉴 ${moved} · 3px 흔들기 뒤 메뉴 ${small}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // 5. 진짜 터치(hasTouch + CDP): 300ms 짧게 → 0 · 650ms 길게 → 보임 · 40px 움직임 → 취소 · 3px 는 취소 안 함 · … 탭 열고 닫기
  {
    const { ctx, page } = await open(browser, { seed: SEEDL, hasTouch: true });
    await check('5. 진짜 터치: 300ms 짧게 → 메뉴 0·기록 그대로 / 650ms 길게 → card-menu 보임 / 40px 끌면 0 / 3px 는 보임', async () => {
      await goToday(page);
      const errs = [];
      const raw0 = await getRaw(page);
      await touchHold(page, card(page, 'r_a').locator('.card-name'), 300);
      await sleep(150);
      const shortN = await menuCount(page);
      if (shortN !== 0) errs.push(`터치 300ms 뒤 메뉴 ${shortN}개`);
      if ((await getRaw(page)) !== raw0) errs.push('터치 짧게 뒤 routineTracker 바뀜');
      await openCardMenuTouch(page, 'r_a');
      const longVis = await page.locator(tid('card-menu')).isVisible();
      if (!longVis) errs.push('터치 650ms 뒤 card-menu 안 보임');
      if ((await getRaw(page)) !== raw0) errs.push('터치 길게 뒤 routineTracker 바뀜');
      await page.locator('#today-title').tap(); // 바깥 터치로 닫기
      await sleep(150);
      const closedN = await menuCount(page);
      if (closedN !== 0) errs.push(`바깥 터치 뒤 메뉴 ${closedN}개`);
      await touchMove(page, 'r_a', 40, 700);
      const movedN = await menuCount(page);
      if (movedN !== 0) errs.push(`터치 40px 움직인 뒤 메뉴 ${movedN}개 (기대 0)`);
      await touchMove(page, 'r_a', 3, 600);
      const smallN = await menuCount(page);
      if (smallN !== 1) errs.push(`터치 3px 흔들린 뒤 메뉴 ${smallN}개 (기대 1)`);
      note(`짧게 ${shortN} · 길게 보임 ${longVis} · 바깥 터치 뒤 ${closedN} · 40px 뒤 ${movedN} · 3px 뒤 ${smallN}`);
      return errs.length ? errs.join('; ') : true;
    });
    await check('5b. 진짜 터치: … 버튼을 탭하면 메뉴 열림, 다시 탭하면 닫힘', async () => {
      await goToday(page);
      await page.locator('#today-title').tap(); // 앞 시험이 남긴 열린 메뉴를 먼저 닫는다
      await sleep(150);
      if ((await menuCount(page)) !== 0) return '시작 전 메뉴가 안 닫힘';
      await page.locator(tid('routine-card')).first().locator('.card-more').tap();
      await sleep(150);
      const opened = await menuCount(page);
      await page.locator(tid('routine-card')).first().locator('.card-more').tap();
      await sleep(150);
      const closed = await menuCount(page);
      note(`… 탭 뒤 ${opened}개 · 한 번 더 탭 뒤 ${closed}개`);
      if (opened !== 1) return `… 탭 뒤 메뉴 ${opened}개 (기대 1)`;
      if (closed !== 0) return `다시 탭 뒤 메뉴 ${closed}개 (기대 0)`;
      return true;
    });
    await ctx.close();
  }

  // 6. 키보드: Shift+F10 / ContextMenu → 메뉴, F10 만 누르면 안 뜸, Esc → 닫힘 + 포커스 … 버튼으로
  {
    const { ctx, page } = await open(browser, { seed: SEEDL });
    await check('6. 키보드: F10 만 → 메뉴 0 · Shift+F10 → 메뉴 1(포커스 수정 버튼) · Esc → 0(포커스 …) · ContextMenu → 1 · Esc → 0', async () => {
      await goToday(page);
      const errs = [];
      await card(page, 'r_a').focus();
      await page.keyboard.press('F10');
      await sleep(100);
      const f10 = await menuCount(page);
      if (f10 !== 0) errs.push(`F10 만 눌렀는데 메뉴 ${f10}개 (기대 0)`);
      await page.keyboard.press('Shift+F10');
      await sleep(100);
      const sh = await menuCount(page);
      const focusTid = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
      if (sh !== 1) errs.push(`Shift+F10 뒤 메뉴 ${sh}개 (기대 1)`);
      if (focusTid !== 'btn-card-edit') errs.push(`Shift+F10 뒤 포커스 ${focusTid} (기대 btn-card-edit)`);
      await page.keyboard.press('Escape');
      await sleep(100);
      const esc = await menuCount(page);
      const back = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
      if (esc !== 0) errs.push(`Esc 뒤 메뉴 ${esc}개 (기대 0)`);
      if (back !== 'btn-card-more') errs.push(`Esc 뒤 포커스 ${back} (기대 btn-card-more)`);
      await card(page, 'r_a').focus();
      await page.keyboard.press('ContextMenu');
      await sleep(100);
      const cm = await menuCount(page);
      if (cm !== 1) errs.push(`ContextMenu 키 뒤 메뉴 ${cm}개 (기대 1)`);
      await page.keyboard.press('Escape');
      await sleep(100);
      const esc2 = await menuCount(page);
      if (esc2 !== 0) errs.push(`ContextMenu 뒤 Esc 메뉴 ${esc2}개`);
      note(`F10 ${f10} · Shift+F10 ${sh}(포커스 ${focusTid}) · Esc ${esc}(포커스 ${back}) · ContextMenu ${cm} · Esc ${esc2}`);
      return errs.length ? errs.join('; ') : true;
    });

    // 7. … 버튼: 44px 이상 · aria-label · 누르면 열림, 또 누르면 닫힘
    await check('7. … 버튼 btn-card-more: 가로·세로 44px 이상 · aria-label "루틴 메뉴 열기" · 누르면 열림, 다시 누르면 닫힘', async () => {
      await goToday(page);
      const errs = [];
      const more = card(page, 'r_a').locator(tid('btn-card-more'));
      const b = await more.boundingBox();
      const label = await more.getAttribute('aria-label');
      if (!b || b.width < 44 || b.height < 44) errs.push(`… 버튼 크기 ${b ? Math.round(b.width) + 'x' + Math.round(b.height) : '없음'} (기대 44 이상)`);
      if (label !== '루틴 메뉴 열기') errs.push(`aria-label "${label}"`);
      await more.click();
      await sleep(100);
      const on = await menuCount(page);
      await more.click();
      await sleep(100);
      const off = await menuCount(page);
      if (on !== 1) errs.push(`… 누른 뒤 메뉴 ${on}개 (기대 1)`);
      if (off !== 0) errs.push(`… 다시 누른 뒤 메뉴 ${off}개 (기대 0)`);
      note(`… 크기 ${b ? Math.round(b.width) + 'x' + Math.round(b.height) : '?'} · aria-label "${label}" · 열림 ${on} · 닫힘 ${off}`);
      return errs.length ? errs.join('; ') : true;
    });

    // 8. 바깥 누르기 → 닫힘
    await check('8. 메뉴를 … 로 연 뒤 바깥(#today-title) 누르면 card-menu 0', async () => {
      await goToday(page);
      await card(page, 'r_a').locator(tid('btn-card-more')).click();
      const before = await menuCount(page);
      await page.locator('#today-title').click();
      await sleep(100);
      const after = await menuCount(page);
      note(`바깥 누르기 전 ${before} · 뒤 ${after}`);
      if (before !== 1) return `열린 뒤 메뉴 ${before}개 (기대 1)`;
      if (after !== 0) return `바깥 누른 뒤 메뉴 ${after}개 (기대 0)`;
      return true;
    });

    // 9. 수정: 기존 시트 · 이름 바뀜 · 저장 형식 그대로 · 기록 그대로
    await check('9. 수정: 메뉴 → 수정 → 기존 시트(제목 "루틴 수정"·값 채움) → 이름 "운동 수정" 저장 → 이름만 바뀌고 키·순서·기록 그대로', async () => {
      await goToday(page);
      const errs = [];
      const s0 = await getStore(page);
      const r0 = s0.routines.find((r) => r.id === 'r_a');
      const keys0 = Object.keys(r0).sort().join(',');
      const logs0 = JSON.stringify(s0.logs);
      await openCardMenu(page, 'r_a');
      await page.locator(tid('btn-card-edit')).click();
      await page.locator(tid('sheet')).waitFor({ state: 'visible' });
      const title = (await page.locator('#sheet-title').textContent()).trim();
      const vName = await page.locator(tid('input-name')).inputValue();
      const vMini = await page.locator(tid('input-mini')).inputValue();
      if (title !== '루틴 수정') errs.push(`시트 제목 "${title}" (기대 루틴 수정)`);
      if (vName !== '운동') errs.push(`이름 칸 "${vName}" (기대 운동)`);
      if (vMini !== 'r_a-mini') errs.push(`mini 칸 "${vMini}" (기대 r_a-mini)`);
      await page.locator(tid('input-name')).fill('운동 수정');
      await page.locator(tid('btn-save')).click();
      await page.locator(tid('sheet')).waitFor({ state: 'hidden' });
      const s1 = await getStore(page);
      const r1 = s1.routines.find((r) => r.id === 'r_a');
      if (!r1 || r1.name !== '운동 수정') errs.push(`저장 뒤 이름 ${r1 && r1.name}`);
      if (s1.routines.length !== 2) errs.push(`루틴 수 ${s1.routines.length} (기대 2)`);
      if (r1 && Object.keys(r1).sort().join(',') !== keys0) errs.push(`키 형식 바뀜 ${keys0} → ${Object.keys(r1).sort().join(',')}`);
      if (r1 && (r1.mini !== 'r_a-mini' || r1.order !== 0 || r1.createdAt !== r0.createdAt)) errs.push('mini·order·createdAt 바뀜');
      if (JSON.stringify(s1.logs) !== logs0) errs.push('수정 뒤 logs 바뀜');
      note(`시트 제목 "${title}" · 이름 칸 "${vName}" · 저장 뒤 이름 "${r1 && r1.name}" · 키 ${Object.keys(r1 || {}).length}개 · logs ${JSON.stringify(s1.logs) === logs0 ? '같음' : '다름'}`);
      return errs.length ? errs.join('; ') : true;
    });

    // 10. 삭제: 확인창 · 취소 → 불변 · 삭제 → 루틴·지난 기록 함께 지움
    await check('10. 삭제: 메뉴 → 삭제 → 확인창 문구 · 취소 → 저장 글자 그대로 · 다시 삭제 확인 → 루틴 1개·r_b 기록 제거·r_a 기록 유지', async () => {
      await goToday(page);
      const errs = [];
      const raw0 = await getRaw(page);
      await openCardMenu(page, 'r_b');
      await page.locator(tid('btn-card-delete')).click();
      await page.locator(tid('confirm-sheet')).waitFor({ state: 'visible' });
      const txt = (await page.locator(tid('confirm-text')).textContent()).trim();
      if (!txt.includes('"독서" 루틴을 삭제할까요?')) errs.push(`확인 문구 "${txt}"`);
      await page.locator(tid('btn-cancel-delete')).click();
      await page.locator(tid('confirm-sheet')).waitFor({ state: 'hidden' });
      if ((await getRaw(page)) !== raw0) errs.push('취소 뒤 routineTracker 바뀜');
      await openCardMenu(page, 'r_b');
      await page.locator(tid('btn-card-delete')).click();
      await page.locator(tid('btn-confirm-delete')).click();
      await page.locator(tid('confirm-sheet')).waitFor({ state: 'hidden' });
      // 카드는 빠지는 연출(data-leaving) 뒤에 사라질 수 있어 최대 2초 기다린다
      const t0 = Date.now();
      while ((await page.locator(tid('routine-card')).count()) !== 1 && Date.now() - t0 < 2000) await sleep(50);
      const waitedMs = Date.now() - t0;
      const s = await getStore(page);
      const ids = s.routines.map((r) => r.id).join(',');
      const cards = await page.locator(tid('routine-card')).count();
      const dayKeys = JSON.stringify(s.logs[TODAY] || null);
      if (ids !== 'r_a') errs.push(`루틴 id ${ids} (기대 r_a)`);
      if (cards !== 1) errs.push(`카드 ${cards}개 (기대 1)`);
      if (dayKeys !== JSON.stringify({ r_a: 'mini' })) errs.push(`${TODAY} 기록 ${dayKeys} (기대 {"r_a":"mini"})`);
      note(`확인 문구 "${txt}" · 삭제 뒤 id ${ids} · 카드 ${cards}개(${waitedMs}ms 뒤) · ${TODAY} 기록 ${dayKeys}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }
});
