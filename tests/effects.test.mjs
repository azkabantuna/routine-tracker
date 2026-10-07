// 달성 축포·이모지 입자·토스트 시험 (effects.js·effects.css)
// 실행(레포 루트에서): node projects/routine-tracker/tests/effects.test.mjs   (서버는 run.mjs 가 켜 주거나, 직접: cd projects/routine-tracker && python3 -m http.server 8080)
import assert from 'node:assert';
import { fs, path, HERE, run, check, info, sleep, tid, getStore, open, countNow, pct, R, seedOf, SEED_EMO, SEED_2, SEED_NOEMO } from './_lib.mjs';

// ---------- 효과 표본 (같은 evaluate 안: 클릭 → 첫 표본 → 400ms → 800ms → 사라질 때까지) ----------
function pressA(page, idx, level) {
  return page.evaluate(async ({ idx, level }) => {
    const sleepI = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
    const cards = [...document.querySelectorAll('[data-testid="routine-card"]')];
    const btn = cards[idx].querySelector(`.level-btn[data-level="${level}"]`);
    const br = btn.getBoundingClientRect();
    const bc = { x: br.x + br.width / 2, y: br.y + br.height / 2 };
    const t0 = performance.now();
    btn.click();
    const all = [...document.querySelectorAll('.celebrate')];
    const c = all[all.length - 1];
    const out = { present: !!c, celebrateCount: all.length };
    const toastEl = document.querySelector('[data-testid="toast"]');
    const tr = toastEl.getBoundingClientRect();
    out.toast = { hidden: toastEl.hidden, text: toastEl.textContent, kind: toastEl.getAttribute('data-kind'), h: tr.height, w: tr.width, scrollW: toastEl.scrollWidth, clientW: toastEl.clientWidth, left: tr.left, right: tr.right, z: getComputedStyle(toastEl).zIndex, ws: getComputedStyle(toastEl).whiteSpace };
    if (!c) return out;
    const q = (s) => [...c.querySelectorAll(s)];
    const parts = q('.confetti, .emoji-particle');
    const cs = getComputedStyle(c);
    out.level = c.getAttribute('data-level');
    out.ariaHidden = c.getAttribute('aria-hidden');
    out.dataCount = c.getAttribute('data-count');
    out.dataBurst = c.getAttribute('data-burst');
    out.dataRain = c.getAttribute('data-rain');
    out.confetti = q('.confetti').length;
    out.emojiParticles = q('.emoji-particle').length;
    out.burstN = q('.emoji-burst .emoji-particle').length;
    out.rainN = q('.emoji-rain .emoji-particle').length;
    out.rainBoxes = q('.emoji-rain').length;
    out.burstBoxes = q('.emoji-burst').length;
    out.glow = q('.celebrate-glow').length;
    out.total = parts.length;
    out.texts = [...new Set(q('.emoji-particle').map((p) => p.textContent))];
    out.pointerEvents = cs.pointerEvents;
    out.z = cs.zIndex;
    out.position = cs.position;
    out.fontBurst = [...new Set(q('.emoji-burst .emoji-particle').map((p) => getComputedStyle(p).fontSize))];
    out.fontRain = [...new Set(q('.emoji-rain .emoji-particle').map((p) => getComputedStyle(p).fontSize))];
    out.kinds = [...new Set(q('.emoji-particle').map((p) => p.getAttribute('data-kind')))];
    const glowEl = q('.celebrate-glow')[0];
    out.glowDur = glowEl ? glowEl.getAnimations()[0].effect.getComputedTiming().duration : null;
    // 터짐 입자 시작 중심 - 버튼 중심
    const bursts = q('.emoji-burst .emoji-particle').concat(q('.confetti'));
    out.startOffsetMax = Math.max(0, ...bursts.map((p) => { const r = p.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - bc.x, r.y + r.height / 2 - bc.y); }));
    // 우수수 첫 표본
    const rain = q('.emoji-rain .emoji-particle');
    const r0 = rain.map((p) => { const r = p.getBoundingClientRect(); return { top: r.top, cy: r.top + r.height / 2, left: r.left }; });
    out.vh = window.innerHeight; out.vw = window.innerWidth;
    out.rainCyMax = r0.length ? Math.max(...r0.map((r) => r.cy)) : null;
    out.rainXRange = r0.length ? Math.max(...r0.map((r) => r.left)) - Math.min(...r0.map((r) => r.left)) : 0;
    out.rainDelays = [...new Set(rain.map((p) => Math.round(p.getAnimations()[0].effect.getComputedTiming().delay)))].length;
    // 애니메이션 endTime
    const ends = parts.map((p) => p.getAnimations()[0].effect.getComputedTiming().endTime);
    out.endMax = Math.max(...ends); out.endMin = Math.min(...ends);
    // 400ms
    await sleepI(400 - (performance.now() - t0));
    out.at400Present = c.isConnected;
    out.at400OpacityMax = c.isConnected ? Math.max(...parts.map((p) => parseFloat(getComputedStyle(p).opacity))) : null;
    // 800ms
    await sleepI(800 - (performance.now() - t0));
    out.at800Elapsed = performance.now() - t0;
    out.rainFallMax = rain.length ? Math.max(...rain.map((p, i) => p.getBoundingClientRect().top - r0[i].top)) : null;
    // 사라질 때까지
    while (c.isConnected && performance.now() - t0 < 5000) await sleepI(8);
    out.removedAt = c.isConnected ? null : performance.now() - t0;
    return out;
  }, { idx, level });
}

