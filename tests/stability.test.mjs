// 안정성 시험: 무작위 조작·이상한 저장 데이터·날짜 경계·타이머·새로고침·탭 왕복 누수 (store·routines·screens·calendar·streak·timer·app)
// 실행(레포 루트에서): node projects/routine-tracker/tests/stability.test.mjs   (서버는 run.mjs 가 켜 주거나 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { run, check, note, sleep, tid, getRaw, getStore, open, goToday, consoleErrors, externalRequests, hosts, KEY, BASE, R, seedOf } from './_lib.mjs';

const TABS = ['tab-today', 'tab-calendar', 'tab-manage', 'tab-timer'];
const LV = ['mini', 'more', 'max'];

// 같은 시드면 항상 같은 순서로 무작위 값이 나온다 (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 시계를 직접 다루는 열기: 시각을 iso 로 맞추고 시계는 멈춘 상태(runFor·setSystemTime 으로만 흐름)
async function openAt(browser, iso, { seed = null, extra = [] } = {}) {
  const t = Date.parse(iso);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR', isMobile: false });
  await ctx.route('**/*', (route) => {
    const u = new globalThis.URL(route.request().url());
    hosts.add(u.hostname || u.protocol);
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.clock.install({ time: new Date(t - 10000) });
  await page.clock.pauseAt(new Date(t));
  const pairs = [];
  if (seed !== null) pairs.push([KEY, typeof seed === 'string' ? seed : JSON.stringify(seed)]);
  pairs.push(...extra);
  if (pairs.length) await page.addInitScript((list) => { list.forEach(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }); }, pairs);
  await page.goto(BASE);
  return { ctx, page };
}
// 앱을 뒤로 보냈다가 다시 보이게 한다 (visibilitychange: 앱이 "복귀" 때 날짜·오늘 카드를 다시 그린다)
async function goBackground(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
async function comeBack(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(100);
}
// 탭 누르고 전환 연출 시간만큼 가짜 시계를 흘린다
async function tabTo(page, id) {
  await page.click(tid(id));
  await page.clock.runFor(400);
}
const todayText = (page) => page.locator(tid('today-date')).textContent();
const calTitle = (page) => page.locator('#cal-title, [data-testid="cal-title"]').first().textContent();
const calStreak = (page) => page.locator(tid('cal-streak')).textContent();
const todayCellDate = async (page) => { const l = page.locator(`${tid('cal-day')}[data-today="true"]`); return (await l.count()) === 0 ? 'none(오늘 칸이 보이는 달에 없음)' : l.getAttribute('data-date'); };

// 저장 글자 스키마 검사 (기존 형식: version 1·routines 배열·logs 객체·celebratedOn)
function schemaErrors(s) {
  const e = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['루트가 객체가 아님'];
  if (s.version !== 1) e.push('version ' + JSON.stringify(s.version));
  if (!Array.isArray(s.routines)) e.push('routines 배열 아님');
  if (!s.logs || typeof s.logs !== 'object' || Array.isArray(s.logs)) e.push('logs 객체 아님');
  if (!('celebratedOn' in s)) e.push('celebratedOn 없음');
  (Array.isArray(s.routines) ? s.routines : []).forEach((r, i) => {
    if (typeof r.id !== 'string') e.push(`routines[${i}].id`);
    if (typeof r.name !== 'string' || !r.name.trim()) e.push(`routines[${i}].name`);
    for (const k of ['mini', 'more', 'max']) if (typeof r[k] !== 'string') e.push(`routines[${i}].${k} 글자 아님`);
    if (typeof r.order !== 'number') e.push(`routines[${i}].order 숫자 아님`);
    if (typeof r.createdAt !== 'string') e.push(`routines[${i}].createdAt 글자 아님`);
  });
  for (const d of Object.keys((s.logs && typeof s.logs === 'object') ? s.logs : {})) {
    const day = s.logs[d];
    if (!day || typeof day !== 'object') { e.push(`logs.${d} 객체 아님`); continue; }
    for (const id of Object.keys(day)) if (!LV.includes(day[id])) e.push(`logs.${d}.${id}=${JSON.stringify(day[id])}`);
  }
  return e;
}

await run(async (browser) => {
  // ---------- (1) 무작위 200회: 탭 이동·추가·삭제·완료·강도·달 넘기·수정 ----------
  {
    const { ctx, page } = await open(browser, { seed: seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1)]) });
    const LIVE = `${tid('routine-card')}:not([data-leaving="true"])`;
    const rng = mulberry32(20261020);
    const kinds = {};
    const fails = [];
    const errBefore = consoleErrors.length;
    await check('1. 무작위 200회(시드 20261020): 오류(pageerror·console.error) 0 · 끝난 뒤 routineTracker JSON 파싱 · 스키마 유지', async () => {
      for (let i = 0; i < 200; i++) {
        const op = Math.floor(rng() * 6);
        const pick = (n) => Math.floor(rng() * n);
        const cards = await page.locator(LIVE).count(); // 퇴장 중(data-leaving) 카드는 셈에서 뺀다
        const s = await getStore(page);
        const n = s && Array.isArray(s.routines) ? s.routines.length : 0;
        let kind = '';
        try {
          if (op === 0) {                                  // 탭 이동
            const t = TABS[pick(4)];
            await page.click(tid(t)); await sleep(60); kind = 'tab';
          } else if (op === 1) {                           // 루틴 추가 (6개 넘지 않게)
            if (n >= 6) { kind = 'add-skip'; }
            else {
              await goToday(page);
              await page.click(tid('btn-add-routine'));
              await page.fill(tid('input-name'), '루틴' + i);
              await page.fill(tid('input-mini'), '미니' + i);
              await page.click(tid('btn-save'));
              await page.locator(tid('sheet')).waitFor({ state: 'hidden' });
              kind = 'add';
            }
          } else if (op === 2) {                           // 루틴 삭제 (… → 삭제 → 확인)
            if (cards === 0) { kind = 'del-skip'; }
            else {
              await goToday(page);
              await page.locator(LIVE).nth(pick(cards)).locator(tid('btn-card-more')).click();
              await page.locator(tid('btn-card-delete')).click();
              await page.locator(tid('btn-confirm-delete')).click();
              await page.locator(tid('confirm-sheet')).waitFor({ state: 'hidden' });
              await sleep(300); // 퇴장 연출(250ms) 끝까지
              kind = 'del';
            }
          } else if (op === 3) {                           // 완료(강도 누르기)
            if (cards === 0) { kind = 'lv-skip'; }
            else {
              await goToday(page);
              const lv = LV[pick(3)];
              await page.locator(LIVE).nth(pick(cards)).locator(`.level-btn[data-level="${lv}"]`).click();
              kind = 'lv:' + lv;
            }
          } else if (op === 4) {                           // 캘린더 달 넘기
            await page.click(tid('tab-calendar')); await sleep(350);
            await page.click(tid(rng() < 0.5 ? 'cal-prev' : 'cal-next'));
            kind = 'cal';
          } else {                                         // 수정 (… → 수정 → 이름 저장)
            if (cards === 0) { kind = 'edit-skip'; }
            else {
              await goToday(page);
              await page.locator(LIVE).nth(pick(cards)).locator(tid('btn-card-more')).click();
              await page.locator(tid('btn-card-edit')).click();
              await page.fill(tid('input-name'), '수정' + i);
              await page.click(tid('btn-save'));
              await page.locator(tid('sheet')).waitFor({ state: 'hidden' });
              kind = 'edit';
            }
          }
        } catch (e) {
          const why = String(e.message).split('\n').filter((l) => /intercept|not visible|not stable|not enabled|outside|resolved to|Timeout/.test(l)).slice(0, 2).join(' / ');
          fails.push(`#${i} ${kind || 'op' + op}: ${why || String(e.message).split('\n')[0]}`);
          kind = kind || 'error';
        }
        kinds[kind.split(':')[0]] = (kinds[kind.split(':')[0]] || 0) + 1;
      }
      const errN = consoleErrors.length - errBefore;
      const raw = await getRaw(page);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { return `끝난 뒤 routineTracker JSON 파싱 실패 (${String(raw).slice(0, 40)})`; }
      const schema = schemaErrors(parsed);
      note(`동작 분포 ${JSON.stringify(kinds)} · 조작 예외 ${fails.length}건 · 오류 ${errN}개 · 루틴 ${parsed.routines.length}개 · 기록 날짜 ${Object.keys(parsed.logs).length}개`);
      const errs = [];
      if (fails.length) errs.push('조작 실패: ' + fails.slice(0, 3).join(' | '));
      if (errN) errs.push(`오류 ${errN}개: ${consoleErrors.slice(errBefore, errBefore + 2).join(' | ')}`);
      if (schema.length) errs.push('스키마: ' + schema.slice(0, 4).join(', '));
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ---------- (2) 이상한 저장 데이터 6종: 앱이 뜨고 탭 4개 동작 · 오류 0 · 원래 저장 글자 그대로 ----------
  const CASES = [
    { name: '키 없음', seed: null },
    { name: '빈 문자열', seed: '' },
    { name: '잘못된 JSON', seed: '{"version":1,"routines":[' },
    { name: 'routines 빠짐', seed: JSON.stringify({ version: 1, logs: {}, celebratedOn: null }) },
    { name: '기록 날짜 이상함(2026-13-40·abc)', seed: JSON.stringify({ version: 1, routines: [R('r_a', '운동', 0)], logs: { '2026-13-40': { r_a: 'mini' }, abc: { r_a: 'max' } }, celebratedOn: null }) },
    { name: '숫자 대신 문자열(order "0")', seed: JSON.stringify({ version: 1, routines: [{ ...R('r_a', '운동', 0), order: '0' }], logs: {}, celebratedOn: null }) },
  ];
  for (const c of CASES) {
    await check(`2. 이상한 데이터 "${c.name}": 앱이 뜸 · 탭 4개 선택 동작 · 오류 0 · 저장 글자 그대로(몰래 덮어쓰기 0)`, async () => {
      const errBefore = consoleErrors.length;
      const { ctx, page } = await open(browser, { seed: c.seed });
      const errs = [];
      if (!(await page.locator(tid('tab-today')).isVisible())) errs.push('오늘 탭 안 보임');
      for (const t of TABS) {
        await page.click(tid(t));
        await sleep(300);
        const sel = await page.locator(tid(t)).getAttribute('aria-selected');
        if (sel !== 'true') errs.push(`${t} 선택 안 됨(aria-selected=${sel})`);
      }
      await page.click(tid('tab-today'));
      const after = await page.evaluate((k) => localStorage.getItem(k), KEY);
      if (c.seed !== null && after !== c.seed) errs.push(`저장 글자 바뀜: ${String(after).slice(0, 50)}`);
      const backup = await page.evaluate(() => localStorage.getItem('routineTracker.backup'));
      const newErr = consoleErrors.length - errBefore;
      if (newErr) errs.push(`오류 ${newErr}개: ${consoleErrors.slice(errBefore, errBefore + 2).join(' | ')}`);
      note(`저장 글자 ${c.seed === null ? '없음→' + (after === null ? '없음 유지' : '새로 씀') : (after === c.seed ? '그대로' : '바뀜')} · 백업 키 ${backup === null ? '없음' : '있음'} · 오류 ${newErr}`);
      await ctx.close();
      return errs.length ? errs.join('; ') : true;
    });
  }

  // ---------- (3) 날짜 경계 (가짜 시계) ----------
  {
    const { ctx, page } = await openAt(browser, '2026-10-20T23:59:59+09:00');
    await check('3-1a 자정: 23:59:59 → 00:00:01 넘기고 앱 복귀(다시 보임) → 오늘 날짜 "10월 21일 수요일" · 달력 오늘 칸 2026-10-21', async () => {
      const errs = [];
      const d0 = (await todayText(page)).trim();
      if (d0 !== '10월 20일 화요일') errs.push(`시작 날짜 "${d0}"`);
      await goBackground(page);
      await page.clock.runFor(2000);
      const hms = await page.evaluate(() => { const d = new Date(); return [d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].join(':'); });
      if (hms !== '21:0:0:1') errs.push(`시계 ${hms} (기대 21:0:0:1)`);
      await comeBack(page);
      const d1 = (await todayText(page)).trim();
      if (d1 !== '10월 21일 수요일') errs.push(`복귀 뒤 "${d1}" (기대 10월 21일 수요일)`);
      await tabTo(page, 'tab-calendar');
      const cell = await todayCellDate(page);
      if (cell !== '2026-10-21') errs.push(`달력 오늘 칸 ${cell} (기대 2026-10-21)`);
      note(`시작 "${d0}" · 복귀 뒤 "${d1}" · 달력 오늘 칸 ${cell}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await openAt(browser, '2026-10-20T23:59:59+09:00');
    await check('3-1b 자정 뒤 "오늘" 탭을 눌러 옮기기만 해도 오늘 날짜가 "10월 21일 수요일" (탭 이동만으로 갱신)', async () => {
      await page.clock.runFor(2000);
      await tabTo(page, 'tab-calendar');
      await tabTo(page, 'tab-today');
      const d1 = (await todayText(page)).trim();
      note(`탭만 옮긴 뒤 오늘 날짜 "${d1}" (앱 showTab 은 today 전환 때 renderToday 를 안 부름)`);
      return d1 === '10월 21일 수요일' ? true : `탭만 옮긴 뒤 "${d1}" (기대 10월 21일 수요일)`;
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await openAt(browser, '2026-12-31T23:59:50+09:00');
    await check('3-2 연말: 12/31 23:59:50 → 1/1 00:00:10 (복귀) → 달력 제목 "2027년 1월"·오늘 칸 2027-01-01·오늘 날짜 "1월 1일 금요일"', async () => {
      const errs = [];
      await tabTo(page, 'tab-calendar');
      const t0 = (await calTitle(page)).trim();
      if (t0 !== '2026년 12월') errs.push(`시작 달력 "${t0}"`);
      await tabTo(page, 'tab-today');
      await goBackground(page);
      await page.clock.runFor(20000);
      await comeBack(page);
      const d1 = (await todayText(page)).trim();
      await tabTo(page, 'tab-calendar');
      const t1 = (await calTitle(page)).trim();
      const cell = await todayCellDate(page);
      if (t1 !== '2027년 1월') errs.push(`넘긴 뒤 달력 제목 "${t1}" (기대 2027년 1월)`);
      if (cell !== '2027-01-01') errs.push(`오늘 칸 ${cell} (기대 2027-01-01)`);
      if (d1 !== '1월 1일 금요일') errs.push(`오늘 날짜 "${d1}" (기대 1월 1일 금요일)`);
      note(`달력 "${t0}" → "${t1}" · 오늘 칸 ${cell} · 오늘 날짜 "${d1}"`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await openAt(browser, '2028-02-28T23:59:50+09:00');
    await check('3-3 윤년 2028: 2/28 → 2/29(화) 복귀 → 달력 ◀▶ → 3/1(수) 복귀 · 오늘 날짜·오늘 칸·달 제목', async () => {
      const errs = [];
      await tabTo(page, 'tab-today');
      await goBackground(page);
      await page.clock.runFor(20000); // 2/29 00:00:10
      await comeBack(page);
      const d29 = (await todayText(page)).trim();
      if (d29 !== '2월 29일 화요일') errs.push(`2/29 오늘 날짜 "${d29}"`);
      await tabTo(page, 'tab-calendar');
      const cell29 = await todayCellDate(page);
      const title29 = (await calTitle(page)).trim();
      if (cell29 !== '2028-02-29') errs.push(`2/29 오늘 칸 ${cell29}`);
      if (title29 !== '2028년 2월') errs.push(`2/29 달력 제목 "${title29}"`);
      await page.click(tid('cal-next'));
      await page.clock.runFor(300);
      const titleNext = (await calTitle(page)).trim();
      await page.click(tid('cal-prev'));
      await page.click(tid('cal-prev'));
      await page.clock.runFor(300);
      const titlePrev2 = (await calTitle(page)).trim();
      await page.click(tid('cal-next'));
      await page.clock.runFor(300);
      if (titleNext !== '2028년 3월') errs.push(`다음 달 "${titleNext}" (기대 2028년 3월)`);
      if (titlePrev2 !== '2028년 1월') errs.push(`두 번 이전 "${titlePrev2}" (기대 2028년 1월)`);
      // 3/1 로 하루 더 (달 바뀜 · 앱 복귀)
      await tabTo(page, 'tab-today');
      await goBackground(page);
      await page.clock.runFor(86400000);
      await comeBack(page);
      const d31 = (await todayText(page)).trim();
      if (d31 !== '3월 1일 수요일') errs.push(`3/1 오늘 날짜 "${d31}" (기대 3월 1일 수요일)`);
      await tabTo(page, 'tab-calendar');
      // 2월(이전 오늘의 달)을 보던 달력은 날짜가 바뀌면 앱이 스스로 3월로 옮긴다(바퀴1 고침) — 버튼 누르지 않음
      await page.clock.runFor(300);
      const cell31 = await todayCellDate(page);
      const title31 = (await calTitle(page)).trim();
      if (cell31 !== '2028-03-01') errs.push(`3/1 오늘 칸 ${cell31}`);
      if (title31 !== '2028년 3월') errs.push(`3/1 달력 제목 "${title31}"`);
      note(`2/29: 날짜 "${d29}" · 칸 ${cell29} · 제목 "${title29}" · ◀▶ "${titleNext}"/"${titlePrev2}" · 3/1: 날짜 "${d31}" · 칸 ${cell31} · "${title31}"`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }
  {
    // 스트릭: 기록 2일(18 max, 19 mini) → 오늘 20 mini 만 해도 3 · 21 건너뜀 → 22 mini 는 1
    const seed = seedOf([R('r_a', '운동', 0)]);
    seed.logs = { '2026-10-18': { r_a: 'max' }, '2026-10-19': { r_a: 'mini' } };
    const { ctx, page } = await openAt(browser, '2026-10-20T10:00:00+09:00', { seed });
    await check('3-4 스트릭: 18·19 기록 → 달력 2 · 오늘 20 mini 만 → 3(mini 도 인정) · 21 건너뜀(22 아직) → 0 · 22 mini → 1', async () => {
      const errs = [];
      await tabTo(page, 'tab-calendar');
      const s0 = (await calStreak(page)).trim();
      if (s0 !== '2') errs.push(`처음 스트릭 ${s0} (기대 2)`);
      await tabTo(page, 'tab-today');
      await page.locator(tid('routine-card')).first().locator('.level-btn[data-level="mini"]').click();
      await tabTo(page, 'tab-calendar');
      const s1 = (await calStreak(page)).trim();
      if (s1 !== '3') errs.push(`오늘 mini 뒤 스트릭 ${s1} (기대 3)`);
      await tabTo(page, 'tab-today');
      await goBackground(page);
      await page.clock.setSystemTime(new Date('2026-10-22T10:00:00+09:00'));
      await comeBack(page);
      await tabTo(page, 'tab-calendar');
      const s2 = (await calStreak(page)).trim();
      if (s2 !== '0') errs.push(`21 건너뛴 뒤(오늘 22 아직) 스트릭 ${s2} (기대 0)`);
      await tabTo(page, 'tab-today');
      await page.locator(tid('routine-card')).first().locator('.level-btn[data-level="mini"]').click();
      await tabTo(page, 'tab-calendar');
      const s3 = (await calStreak(page)).trim();
      if (s3 !== '1') errs.push(`22 mini 뒤 스트릭 ${s3} (기대 1: 21 끊김)`);
      note(`처음 ${s0} · 20 mini ${s1} · 21 건너뜀 ${s2} · 22 mini ${s3}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ---------- (4) 타이머: 다른 탭 갔다 오기·15분 진행·전체화면·0:00 ----------
  {
    const { ctx, page } = await openAt(browser, '2026-10-20T10:00:00+09:00');
    const secOf = (t) => { const m = /^\s*(\d+):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
    const timeTxt = () => page.locator(tid('timer-time')).textContent();
    await check('4-1 타이머 25분 시작 → 다른 탭 10분(가짜 시계) → 돌아와 15:00±1초 → 5분 더 → 10:00±1초', async () => {
      const errs = [];
      await tabTo(page, 'tab-timer');
      await page.click(tid('timer-start'));
      await page.clock.runFor(300);
      const t0 = await timeTxt();
      if (secOf(t0) < 1499 || secOf(t0) > 1500) errs.push(`시작 직후 ${t0} (기대 25:00±1초)`);
      await tabTo(page, 'tab-today');
      await page.clock.runFor(600000);
      await tabTo(page, 'tab-timer');
      const t1 = await timeTxt();
      if (Math.abs(secOf(t1) - 900) > 1) errs.push(`다른 탭 10분 뒤 ${t1} (기대 15:00±1초)`);
      await page.clock.runFor(300000);
      const t2 = await timeTxt();
      if (Math.abs(secOf(t2) - 600) > 1) errs.push(`5분 더 뒤 ${t2} (기대 10:00±1초)`);
      const state = await page.locator('#screen-timer').getAttribute('data-timer-state');
      if (state !== 'running') errs.push(`상태 ${state} (기대 running)`);
      note(`시작 ${t0} · 다른 탭 10분 뒤 ${t1} · 5분 더 뒤 ${t2} · 상태 ${state}`);
      return errs.length ? errs.join('; ') : true;
    });
    await check('4-2 전체화면 열기/닫기 5회: 덮개 열림·닫힘 각 5번 · 실패 0', async () => {
      const errs = [];
      let opened = 0, closed = 0;
      for (let i = 0; i < 5; i++) {
        await page.click(tid('timer-fs'));
        await sleep(60);
        if (await page.locator(tid('timer-cover')).isVisible()) opened++;
        else errs.push(`${i + 1}번째 열기 뒤 덮개 없음`);
        await page.click(tid('timer-cover-close'));
        await sleep(60);
        const hiddenNow = await page.locator(tid('timer-cover')).isHidden();
        if (hiddenNow) closed++; else errs.push(`${i + 1}번째 닫기 뒤 덮개 남음`);
      }
      note(`열기 ${opened}회 · 닫기 ${closed}회 (각 5 기대)`);
      return errs.length ? errs.join('; ') : true;
    });
    await check('4-3 0:00 종료: 남은 시간 끝까지 0.25초씩 → 0:00 · 상태 done · data-timer-fx done · 완료 글자 · 종료 효과(.celebrate) 생성 1회', async () => {
      const errs = [];
      await page.evaluate(() => {
        window.__cel = 0;
        new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList && n.classList.contains('celebrate')) window.__cel++; }); })
          .observe(document.body, { childList: true, subtree: true });
      });
      let steps = 0;
      while (steps < 2600 && (await page.locator('#screen-timer').getAttribute('data-timer-state')) !== 'done') { await page.clock.runFor(250); steps++; }
      const t = await timeTxt();
      const st = await page.locator('#screen-timer').getAttribute('data-timer-state');
      const fx = await page.evaluate(() => { const r = document.querySelector('[data-testid="timer-ring"]'); return r.closest('[data-timer-fx]') ? r.closest('[data-timer-fx]').getAttribute('data-timer-fx') : 'none'; });
      const done = await page.locator(tid('timer-done')).isVisible();
      const made = await page.evaluate(() => window.__cel);
      if (secOf(t) !== 0) errs.push(`끝난 뒤 ${t} (기대 0:00)`);
      if (st !== 'done') errs.push(`상태 ${st} (기대 done)`);
      if (fx !== 'done') errs.push(`data-timer-fx ${fx} (기대 done)`);
      if (!done) errs.push('완료 글자 안 보임');
      if (made !== 1) errs.push(`종료 효과 생성 ${made}개 (기대 1)`);
      note(`끝 ${t} · 상태 ${st} · fx ${fx} · 완료 글자 ${done} · 종료 효과 생성 ${made}개 · 걸린 0.25초 ${steps}번`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ---------- (5) 새로고침 뒤 기록·단어·타이머 유지 ----------
  {
    const { ctx, page } = await open(browser, { seed: seedOf([R('r_a', '운동', 0), R('r_b', '독서', 1)]) });
    await check('5. 새로고침: 기록·routineFutureWord·routineTimer 글자 전후 같음 · 타이머 분 7 유지', async () => {
      const errs = [];
      await page.evaluate(() => localStorage.setItem('routineFutureWord', '조용히 달린다'));
      await goToday(page);
      await page.locator(tid('routine-card')).first().locator('.level-btn[data-level="more"]').click();
      await tabTo_(page, 'tab-timer');
      await page.fill(tid('timer-min'), '7');
      await page.locator(tid('timer-min')).dispatchEvent('change');
      const before = await page.evaluate(() => ({ t: localStorage.getItem('routineTracker'), f: localStorage.getItem('routineFutureWord'), m: localStorage.getItem('routineTimer') }));
      if (before.m !== '{"minutes":7}') errs.push(`분 저장 ${before.m} (기대 {"minutes":7})`);
      await page.reload();
      await page.waitForLoadState('load');
      const after = await page.evaluate(() => ({ t: localStorage.getItem('routineTracker'), f: localStorage.getItem('routineFutureWord'), m: localStorage.getItem('routineTimer') }));
      if (after.t !== before.t) errs.push('새로고침 뒤 routineTracker 바뀜');
      if (after.f !== before.f) errs.push(`새로고침 뒤 routineFutureWord ${after.f}`);
      if (after.m !== before.m) errs.push(`새로고침 뒤 routineTimer ${after.m}`);
      await tabTo_(page, 'tab-timer');
      const minVal = await page.locator(tid('timer-min')).inputValue();
      if (minVal !== '7') errs.push(`새로고침 뒤 타이머 분 칸 ${minVal} (기대 7)`);
      await goToday(page);
      const cur = await page.locator(tid('routine-card')).first().getAttribute('data-current');
      if (cur !== 'more') errs.push(`새로고침 뒤 운동 강도 ${cur} (기대 more)`);
      note(`routineTimer ${after.m} · 단어 ${after.f} · 분 칸 ${minVal} · 강도 ${cur}`);
      return errs.length ? errs.join('; ') : true;
    });
    await ctx.close();
  }

  // ---------- (6) 반복 실행 누수: 탭 20회 왕복 뒤 setInterval 살아 있는 수 ≤1 · rAF 가 숨긴 탭에서 안 늚 ----------
  {
    const wrap = `
      window.__iv = new Map();
      const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
      window.setInterval = function (fn, ms, ...rest) { const id = si(fn, ms, ...rest); window.__iv.set(id, 1); return id; };
      window.clearInterval = function (id) { window.__iv.delete(id); return ci(id); };
      window.__raf = 0;
      const sr = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) { window.__raf++; return sr(cb); };
    `;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', locale: 'ko-KR', isMobile: false });
    await ctx.route('**/*', (route) => {
      const u = new globalThis.URL(route.request().url());
      hosts.add(u.hostname || u.protocol);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') { externalRequests.push(u.href); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    await page.addInitScript(wrap);
    await page.goto(BASE);
    await check('6-1 탭 20회 왕복(4탭 순환) 뒤 살아 있는 setInterval ≤1', async () => {
      const seq = ['tab-calendar', 'tab-manage', 'tab-timer', 'tab-today'];
      for (let i = 0; i < 20; i++) {
        await page.click(tid(seq[i % 4]));
        await sleep(250);
        await page.click(tid('tab-today'));
        await sleep(250);
      }
      const alive = await page.evaluate(() => window.__iv.size);
      note(`왕복 20회 뒤 살아 있는 setInterval ${alive}개 (기대 ≤1)`);
      return alive <= 1 ? true : `살아 있는 setInterval ${alive}개 (기대 ≤1)`;
    });
    await check('6-2 오늘 탭(3D 꺼짐)에서 1.5초 동안 rAF 증가 ≤2', async () => {
      await sleep(300);
      const r0 = await page.evaluate(() => window.__raf);
      await sleep(1500);
      const d = (await page.evaluate(() => window.__raf)) - r0;
      note(`오늘 탭 1.5초 rAF 증가 ${d}`);
      return d <= 2 ? true : `오늘 탭에서 rAF ${d}회 증가 (기대 ≤2)`;
    });
    await check('6-3 퓨처 셀프 탭을 보다가 숨김(visibilitychange hidden): 1.5초 동안 rAF 증가 ≤2', async () => {
      await page.click(tid('tab-manage'));
      await sleep(800);
      const shownR = await page.evaluate(() => window.__raf);
      await sleep(500);
      const visibleRate = (await page.evaluate(() => window.__raf)) - shownR;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(300);
      const r0 = await page.evaluate(() => window.__raf);
      await sleep(1500);
      const d = (await page.evaluate(() => window.__raf)) - r0;
      note(`보일 때 0.5초 rAF ${visibleRate}회 · 숨긴 뒤 1.5초 rAF 증가 ${d}회 (기대 ≤2)`);
      return d <= 2 ? true : `숨긴 뒤 rAF ${d}회 증가 (기대 ≤2)`;
    });
    await ctx.close();
  }
});

// 캘린더 탭 이동(시계 흘림 포함)
async function tabTo_(page, id) { await tabTo(page, id); }
