// Performance benchmark — measures key operations and detects regressions
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const cwd = process.cwd();
const distIdx = join(cwd, 'dist/index.js');
const baselinePath = join(cwd, '.icloser', 'perf-baseline.json');

function run(cmd, opts = {}) {
  const start = Date.now();
  try { execSync(cmd, { stdio: 'pipe', timeout: 120000, ...opts }); return { ok: true, ms: Date.now() - start }; }
  catch (e) { return { ok: false, ms: Date.now() - start, err: e.message }; }
}

// ── Benchmark 1: Small project scan ──
console.log('[1/4] Small project scan...');
const smallDir = mkdtempSync(join(tmpdir(), 'icloser-perf-'));
try {
  mkdirSync(join(smallDir, 'src'), { recursive: true });
  writeFileSync(join(smallDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } }));
  writeFileSync(join(smallDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' }, include: ['src'] }));
  for (let i = 0; i < 50; i++) writeFileSync(join(smallDir, 'src', `file${i}.ts`), `export function fn${i}() { return ${i}; }\n`);
  const initR = run(`node "${distIdx}" init --force`, { cwd: smallDir });
  const scanR = run(`node "${distIdx}" scan`, { cwd: smallDir });
  console.log(`  Init: ${initR.ms}ms | Scan 50 files: ${scanR.ms}ms`);
} finally { try { rmSync(smallDir, { recursive: true, force: true }); } catch {} }

// ── Benchmark 2: Task execution ──
console.log('[2/4] Task execution...');
const taskDir = mkdtempSync(join(tmpdir(), 'icloser-perf-'));
let taskMs = 0;
try {
  mkdirSync(join(taskDir, 'src'), { recursive: true });
  writeFileSync(join(taskDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } }));
  writeFileSync(join(taskDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' }, include: ['src'] }));
  writeFileSync(join(taskDir, 'src/index.ts'), 'console.log("hello");');
  run(`node "${distIdx}" init --force`, { cwd: taskDir });
  run(`node "${distIdx}" scan`, { cwd: taskDir });
  const taskR = run(`node "${distIdx}" t "add comment" --go`, { cwd: taskDir });
  taskMs = taskR.ms;
  console.log(`  Task exec: ${taskMs}ms`);
} finally { try { rmSync(taskDir, { recursive: true, force: true }); } catch {} }

// ── Benchmark 3: Code generation ──
console.log('[3/4] Code generation...');
const genDir = mkdtempSync(join(tmpdir(), 'icloser-perf-'));
let genMs = 0;
try {
  mkdirSync(join(genDir, 'src'), { recursive: true });
  writeFileSync(join(genDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } }));
  writeFileSync(join(genDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' }, include: ['src'] }));
  writeFileSync(join(genDir, 'src/index.ts'), 'export const x = 1;');
  run(`node "${distIdx}" init --force`, { cwd: genDir });
  run(`node "${distIdx}" scan`, { cwd: genDir });
  const genR = run(`node "${distIdx}" gen new "add helper function"`, { cwd: genDir });
  genMs = genR.ms;
  console.log(`  Code gen: ${genMs}ms`);
} finally { try { rmSync(genDir, { recursive: true, force: true }); } catch {} }

// ── Benchmark 4: Acceptance smoke ──
console.log('[4/4] Acceptance gate...');
const acceptR = run(`node scripts/live-acceptance.mjs`, { cwd });
console.log(`  Acceptance: ${acceptR.ms}ms`);

// ── Save / compare baseline ──
const results = {
  timestamp: new Date().toISOString(),
  scan50: 0, // not captured individually
  taskMs,
  genMs,
  acceptMs: acceptR.ms,
};

let prev = null;
if (existsSync(baselinePath)) {
  prev = JSON.parse(readFileSync(baselinePath, 'utf-8'));
  console.log('\n=== Regression Check ===');
  const check = (name, cur, prevVal) => {
    const delta = Math.round((cur - prevVal) / prevVal * 100);
    const flag = delta > 20 ? '⚠️ REGRESSION' : delta < -20 ? '✅ IMPROVED' : 'OK';
    console.log(`  ${name}: ${prevVal}ms → ${cur}ms (${delta > 0 ? '+' : ''}${delta}%) ${flag}`);
  };
  if (prev.taskMs) check('Task', taskMs, prev.taskMs);
  if (prev.genMs) check('Gen', genMs, prev.genMs);
  if (prev.acceptMs) check('Accept', acceptR.ms, prev.acceptMs);
} else {
  try { mkdirSync(join(cwd, '.icloser'), { recursive: true }); } catch {}
}

writeFileSync(baselinePath, JSON.stringify(results, null, 2));
console.log(`\nBaseline saved: ${baselinePath}`);
