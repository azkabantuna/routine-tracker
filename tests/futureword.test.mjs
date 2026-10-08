// 퓨처 셀프 ② 시험: 터널 회전·별, 구름 위아래 움직임, 라벨 위치·겹침, 입력·저장(마우스·진짜 터치·IME), 2D 폴백, reduced-motion
// 실행(레포 루트에서): node projects/routine-tracker/tests/futureword.test.mjs   (보통은 run.mjs 가 대신 켠 서버에서 돈다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, run, check, sleep, tid, getRaw, open, fixtureRaw } from './_lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FW = '[data-testid="future-word"]';
const FWI = '[data-testid="future-word-input"]';
const CARD = '[data-testid="char-card"]';
const CANVAS = '[data-testid="char-canvas"]';
const FWKEY = 'routineFutureWord';
// M10(HEAD 9dbbb39, 기록 시점 측정) stage4 드로우콜 27. 이 값은 옛 기록에서 옮긴 기준(시험 안에서 git 을 읽지 않음).
const M10_DRAWS_STAGE4 = 27;
const TWO_PI = Math.PI * 2;

const logs4 = {};
for (let d = 1; d <= 31; d++) logs4[`2026-09-${String(d).padStart(2, '0')}`] = { r: 'max' };
logs4['2026-10-01'] = { r: 'more' };
const seed4 = JSON.stringify({ version: 1, routines: [], logs: logs4 });

const waitMounted = (page) => page.waitForFunction(() => !!(window.RT3D && window.RT3D.getState && window.RT3D.getState()), null, { timeout: 4000 });
const placed = (page) => page.waitForSelector('.fw-layer[data-placed="1"]', { timeout: 4000 });
const labelOf = (page) => page.locator(FW).textContent();
const storedOf = (page) => page.evaluate((k) => localStorage.getItem(k), FWKEY);
const keysOf = (page) => page.evaluate(() => Object.keys(localStorage));
const attrOf = (page, sel, name) => page.locator(sel).getAttribute(name);
const cpLen = (s) => Array.from(s).length;
// 입력칸은 열 때 저장된 단어가 채워져 있다. 새로 칠 때는 먼저 비운다(fill 로 지우고 insertText).
const typeNew = async (page, text) => { await page.locator(FWI).fill(''); await page.keyboard.insertText(text); };

