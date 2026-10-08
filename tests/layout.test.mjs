// 가로 스크롤·시트 닿음·토스트 크기·아래 여백·스크립트 순서 시험 (css/*.css·index.html)
// 실행(레포 루트에서): node projects/routine-tracker/tests/layout.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import { consoleErrors, run, check, note, sleep, tid, open, addRoutine, noHScroll, openAddSheet, openManagePanel, seedN, SEED_EMO, SEED_2 } from './_lib.mjs';

  const geom = (page, screenSel, isManage = false) => page.evaluate(({ sel, isManage }) => {
    const iw = window.innerWidth; const tabbarTop = document.querySelector('.tabbar').getBoundingClientRect().top;
    const out = { sw: 0, clip: [], overlap: [], tabbarTop };

    if (isManage) {
      // 관리 탭: 패널 안만 검사
      const panel = document.querySelector('[data-testid="manage-panel"]');
      if (!panel) return out;
      out.sw = panel.scrollWidth - panel.clientWidth;

      // 패널 내용 잘림 검사 (숨김 제목 제외)
      panel.querySelectorAll('*').forEach((el) => {
        if (getComputedStyle(el).display === 'none') return;
        const classList = el.className;
        if (classList && classList.includes('manage-title-hidden')) return; // 숨김 제목 제외

        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const panelRect = panel.getBoundingClientRect();
        if (r.left < panelRect.left - 0.5 || r.right > panelRect.right + 0.5)
          out.clip.push((className || el.tagName) + ' ' + Math.round(r.left) + '~' + Math.round(r.right));
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
          out.clip.push('내용 잘림 ' + (el.className || el.tagName));
      });

      // 겹침 검사
      const boxes = (q) => [...panel.querySelectorAll(q)].map((e) => e.getBoundingClientRect());
      const inter = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const q of ['.level-btn', '[data-testid="manage-item"]']) {
        const b = boxes(q);
        for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (inter(b[i], b[j])) out.overlap.push(q + ' ' + i + '/' + j);
      }

      // 마지막 manage-item과 탭바의 gap 계산
      const items = panel.querySelectorAll('[data-testid="manage-item"]');
      // 실제 스크롤 칸은 패널 본문(.manage-panel-body). 끝까지 내린 뒤 잰다
      const body = panel.querySelector('.manage-panel-body') || panel;
      body.scrollTop = body.scrollHeight;
      out.items = items.length;
      out.gap = items.length ? tabbarTop - items[items.length - 1].getBoundingClientRect().bottom : null;
    } else {
      // 오늘 탭: 기존 로직
      out.sw = document.documentElement.scrollWidth - iw;
      const root = document.querySelector(sel);
      root.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.left < -0.5 || r.right > iw + 0.5) out.clip.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '~' + Math.round(r.right));
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.clip.push('내용 잘림 ' + (el.className || el.tagName));
      });
      const boxes = (q) => [...root.querySelectorAll(q)].map((e) => e.getBoundingClientRect());
      const inter = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const q of ['#card-list > [data-routine-id]', '.level-btn', '[data-testid="manage-item"]']) {
        const b = boxes(q);
        for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (inter(b[i], b[j])) out.overlap.push(q + ' ' + i + '/' + j);
      }
      const items = root.querySelectorAll('#card-list > [data-routine-id]');
      window.scrollTo(0, document.documentElement.scrollHeight);
      out.items = items.length;
      out.gap = items.length ? tabbarTop - items[items.length - 1].getBoundingClientRect().bottom : null;
    }
    return out;
  }, { sel: screenSel, isManage });