function pressB(page, idx, level) {
  return page.evaluate(({ idx, level }) => {
    const cards = [...document.querySelectorAll('[data-testid="routine-card"]')];
    const btn = cards[idx].querySelector(`.level-btn[data-level="${level}"]`);
    const br = btn.getBoundingClientRect();
    const bc = { x: br.x + br.width / 2, y: br.y + br.height / 2 };
    btn.click();
    const all = [...document.querySelectorAll('.celebrate')];
    const c = all[all.length - 1];
    if (!c) return { present: false };
    const anims = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.celebrate'));
    anims.forEach((a) => { const t = a.effect.getComputedTiming(); a.pause(); a.currentTime = t.delay + 0.5 * t.duration; });
    const ps = [...c.querySelectorAll('.confetti, .emoji-burst .emoji-particle')];
    const d = ps.map((p) => { const r = p.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - bc.x, r.y + r.height / 2 - bc.y); }).sort((a, b) => a - b);
    const p95 = d[Math.max(0, Math.ceil(0.95 * d.length) - 1)];
    return { present: true, n: d.length, p95, min: d[0], max: d[d.length - 1], paused: anims.length };
  }, { idx, level });
}

const EXPECT = { mini: { confetti: 8, emoji: 3, count: 11, burst: 3, rain: 0 }, more: { confetti: 24, emoji: 8, count: 32, burst: 4, rain: 4 }, max: { confetti: 40, emoji: 16, count: 56, burst: 6, rain: 10 } };
const WIN = { mini: [800, 1000, 1200], more: [1100, 1400, 1600], max: [1600, 2000, 2200] };
const LEVELS = ['mini', 'more', 'max'];

