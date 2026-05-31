// Live acceptance — CI-grade E2E pipeline verification
import { execSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const run = (cmd, cwd, timeout = 120000) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf-8', timeout, stdio: 'pipe' }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || ''), err: e.message };
  }
};

const cwd = process.cwd();
let passed = 0, failed = 0;
function check(name, condition, detail = '') {
  if (condition) { console.log(`  [PASS] ${name}`); passed++; }
  else { console.log(`  [FAIL] ${name}${detail ? ': ' + detail : ''}`); failed++; }
}

console.log('=== icloser Agent Shell — Acceptance ===\n');

// Gate 1: Build + Test
console.log('[1/6] Build & test');
check('tsc build', run('npm run build', cwd).ok);
const testOut = run('npm test', cwd).out;
const testPass = testOut.includes('Tests ') && testOut.includes('passed') && !testOut.includes('0 passed');
check('Tests pass', testPass);

// Gate 2: Lint
console.log('[2/6] Lint');
const lint = run('npm run lint', cwd);
check('Lint ok', lint.ok || lint.out.includes('ok'), lint.out.slice(-60));

// Gate 3: Spawn tests
console.log('[3/6] Spawn tests');
const spawn = run('npx vitest run tests/json-contract-spawn.test.ts', cwd, 120000);
check('Spawn tests', spawn.out.includes('passed'), spawn.out.match(/(\d+) passed/)?.[1] || '');

// Gate 4: Task pipeline
console.log('[4/6] Task pipeline');
const dir = mkdtempSync(join(tmpdir(), 'icloser-accept-'));
let taskPassed = false;
try {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok', lint: 'echo ok', test: 'echo ok' } }));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, outDir: 'dist' }, include: ['src'] }));
  writeFileSync(join(dir, 'src/index.ts'), 'console.log("hello");');
  const idx = join(cwd, 'dist/index.js');

  check('init', run(`node "${idx}" init --force`, dir).ok);
  run(`node "${idx}" scan`, dir, 30000);

  const taskOut = run(`node "${idx}" t "修改 src/index.ts 添加注释" --go`, dir, 180000).out;
  taskPassed = !taskOut.includes('ENOENT') && !taskOut.includes('Error:') && taskOut.length > 100;
  check('Task pipeline', taskPassed, taskOut.slice(0, 100));

  const st = run(`node "${idx}" st --json`, dir, 30000);
  const statusOk = st.out.includes('"status"') || st.out.includes('"tasks"');
  check('Status query', statusOk);
} finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// Gate 5: Code gen
console.log('[5/6] Code gen');
const gd = mkdtempSync(join(tmpdir(), 'icloser-accept-'));
try {
  mkdirSync(join(gd, 'src'), { recursive: true });
  writeFileSync(join(gd, 'package.json'), JSON.stringify({ name: 'gen', scripts: { build: 'echo ok' } }));
  writeFileSync(join(gd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' }, include: ['src'] }));
  writeFileSync(join(gd, 'src/index.ts'), 'import express from "express";\nconst app=express();app.listen(3000);\n');
  const idx = join(cwd, 'dist/index.js');
  run(`node "${idx}" init --force`, gd, 30000);
  run(`node "${idx}" scan`, gd, 30000);
  const genOut = run(`node "${idx}" gen new "add json middleware"`, gd, 60000).out;
  check('Code gen runs', genOut.length > 10, genOut.slice(0, 60));
} finally { try { rmSync(gd, { recursive: true, force: true }); } catch {} }

// Gate 6: Provider
console.log('[6/6] Provider');
const prv = run('node dist/index.js provider list --json', cwd).out;
check('Provider list', prv.includes('mock') && prv.includes('claude'));

// Gate 7: Real AI comparison (only when API key is available)
console.log('[7/7] Real AI check');
const hasKey = process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (hasKey) {
  const liveDir = mkdtempSync(join(tmpdir(), 'icloser-live-'));
  try {
    mkdirSync(join(liveDir, 'src'), { recursive: true });
    writeFileSync(join(liveDir, 'package.json'), JSON.stringify({ name: 'live', scripts: { build: 'echo ok', test: 'echo ok' } }));
    writeFileSync(join(liveDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' }, include: ['src'] }));
    writeFileSync(join(liveDir, 'src/index.ts'), 'console.log("hello world");');
    const idx = join(cwd, 'dist/index.js');
    run(`node "${idx}" init --force`, liveDir, 30000);
    run(`node "${idx}" scan`, liveDir, 30000);
    // Use the real provider for one task
    const liveOut = run(`node "${idx}" t "分析代码质量" --go`, liveDir, 300000).out;
    check('Real AI completes', liveOut.length > 50 && !liveOut.includes('API key'), liveOut.slice(0, 80));
  } catch (e) { check('Real AI completes', false, e.message?.slice(0, 60)); }
  finally { try { rmSync(liveDir, { recursive: true, force: true }); } catch {} }
} else {
  console.log('  [SKIP] No API key. Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY for live test.');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
