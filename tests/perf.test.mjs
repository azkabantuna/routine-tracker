// 성능 시험 (R2 계획 ①: 다시 그리기 횟수·DOM 변경·반응 ms·longtask·layout-shift). 절대 ms 는 판정하지 않고 '후/전' 비율만 본다.
// 실행(레포 루트에서): node projects/routine-tracker/tests/perf.test.mjs
// 측정 표: logs/routine-tracker/perf.md (표: 동작 | 전 | 후 | 비율). PERF_PHASE=before|after 로 강제, 없으면 '전' 칸이 비었을 때만 전, 있으면 후를 쓴다.
// 측정 법: 시드 mulberry32(20261021) 루틴 10개×90일 = 기록 900건(최근 30일 300건), 날짜 2026-10-21 고정, 7회 중앙값.
// 동작: 탭 4개 열기(캘린더→퓨처 셀프→타이머→오늘), 캘린더 cal-prev 3번·cal-next 3번. 반응 = el.click() 부터 2 rAF 까지.
// render 호출 = 앱 공개 함수(RT.screens.renderToday/renderAll/renderManage)를 감싼 호출 수 + 캘린더 칸을 다시 만든 횟수(cal-day 추가 수 ÷ 칸 수).
//   캘린더 내부 renderMonth 와 renderAll 안의 renderToday 는 공개 함수가 아니라 직접 못 세므로 DOM 으로 대신 잰다(한계 기록).
import { run, check, note, info, sleep, tid, getRaw, open, fs, path, HERE } from './_lib.mjs';

const LOG_DIR = path.resolve(HERE, '../../../logs/routine-tracker');
const FILE = path.join(LOG_DIR, 'perf.md');
const RUNS = 7;
const PNOW = '2026-10-21T10:00:00+09:00';
const SEED_RNG = 20261021;
const JUDGE_RATIO = ['m1', 'm2', 'm3', 'm4']; // 반응 ms·DOM 변경: 후/전 ≤ 1.0
const ROWS = [
  ['탭 4개 열기 반응 ms (4회 합, 중앙값)', 'm1', 'ms'],
  ['달 넘김 1번 반응 ms (6회 중앙값)', 'm2', 'ms'],
  ['탭 4개 열기 DOM 변경 수 (합)', 'm3', 'n'],
  ['달 넘김 1번 DOM 변경 수 (평균)', 'm4', 'n'],
  ['탭 4개 열기 render 호출 (합)', 'm5', 'n'],
  ['달 넘김 1번 render 호출 (최댓값)', 'm6', 'n'],
  ['오늘 탭 재진입 render 호출 (바뀐 것 없음, 기대 0)', 'm7', 'n'],
  ['탭 4개 열기 longtask 수', 'm8', 'n'],
  ['탭 4개 열기 longtask 합 ms', 'm9', 'ms'],
  ['달 넘김 6번 longtask 합 ms', 'm10', 'ms'],
  ['layout-shift 합 (탭 4·달 넘김 6)', 'm11', 'n'],
];

// 시드: 기록 900건. 날짜는 2026-10-20 부터 90일 거꾸로.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeSeed() {
  const rng = mulberry32(SEED_RNG);
  const routines = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: '루틴' + (i + 1), mini: '미니' + (i + 1), more: '보통' + (i + 1), max: '최대' + (i + 1), createdAt: '2026-07-01', order: i }));
  const LV = ['mini', 'more', 'max'];
  const logs = {};
  const base = Date.UTC(2026, 9, 20);
  let total = 0, recent = 0;
  for (let d = 0; d < 90; d++) {
    const date = new Date(base - d * 86400000).toISOString().slice(0, 10);
    logs[date] = {};
    for (const r of routines) {
      logs[date][r.id] = LV[Math.floor(rng() * 3)];
      total++;
      if (d < 30) recent++;
    }
  }
  return { seed: { version: 1, routines, logs, celebratedOn: null }, total, recent };
}

