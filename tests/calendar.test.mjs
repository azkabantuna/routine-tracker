// 캘린더 탭 시험 (calendar.js · streak.js · calendar.css · index.html · app.js)
// 실행(레포 루트에서): node projects/routine-tracker/tests/calendar.test.mjs
// 원칙: 모든 검사는 실패할 수 있어야 한다. 기대값은 코드가 아니라 옛 기록 예시(fixtures/old-seed.json)에서 계산한다.
import { fs, path, HERE, run, check, sleep, tid, getRaw, open, fixtureRaw, noHScroll, scaleOf } from './_lib.mjs';

const FIX = JSON.parse(fixtureRaw);
const IDS = FIX.routines.map((r) => r.id);
const NAME = Object.fromEntries(FIX.routines.map((r) => [r.id, r.name]));
const withLogs = (logs, routines = FIX.routines) => ({ ...FIX, routines, logs });
const title = (page) => page.locator(tid('cal-title')).innerText().then((t) => t.replace(/\s+/g, ' ').trim());
const cell = (page, date) => page.locator(`[data-testid="cal-day"][data-date="${date}"]`);
const num = (page, id) => page.locator(tid(id)).innerText().then((t) => t.trim());

async function openCal(browser, opts = {}) {
  const r = await open(browser, { settle: 300, ...opts });
  await r.page.locator(tid('tab-calendar')).click();
  await sleep(450);
  return r;
}
// 진짜 터치 이벤트(CDP)로 한 번 끌기
async function touchDrag(page, el, dx, dy) {
  const b = await el.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx / 10) * i, y: y + (dy / 10) * i }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(450);
}
const allowedOnly = (props, allowed) => props.every((p) => allowed.includes(p));