await run(async (browser) => {
  // ================= 4. 효과 개수(마우스 evaluate-click, 한 번에 하나, 3.5초 간격) =================
  const A = {};
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    for (const lv of LEVELS) {
      A[lv] = await pressA(page, 0, lv);
      await sleep(3500);
    }
    await ctx.close();
  }
  for (const lv of LEVELS) {
    const o = A[lv], e = EXPECT[lv];
    await check(`4-${lv} ${lv}: confetti ${e.confetti} · emoji-particle ${e.emoji} · data-count ${e.count}/burst ${e.burst}/rain ${e.rain} 일치 · ≤56 · 글자=🏃 · ${lv === 'max' ? 'glow 1' : 'glow 0'} · level 고정 문자열 · aria-hidden`, async () => {
      const okAttr = o.dataCount === String(o.confetti + o.emojiParticles) && o.dataBurst === String(o.burstN) && o.dataRain === String(o.rainN);
      const ok = o.present && o.confetti === e.confetti && o.emojiParticles === e.emoji && o.burstN === e.burst && o.rainN === e.rain && o.dataCount === String(e.count) && okAttr
        && o.total <= 56 && o.texts.length === 1 && o.texts[0] === '🏃' && o.glow === (lv === 'max' ? 1 : 0) && o.level === lv && o.ariaHidden === 'true';
      return ok || JSON.stringify({ confetti: o.confetti, emoji: o.emojiParticles, burst: o.burstN, rain: o.rainN, dc: o.dataCount, db: o.dataBurst, dr: o.dataRain, texts: o.texts, glow: o.glow, level: o.level, ah: o.ariaHidden });
    });
    info(`${lv} 기록: 글자 burst=${o.fontBurst} rain=${o.fontRain} · glow 길이 ${o.glowDur} · 버튼 중심↔입자 시작 최대 ${o.startOffsetMax?.toFixed(1)}px · pointer-events=${o.pointerEvents} z=${o.z} · 토스트=${JSON.stringify(o.toast)}`);
  }
  await check('4-mini 토스트 "mini 도 한 거다!" data-kind="mini" 클릭 직후 존재', async () => {
    const t = A.mini.toast;
    return (!t.hidden && t.text.includes('mini 도 한 거다') && t.kind === 'mini') || JSON.stringify(t);
  });
  await check('4-글자 mini→more→max 로 갈수록 커짐(22/28/36 기록값과 일치) [기록 + 느슨한 판정]', async () => {
    const f = (lv) => parseFloat(A[lv].fontBurst[0]);
    return (f('mini') < f('more') && f('more') < f('max')) || JSON.stringify([f('mini'), f('more'), f('max')]);
  });
  await check('4-터짐 입자 시작 중심이 누른 버튼 중앙 ±20px (3단계 모두)', async () => {
    const m = LEVELS.map((lv) => A[lv].startOffsetMax);
    return m.every((x) => x <= 20) || m.map((x) => x.toFixed(1)).join('/');
  });

  // ================= 5. 반경 p95 (입자만 정지) =================
  const B = {};
  {
    const { ctx, page } = await open(browser, { seed: SEED_EMO });
    for (const lv of LEVELS) {
      B[lv] = await pressB(page, 0, lv);
      await sleep(3500);
    }
    await ctx.close();
  }
  info(`반경 p95(정지 후, 설계 80/130/190): mini ${B.mini.p95?.toFixed(1)} · more ${B.more.p95?.toFixed(1)} · max ${B.max.p95?.toFixed(1)} (입자 수 ${B.mini.n}/${B.more.n}/${B.max.n}, 정지한 애니메이션 ${B.mini.paused}/${B.more.paused}/${B.max.paused})`);
  await check('5-1 반경 p95: more ≥ 1.3×mini', async () => { const r = B.more.p95 / B.mini.p95; return r >= 1.3 || `비율 ${r.toFixed(3)} (mini ${B.mini.p95}, more ${B.more.p95})`; });
  await check('5-2 반경 p95: max ≥ 1.3×more', async () => { const r = B.max.p95 / B.more.p95; return r >= 1.3 || `비율 ${r.toFixed(3)} (more ${B.more.p95}, max ${B.max.p95})`; });
  info(`반경 비율: more/mini ${(B.more.p95 / B.mini.p95).toFixed(3)} · max/more ${(B.max.p95 / B.more.p95).toFixed(3)} · mini 반경 ≈80 기록 ${B.mini.p95?.toFixed(1)}`);

  // ================= 6. 우수수 =================
  for (const lv of ['more', 'max']) {
    const o = A[lv];
    await check(`6-${lv} 우수수: .emoji-rain ${o.rainN}개 입자 · 첫 표본 중심 y <20% 뷰포트(${o.rainCyMax?.toFixed(1)}/${(o.vh * 0.2).toFixed(0)}) · x 범위 ${o.rainXRange?.toFixed(0)} ≥ ${o.vw / 2} · 800ms 뒤 ≥30% 낙하(${o.rainFallMax?.toFixed(0)} ≥ ${(o.vh * 0.3).toFixed(0)})`, async () => {
      const ok = o.rainBoxes === 1 && o.rainN === EXPECT[lv].rain && o.rainCyMax < o.vh * 0.2 && o.rainXRange >= o.vw / 2 && o.rainFallMax >= o.vh * 0.3 && o.at800Elapsed >= 780 && o.at800Elapsed <= 1000;
      return ok || JSON.stringify({ boxes: o.rainBoxes, n: o.rainN, cy: o.rainCyMax, xr: o.rainXRange, fall: o.rainFallMax, at: o.at800Elapsed });
    });
  }
  await check(`6-max 우수수 시작 지연 서로 다른 값 ≥4가지 (실제 ${A.max.rainDelays}) · more ${A.more.rainDelays}`, async () => A.max.rainDelays >= 4 || String(A.max.rainDelays));
  await check('6-mini 우수수 없음(.emoji-rain 0개, data-rain=0)', async () => (A.mini.rainBoxes === 0 && A.mini.dataRain === '0') || JSON.stringify({ b: A.mini.rainBoxes, d: A.mini.dataRain }));

  // ================= 7. 수명 상한·하한 =================
  for (const lv of LEVELS) {
    const o = A[lv], [lo, hi, life] = WIN[lv];
    await check(`7-${lv} 지속: endTime 최댓값 ${o.endMax} ∈ [${lo},${hi}] · 400ms 에 존재 + 입자 opacity>0.3 (${o.at400OpacityMax}) · 제거 ${o.removedAt?.toFixed(0)}ms ≤ ${life + 300}`, async () => {
      const ok = o.endMax >= lo && o.endMax <= hi && o.at400Present && o.at400OpacityMax > 0.3 && o.removedAt !== null && o.removedAt <= life + 300;
      return ok || JSON.stringify({ endMax: o.endMax, endMin: o.endMin, at400: o.at400Present, op: o.at400OpacityMax, removed: o.removedAt });
    });
    info(`${lv} endTime 최솟값 ${o.endMin}`);
  }

  // ================= 8. 터치 tap vs 마우스(실제 입력) =================
  {
    const { ctx, page } = await open(browser, { seed: SEED_2, hasTouch: true });
    const mouse = {}, touch = {};
    for (const lv of LEVELS) {
      await page.locator(`[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="${lv}"]`).click();
      mouse[lv] = await countNow(page);
      await sleep(3500);
      await page.locator(`[data-testid="routine-card"]:nth-child(2) .level-btn[data-level="${lv}"]`).tap();
      touch[lv] = await countNow(page);
      await sleep(3500);
    }
    await check('8 터치 tap 한 번의 개수 = 마우스 click 개수 = 8/24/40·3/8/16, data-count/burst/rain 도 같음', async () => {
      const bad = LEVELS.filter((lv) => {
        const e = EXPECT[lv];
        const same = (o) => o.present && o.confetti === e.confetti && o.emoji === e.emoji && o.count === String(e.count) && o.burst === String(e.burst) && o.rain === String(e.rain) && o.level === lv;
        return !(same(mouse[lv]) && same(touch[lv]));
      });
      return bad.length === 0 || JSON.stringify({ mouse, touch });
    });
    // 터치 시작 위치
    await ctx.close();
  }

  // ================= 9. 취소·강도 변경·이모지 없는 루틴(✨) =================
  {
    const { ctx, page } = await open(browser, { seed: SEED_NOEMO });
    const first = await pressA(page, 0, 'mini');
    await sleep(3500);
    await check('9-1 이모지 없는 루틴: 모든 .emoji-particle 글자 "✨"', async () => (first.texts.length === 1 && first.texts[0] === '✨') || JSON.stringify(first.texts));
    const cancel = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="routine-card"] .level-btn[data-level="mini"]');
      btn.click();
      const card = btn.closest('[data-testid="routine-card"]');
      return { celebrate: document.querySelectorAll('.celebrate').length, pressed: btn.getAttribute('aria-pressed'), current: card.getAttribute('data-current') };
    });
    await check('9-2 취소(같은 버튼 다시): .celebrate 0개, 카드 완료 해제', async () => (cancel.celebrate === 0 && cancel.pressed === 'false' && !cancel.current) || JSON.stringify(cancel));
    await sleep(3500);
    await pressA(page, 0, 'mini');
    await sleep(3500);
    const change = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="routine-card"] .level-btn[data-level="max"]');
      btn.click();
      const c = [...document.querySelectorAll('.celebrate')].pop();
      return { n: document.querySelectorAll('.celebrate').length, level: c && c.getAttribute('data-level'), conf: c && c.querySelectorAll('.confetti').length };
    });
    await check('9-3 레벨 변경(mini→max): 새 .celebrate data-level=max, confetti 40', async () => (change.n === 1 && change.level === 'max' && change.conf === 40) || JSON.stringify(change));
    await sleep(3500);
    await ctx.close();
  }

  // ================= 10. 연타 상한 ≤80, 3.5초 뒤 0 (일반 + 움직임 줄이기) =================
  for (const reduced of [false, true]) {
    const { ctx, page } = await open(browser, { seed: seedOf([R('r_a', 'a', 0, '🏃'), R('r_b', 'b', 1, '📚'), R('r_c', 'c', 2, '💧'), R('r_d', 'd', 3, '🥗'), R('r_e', 'e', 4, '😴')]), reduced });
    const rapid = await page.evaluate(async () => {
      const sleepI = (ms) => new Promise((r) => setTimeout(r, ms));
      const cards = [...document.querySelectorAll('[data-testid="routine-card"]')];
      let maxTotal = 0, maxCel = 0;
      const sample = () => { maxTotal = Math.max(maxTotal, document.querySelectorAll('.confetti, .emoji-particle').length); maxCel = Math.max(maxCel, document.querySelectorAll('.celebrate').length); };
      const seq = [['more', 0], ['max', 1], ['more', 2], ['max', 3], ['more', 4], ['max', 0], ['more', 1], ['max', 2]];
      for (const [lv, i] of seq) { cards[i].querySelector(`.level-btn[data-level="${lv}"]`).click(); sample(); await sleepI(100); sample(); }
      // 한 번에 여러 개
      for (let k = 0; k < 4; k++) { cards[k].querySelector('.level-btn[data-level="max"]').click(); cards[k].querySelector('.level-btn[data-level="more"]').click(); sample(); }
      return { maxTotal, maxCel };
    });
    await sleep(3500);
    const after = await page.evaluate(() => ({ cel: document.querySelectorAll('.celebrate').length, parts: document.querySelectorAll('.confetti, .emoji-particle').length }));
    await check(`10-${reduced ? 'reduce' : 'normal'} 연타(12번+동시): 입자 합계 최대 ${rapid.maxTotal} ≤ 80${reduced ? ' (=0)' : ''}, 3.5초 뒤 .celebrate 0 · 입자 0`, async () => {
      const ok = rapid.maxTotal <= 80 && (reduced ? rapid.maxTotal === 0 && rapid.maxCel === 0 : rapid.maxTotal > 56) && after.cel === 0 && after.parts === 0;
      return ok || JSON.stringify({ rapid, after });
    });
    if (!reduced) info(`연타 최대 합계 ${rapid.maxTotal}, 동시 .celebrate 최대 ${rapid.maxCel}`);
    await ctx.close();
  }

  // ================= 11. 효과 중에도 아래 버튼이 눌림 · z-index · 토스트(360x640) =================
  {
    const { ctx, page } = await open(browser, { seed: SEED_2, viewport: { width: 360, height: 640 } });
    const o = await pressA(page, 0, 'mini');
    await sleep(3500);
    await check('11-1 z-index: .celebrate 14 < 토스트 15 (position fixed)', async () => (o.z === '14' && o.toast.z === '15' && o.position === 'fixed' && Number(o.z) < Number(o.toast.z)) || JSON.stringify({ z: o.z, tz: o.toast.z, p: o.position }));
    await check(`11-2 360x640 칭찬 토스트: 높이 ${o.toast.h?.toFixed(1)}px ≤ 40 · 한 줄(nowrap) · 글자 안 잘림(scrollW ${o.toast.scrollW} ≤ clientW ${o.toast.clientW}) · 화면 안 · "mini 도 한 거다!" 전체`, async () => {
      const t = o.toast;
      return (t.h <= 40 && t.ws === 'nowrap' && t.scrollW <= t.clientW && t.left >= 0 && t.right <= 360 && t.text.includes('mini 도 한 거다!')) || JSON.stringify(t);
    });
    // 효과 떠 있는 동안 아래 버튼 클릭
    await page.locator('[data-testid="routine-card"]:nth-child(1) .level-btn[data-level="max"]').click();
    const midPress = await page.evaluate(() => ({ cel: document.querySelectorAll('.celebrate').length, pe: getComputedStyle(document.querySelector('.celebrate')).pointerEvents }));
    await page.locator('[data-testid="routine-card"]:nth-child(2) .level-btn[data-level="more"]').click({ timeout: 3000 });
    const cur = await page.evaluate(() => document.querySelectorAll('[data-testid="routine-card"]')[1].getAttribute('data-current'));
    await check('11-3 효과가 떠 있는 동안 .celebrate pointer-events:none, 아래 다른 카드 버튼이 실제 클릭으로 눌림', async () => (midPress.cel >= 1 && midPress.pe === 'none' && cur === 'more') || JSON.stringify({ midPress, cur }));
    await sleep(3500);
    // 360 오른쪽 끝 버튼 max
    await ctx.close();
  }

  // ================= 12. 움직임 줄이기 =================
  {
    const { ctx, page } = await open(browser, { seed: SEED_NOEMO, reduced: true });
    const r = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="routine-card"]');
      card.querySelector('.level-btn[data-level="mini"]').click();
      const t = document.querySelector('[data-testid="toast"]');
      return { particles: document.querySelectorAll('.confetti, .emoji-particle').length, cel: document.querySelectorAll('.celebrate').length, current: card.getAttribute('data-current'), pressed: card.querySelector('.level-btn[data-level="mini"]').getAttribute('aria-pressed'), toast: t.textContent, kind: t.getAttribute('data-kind'), hidden: t.hidden, ret: String(window.RT.effects.celebrate({ level: 'max', x: 10, y: 10, emoji: '🏃' })) };
    });
    await sleep(500);
    const later = await page.evaluate(() => document.querySelectorAll('.confetti, .emoji-particle, .celebrate').length);
    await check('12 움직임 줄이기: 입자 0·.celebrate 0·celebrate()==null, 카드 data-current="mini"·토스트 "mini 도 한 거다!" data-kind="mini" 유지', async () => {
      const ok = r.particles === 0 && r.cel === 0 && later === 0 && r.ret === 'null' && r.current === 'mini' && r.pressed === 'true' && !r.hidden && r.toast.includes('mini 도 한 거다!') && r.kind === 'mini';
      return ok || JSON.stringify({ r, later });
    });
    await ctx.close();
  }

  // ================= 13. 스타일시트 검사 =================
  {
    const { ctx, page } = await open(browser);
    const sheet = await page.evaluate(() => {
      const out = { kf: {}, willChange: [], transitionAll: [], badTransition: [], sheets: 0, unreadable: 0 };
      for (const ss of document.styleSheets) {
        out.sheets++;
        let rules;
        try { rules = [...ss.cssRules]; } catch (e) { out.unreadable++; continue; }
        const walk = (rs) => {
          for (const r of rs) {
            if (r.type === CSSRule.KEYFRAMES_RULE) {
              const props = new Set();
              for (const k of r.cssRules) for (let i = 0; i < k.style.length; i++) props.add(k.style[i]);
              out.kf[r.name] = [...props];
            } else if (r.cssRules) walk([...r.cssRules]);
            if (r.style) {
              const wc = r.style.getPropertyValue('will-change');
              if (wc) out.willChange.push(r.selectorText + ':' + wc);
              const tp = r.style.getPropertyValue('transition-property'), t = r.style.getPropertyValue('transition');
              if (/\ball\b/.test(tp) || /\ball\b/.test(t)) out.transitionAll.push(r.selectorText);
              if (/box-shadow|width|height|top|left/.test(tp) || /box-shadow|width|height|\btop\b|\bleft\b/.test(t)) out.badTransition.push(r.selectorText + ':' + (tp || t));
            }
          }
        };
        walk(rules);
      }
      return out;
    });
    await check('13-1 keyframes confetti-burst / particle-burst / particle-fall / glow-pulse 모두 있고 transform·opacity 만 사용', async () => {
      const names = ['confetti-burst', 'particle-burst', 'particle-fall', 'glow-pulse'];
      const bad = names.filter((n) => !sheet.kf[n] || sheet.kf[n].some((p) => p !== 'transform' && p !== 'opacity'));
      return bad.length === 0 || JSON.stringify(bad.map((n) => [n, sheet.kf[n]]));
    });
    info('모든 keyframes 속성: ' + JSON.stringify(sheet.kf));
    await check('13-2 스타일시트에 will-change 없음 · transition:all 없음 · transition 에 box-shadow/width/height/top/left 없음', async () => (sheet.willChange.length === 0 && sheet.transitionAll.length === 0 && sheet.badTransition.length === 0 && sheet.unreadable === 0) || JSON.stringify(sheet));
    const src = ['js/date.js', 'js/emoji.js', 'js/store.js', 'js/routines.js', 'js/streak.js', 'js/effects.js', 'js/character.js', 'js/screens.js', 'js/sheets.js', 'js/app.js'].map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8')).join('\n');
    await check('13-3 JS 소스에 willChange/will-change 없음', async () => !/will-?change/i.test(src) || 'will-change 문자열 발견');
    await ctx.close();
  }

  // ================= 15. CPU 4배 감속 표본 (기록만) =================
  {
    const base = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await p.goto('about:blank');
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const v = await p.evaluate(() => new Promise((res) => { const g = []; let last = performance.now(); const t0 = last; const f = (n) => { g.push(n - last); last = n; if (n - t0 < 1500) requestAnimationFrame(f); else res(g.slice(1)); }; requestAnimationFrame(f); }));
      await ctx.close();
      return v;
    })();
    info(`빈 페이지 기준선(CPU 4배): 중앙값 ${pct(base, 0.5).toFixed(1)}ms · p95 ${pct(base, 0.95).toFixed(1)}ms (n=${base.length})`);
    for (const lv of ['mini', 'max']) {
      const { ctx, page } = await open(browser, { seed: SEED_EMO });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await sleep(300);
      const res = await page.evaluate(async (level) => {
        const sleepI = (ms) => new Promise((r) => setTimeout(r, ms));
        const long = [];
        try { new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
        const gaps = []; let last = performance.now(); let run = true;
        const f = (n) => { gaps.push(n - last); last = n; if (run) requestAnimationFrame(f); };
        requestAnimationFrame(f);
        await sleepI(200);
        const btn = document.querySelector(`[data-testid="routine-card"] .level-btn[data-level="${level}"]`);
        const t0 = performance.now();
        btn.click();
        const c = document.querySelector('.celebrate');
        const parts = c ? [...c.querySelectorAll('.confetti, .emoji-particle')] : [];
        await sleepI(500 - (performance.now() - t0));
        const cts = parts.map((p) => p.getAnimations()[0] && p.getAnimations()[0].currentTime).filter((x) => x != null);
        const elapsed500 = performance.now() - t0;
        await sleepI(2800);
        run = false;
        return { gaps: gaps.slice(1), long, ctAvg: cts.length ? cts.reduce((a, b) => a + b, 0) / cts.length : null, elapsed500 };
      }, lv);
      const g = res.gaps;
      info(`CPU 4배 ${lv} 축포 중 ~3.5초: rAF 중앙값 ${pct(g, 0.5).toFixed(1)}ms · p95 ${pct(g, 0.95).toFixed(1)}ms · 최대 ${Math.max(...g).toFixed(1)}ms (n=${g.length}) · longtask ${res.long.length}개(최대 ${res.long.length ? Math.max(...res.long).toFixed(0) : 0}ms) · 500ms 시점 입자 currentTime 평균 ${res.ctAvg?.toFixed(0)} (경과 ${res.elapsed500.toFixed(0)}) · 부하 기준(≤22/≤50/≤150) ${pct(g, 0.5) <= 22 && pct(g, 0.95) <= 50 && Math.max(...g) <= 150 ? '충족' : '미충족'}`);
      await ctx.close();
    }
  }
});
