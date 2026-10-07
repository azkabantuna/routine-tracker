// 바뀐 기능의 시험만 골라 돌리는 실행기.
// 사용(레포 루트에서):
//   node projects/routine-tracker/tests/run.mjs <바뀐 파일…>      예) js/effects.js  또는  projects/routine-tracker/js/store.js
//   node projects/routine-tracker/tests/run.mjs --feature store emoji
//   node projects/routine-tracker/tests/run.mjs --all
// 8080 에서 응답하는 서버가 없을 때만 python3 http.server 를 직접 켜고, 끝나면 그 PID 만 끈다.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const FEATURES = ['store', 'routines', 'emoji', 'effects', 'motion', 'layout'];

// ★ 바뀐 파일 → 돌릴 기능 (표 하나뿐). 표에 없는 파일은 안전하게 전부 돌린다.
const TABLE = {
  'date.js': ['store', 'routines'],
  'store.js': ['store', 'routines'],
  'routines.js': ['store', 'routines'],
  'emoji.js': ['emoji', 'routines'], // 시트가 이모지 검사를 씀
  'sheets.js': ['routines', 'emoji'],
  'effects.js': ['effects'],
  'effects.css': ['effects'],
  'screens.js': ['routines', 'motion', 'layout'],
  'app.js': ['routines', 'motion', 'layout'],
  'index.html': ['routines', 'motion', 'layout'],
  'base.css': ['motion', 'layout'],
  'cards.css': ['motion', 'layout'],
  'overlays.css': ['motion', 'layout'],
  'character.js': ['store'], // 간단 확인(저장 데이터가 그대로인지)
  'streak.js': ['store'],
  '_lib.mjs': FEATURES, // 공용 도우미가 바뀌면 전부
  'run.mjs': ['store'], // 실행기만 바뀜: 간단 확인
  'old-seed.json': ['store'],
};
for (const f of FEATURES) TABLE[`${f}.test.mjs`] = [f];

function choose(args) {
  const why = [];
  const set = new Set();
  const add = (list, reason) => { list.forEach((f) => set.add(f)); why.push(`${reason} → ${list.join(', ')}`); };
  if (args[0] === '--all') { add(FEATURES, '--all'); return { set, why }; }
  if (args[0] === '--feature') {
    const names = args.slice(1);
    const bad = names.filter((n) => !FEATURES.includes(n));
    if (!names.length || bad.length) { console.error(`알 수 없는 기능: ${bad.join(', ') || '(없음)'} (가능: ${FEATURES.join(', ')})`); process.exit(2); }
    add(names, '--feature 지정');
    return { set, why };
  }
  for (const file of args) {
    const base = path.basename(file);
    if (TABLE[base]) add(TABLE[base], base);
    else add(FEATURES, `${file} (표에 없음: 안전하게 전부)`);
  }
  return { set, why };
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('사용: node projects/routine-tracker/tests/run.mjs <바뀐 파일…> | --feature <이름…> | --all\n기능: ' + FEATURES.join(', '));
  process.exit(2);
}
const { set, why } = choose(args);
const chosen = FEATURES.filter((f) => set.has(f));
console.log('고른 기능: ' + chosen.join(', '));
why.forEach((w) => console.log('  이유: ' + w));

const answers = () => new Promise((resolve) => {
  const req = http.get({ host: 'localhost', port: 8080, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

let server = null; // 우리가 켠 서버(자식 프로세스)
function stopServer() {
  if (server && server.exitCode === null && !server.killed) {
    try { process.kill(server.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ }
  }
}
process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });

async function startServerIfNeeded() {
  if (await answers()) { console.log('서버: 8080 에서 이미 응답 중 (그대로 사용, 끄지 않음)'); return; }
  server = spawn('python3', ['-m', 'http.server', '8080'], { cwd: PROJECT, stdio: 'ignore' });
  console.log(`서버: 8080 응답 없음 → http.server 시작 (PID ${server.pid})`);
  for (let i = 0; i < 50; i++) {
    if (await answers()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  stopServer();
  console.error('서버가 8080 에서 뜨지 않음');
  process.exit(1);
}

function runFile(feature) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, `${feature}.test.mjs`)], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ feature, code, out }));
  });
}

let pass = 0, total = 0, anyFail = false;
try {
  await startServerIfNeeded();
  for (const f of chosen) {
    const r = await runFile(f);
    const m = r.out.match(/결과: (\d+)\/(\d+) 통과/);
    r.out.split('\n').filter((l) => l.startsWith('❌')).forEach((l) => console.log('  ' + l));
    if (m) { pass += Number(m[1]); total += Number(m[2]); } else { total += 1; anyFail = true; console.log(r.out.split('\n').slice(-8).join('\n')); }
    if (r.code !== 0) anyFail = true;
    console.log(`[${f}] ${m ? m[0] : '결과 줄 없음'}${r.code !== 0 ? ' (실패)' : ''}`);
  }
} finally {
  stopServer();
}
console.log(`결과: ${pass}/${total} 통과 (기능: ${chosen.join(', ')})`);
process.exit(anyFail || pass !== total ? 1 : 0);