// 판정 도우미(순수 함수): 시험 안에서 "틀린 값이면 실패"를 확인하는 대조에도 쓴다
const angDiff = (a, b) => { let d = (b - a) % TWO_PI; if (d > Math.PI) d -= TWO_PI; if (d < -Math.PI) d += TWO_PI; return d; };
const judgeSpin = (rate) => (rate >= 0.35 && rate <= 0.45) ? true : `터널 회전 ${rate.toFixed(3)}rad/s (0.35~0.45 기대)`;
const judgeCloud = (S) => {
  const e = [];
  const dys = S.map((s) => s.dy);
  if (dys.some((v) => typeof v !== 'number' || !isFinite(v))) e.push('dy 값 이상');
  else {
    const mx = Math.max(...dys), mn = Math.min(...dys);
    // 진폭은 2바퀴에서 ±0.08 → ±0.1 로 바꿈(360px 화면에서 둥둥이 너무 작아서, 진행자 지시)
    if (mx - mn < 0.18 || mx - mn > 0.21) e.push(`dy 범위 ${(mx - mn).toFixed(3)} (0.18~0.21 기대)`);
    if (mx > 0.105 || mn < -0.105) e.push(`dy ${mn.toFixed(3)}~${mx.toFixed(3)} (±0.1 밖)`);
  }
  const badRot = S.filter((s) => !(Array.isArray(s.rot) && s.rot.length === 3 && s.rot.every((v) => v === 0)));
  if (badRot.length) e.push(`cloud.rot ≠ [0,0,0] ${badRot.length}회 (예: ${JSON.stringify(badRot[0].rot)})`);
  if (S.some((s) => s.visible !== true)) e.push('cloud.visible 이 false 인 순간 있음');
  return e.length ? e.join('; ') : true;
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const judgeLabel = (S, hud, vp) => {
  const e = [];
  if (!S.length) return '샘플 없음';
  // 새 규칙: 라벨은 구름 위에 뜬다. 가로 중심은 구름 x ±20px (이유: 라벨이 구름 위 띠에 얹히므로 세로 ±6 은 맞지 않음)
  const worstX = Math.max(...S.map((s) => Math.abs(s.x + s.w / 2 - s.cloudX)));
  if (worstX > 20) e.push(`버튼 가로 중심과 구름 x 차 최대 ${worstX.toFixed(1)}px (±20)`);
  // 간격 = 구름 윗가장자리(cloudY−hh) − 라벨 아래쪽. −2 미만이면 라벨이 구름 안으로 들어감, 20 초과면 구름에서 떨어져 뜸 (이유: 새 배치 규칙)
  const gaps = S.map((s) => s.cloudTop - (s.y + s.h));
  if (gaps.some((g) => !isFinite(g))) e.push('구름 반높이 hh 값 없음(getState().cloud.hh)');
  else {
    if (Math.min(...gaps) < -2) e.push(`라벨 아래쪽이 구름 윗가장자리보다 ${(-Math.min(...gaps)).toFixed(1)}px 아래 (+2 이하 기대)`);
    if (Math.max(...gaps) > 20) e.push(`라벨과 구름 윗가장자리 간격 ${Math.max(...gaps).toFixed(1)}px (≤20 기대)`);
  }
  if (Math.min(...S.map((s) => s.w)) < 43.5 || Math.min(...S.map((s) => s.h)) < 43.5) e.push(`버튼 크기 ${Math.min(...S.map((s) => s.w)).toFixed(0)}×${Math.min(...S.map((s) => s.h)).toFixed(0)} (≥44 기대)`);
  if (S.some((s) => s.x < 0 || s.y < 0 || s.x + s.w > vp.width || s.y + s.h > vp.height)) e.push('버튼이 화면 밖으로 나감');
  for (const item of hud) {
    if (item.none || !(item.w > 0 && item.h > 0)) { e.push(`${item.s} 요소가 없거나 안 보임`); continue; }
    if (S.some((s) => overlap(s, item))) e.push(`${item.s} 와 겹침`);
  }
  if (S.some((s) => s.style !== '|')) e.push('버튼 style 에 top/left 가 쓰임(transform 만 허용)');
  if (S.some((s) => s.visible !== true)) e.push('구름 visible=false 순간 있음');
  // 1초 간격 두 번: top 변화 ≥10px, 구름 y 차이와 ±3px
  let maxTop = 0, pairs = 0, worstSync = 0;
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) {
      const dt = S[j].t - S[i].t;
      if (dt < 1000) continue;
      if (dt > 1100) break;
      pairs++;
      maxTop = Math.max(maxTop, Math.abs(S[j].y - S[i].y));
      const dBtn = (S[j].y + S[j].h / 2) - (S[i].y + S[i].h / 2);
      const dCloud = S[j].cloudY - S[i].cloudY;
      worstSync = Math.max(worstSync, Math.abs(dBtn - dCloud));
      break;
    }
  }
  if (!pairs) e.push('1초 간격 샘플 없음');
  else {
    if (maxTop < 10) e.push(`1초 간 top 최대 변화 ${maxTop.toFixed(1)}px (≥10 기대, 고정이면 실패)`);
    if (worstSync > 3) e.push(`1초 간 구름 y 차이와 버튼 y 차이 어긋남 ${worstSync.toFixed(1)}px (±3)`);
  }
  // 구름 위치(프록시): 터널 투영은 getState 에 없어 "구름 x 가 캔버스 가운데보다 오른쪽, y 가 가운데보다 위"로 대신 본다
  const first = S[0];
  if (!(first.cx0 >= first.cvW / 2 && first.cy0 <= first.cvH / 2)) e.push(`구름 위치(프록시) x=${first.cx0.toFixed(0)}/${first.cvW}, y=${first.cy0.toFixed(0)}/${first.cvH}`);
  return e.length ? e.join('; ') : true;
};
const judgeSaved = (label, stored, want) => {
  const e = [];
  if (label !== want) e.push(`라벨 "${label}" (기대 "${want}")`);
  if (stored !== want) e.push(`저장값 ${JSON.stringify(stored)} (기대 "${want}")`);
  return e.length ? e.join('; ') : true;
};

// 페이지 안 샘플러: 버튼 rect·구름 좌표를 50ms 간격으로 4.3초 기록
const sampler = async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fw = document.querySelector('[data-testid="future-word"]');
  const cv = document.querySelector('[data-testid="char-canvas"]');
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 4300) {
    const r = fw.getBoundingClientRect();
    const c = cv.getBoundingClientRect();
    const s = window.RT3D.getState().cloud;
    // hh = 구름 반높이(px). 구름 윗가장자리 = cloudY − hh (B 가 getState().cloud 에 추가)
    out.push({ t: performance.now() - t0, x: r.x, y: r.y, w: r.width, h: r.height, cloudX: c.left + s.x, cloudY: c.top + s.y, cloudTop: c.top + s.y - s.hh, cx0: s.x, cy0: s.y, cvW: c.width, cvH: c.height, visible: s.visible, style: fw.style.top + '|' + fw.style.left });
    await wait(50);
  }
  return out;
};

