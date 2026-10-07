// M1 통과 기준 자동 시험 (검토봇 C)
// 실행: 레포 루트에서  node projects/routine-tracker/tests/m1.test.mjs
// 먼저 서버를 켜 두어야 함: cd projects/routine-tracker && python3 -m http.server 8080
import { chromium } from 'playwright';

const URL = process.env.RT_URL || 'http://localhost:8080/';
const KEY = 'routineTracker';
const results = []; // { name, ok, reason }
let consoleErrors = [];

function record(name, ok, reason) {
  results.push({ name, ok, reason });
  console.log(`${ok ? '✅' : '❌'} ${name}${reason ? ' — ' + reason : ''}`);
}

async function newPage(browser, time) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date(time));
  return { ctx, page };
}

const tid = (id) => `[data-testid="${id}"]`;
const getStore = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const progress = async (page) => {
  const el = page.locator(tid('progress'));
  return { n: Number(await el.getAttribute('data-done-count')), m: Number(await el.getAttribute('data-total')) };
};
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function addRoutine(page, { name, mini = '', more = '', max = '' }) {
  await page.click(tid('tab-manage'));
  await page.click(tid('btn-add-routine'));
  await page.fill(tid('input-name'), name);
  await page.fill(tid('input-mini'), mini);
  await page.fill(tid('input-more'), more);
  await page.fill(tid('input-max'), max);
  await page.click(tid('btn-save'));
  await page.click(tid('tab-today'));
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

const browser = await chromium.launch();
try {
  // ---------- 기준 1~4, 6: 기본 시각 10:00 ----------
  const { ctx, page } = await newPage(browser, '2026-10-07T10:00:00+09:00');
  await page.goto(URL);

  await check('1. 빈 상태 안내·첫 루틴 버튼·가로 스크롤 없음·탭 3개·기록 탭 준비 중', async () => {
    const errs = [];
    if (!(await page.locator(tid('empty-state')).isVisible())) errs.push('empty-state 안 보임');
    if (!(await page.locator(tid('btn-first-routine')).isVisible())) errs.push('첫 루틴 버튼 안 보임');
    if (!(await noHScroll(page))) errs.push('가로 스크롤 있음');
    for (const t of ['tab-today', 'tab-log', 'tab-manage']) if (!(await page.locator(tid(t)).isVisible())) errs.push(t + ' 안 보임');
    await page.click(tid('tab-log'));
    const ph = page.locator(tid('log-placeholder'));
    if (!(await ph.isVisible())) errs.push('기록 placeholder 안 보임');
    const txt = (await page.locator('#screen-log').innerText()).trim();
    if (!txt.includes('M2 에서 준비 중')) errs.push('"M2 에서 준비 중" 문구 없음: ' + txt);
    if ((await page.locator('#screen-log button, #screen-log input').count()) > 0) errs.push('기록 화면에 다른 컨트롤 있음');
    if ((await page.locator(tid('tab-log')).getAttribute('aria-selected')) !== 'true') errs.push('tab-log aria-selected 아님');
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
    await page.click(tid('tab-today'));
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

  // ---------- 기본 경우 ----------
  await check('기본: 긴 이름(45자)·긴 기준이 카드 밖으로 넘치지 않음, 가로 스크롤 없음', async () => {
    const errs = [];
    const long = '가나다라마바사아자차카타파하'.repeat(3) + 'ABC'; // 45자
    const longNoSpace = 'abcdefghij'.repeat(5);
    await addRoutine(page, { name: long, mini: longNoSpace, more: '보통', max: '최고' });
    await addRoutine(page, { name: longNoSpace, mini: '1' });
    if (!(await noHScroll(page))) errs.push('오늘 화면 가로 스크롤 생김');
    const over = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[data-testid="routine-card"]').forEach((c) => {
        const cr = c.getBoundingClientRect();
        c.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) out.push((el.className || el.tagName) + ':' + Math.round(r.right) + '>' + Math.round(cr.right));
        });
        if (cr.right > window.innerWidth + 1) out.push('card 화면 밖');
      });
      return out;
    });
    if (over.length) errs.push('넘침: ' + over.slice(0, 5).join(', '));
    await page.click(tid('tab-manage'));
    if (!(await noHScroll(page))) errs.push('관리 화면 가로 스크롤 생김');
    await page.screenshot({ path: 'projects/routine-tracker/tests/m1-long-names.png', fullPage: true });
    await page.click(tid('tab-today'));
    await page.screenshot({ path: 'projects/routine-tracker/tests/m1-today.png', fullPage: true });
    return errs.length ? errs.join('; ') : true;
  });

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

  await check('기본: 사용자 글자 HTML 로 해석 안 됨', async () => {
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
    await page.reload();
    await addRoutine(page, { name: '<b>독서</b><img src=x onerror=alert(1)>' });
    const t = await page.locator(`${tid('routine-card')} .card-name`).innerText();
    const n = await page.locator(`${tid('routine-card')} .card-name b, ${tid('routine-card')} img`).count();
    return n === 0 && t.includes('<b>독서</b>') ? true : `text=${t}, elements=${n}`;
  });

  await ctx.close();

  // ---------- 기준 5: 08:30 KST ----------
  const t5 = await newPage(browser, '2026-10-07T08:30:00+09:00');
  await check('5. 08:30 KST 에 mini → logs 키 "2026-10-07"', async () => {
    const p = t5.page;
    await p.goto(URL);
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

  // ---------- 기준 7 ----------
  record('7. 콘솔 오류 0개 (console error + pageerror)', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.join(' | ') : '');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