await run(async (browser) => {
  // ---------- (옛 v2-m2) 0-1·0-2 첫 로드 콘솔 오류 0 · 스크립트 순서 ----------
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    await sleep(500);
    await check('0-1 첫 로드 콘솔 오류 0 (스크립트 순서)', async () => consoleErrors.length === 0 || consoleErrors.join(' | '));
    await check('0-2 스크립트 순서 date→emoji→store→streak→effects→character3d→futureword→character→app, css/effects.css 링크', async () => {
      const o = await page.evaluate(() => ({ js: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')), css: [...document.querySelectorAll('link[rel=stylesheet]')].map((s) => s.getAttribute('href')) }));
      const want = ['js/date.js', 'js/emoji.js', 'js/store.js', 'js/routines.js', 'js/streak.js', 'js/effects.js', 'vendor/character3d.js', 'js/futureword.js', 'js/character.js', 'js/screens.js', 'js/sheets.js', 'js/calendar.js', 'js/timer.js', 'js/app.js'];
      if (JSON.stringify(o.js) !== JSON.stringify(want)) return '순서: ' + o.js.join(',');
      return o.css.includes('css/effects.css') || 'effects.css 링크 없음';
    });
    await ctx.close();
  }

  // ---------- (옛 m1) 긴 이름 넘침 ----------
  {
    const { ctx, page } = await open(browser);
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
    await page.click(tid('tab-today'));
    return errs.length ? errs.join('; ') : true;
  });
    await ctx.close();
  }

  // ---------- (옛 v2-m1-r2) T3 탭 전환 중 가로 스크롤 / R360 ----------
  await check('T3 전환 중 매 rAF documentElement.scrollWidth ≤ innerWidth (390x844·360x640 × 순서 today→log→manage·manage→today·log→today)', async () => {
    const errs = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      for (const [start, steps] of [['today', ['calendar', 'manage']], ['manage', ['today']], ['calendar', ['today']]]) {
        const { ctx, page } = await open(browser, { seed: seedN(6), viewport, settle: 300 });
        if (start !== 'today') { await page.click(tid('tab-' + start)); await sleep(500); }
        const r = await page.evaluate((steps) => new Promise((res) => {
          let maxOver = -999, frames = 0, stop = false, worstW = 0;
          (function step() {
            const over = document.documentElement.scrollWidth - window.innerWidth;
            if (over > maxOver) maxOver = over;
            worstW = Math.max(worstW, document.body.scrollWidth - window.innerWidth);
            frames++;
            if (!stop) requestAnimationFrame(step);
          })();
          steps.forEach((n, i) => setTimeout(() => document.querySelector(`[data-testid="tab-${n}"]`).click(), 50 + i * 500));
          setTimeout(() => { stop = true; res({ maxOver, frames, worstW }); }, 50 + steps.length * 500 + 300);
        }), steps);
        note(`${viewport.width}x${viewport.height} ${start}→${steps.join('→')}: scrollWidth−innerWidth 최대=${r.maxOver}, 프레임 ${r.frames}`);
        if (r.maxOver > 0) errs.push(`${viewport.width} ${start}→${steps}: 넘침 ${r.maxOver}px`);
        await ctx.close();
      }
    }
    return errs.length ? errs.join('; ') : true;
  });

  await check('R360 회귀 360x640·390x844(오늘·관리, 카드 5·6개): 가로 스크롤·잘림·겹침 없음, 마지막 카드~탭바 ≥16px, 토스트와 .screen-title 비겹침', async () => {
    const errs = [];
    for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
      for (const n of [5, 6]) {
        const { ctx, page } = await open(browser, { seed: seedN(n), viewport, settle: 300 });
        for (const [tab, sel] of [['today', '#screen-today'], ['manage', '#screen-manage']]) {
          if (tab !== 'today') {
            await page.click(tid('tab-' + tab));
            await sleep(500);
            await openManagePanel(page);
            await sleep(450); // 패널이 올라오는 전환(약 300ms)이 끝난 뒤
          }
          const g = await geom(page, sel, tab === 'manage');
          const tag = `${viewport.width}x${viewport.height} ${tab} ${n}개`;
          note(`${tag}: scrollWidth−innerWidth=${g.sw}, 마지막~탭바 ${g.gap == null ? '-' : g.gap.toFixed(1)}px, 잘림 ${g.clip.length}, 겹침 ${g.overlap.length}`);
          if (g.sw > 0) errs.push(tag + ' 가로 스크롤 ' + g.sw);
          if (g.clip.length) errs.push(tag + ' 잘림 ' + g.clip.slice(0, 3));
          if (g.overlap.length) errs.push(tag + ' 겹침 ' + g.overlap.slice(0, 3));
          if (!(g.gap >= 16)) errs.push(tag + ' 마지막 카드~탭바 ' + g.gap);
        }
        if (n === 6) {
          await page.click(tid('tab-today')); await sleep(500);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.click('[data-routine-id="r_0"] [data-level="mini"]');
          await sleep(100);
          const t = await page.evaluate(() => {
            const toast = document.querySelector('[data-testid="toast"]'); const tr = toast.getBoundingClientRect();
            const ti = document.querySelector('#screen-today .screen-title').getBoundingClientRect(); const tb = document.querySelector('.tabbar').getBoundingClientRect();
            return { hidden: toast.hidden, text: toast.textContent, toast: [tr.top, tr.bottom], title: [ti.top, ti.bottom], tabbarTop: tb.top, z: getComputedStyle(toast).zIndex };
          });
          const tag = `${viewport.width}x${viewport.height} 토스트`;
          note(`${tag}: ${JSON.stringify(t)}`);
          if (t.hidden) errs.push(tag + ' 안 뜸');
          else if (t.toast[0] < t.title[1] && t.toast[1] > t.title[0]) errs.push(tag + ' 제목과 겹침');
          else if (t.toast[1] > t.tabbarTop + 0.5) errs.push(tag + ' 탭바와 겹침');
        }
        await ctx.close();
      }
    }
    return errs.length ? errs.join('; ') : true;
  });

  // ---------- (옛 v2-m2) 3 시트 닿음 / 11-4 효과 중 가로 스크롤 ----------
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    const { ctx, page } = await open(browser, { viewport: vp, seed: SEED_EMO });
    await openAddSheet(page);
    await check(`3 ${vp.width}x${vp.height} 시트: btn-save 에 닿음(trial click)·scrollWidth<=innerWidth·이름/이모지 입력칸 같은 줄·폭 안`, async () => {
      await page.locator(tid('btn-save')).click({ trial: true });
      const o = await page.evaluate(() => {
        const a = document.querySelector('[data-testid="input-name"]').getBoundingClientRect();
        const b = document.querySelector('[data-testid="input-emoji"]').getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, ay: a.y, ah: a.height, by: b.y, bh: b.height, bRight: b.right, aRight: a.right };
      });
      const sameRow = Math.min(o.ay + o.ah, o.by + o.bh) - Math.max(o.ay, o.by) > 0;
      return (o.sw <= o.iw && sameRow && o.bRight <= o.iw) || JSON.stringify(o);
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { seed: SEED_2, viewport: { width: 360, height: 640 } });
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="max"]').click();
    const sws = [];
    for (const t of [30, 300, 700, 1300, 2000]) { await sleep(t - (sws.length ? [30, 300, 700, 1300, 2000][sws.length - 1] : 0)); sws.push(await page.evaluate(() => document.documentElement.scrollWidth)); }
    await check(`11-4 360x640 에서 max(오른쪽 끝 버튼) 효과 중 scrollWidth ≤ innerWidth(360): ${sws.join('/')}`, async () => sws.every((x) => x <= 360) || sws.join('/'));
    await sleep(3000);
    await ctx.close();
  }
});