await run(async (browser) => {
  // ========== M11-1 터널: 회전 속도·별 포함 드로우콜 ==========
  await check('M11-1. 터널: 1초 회전 0.35~0.45rad(|Δrot|), stage4 드로우콜 ≤39·M10(27) 대비 +1~5, 대조(0·1.2) 실패', async () => {
    const { ctx, page } = await open(browser, { seed: seed4 });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    await sleep(300);
    const stage = await attrOf(page, CARD, 'data-stage');
    const draws = parseInt(await attrOf(page, CARD, 'data-rt-draws'), 10);
    // 진단(M12 진행자): 전체 실행 중 1회 draws 가 사라짐(장면이 해체됨) — 다시 나오면 원인을 보이게 render 모드·quality 를 같이 적는다
    const diag = Number.isNaN(draws) ? await page.evaluate(() => { const c = document.querySelector('[data-testid="char-card"]'); return { render: c && c.getAttribute('data-render'), q: c && c.getAttribute('data-rt-quality'), canvas: !!document.querySelector('[data-testid="char-canvas"]') }; }) : null;
    const spin = await page.evaluate(async () => {
      const r0 = window.RT3D.getState().tunnel.rot; const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 1000));
      const r1 = window.RT3D.getState().tunnel.rot; const t1 = performance.now();
      return { r0, r1, dt: (t1 - t0) / 1000 };
    });
    await ctx.close();
    const errs = [];
    if (stage !== '4') errs.push(`stage=${stage} (4 기대)`);
    const rate = Math.abs(angDiff(spin.r0, spin.r1)) / spin.dt;
    const j = judgeSpin(rate);
    if (j !== true) errs.push(j);
    if (!(draws <= 39)) errs.push(`stage4 드로우콜 ${draws} (≤39)` + (diag ? ` 진단 ${JSON.stringify(diag)}` : ''));
    if (!(draws - M10_DRAWS_STAGE4 >= 1 && draws - M10_DRAWS_STAGE4 <= 5)) errs.push(`M10 대비 증가 ${draws - M10_DRAWS_STAGE4} (1~5 기대)`);
    // 대조: 0 과 1.2rad/s 는 실패해야 한다
    if (judgeSpin(0) === true || judgeSpin(1.2) === true) errs.push('대조 실패: 0 또는 1.2rad/s 를 통과시킴');
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-2 구름: 위아래 4초 주기·rot 0·위치(프록시) ==========
  await check('M11-2. 구름: 4초 20샘플 dy 범위 0.18~0.21(±0.1 안), cloud.rot 전부 [0,0,0], visible 항상 true, 위치(프록시)', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page);
    await sleep(300);
    const S = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      const cv = document.querySelector('[data-testid="char-canvas"]');
      for (let i = 0; i < 20; i++) {
        const s = window.RT3D.getState().cloud;
        const c = cv.getBoundingClientRect();
        out.push({ dy: s.dy, rot: s.rot, visible: s.visible, cx0: s.x, cy0: s.y, cvW: c.width, cvH: c.height, w: s.w, d: window.RT3D.getState().tunnel.d });
        await wait(200);
      }
      return out;
    });
    await ctx.close();
    const errs = [];
    const j = judgeCloud(S);
    if (j !== true) errs.push(j);
    // 진행자 추가(M11-R3): 구름 크기 = 터널의 약 25% (화면 px 폭 비율 0.22~0.32)
    const ratio = S[0].w / S[0].d;
    if (!(ratio >= 0.22 && ratio <= 0.32)) errs.push(`구름/터널 폭 비율 ${ratio && ratio.toFixed(3)} (0.22~0.32 기대)`);
    const f = S[0];
    if (!(f.cx0 >= f.cvW / 2 && f.cy0 <= f.cvH / 2)) errs.push(`구름 위치(프록시) x=${f.cx0.toFixed(0)}/${f.cvW}, y=${f.cy0.toFixed(0)}/${f.cvH} (오른쪽·위 기대)`);
    // 대조: 상수 dy·회전 있는 입력은 실패해야 한다
    if (judgeCloud(S.map((s) => ({ ...s, dy: 0 }))) === true) errs.push('대조 실패: dy 상수를 통과시킴');
    if (judgeCloud(S.map((s, i) => (i === 3 ? { ...s, rot: [0, 0, 0.1] } : s))) === true) errs.push('대조 실패: rot 하나 0.1 을 통과시킴');
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-3 라벨 위치: 구름과 함께, 겹침 0, 크기, 화면 안 ==========
  const HUD = ['[data-testid="char-level"]', '[data-testid="char-xp"]', '[data-testid="char-next"]', '[data-testid="char-stage-name"]', '[data-testid="char-progress"]', '.char-info', '.tabbar', '[data-testid="manage-panel"]', '.manage-panel-head'];
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await check(`M11-3. 라벨 위치 ${vp.width}×${vp.height}: 구름 위 간격 0~20px(아래쪽 ≤ 구름 윗가장자리+2), 가로 중심 구름 x ±20, 크기 ≥44, 화면 안, HUD·패널 머리·탭바 겹침 0, 1초 top 변화 ≥10px, 구름과 같은 y 차이 ±3px, top/left 안 씀`, async () => {
      const { ctx, page } = await open(browser, { seed: fixtureRaw, viewport: vp });
      await sleep(600);
      await page.click(tid('tab-manage'));
      await waitMounted(page);
      await placed(page);
      const hud = await page.evaluate((sels) => sels.map((s) => {
        const e = document.querySelector(s);
        if (!e) return { s, none: true };
        const r = e.getBoundingClientRect();
        return { s, x: r.x, y: r.y, w: r.width, h: r.height };
      }), HUD);
      const S = await page.evaluate(sampler);
      await ctx.close();
      const j = judgeLabel(S, hud, vp);
      if (j !== true) return j;
      // 대조: 버튼을 30px 옆으로 밀어 둔 입력은 실패해야 한다 (±20 기준 초과)
      const shifted = S.map((s) => ({ ...s, x: s.x + 30 }));
      if (judgeLabel(shifted, hud, vp) === true) return '대조 실패: 30px 밀린 버튼을 통과시킴';
      // 대조: 라벨을 40px 내려 구름 안으로 넣은 입력은 실패해야 한다 (간격 < −2)
      const sunk = S.map((s) => ({ ...s, y: s.y + 40 }));
      if (judgeLabel(sunk, hud, vp) === true) return '대조 실패: 구름 안으로 40px 내린 라벨을 통과시킴';
      return true;
    });
  }

  // ========== M11-4 입력·저장 (마우스) ==========
  await check('M11-4a. 입력(마우스): 탭→입력칸 focus·maxlength 12·enterkeyhint done, 공백 trim 저장, 13자→12자, Esc 취소, 바깥 탭 저장, 빈 값→"미래의 나"·data-empty·키 없음, routineTracker 불변', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage')); await waitMounted(page); await placed(page);
    const raw0 = await getRaw(page);
    const keys0 = await keysOf(page);
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    const at = await page.evaluate(() => { const i = document.querySelector('[data-testid="future-word-input"]'); return { focused: document.activeElement === i, max: i.getAttribute('maxlength'), enter: i.getAttribute('enterkeyhint') }; });
    if (!at.focused) errs.push('입력칸이 focus 안 됨');
    if (at.max !== '12') errs.push(`maxlength=${at.max} (12 기대)`);
    if (at.enter !== 'done') errs.push(`enterkeyhint=${at.enter} (done 기대)`);
    await typeNew(page, '  달리는나  ');
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    let j = judgeSaved(await labelOf(page), await storedOf(page), '달리는나');
    if (j !== true) errs.push('공백 trim 저장: ' + j);
    const keysMid = await keysOf(page);
    const newKeys = keysMid.filter((k) => !keys0.includes(k));
    if (JSON.stringify(newKeys) !== JSON.stringify([FWKEY])) errs.push(`새 localStorage 키 ${JSON.stringify(newKeys)} (["${FWKEY}"] 기대)`);
    // Esc 취소: 원래 값 유지
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await typeNew(page, '다른값');
    await page.keyboard.press('Escape');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    j = judgeSaved(await labelOf(page), await storedOf(page), '달리는나');
    if (j !== true) errs.push('Esc 취소: ' + j);
    // 바깥 탭으로 저장
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await typeNew(page, '바깥저장');
    // 바깥 탭: 3D 캔버스가 HUD 위를 덮어 캔버스 빈 곳을 누른다(pointerdown 은 문서 전체에서 잡힌다)
    await page.mouse.click(20, 700);
    await page.locator(FWI).waitFor({ state: 'hidden' });
    j = judgeSaved(await labelOf(page), await storedOf(page), '바깥저장');
    if (j !== true) errs.push('바깥 탭 저장: ' + j);
    // 13자 → 12자
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await typeNew(page, '가'.repeat(13));
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    const st13 = await storedOf(page);
    if (cpLen(st13) !== 12 || st13 !== '가'.repeat(12)) errs.push(`13자 입력 저장 ${cpLen(st13)}자 (12자 기대)`);
    // 빈 값 → 미래의 나·data-empty·키 없음
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await typeNew(page, '   ');
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    const emptyLabel = await labelOf(page);
    const emptyAttr = await attrOf(page, FW, 'data-empty');
    if (emptyLabel !== '미래의 나') errs.push(`빈 값 라벨 "${emptyLabel}" (미래의 나 기대)`);
    if (emptyAttr !== '1') errs.push(`빈 값 data-empty=${emptyAttr} (1 기대)`);
    if ((await storedOf(page)) !== null) errs.push('빈 값인데 키가 남음');
    const raw1 = await getRaw(page);
    if (raw1 !== raw0) errs.push('routineTracker 값 바뀜');
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-4b 진짜 터치(hasTouch·CDP tap) ==========
  await check('M11-4b. 진짜 터치: 버튼 tap→입력칸 보임→insertText("건강한 나")→Enter 저장→라벨·data-empty 없음·키·새로고침 유지', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, hasTouch: true, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.locator(tid('tab-manage')).tap();
    await waitMounted(page); await placed(page);
    await page.locator(FW).tap();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await page.keyboard.insertText('건강한 나');
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    if ((await labelOf(page)) !== '건강한 나') errs.push(`라벨 "${await labelOf(page)}"`);
    if ((await attrOf(page, FW, 'data-empty')) !== null) errs.push('저장 뒤 data-empty 남음');
    if ((await storedOf(page)) !== '건강한 나') errs.push(`저장값 ${JSON.stringify(await storedOf(page))}`);
    await page.reload(); await sleep(400);
    await page.locator(tid('tab-manage')).tap();
    await waitMounted(page); await placed(page);
    if ((await labelOf(page)) !== '건강한 나') errs.push(`새로고침 뒤 라벨 "${await labelOf(page)}"`);
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-5 한글 IME 시뮬레이션 ==========
  await check('M11-5. 한글 IME: 조합 중(compositionstart·isComposing input 15자) 값 안 잘림 → compositionend 후 12자, insertText 저장, 새로고침 유지', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage')); await waitMounted(page); await placed(page);
    const raw0 = await getRaw(page);
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    const LONG = '미래의나는최고로멋진달리기선수';
    const r = await page.evaluate(async (long) => {
      const input = document.querySelector('[data-testid="future-word-input"]');
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      input.value = long;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: long }));
      await new Promise((r) => setTimeout(r, 50));
      const during = input.value;
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: long }));
      const after = input.value;
      return { during, after };
    }, LONG);
    if (Array.from(r.during).length !== 15) errs.push(`조합 중 값 ${Array.from(r.during).length}자 (15 유지 기대)`);
    if (r.after !== '미래의나는최고로멋진달리') errs.push(`compositionend 후 "${r.after}" (12자 기대)`);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('하늘을나는별');
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    const j = judgeSaved(await labelOf(page), await storedOf(page), '하늘을나는별');
    if (j !== true) errs.push('insertText 저장: ' + j);
    await page.reload(); await sleep(400);
    await page.click(tid('tab-manage')); await waitMounted(page); await placed(page);
    if ((await labelOf(page)) !== '하늘을나는별') errs.push(`새로고침 뒤 라벨 "${await labelOf(page)}"`);
    if ((await getRaw(page)) !== raw0) errs.push('routineTracker 값 바뀜');
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-6 2D 폴백 ==========
  await check('M11-6. 2D 폴백(?avatar=2d): 버튼 보임·카드 안 흐름(data-mode=flow)·1초 top 불변·입력→저장 동일', async () => {
    const errs = [];
    const { ctx, page } = await open(browser, { seed: fixtureRaw, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE + '?avatar=2d'); await sleep(600);
    await page.click(tid('tab-manage'));
    await page.locator(FW).waitFor({ state: 'visible' });
    if ((await attrOf(page, CARD, 'data-render')) !== '2d') errs.push(`data-render=${await attrOf(page, CARD, 'data-render')} (2d 기대)`);
    if ((await attrOf(page, '.fw-layer', 'data-mode')) !== 'flow') errs.push(`data-mode=${await attrOf(page, '.fw-layer', 'data-mode')} (flow 기대)`);
    const inside = await page.evaluate(() => document.querySelector('[data-testid="char-card"]').contains(document.querySelector('[data-testid="future-word"]')));
    if (!inside) errs.push('버튼이 카드 밖에 있음');
    const box = await page.locator(FW).boundingBox();
    if (!box || box.width < 44 || box.height < 44) errs.push(`버튼 크기 ${box && box.width}×${box && box.height} (≥44 기대)`);
    const tops = await page.evaluate(async () => {
      const fw = document.querySelector('[data-testid="future-word"]');
      const arr = []; const t0 = performance.now();
      while (performance.now() - t0 < 1000) { arr.push(fw.getBoundingClientRect().top); await new Promise((r) => setTimeout(r, 100)); }
      return arr;
    });
    const spread = Math.max(...tops) - Math.min(...tops);
    if (spread > 0.5) errs.push(`2D 에서 1초 top 변화 ${spread.toFixed(1)}px (고정 기대)`);
    await page.locator(FW).click();
    await page.locator(FWI).waitFor({ state: 'visible' });
    await page.keyboard.insertText('2D나');
    await page.keyboard.press('Enter');
    await page.locator(FWI).waitFor({ state: 'hidden' });
    const j = judgeSaved(await labelOf(page), await storedOf(page), '2D나');
    if (j !== true) errs.push('2D 저장: ' + j);
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    await ctx.close();
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-7 reduced-motion: 회전·구름 정지 ==========
  await check('M11-7. reduced-motion: 터널 rot 0 고정(1초 불변)·cloud.dy 0·cloud.rot [0,0,0]·버튼 1초 위치 불변', async () => {
    const { ctx, page } = await open(browser, { seed: fixtureRaw, reduced: true, goto: false });
    const pe = []; page.on('pageerror', (e) => pe.push(e.message));
    await page.goto(BASE); await sleep(600);
    await page.click(tid('tab-manage'));
    await waitMounted(page); await placed(page);
    const S = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const fw = document.querySelector('[data-testid="future-word"]');
      const out = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        const s = window.RT3D.getState();
        out.push({ rot: s.tunnel.rot, dy: s.cloud.dy, crot: s.cloud.rot, top: fw.getBoundingClientRect().top });
        await wait(100);
      }
      return out;
    });
    await ctx.close();
    const errs = [];
    const judgeReduced = (X) => {
      const e = [];
      if (X.some((s) => s.rot !== X[0].rot)) e.push('reduced 인데 tunnel.rot 변함');
      if (X.some((s) => s.rot !== 0)) e.push(`reduced tunnel.rot=${X[0].rot} (0 고정 기대)`);
      if (X.some((s) => s.dy !== 0)) e.push(`reduced cloud.dy=${X.find((s) => s.dy !== 0).dy} (0 기대)`);
      if (X.some((s) => !(Array.isArray(s.crot) && s.crot.every((v) => v === 0)))) e.push('reduced cloud.rot ≠ [0,0,0]');
      if (Math.max(...X.map((s) => s.top)) - Math.min(...X.map((s) => s.top)) > 0.5) e.push('reduced 인데 버튼 top 변함');
      return e.length ? e.join('; ') : true;
    };
    const j = judgeReduced(S);
    if (j !== true) errs.push(j);
    // 대조: 회전하는 입력은 실패해야 한다
    if (judgeReduced(S.map((s, i) => ({ ...s, rot: i * 0.05 }))) === true) errs.push('대조 실패: 회전하는 입력을 통과시킴');
    if (pe.length) errs.push('pageerror: ' + pe.join('|'));
    return errs.length ? errs.join('; ') : true;
  });

  // ========== M11-8 저장 키 격리 (파일 검사) ==========
  await check('M11-8. futureword.js: routineTracker 문자열 없음·routineFutureWord 키 사용', async () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'js', 'futureword.js'), 'utf8');
    const errs = [];
    if (/routineTracker/.test(src)) errs.push('futureword.js 에 routineTracker 문자열 있음');
    if (!/routineFutureWord/.test(src)) errs.push('routineFutureWord 키 없음');
    return errs.length ? errs.join('; ') : true;
  });
});