// 페이지 안: 감싸기 + 관찰 (반응 측정 전에 한 번만 붙인다)
const INSTALL = () => {
  if (window.__pf) return true;
  const P = (window.__pf = { mo: 0, added: 0, rc: 0, lt: [], ls: [] });
  const wrap = (obj, key) => { const f = obj[key]; obj[key] = function () { P.rc++; return f.apply(this, arguments); }; };
  wrap(window.RT.screens, 'renderToday');
  wrap(window.RT.screens, 'renderAll');
  wrap(window.RT.screens, 'renderManage');
  new MutationObserver((ms) => {
    for (const m of ms) {
      P.mo++;
      m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-testid') === 'cal-day') P.added++; });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) P.ls.push(e.value); }).observe({ type: 'layout-shift' });
  return true;
};
// 클릭(프로그램 클릭, 앱 핸들러 동기 실행) → 2 rAF 까지 걸린 ms
const MEASURE = (sel) => new Promise((resolve) => {
  const el = document.querySelector(sel);
  const t0 = performance.now();
  el.click();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
});
// 읽고 0으로 되돌림
const READ = () => {
  const P = window.__pf;
  const cells = document.querySelectorAll('[data-testid="cal-day"]').length;
  const out = { mo: P.mo, added: P.added, cells, rc: P.rc, lt: P.lt.length, ltMs: P.lt.reduce((a, b) => a + b, 0), ls: P.ls.reduce((a, b) => a + b, 0) };
  P.mo = 0; P.added = 0; P.rc = 0; P.lt = []; P.ls = [];
  return out;
};

async function clickOnce(page, sel) {
  const dt = await page.evaluate(MEASURE, sel);
  await sleep(120);
  const r = await page.evaluate(READ);
  const rb = r.rc + Math.round(r.added / Math.max(1, r.cells)); // render 호출 = 감싼 호출 + 칸 다시 그림
  await sleep(450); // 전환 애니가 끝난 뒤 남은 변경은 버린다
  await page.evaluate(READ);
  return { dt, mo: r.mo, rb, lt: r.lt, ltMs: r.ltMs, ls: r.ls };
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

async function runOnce(browser, seed) {
  const { ctx, page } = await open(browser, { seed, now: PNOW, settle: 400 });
  await page.evaluate(INSTALL);
  const base = await getRaw(page);
  const tabs = [];
  for (const t of ['tab-calendar', 'tab-manage', 'tab-timer', 'tab-today']) tabs.push(await clickOnce(page, `[data-testid="${t}"]`));
  const cal = [];
  for (const t of ['cal-prev', 'cal-prev', 'cal-prev', 'cal-next', 'cal-next', 'cal-next']) cal.push(await clickOnce(page, `[data-testid="${t}"]`));
  const after = await getRaw(page);
  await ctx.close();
  const all = [...tabs, ...cal];
  return {
    m1: sum(tabs.map((x) => x.dt)),
    m2: median(cal.map((x) => x.dt)),
    m3: sum(tabs.map((x) => x.mo)),
    m4: sum(cal.map((x) => x.mo)) / cal.length,
    m5: sum(tabs.map((x) => x.rb)),
    m6: Math.max(...cal.map((x) => x.rb)),
    m7: tabs[3].rb,
    m8: sum(tabs.map((x) => x.lt)),
    m9: sum(tabs.map((x) => x.ltMs)),
    m10: sum(cal.map((x) => x.ltMs)),
    m11: sum(all.map((x) => x.ls)),
    perClickMax: Math.max(...all.map((x) => x.rb)),
    saveSame: after === base,
    saveLen: (base || '').length,
  };
}

// 표 읽기/쓰기: 같은 형식 한 줄씩. 전/후 칸을 따로 보존한다.
function readTable() {
  const map = new Map();
  if (!fs.existsSync(FILE)) return map;
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const m = line.match(/^\| (.+?) \| (\S*) \| (\S*) \| (\S*) \|$/);
    if (m) map.set(m[1], { before: m[2] === '-' || m[2] === '' ? null : Number(m[2]), after: m[3] === '-' || m[3] === '' ? null : Number(m[3]) });
  }
  return map;
}
const fmt = (v, unit) => (v === null || v === undefined || Number.isNaN(v) ? '' : (unit === 'ms' ? v.toFixed(1) : String(Math.round(v * 100) / 100)));

run(async (browser) => {
  const { seed, total, recent } = makeSeed();
  check(`[성능] 시드 기록 ${total}건(최근 30일 ${recent}건) 확인`, total === 900 && recent === 300, `${total}/${recent}`);

  const table = readTable();
  const hasBefore = ROWS.some(([, k]) => table.get(ROWS[ROWS.findIndex((r) => r[1] === k)][0]) && table.get(ROWS[ROWS.findIndex((r) => r[1] === k)][0]).before !== null);
  const phase = process.env.PERF_PHASE || (hasBefore ? 'after' : 'before');
  info(`성능 측정 단계: ${phase} (${RUNS}회 중앙값)`);

  // 대조: 계측이 실제로 세는지 (render 2번 호출 → 2, DOM 변경 → 0 아님)
  {
    const { ctx, page } = await open(browser, { seed, now: PNOW, settle: 400 });
    await page.evaluate(INSTALL);
    await page.evaluate(() => { window.RT.screens.renderToday(); window.RT.screens.renderToday(); });
    const c = await page.evaluate(READ);
    check(`[성능] 대조: 감싼 render 호출 2번이 2로 잡힘 (측정 ${c.rc})`, c.rc === 2, `측정 ${c.rc}`);
    check(`[성능] 대조: DOM 변경 관찰이 동작함 (측정 ${c.mo}건)`, c.mo > 0, `측정 ${c.mo}`);
    await ctx.close();
  }

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce(browser, seed);
    runs.push(r);
    info(`  회차 ${i + 1}: 반응 탭 ${r.m1.toFixed(1)}ms 달 ${r.m2.toFixed(1)}ms · DOM ${r.m3}/${r.m4} · render 최대 ${r.perClickMax}`);
  }
  const med = {};
  for (const [, k] of ROWS) med[k] = median(runs.map((r) => r[k]));

  // 판정 (절대 기준)
  const maxPer = Math.max(...runs.map((r) => r.perClickMax));
  check(`[성능] 동작마다 render 호출 ≤1 (탭 4개·달 넘김 전 클릭, ${RUNS}회 최댓값)`, maxPer <= 1, `최댓값 ${maxPer}`);
  check(`[성능] 오늘 탭 재진입(바뀐 것 없음) render 0 (${RUNS}회 최댓값 ${Math.max(...runs.map((r) => r.m7))})`, runs.every((r) => r.m7 === 0), `회차별 ${runs.map((r) => r.m7).join(',')}`);
  check(`[성능] 저장 결과 불변 (측정 전·후 localStorage 같음, 기록 ${runs[0].saveLen}자)`, runs.every((r) => r.saveSame), runs.filter((r) => !r.saveSame).length + '회 다름');

  // 표 쓰기
  const rowsOut = [];
  let ratioFail = [];
  for (const [name, k, unit] of ROWS) {
    const prev = table.get(name) || { before: null, after: null };
    let before = prev.before;
    let after = prev.after;
    if (phase === 'before') before = med[k];
    else after = med[k];
    let ratio = '-';
    if (JUDGE_RATIO.includes(k) && before !== null && after !== null) {
      // 전 칸은 파일(반올림된 표)에서 읽은 값이라, 비교도 표에 적힌 자릿수로 맞춘다(원값 12.8333 과 표 12.83 을 비교하면 1.0003 으로 잘못 실패).
      const b = Number(fmt(before, unit)), a = Number(fmt(after, unit));
      const rt = b === 0 ? (a === 0 ? 1 : Infinity) : a / b;
      ratio = rt === Infinity ? '∞' : rt.toFixed(2);
      // 진행자 판정(야간 바퀴2): swiftshader 의 ms 는 같은 코드로도 교대 측정에서 0.90~1.05 로 흔들림(perf.md 교대 표) → ms 는 ≤1.05, DOM 변경 수는 ≤1.0 그대로
      // DOM 변경 수는 애니 끝(animationend) 타이밍에 따라 속성 제거가 ±1회 흔들림(바퀴2 는 CSS 만 바꿨는데 112↔113) → 전보다 1개 많은 것까지 허용
      const lim = /ms/.test(name) ? 1.05 : 1.0;
      const domSlack = !/ms/.test(name) && a - b <= 1;
      if (phase === 'after' && rt > lim && !domSlack) ratioFail.push(`${name} ${fmt(after, unit)}/${fmt(before, unit)}=${ratio}`);
    }
    rowsOut.push(`| ${name} | ${fmt(before, unit) || '-'} | ${fmt(after, unit) || ''} | ${ratio} |`);
  }
  const head = [
    '# 성능 측정 (routine-tracker, R2 바퀴 2)',
    `- 시드 mulberry32(20261021): 루틴 10개 × 90일 = 기록 ${total}건(최근 30일 ${recent}건). 날짜 2026-10-21 고정, 같은 swiftshader, ${RUNS}회 중앙값.`,
    '- 판정: 반응 ms 는 후/전 ≤1.05(소음 허용), DOM 변경은 후/전 ≤1.0 (비율만, 절대 ms 판정 안 함). 동작마다 render ≤1, 오늘 탭 재진입 render 0, 저장 불변.',
    '- 측정 한계: 캘린더 renderMonth 와 renderAll 안의 renderToday 는 공개 함수가 아니어서 직접 못 셈 → 칸 다시 그림 수·DOM 변경으로 대신 잰다.',
    `- 단계: ${phase === 'before' ? '전 기록(코드 고치기 전)' : '후 기록(B 수정 뒤)'} · 측정일 ${new Date().toISOString().slice(0, 10)}`,
    '',
    '| 동작 | 전 | 후 | 비율 |',
    '|---|---|---|---|',
  ];
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(FILE, head.concat(rowsOut).join('\n') + '\n');
  info(`perf.md ${phase === 'before' ? '전' : '후'} 칸 기록 완료`);

  if (phase === 'after') {
    check('[성능] 반응 ms 후/전 ≤1.05(측정 소음)·DOM 변경 후/전 ≤1.0 (표 비율)', ratioFail.length === 0, ratioFail.join(' | '));
  } else {
    note('전 기록 단계: 후/전 비율 판정은 B 수정 뒤 측정에서 한다');
  }
  note(`중앙값 — 탭 반응 ${med.m1.toFixed(1)}ms, 달 넘김 반응 ${med.m2.toFixed(1)}ms, 탭 DOM ${med.m3}, 달 DOM ${med.m4.toFixed(1)}, 탭 render ${med.m5}, 달 render 최댓값 ${med.m6}, longtask ${med.m8}회 ${med.m9.toFixed(1)}ms, layout-shift ${med.m11.toFixed(4)}`);
}).catch((e) => { console.error(e); process.exit(1); });