await run(async (browser) => {
  // ---- 1. 탭 구성 ----
  await check('1. 탭 4개: 오늘·캘린더·루틴 관리·타이머 순서, 2번째 전환 시 aria-selected·화면 전환, 옛 #screen-log 없음', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, settle: 300 });
    const tabs = await page.locator('nav.tabbar [role="tab"]').all();
    const ids = [], labels = [];
    for (const t of tabs) { ids.push(await t.getAttribute('data-testid')); labels.push((await t.innerText()).replace(/\s+/g, ' ').trim()); }
    const errs = [];
    if (ids.join('|') !== 'tab-today|tab-calendar|tab-manage|tab-timer') errs.push('순서 ' + ids.join('|'));
    if (!/오늘/.test(labels[0]) || !/캘린더/.test(labels[1]) || !/루틴 관리/.test(labels[2]) || !/타이머/.test(labels[3])) errs.push('이름 ' + labels.join('|'));
    await page.locator(tid('tab-calendar')).click();
    await sleep(450);
    if ((await page.locator(tid('tab-calendar')).getAttribute('aria-selected')) !== 'true') errs.push('aria-selected 안 바뀜');
    if (!(await page.locator('#screen-calendar').isVisible())) errs.push('캘린더 화면 안 보임');
    if (await page.locator('#screen-today').isVisible()) errs.push('오늘 화면이 같이 보임');
    if ((await page.locator('#screen-log').count()) !== 0) errs.push('옛 #screen-log 남아 있음');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 2. 읽기 전용 (코드 + 실제 저장값) ----
  await check('2. 캘린더·스트릭 코드에 저장 명령 없음 (대조: 같은 검사가 쓰기 코드를 잡아내는지 포함)', async () => {
    const WRITE = /setItem|removeItem|localStorage|\.save\s*\(|store\.save|\.clear\s*\(/;
    if (!WRITE.test("localStorage.setItem('x','y')")) return '대조 실패: 검사식이 쓰기 코드를 못 잡음';
    const bad = [];
    for (const f of ['calendar.js', 'streak.js']) if (WRITE.test(fs.readFileSync(path.join(HERE, '..', 'js', f), 'utf8'))) bad.push(f);
    return bad.length ? '쓰기 코드 발견: ' + bad.join(', ') : true;
  });

  await check('3. 저장값 불변: 캘린더 열기·6달 뒤로/앞으로·날짜 3번 탭·새로고침 뒤 localStorage 문자열이 한 글자도 안 바뀜', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    const before = await getRaw(page);
    if (!before || before.length < 100) { await ctx.close(); return '시작 저장값이 비정상(' + (before || '').length + '자)'; }
    for (let i = 0; i < 6; i++) { await page.locator(tid('cal-prev')).click(); await sleep(350); }
    await cell(page, '2026-04-01').first().click().catch(() => {});
    for (let i = 0; i < 12; i++) { await page.locator(tid('cal-next')).click(); await sleep(350); }
    await page.locator(tid('cal-prev')).click(); await sleep(350);
    const days = await page.locator(tid('cal-day')).all();
    for (const d of days.slice(0, 3)) await d.click();
    await page.reload(); await sleep(400);
    await page.locator(tid('tab-calendar')).click(); await sleep(450);
    const after = await getRaw(page);
    await ctx.close();
    return before === after ? true : `바뀜 (${before.length}자 → ${after.length}자)`;
  });

  // ---- 4. 옛 기록 예시로 계산한 값 ----
  await check('4. 옛 기록(2026-10-07 10시 고정): 제목 "2026년 10월", 스트릭 정확히 20·pending, 이번 달 6일 → 한 달 전 "2026년 9월"·14일', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    const errs = [];
    if (!/^2026 ?년 ?10 ?월$/.test(await title(page))) errs.push('제목 ' + (await title(page)));
    if ((await num(page, 'cal-streak')) !== '20') errs.push('스트릭 ' + (await num(page, 'cal-streak')));
    if ((await page.locator(tid('cal-streak')).getAttribute('data-streak-state')) !== 'pending') errs.push('state ' + (await page.locator(tid('cal-streak')).getAttribute('data-streak-state')));
    if ((await num(page, 'cal-month-count')) !== '6') errs.push('10월 일수 ' + (await num(page, 'cal-month-count')));
    await page.locator(tid('cal-prev')).click(); await sleep(450);
    if (!/^2026 ?년 ?9 ?월$/.test(await title(page))) errs.push('9월 제목 ' + (await title(page)));
    if ((await num(page, 'cal-month-count')) !== '14') errs.push('9월 일수 ' + (await num(page, 'cal-month-count')));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 5. 칸 표시: 오늘·강도·mini 만 한 날 ----
  await check('5. 칸: 오늘(10-07)만 data-today, 하루 최고 강도 규칙(mini→mini / mini+more→more / max 포함→max), 기록 없는 날 none', async () => {
    const [a, b] = IDS;
    const seed = withLogs({
      '2026-10-02': { [a]: 'mini' },
      '2026-10-03': { [a]: 'mini', [b]: 'more' },
      '2026-10-04': { [a]: 'more', [b]: 'mini', [IDS[2]]: 'max' },
      '2026-10-05': { [a]: 'mini', [b]: 'mini' },
    });
    const { ctx, page } = await openCal(browser, { seed });
    const errs = [];
    const todays = await page.locator('[data-testid="cal-day"][data-today="true"]').all();
    if (todays.length !== 1) errs.push('오늘 칸 수 ' + todays.length);
    else if ((await todays[0].getAttribute('data-date')) !== '2026-10-07') errs.push('오늘 칸 날짜 ' + (await todays[0].getAttribute('data-date')));
    const want = { '2026-10-02': 'mini', '2026-10-03': 'more', '2026-10-04': 'max', '2026-10-05': 'mini', '2026-10-06': 'none', '2026-10-01': 'none' };
    for (const [d, lv] of Object.entries(want)) {
      const got = await cell(page, d).getAttribute('data-level');
      if (got !== lv) errs.push(`${d}: ${got} (기대 ${lv})`);
    }
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('6. mini 만 한 날도 "한 날"로 확실히 보임: 빈 칸과 배경색 대비 ≥1.5:1, 색은 mini 초록·more 파랑·max 금색으로 서로 다름', async () => {
    const [a, b] = IDS;
    const seed = withLogs({ '2026-10-02': { [a]: 'mini' }, '2026-10-03': { [a]: 'more' }, '2026-10-04': { [b]: 'max' } });
    const { ctx, page } = await openCal(browser, { seed });
    const bg = (d) => cell(page, d).evaluate((e) => getComputedStyle(e).backgroundColor);
    const lum = (rgb) => { const [r, g, bl] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const contrast = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
    const [none, mini, more, max] = [await bg('2026-10-01'), await bg('2026-10-02'), await bg('2026-10-03'), await bg('2026-10-04')];
    await ctx.close();
    const c = contrast(mini, none);
    const errs = [];
    if (c < 1.5) errs.push(`mini↔빈 칸 대비 ${c.toFixed(2)}:1 (<1.5)`);
    if (new Set([mini, more, max, none]).size !== 4) errs.push(`색이 겹침 none=${none} mini=${mini} more=${more} max=${max}`);
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 7. 날짜 눌러 보기 ----
  await check('7. 날짜(10-06) 탭 → 그날 루틴 3개와 고른 강도가 "이름 · 강도"로 (옛 기록에서 계산)', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    await cell(page, '2026-10-06').click(); await sleep(300);
    const items = await page.locator(`${tid('cal-detail')} .cal-item`).allInnerTexts();
    const day = FIX.logs['2026-10-06'];
    const errs = [];
    if (items.length !== Object.keys(day).length) errs.push(`항목 수 ${items.length} (기대 ${Object.keys(day).length})`);
    for (const [id, lv] of Object.entries(day)) {
      if (!items.some((t) => t.includes(NAME[id]) && t.includes(lv))) errs.push(`"${NAME[id]} · ${lv}" 없음 (실제: ${items.join(' / ')})`);
    }
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('8. 기록 없는 날 탭 → cal-empty "기록이 없어요" (오류 없음), 지워진 루틴 → "삭제된 루틴", 이름 <b> 는 글자 그대로', async () => {
    const [a] = IDS;
    const seed = withLogs(
      { '2026-10-02': { r_gone: 'max' }, '2026-10-03': { [a]: 'mini' } },
      [{ ...FIX.routines[0], name: '<b>굵게</b>' }, ...FIX.routines.slice(1)],
    );
    const { ctx, page } = await openCal(browser, { seed });
    const errs = [];
    await cell(page, '2026-10-01').click(); await sleep(300);
    const empty = (await page.locator(tid('cal-empty')).innerText().catch(() => '')).trim();
    if (!/기록이 없어요/.test(empty)) errs.push('빈 날 문구: "' + empty + '"');
    await cell(page, '2026-10-02').click(); await sleep(300);
    const gone = await page.locator(tid('cal-detail')).innerText();
    if (!/삭제된 루틴/.test(gone) || !/max/.test(gone)) errs.push('삭제된 루틴 표시: ' + gone.replace(/\s+/g, ' '));
    if ((await cell(page, '2026-10-02').getAttribute('data-level')) !== 'max') errs.push('삭제된 루틴 날 칸 강도');
    await cell(page, '2026-10-03').click(); await sleep(300);
    const lit = await page.locator(tid('cal-detail')).innerText();
    if (!lit.includes('<b>굵게</b>')) errs.push('이름이 글자 그대로가 아님: ' + lit.replace(/\s+/g, ' '));
    if ((await page.locator(`${tid('cal-detail')} b`).count()) !== 0) errs.push('<b> 가 실제 요소로 만들어짐');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 9. 스트릭 규칙 ----
  await check('9. 스트릭: 오늘 기록 있으면 21·today / 어제까지 mini 만 4일이면 4·pending(mini 도 유지) / 어제 기록 없으면 0·none', async () => {
    const [a] = IDS;
    const errs = [];
    const cases = [
      ['오늘 기록 있음', withLogs({ ...FIX.logs, '2026-10-07': { [a]: 'mini' } }), '21', 'today'],
      ['mini 만 4일', withLogs({ '2026-10-03': { [a]: 'mini' }, '2026-10-04': { [a]: 'mini' }, '2026-10-05': { [a]: 'mini' }, '2026-10-06': { [a]: 'mini' } }), '4', 'pending'],
      ['어제 기록 없음', withLogs({ '2026-10-03': { [a]: 'max' }, '2026-10-04': { [a]: 'max' }, '2026-10-05': { [a]: 'max' } }), '0', 'none'],
    ];
    for (const [label, seed, count, state] of cases) {
      const { ctx, page } = await openCal(browser, { seed });
      const n = await num(page, 'cal-streak');
      const s = await page.locator(tid('cal-streak')).getAttribute('data-streak-state');
      if (n !== count || s !== state) errs.push(`${label}: ${n}/${s} (기대 ${count}/${state})`);
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 10~12. 달 이동 ----
  await check('10. 화살표: 이전·다음 달 제목 변경, 해 넘김(2027년 1월), 기록 없는 달(2026년 7월)은 0일·칸 모두 none, 먼 미래(2029년 1월)도 칸 렌더·오류 없음', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    const errs = [];
    const go = async (id, n) => { for (let i = 0; i < n; i++) { await page.locator(tid(id)).click(); await sleep(330); } };
    await go('cal-next', 3);
    if (!/^2027 ?년 ?1 ?월$/.test(await title(page))) errs.push('해 넘김 제목 ' + (await title(page)));
    await go('cal-prev', 6);
    if (!/^2026 ?년 ?7 ?월$/.test(await title(page))) errs.push('7월 제목 ' + (await title(page)));
    if ((await num(page, 'cal-month-count')) !== '0') errs.push('7월 일수 ' + (await num(page, 'cal-month-count')));
    const nonNone = await page.locator('[data-testid="cal-day"]:not([data-level="none"])').count();
    if (nonNone !== 0) errs.push('빈 달인데 채워진 칸 ' + nonNone);
    await go('cal-next', 30);
    if (!/^2029 ?년 ?1 ?월$/.test(await title(page))) errs.push('먼 미래 제목 ' + (await title(page)));
    const cells = await page.locator(tid('cal-day')).count();
    if (cells < 28 || cells > 31) errs.push('먼 미래 칸 수 ' + cells);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('11. 진짜 터치 밀기: 왼쪽으로 100px → 다음 달, 오른쪽 100px → 이전 달 / 30px(50px 미만)·세로 100px 는 안 바뀜 / 옆으로 스크롤 없음', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw, hasTouch: true, viewport: { width: 390, height: 844 } });
    const grid = page.locator(tid('cal-grid'));
    const errs = [];
    const t0 = await title(page);
    await touchDrag(page, grid, -30, 0);
    if ((await title(page)) !== t0) errs.push('30px 밀기로 달이 바뀜');
    await touchDrag(page, grid, 0, 100);
    if ((await title(page)) !== t0) errs.push('세로 끌기로 달이 바뀜');
    await touchDrag(page, grid, -100, 0);
    const t1 = await title(page);
    if (!/^2026 ?년 ?11 ?월$/.test(t1)) errs.push('왼쪽 밀기 뒤 제목 ' + t1);
    await touchDrag(page, grid, 100, 0);
    if ((await title(page)) !== t0) errs.push('오른쪽 밀기 뒤 제목 ' + (await title(page)));
    if (!(await noHScroll(page))) errs.push('가로 스크롤 생김');
    if ((await page.locator(tid('cal-grid')).evaluate((e) => getComputedStyle(e).touchAction)) !== 'pan-y') errs.push('touch-action 이 pan-y 아님');
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  await check('12. 달 이동 움직임: 일반 → 150~400ms 애니메이션이 실제로 돎, 움직임 줄이기 → 애니메이션 0개이고 제목이 바로 바뀜 / 쓰는 속성은 transform·opacity 만', async () => {
    const errs = [];
    {
      const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
      const info = await page.evaluate(async () => {
        document.querySelector('[data-testid="cal-next"]').click();
        await new Promise((r) => requestAnimationFrame(r));
        const g = document.querySelector('[data-testid="cal-grid"]');
        const anims = document.getAnimations().filter((a) => a.effect && g.contains(a.effect.target) || a.effect?.target === g);
        return anims.map((a) => ({ name: a.animationName || a.transitionProperty, d: a.effect.getTiming().duration }));
      });
      if (!info.some((a) => a.d >= 150 && a.d <= 400)) errs.push('150~400ms 애니메이션 없음: ' + JSON.stringify(info));
      // 쓰는 속성 점검 (+ 대조: 검사 함수가 width 를 잡아내는지)
      if (allowedOnly(['transform', 'width'], ['transform', 'opacity'])) errs.push('대조 실패: width 를 못 잡음');
      const props = await page.evaluate(() => {
        const out = { keyframes: [], transitions: [] };
        for (const sheet of document.styleSheets) {
          if (!(sheet.href || '').includes('calendar.css')) continue;
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.KEYFRAMES_RULE) for (const k of rule.cssRules) for (const p of k.style) out.keyframes.push(p);
            if (rule.style && rule.style.transitionProperty && rule.style.transitionProperty !== 'initial') out.transitions.push(...rule.style.transitionProperty.split(',').map((s) => s.trim()));
          }
        }
        return out;
      });
      if (!props.keyframes.length) errs.push('calendar.css 의 keyframes 를 못 찾음(검사가 비어 있음)');
      if (!allowedOnly(props.keyframes, ['transform', 'opacity'])) errs.push('keyframes 에 다른 속성: ' + [...new Set(props.keyframes)].join(','));
      if (!allowedOnly(props.transitions, ['transform', 'opacity'])) errs.push('transition 에 다른 속성: ' + [...new Set(props.transitions)].join(','));
      await ctx.close();
    }
    {
      const { ctx, page } = await openCal(browser, { seed: fixtureRaw, reduced: true });
      await page.locator(tid('cal-next')).click();
      await sleep(60);
      const t = await title(page);
      const n = await page.evaluate(() => { const g = document.querySelector('[data-testid="cal-grid"]'); return document.getAnimations().filter((a) => a.effect && (g.contains(a.effect.target))).length; });
      if (!/^2026 ?년 ?11 ?월$/.test(t)) errs.push('움직임 줄이기: 60ms 뒤 제목 ' + t);
      if (n !== 0) errs.push('움직임 줄이기인데 애니메이션 ' + n + '개');
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 13. 날짜 칸 누름 ----
  await check('13. 날짜 칸 누름(마우스 누른 채 150ms): scale ≤0.96 (목표 0.92), 떼면 1 로 돌아옴', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    const c = cell(page, '2026-10-06');
    const b = await c.boundingBox();
    const sc = () => c.evaluate((e) => getComputedStyle(e).transform);
    const rest = scaleOf(await sc());
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await sleep(150);
    const pressed = scaleOf(await sc());
    await page.mouse.up(); await sleep(600);
    const back = scaleOf(await sc());
    await ctx.close();
    const errs = [];
    if (Math.abs(rest - 1) > 0.001) errs.push('누르기 전 scale ' + rest);
    if (!(pressed <= 0.96)) errs.push('누른 scale ' + pressed.toFixed(3));
    if (Math.abs(back - 1) > 0.01) errs.push('뗀 뒤 scale ' + back.toFixed(3));
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 14. 화면 크기 ----
  await check('14. 360x640·390x844: 가로 스크롤 없음, 달력이 화면 안, 날짜 칸 너비 ≥40px (360)', async () => {
    const errs = [];
    for (const [w, h] of [[360, 640], [390, 844]]) {
      const { ctx, page } = await openCal(browser, { seed: fixtureRaw, viewport: { width: w, height: h } });
      if (!(await noHScroll(page))) errs.push(`${w}: 가로 스크롤`);
      const g = await page.locator(tid('cal-grid')).boundingBox();
      if (g.x < 0 || g.x + g.width > w + 0.5) errs.push(`${w}: 달력이 화면 밖 (x ${g.x}, 폭 ${g.width})`);
      const widths = await page.locator(tid('cal-day')).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      const minW = Math.min(...widths);
      if (w === 360 && minW < 40) errs.push(`360: 가장 좁은 칸 ${minW.toFixed(1)}px (<40)`);
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 15. 1번·3번 탭 ----
  await check('15. 오늘·루틴 관리 탭은 그대로: 오늘에 카드 3개, 관리에 항목 3개, 캘린더를 다녀와도 같음', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, settle: 300 });
    const errs = [];
    const todayCards = await page.locator(tid('routine-card')).count();
    await page.locator(tid('tab-calendar')).click(); await sleep(450);
    await page.locator(tid('tab-manage')).click(); await sleep(450);
    const manage = await page.locator(tid('manage-item')).count();
    await page.locator(tid('tab-today')).click(); await sleep(450);
    const todayAgain = await page.locator(tid('routine-card')).count();
    if (todayCards !== FIX.routines.length) errs.push('오늘 카드 ' + todayCards);
    if (manage !== FIX.routines.length) errs.push('관리 항목 ' + manage);
    if (todayAgain !== todayCards) errs.push('다녀온 뒤 카드 ' + todayAgain);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 16. 여러 루틴: 개수(기준1) ----
  await check('16. 여러 루틴 표시: 옛 시드 10-06(3개) → data-routines=3·cal-dot 3개(max→more→mini 순)·cal-dot-more 없음; 09-14·2026-07 칸 → 점 0개', async () => {
    const { ctx, page } = await openCal(browser, { seed: fixtureRaw });
    const errs = [];
    // 10-06 확인
    const cell0606 = cell(page, '2026-10-06');
    const routines0606 = await cell0606.getAttribute('data-routines');
    if (routines0606 !== '3') errs.push(`10-06 data-routines=${routines0606} (기대 3)`);
    const dots0606 = await page.locator(`[data-date="2026-10-06"] [data-testid="cal-dot"]`).all();
    if (dots0606.length !== 3) errs.push(`10-06 cal-dot 수=${dots0606.length} (기대 3)`);
    if (dots0606.length === 3) {
      const levels = [];
      for (const d of dots0606) levels.push(await d.getAttribute('data-level'));
      if (levels.join(',') !== 'max,more,mini') errs.push(`10-06 점 순서=${levels.join(',')} (기대 max,more,mini)`);
    }
    const more0606 = await page.locator(`[data-date="2026-10-06"] [data-testid="cal-dot-more"]`).count();
    if (more0606 !== 0) errs.push(`10-06 cal-dot-more 수=${more0606} (기대 0)`);
    // 09-14 확인
    await page.locator(tid('cal-prev')).click(); await sleep(450);
    const dots0914 = await page.locator(`[data-date="2026-09-14"] [data-testid="cal-dot"]`).all();
    if (dots0914.length !== 0) errs.push(`09-14 cal-dot 수=${dots0914.length} (기대 0)`);
    // 2026-07 확인
    await page.locator(tid('cal-prev')).click(); await sleep(350);
    await page.locator(tid('cal-prev')).click(); await sleep(450);
    const dotsJuly = await page.locator('[data-date="2026-07-15"] [data-testid="cal-dot"]').count();
    if (dotsJuly !== 0) errs.push(`2026-07 칸 점 수=${dotsJuly} (기대 0)`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 17. 여러 루틴: 넘침(기준2) ----
  await check('17. 많은 루틴 날: 10개 → 점 2개+"+8", 4개 → 점 2개+"+2" (자리 max 3)', async () => {
    const [a, b, c] = IDS;
    const extra = [];
    for (let i = 0; i < 7; i++) {
      extra.push({ id: `r_extra_${i}`, name: `루틴${i+4}`, mini: '1', more: '2', max: '3', createdAt: '2026-09-17', order: 3 + i });
    }
    const routines = [...FIX.routines, ...extra];
    const routineMap = {};
    for (const r of routines) routineMap[r.id] = r;
    const seed = withLogs({
      '2026-10-05': { [a]: 'max', [b]: 'more', [c]: 'mini', [extra[0].id]: 'max', [extra[1].id]: 'more', [extra[2].id]: 'mini', [extra[3].id]: 'max', [extra[4].id]: 'more', [extra[5].id]: 'mini', [extra[6].id]: 'max' },
      '2026-10-04': { [a]: 'mini', [b]: 'mini', [c]: 'mini', [extra[0].id]: 'mini' },
    }, routines);
    const { ctx, page } = await openCal(browser, { seed });
    const errs = [];
    // 10-05 확인
    const routines0605 = await cell(page, '2026-10-05').getAttribute('data-routines');
    if (routines0605 !== '10') errs.push(`10-05 data-routines=${routines0605} (기대 10)`);
    const dots0605 = await page.locator(`[data-date="2026-10-05"] [data-testid="cal-dot"]`).all();
    if (dots0605.length !== 2) errs.push(`10-05 점 수=${dots0605.length} (기대 2)`);
    const more0605 = await page.locator(`[data-date="2026-10-05"] [data-testid="cal-dot-more"]`).first();
    const moreText0605 = await more0605.innerText().catch(() => '');
    if (moreText0605 !== '+8') errs.push(`10-05 "+N" 텍스트="${moreText0605}" (기대 "+8")`);
    // 10-04 확인 (4개 루틴)
    const routines0604 = await cell(page, '2026-10-04').getAttribute('data-routines');
    if (routines0604 !== '4') errs.push(`10-04 data-routines=${routines0604} (기대 4)`);
    const dots0604 = await page.locator(`[data-date="2026-10-04"] [data-testid="cal-dot"]`).all();
    if (dots0604.length !== 2) errs.push(`10-04 점 수=${dots0604.length} (기대 2)`);
    const more0604 = await page.locator(`[data-date="2026-10-04"] [data-testid="cal-dot-more"]`).first();
    const moreText0604 = await more0604.innerText().catch(() => '');
    if (moreText0604 !== '+2') errs.push(`10-04 "+N" 텍스트="${moreText0604}" (기대 "+2")`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 18. 여러 루틴: 칸 크기 불변(기준3) ----
  await check('18. 칸 크기 불변: 360·390px 에서 10개 루틴 날 getBoundingClientRect 폭·높이 = 빈 이웃 칸(±1px), 점·"+N"이 칸 안, 칸 너비 ≥40px', async () => {
    const [a, b, c] = IDS;
    const extra = [];
    for (let i = 0; i < 7; i++) {
      extra.push({ id: `r_extra_18_${i}`, name: `루틴${i+4}`, mini: '1', more: '2', max: '3', createdAt: '2026-09-17', order: 3 + i });
    }
    const routines = [...FIX.routines, ...extra];
    const seed = withLogs({
      '2026-10-05': { [a]: 'max', [b]: 'more', [c]: 'mini', [extra[0].id]: 'max', [extra[1].id]: 'more', [extra[2].id]: 'mini', [extra[3].id]: 'max', [extra[4].id]: 'more', [extra[5].id]: 'mini', [extra[6].id]: 'max' },
    }, routines);
    const errs = [];
    for (const [w, h] of [[360, 640], [390, 844]]) {
      const { ctx, page } = await openCal(browser, { seed, viewport: { width: w, height: h } });
      // 10-05 (10개)와 인접한 빈 칸 비교
      const cell0605 = cell(page, '2026-10-05');
      const cell0604 = cell(page, '2026-10-04'); // 기록 없는 칸
      const rect0605 = await cell0605.evaluate((e) => e.getBoundingClientRect());
      const rect0604 = await cell0604.evaluate((e) => e.getBoundingClientRect());
      const wDiff = Math.abs(rect0605.width - rect0604.width);
      const hDiff = Math.abs(rect0605.height - rect0604.height);
      if (wDiff > 1) errs.push(`${w}: 10개 날 폭 차이 ${wDiff.toFixed(1)}px (> 1)`);
      if (hDiff > 1) errs.push(`${w}: 10개 날 높이 차이 ${hDiff.toFixed(1)}px (> 1)`);
      // 점이 칸 안에 있는지
      const dots = await page.locator(`[data-date="2026-10-05"] [data-testid="cal-dot"]`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      const more = await page.locator(`[data-date="2026-10-05"] [data-testid="cal-dot-more"]`).evaluate((e) => e ? e.getBoundingClientRect() : null);
      const cellRect = rect0605;
      for (const d of dots) {
        if (d.left < cellRect.left - 1 || d.right > cellRect.right + 1 || d.top < cellRect.top - 1 || d.bottom > cellRect.bottom + 1) {
          errs.push(`${w}: 점이 칸 밖 (dot ${d.left.toFixed(0)},${d.top.toFixed(0)} cell ${cellRect.left.toFixed(0)},${cellRect.top.toFixed(0)}-${cellRect.right.toFixed(0)},${cellRect.bottom.toFixed(0)})`);
          break;
        }
      }
      if (more) {
        if (more.left < cellRect.left - 1 || more.right > cellRect.right + 1 || more.top < cellRect.top - 1 || more.bottom > cellRect.bottom + 1) {
          errs.push(`${w}: "+N"이 칸 밖`);
        }
      }
      // 칸 너비 >= 40px
      if (w === 360 && rect0605.width < 40) errs.push(`360: 10개 날 칸 폭 ${rect0605.width.toFixed(1)}px (< 40)`);
      await ctx.close();
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 19. 여러 루틴: 강도 색 구분(기준4) ----
  await check('19. 점 색: mini·more·max 셋 다르고, 테두리 1px 어두운 색(투명 아님)', async () => {
    const [a, b, c] = IDS;
    const seed = withLogs({ '2026-10-02': { [a]: 'mini' }, '2026-10-03': { [b]: 'more' }, '2026-10-04': { [c]: 'max' } });
    const { ctx, page } = await openCal(browser, { seed });
    const errs = [];
    const dotMini = page.locator(`[data-date="2026-10-02"] [data-testid="cal-dot"]`).first();
    const dotMore = page.locator(`[data-date="2026-10-03"] [data-testid="cal-dot"]`).first();
    const dotMax = page.locator(`[data-date="2026-10-04"] [data-testid="cal-dot"]`).first();
    const bgMini = await dotMini.evaluate((e) => getComputedStyle(e).backgroundColor);
    const bgMore = await dotMore.evaluate((e) => getComputedStyle(e).backgroundColor);
    const bgMax = await dotMax.evaluate((e) => getComputedStyle(e).backgroundColor);
    if (new Set([bgMini, bgMore, bgMax]).size !== 3) errs.push(`점 배경색이 같음: mini=${bgMini} more=${bgMore} max=${bgMax}`);
    const borderMini = await dotMini.evaluate((e) => getComputedStyle(e).borderColor);
    if (borderMini === 'transparent' || borderMini === 'rgba(0, 0, 0, 0)') errs.push(`mini 점 테두리가 투명`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 20. 여러 루틴: 읽기 전용(기준6) ----
  await check('20. 점 클릭과 무관: 캘린더 열기·점이 있는 날 여러 번 탭·다시 저장 탭 → localStorage 문자열 불변', async () => {
    const [a, b, c] = IDS;
    const extra = [{ id: 'r_extra_20', name: '루틴4', mini: '1', more: '2', max: '3', createdAt: '2026-09-17', order: 3 }];
    const routines = [...FIX.routines, ...extra];
    const seed = withLogs({ '2026-10-06': { [a]: 'max', [b]: 'more', [c]: 'mini', [extra[0].id]: 'max' } }, routines);
    const { ctx, page } = await openCal(browser, { seed });
    const before = await getRaw(page);
    // 점이 있는 칸 여러 번 클릭
    for (let i = 0; i < 3; i++) {
      await cell(page, '2026-10-06').click(); await sleep(200);
    }
    const after = await getRaw(page);
    await ctx.close();
    const errs = [];
    if (before !== after) errs.push(`저장값 변함 (${before.length}자 → ${after.length}자)`);
    return errs.length ? errs.join('; ') : true;
  });

  // ---- 21. 여러 루틴: 상세 목록(기준5) ----
  await check('21. 상세 목록: 점이 있는 날 탭 → 목록 줄 수 = data-routines (3개면 3줄, 10개면 10줄)', async () => {
    const [a, b, c] = IDS;
    const extra = [];
    for (let i = 0; i < 7; i++) {
      extra.push({ id: `r_extra_21_${i}`, name: `루틴${i+4}`, mini: '1', more: '2', max: '3', createdAt: '2026-09-17', order: 3 + i });
    }
    const routines = [...FIX.routines, ...extra];
    const seed = withLogs({
      '2026-10-06': { [a]: 'max', [b]: 'more', [c]: 'mini' },
      '2026-10-05': { [a]: 'max', [b]: 'more', [c]: 'mini', [extra[0].id]: 'max', [extra[1].id]: 'more', [extra[2].id]: 'mini', [extra[3].id]: 'max', [extra[4].id]: 'more', [extra[5].id]: 'mini', [extra[6].id]: 'max' },
    }, routines);
    const { ctx, page } = await openCal(browser, { seed });
    const errs = [];
    // 3개 루틴 날
    await cell(page, '2026-10-06').click(); await sleep(300);
    const items06 = await page.locator(`${tid('cal-detail')} .cal-item`).count();
    const routines06 = await cell(page, '2026-10-06').getAttribute('data-routines');
    if (String(items06) !== routines06) errs.push(`10-06: 목록 ${items06}줄 (data-routines ${routines06})`);
    // 10개 루틴 날
    await cell(page, '2026-10-05').click(); await sleep(300);
    const items05 = await page.locator(`${tid('cal-detail')} .cal-item`).count();
    const routines05 = await cell(page, '2026-10-05').getAttribute('data-routines');
    if (String(items05) !== routines05) errs.push(`10-05: 목록 ${items05}줄 (data-routines ${routines05})`);
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });
});
