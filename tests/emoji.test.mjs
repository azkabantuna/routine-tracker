// 이모지 입력·검증·표시 시험 (emoji.js·sheets.js)
// 실행(레포 루트에서): node projects/routine-tracker/tests/emoji.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { run, check, info, sleep, tid, getStore, open, openAddSheet, submitSheet, SEED_EMO } from './_lib.mjs';

const ACCEPT = ['🏃', '👨‍👩‍👧', '🇰🇷', '❤️', '✍️', '👍🏽'];
const REJECT = ['ab', '🏃🏃', 'a', '🏃a', '1', '#'];

await run(async (browser) => {
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(500);
    await check('0-3 전역 RT.emoji.isSingleEmoji · RT.effects.celebrate · html[data-emoji-engine=segmenter]', async () => {
      const o = await page.evaluate(() => ({ a: typeof window.RT.emoji.isSingleEmoji, b: typeof window.RT.effects.celebrate, e: document.documentElement.getAttribute('data-emoji-engine'), seg: typeof Intl.Segmenter }));
      return (o.a === 'function' && o.b === 'function' && o.e === 'segmenter') || JSON.stringify(o);
    });
    await ctx.close();
  }

  {
    const { ctx, page } = await open(browser);
    await openAddSheet(page);
    await check('1-1 시트에 input-emoji·error-emoji(기본 숨김)·emoji-pick 버튼 8개', async () => {
      const o = await page.evaluate(() => ({ input: !!document.querySelector('[data-testid="input-emoji"]'), errHidden: document.querySelector('[data-testid="error-emoji"]').hidden, picks: document.querySelectorAll('[data-testid="emoji-pick"] button[data-emoji]').length, pickType: [...document.querySelectorAll('[data-testid="emoji-pick"] button')].every((b) => b.type === 'button') }));
      return (o.input && o.errHidden && o.picks === 8 && o.pickType) || JSON.stringify(o);
    });
    await check('1-2 추천 버튼 💧 누르면 입력칸에 채워지고 시트 유지(제출 안 됨)', async () => {
      await page.locator('[data-testid="emoji-pick"] button[data-emoji="💧"]').click();
      const v = await page.locator(tid('input-emoji')).inputValue();
      const sheet = await page.locator(tid('sheet')).isVisible();
      const n = (await getStore(page))?.routines?.length ?? 0;
      return (v === '💧' && sheet && n === 0) || `v=${v} sheet=${sheet} n=${n}`;
    });
    const r = await submitSheet(page, '달리기', '🏃');
    await check('1-3 "🏃" 저장: 시트 닫힘·localStorage routines[0].emoji=="🏃"·version 1', async () => {
      const s = await getStore(page);
      return (!r.sheet && !r.err && s.routines[0].emoji === '🏃' && s.version === 1) || JSON.stringify({ r, s });
    });
    const addNoEmoji = await submitSheet(await (async () => { await page.locator(tid('btn-add-routine')).click(); await page.locator(tid('sheet')).waitFor({ state: 'visible' }); return page; })(), '이모지없음', '');
    await check('1-4 빈 이모지 칸은 이모지 없이 저장됨(키 없음)', async () => {
      const s = await getStore(page);
      const rr = s.routines.find((x) => x.name === '이모지없음');
      return (!addNoEmoji.err && rr && !('emoji' in rr)) || JSON.stringify({ addNoEmoji, rr });
    });
    await page.locator(tid('tab-today')).click();
    await sleep(400);
    await check('1-5 오늘 카드 routine-emoji=="🏃", .card-name 왼쪽·같은 줄(boundingBox)', async () => {
      const o = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="routine-card"]');
        const e = card.querySelector('[data-testid="routine-emoji"]'), n = card.querySelector('.card-name');
        const a = e.getBoundingClientRect(), b = n.getBoundingClientRect();
        return { text: e.textContent, hidden: e.hidden, ex: a.x, ew: a.width, ey: a.y, eh: a.height, nx: b.x, ny: b.y, nh: b.height };
      });
      const overlapY = Math.min(o.ey + o.eh, o.ny + o.nh) - Math.max(o.ey, o.ny) > 0;
      return (o.text === '🏃' && !o.hidden && overlapY && o.ex + o.ew <= o.nx + 0.5) || JSON.stringify(o);
    });
    await check('1-6 이모지 없는 루틴 카드의 routine-emoji 는 보이지 않음(hidden/폭 0)', async () => {
      const o = await page.evaluate(() => {
        const card = [...document.querySelectorAll('[data-testid="routine-card"]')].find((c) => c.querySelector('.card-name').textContent === '이모지없음');
        const e = card.querySelector('[data-testid="routine-emoji"]');
        const r = e.getBoundingClientRect();
        return { hidden: e.hidden, text: e.textContent, w: r.width, disp: getComputedStyle(e).display };
      });
      return ((o.hidden || o.disp === 'none' || o.w === 0) && o.text === '') || JSON.stringify(o);
    });
    await page.locator(tid('tab-manage')).click();
    await sleep(400);
    await check('1-7 관리 목록 manage-emoji=="🏃" 이고 manage-name 왼쪽·같은 줄', async () => {
      const o = await page.evaluate(() => {
        const it = document.querySelector('[data-testid="manage-item"]');
        const e = it.querySelector('[data-testid="manage-emoji"]');
        const n = it.querySelector('[data-testid="manage-name"]') || it.querySelector('.manage-name');
        const a = e.getBoundingClientRect(), b = n.getBoundingClientRect();
        return { text: e.textContent, ex: a.x, ew: a.width, ey: a.y, eh: a.height, nx: b.x, ny: b.y, nh: b.height };
      });
      const overlapY = Math.min(o.ey + o.eh, o.ny + o.nh) - Math.max(o.ey, o.ny) > 0;
      return (o.text === '🏃' && overlapY && o.ex + o.ew <= o.nx + 0.5) || JSON.stringify(o);
    });
    await page.reload();
    await sleep(400);
    await check('1-8 새로고침 뒤에도 emoji 유지(localStorage·오늘 카드), version===1', async () => {
      await page.locator(tid('tab-today')).click();
      await sleep(400);
      const s = await getStore(page);
      const t = await page.locator(tid('routine-emoji')).first().textContent();
      return (s.version === 1 && s.routines[0].emoji === '🏃' && t === '🏃') || JSON.stringify({ v: s.version, e: s.routines[0].emoji, t });
    });
    // 수정에서 이모지 지우기 / 바꾸기
    await check('1-9 수정 시트에서 기존 이모지가 채워지고, 지우면 키 삭제·바꾸면 반영', async () => {
      await page.locator(tid('tab-manage')).click();
      await page.locator(tid('btn-edit')).first().click();
      await page.locator(tid('sheet')).waitFor({ state: 'visible' });
      const pre = await page.locator(tid('input-emoji')).inputValue();
      await page.locator(tid('input-emoji')).fill('');
      await page.locator(tid('btn-save')).click();
      await sleep(150);
      const s1 = await getStore(page);
      const gone = !('emoji' in s1.routines[0]);
      await page.locator(tid('btn-edit')).first().click();
      await page.locator(tid('sheet')).waitFor({ state: 'visible' });
      await page.locator(tid('input-emoji')).fill('📚');
      await page.locator(tid('btn-save')).click();
      await sleep(150);
      const s2 = await getStore(page);
      return (pre === '🏃' && gone && s2.routines[0].emoji === '📚' && s2.version === 1) || JSON.stringify({ pre, gone, e: s2.routines[0].emoji });
    });
    await ctx.close();
  }

  // ================= 2. 이모지 검증: Segmenter 길 + 폴백 길 =================
  for (const noSeg of [false, true]) {
    const label = noSeg ? '폴백(regex)' : 'Segmenter';
    const { ctx, page } = await open(browser, { noSegmenter: noSeg });
    await check(`2-${noSeg ? 'B' : 'A'}0 ${label} 길: data-emoji-engine=${noSeg ? 'regex' : 'segmenter'}${noSeg ? ' (Intl.Segmenter 삭제 확인)' : ''}`, async () => {
      const o = await page.evaluate(() => ({ e: document.documentElement.getAttribute('data-emoji-engine'), seg: typeof Intl.Segmenter }));
      return (o.e === (noSeg ? 'regex' : 'segmenter') && (noSeg ? o.seg === 'undefined' : o.seg === 'function')) || JSON.stringify(o);
    });
    await check(`2-${noSeg ? 'B' : 'A'}1 ${label} 길: 함수 직접 호출 허용 6·거부 9`, async () => {
      const o = await page.evaluate(({ A, Rj }) => ({
        acc: A.map((s) => window.RT.emoji.isSingleEmoji(s)),
        rej: Rj.concat(['', '12', '1️⃣', '*', ' ']).map((s) => window.RT.emoji.isSingleEmoji(s)),
      }), { A: ACCEPT, Rj: REJECT });
      return (o.acc.every((x) => x === true) && o.rej.every((x) => x === false)) || JSON.stringify(o);
    });
    info(`${label} 길 가장자리(허용 가장자리, 판정 아님): ` + JSON.stringify(await page.evaluate(() => Object.fromEntries(['©', '™', '☺', '❤', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🧑‍💻'].map((s) => [s, window.RT.emoji.isSingleEmoji(s)])))));
    await openAddSheet(page);
    await check(`2-${noSeg ? 'B' : 'A'}2 ${label} 길 UI: 거부 6개는 error-emoji 보임·시트 유지·저장 안 됨`, async () => {
      const bad = [];
      for (const s of REJECT) {
        const r = await submitSheet(page, 'x' + s.length, s);
        const n = (await getStore(page))?.routines?.length ?? 0;
        if (!(r.err && r.sheet && n === 0)) bad.push(`${s}:${JSON.stringify(r)}n=${n}`);
        // 입력하면 오류 숨김
        await page.locator(tid('input-emoji')).fill('');
      }
      return bad.length === 0 || bad.join(' ; ');
    });
    await check(`2-${noSeg ? 'B' : 'A'}3 ${label} 길 UI: 허용 6개 저장됨(시트 닫힘, 문자 그대로 저장)`, async () => {
      const bad = [];
      for (let i = 0; i < ACCEPT.length; i++) {
        if (!(await page.locator(tid('sheet')).isVisible())) { await page.locator(tid('btn-add-routine')).click(); await page.locator(tid('sheet')).waitFor({ state: 'visible' }); }
        const r = await submitSheet(page, 'ok' + i, ACCEPT[i]);
        const s = await getStore(page);
        const rr = s.routines.find((x) => x.name === 'ok' + i);
        if (!(!r.err && !r.sheet && rr && rr.emoji === ACCEPT[i] && s.version === 1)) bad.push(`${ACCEPT[i]}:${JSON.stringify(r)} saved=${rr && rr.emoji}`);
      }
      return bad.length === 0 || bad.join(' ; ');
    });
    await check(`2-${noSeg ? 'B' : 'A'}4 ${label} 길: 이모지 앞뒤 공백은 trim 되어 저장`, async () => {
      await page.locator(tid('btn-add-routine')).click();
      await page.locator(tid('sheet')).waitFor({ state: 'visible' });
      const r = await submitSheet(page, 'trim', '  🏃  ');
      const rr = (await getStore(page)).routines.find((x) => x.name === 'trim');
      return (!r.err && rr && rr.emoji === '🏃') || JSON.stringify({ r, rr });
    });
    await ctx.close();
  }
});
