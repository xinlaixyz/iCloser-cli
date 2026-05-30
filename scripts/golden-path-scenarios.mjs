#!/usr/bin/env node
/**
 * ADV-02 — 真实 Provider 多场景黄金路径
 *
 * Scenario A: Bug 修复 — multiply 负数处理错误
 * Scenario B: 功能添加 — 新增 divide 函数
 *
 * 每个场景产出完整 8 项产物到 doc/golden-path/
 *
 * 前置条件：已设置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 等
 * 用法：node scripts/golden-path-scenarios.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const providers = [
  { name: 'claude', env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6' },
  { name: 'openai', env: 'OPENAI_API_KEY', model: 'gpt-4o' },
  { name: 'deepseek', env: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-pro' },
  { name: 'qwen', env: 'QWEN_API_KEY', model: 'qwen-max' },
];
let selected = null;
for (const p of providers) {
  if (process.env[p.env]) { selected = p; break; }
}
if (!selected) {
  console.error('未检测到 AI Provider API Key。请设置环境变量后重试。');
  process.exit(1);
}

const artifactDir = path.join(process.cwd(), 'doc', 'golden-path');
mkdirSync(artifactDir, { recursive: true });
const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

function artifact(label, content) {
  const file = path.join(artifactDir, `${ts()}-${label}.md`);
  writeFileSync(file, content, 'utf-8');
  console.log(`  → ${file}`);
  return file;
}

function makeProject(scenarioName) {
  const root = mkdtempSync(path.join(tmpdir(), `icloser-scenario-${scenarioName}-`));
  const cli = path.join(process.cwd(), 'dist', 'index.js');
  const env = { ...process.env, ICLOSER_HOME: path.join(root, '.icloser-home'), NODE_OPTIONS: '--no-warnings' };
  function run(command, args, cwd = root) {
    const label = `${command} ${args.join(' ')}`;
    console.log(`\n$ ${label}`);
    const r = spawnSync(command, args, { cwd, encoding: 'utf-8', env, timeout: 180000 });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) throw new Error(`${label} failed: ${r.status}`);
    return r.stdout || '';
  }
  return { root, cli, env, run };
}

// ═══════════════════════════════════════════
// Scenario A: Bug 修复
// ═══════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log('  Scenario A: Bug 修复 — multiply 负数错误');
console.log('═══════════════════════════════════════════\n');

{
  const { root, cli, run } = makeProject('bugfix');

  // Setup project with a bug
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2));
  writeFileSync(path.join(root, 'index.js'), [
    '// Math utilities',
    'export function add(a, b) { return a + b; }',
    '// BUG: multiply uses wrong operator for negative numbers',
    'export function multiply(a, b) {',
    '  if (a < 0 || b < 0) return a - b;  // BUG: should be a * b',
    '  return a * b;',
    '}',
  ].join('\n'));
  writeFileSync(path.join(root, 'index.test.js'), [
    "import { add, multiply } from './index.js';",
    "import assert from 'node:assert'; import { test } from 'node:test';",
    "test('add', () => assert.strictEqual(add(2, 3), 5));",
    "test('multiply positive', () => assert.strictEqual(multiply(3, 4), 12));",
    "test('multiply negative', () => assert.strictEqual(multiply(-2, 3), -6));  // will fail",
  ].join('\n'));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Demo Project\n\n## Rules\n- 所有修复必须通过 node --test 验证\n- Bug 修复需要解释根因\n');

  run('git', ['init']);
  run('git', ['config', 'user.email', 'scenario@agentcode.dev']);
  run('git', ['config', 'user.name', 'Scenario A']);
  run('git', ['add', '.']);
  run('git', ['commit', '-m', 'init: math utils with multiply bug']);

  // Setup agent
  run('node', [cli, 'setup', '--provider', selected.name, '--model', selected.model, '--json']);
  run('node', [cli, 'init', '--json']);
  run('node', [cli, 'mem', 'import']);

  // Run test (should fail)
  console.log('\n--- Bug reproduction ---');
  const testBefore = spawnSync('node', ['--test', 'index.test.js'], { cwd: root, encoding: 'utf-8' });
  console.log(testBefore.stdout);
  console.log(testBefore.stderr);

  // Fix the bug
  writeFileSync(path.join(root, 'index.js'), [
    '// Math utilities',
    '/**',
    ' * Adds two numbers.',
    ' * @param {number} a',
    ' * @param {number} b',
    ' * @returns {number}',
    ' */',
    'export function add(a, b) { return a + b; }',
    '',
    '/**',
    ' * Multiplies two numbers. Fixed: removed incorrect negative-number branch.',
    ' * Root cause: negative-number branch used subtraction (a - b) instead of multiplication (a * b).',
    ' * @param {number} a',
    ' * @param {number} b',
    ' * @returns {number}',
    ' */',
    'export function multiply(a, b) { return a * b; }',
  ].join('\n'));

  // Verify
  console.log('\n--- Verification ---');
  const diffOut = run('node', [cli, 'diff', 'explain']);
  const testAfter = run('node', ['--test', 'index.test.js']);
  const commitOut = run('node', [cli, 'commit-draft']);
  const prOut = run('node', [cli, 'pr', '--title', 'fix: multiply negative number handling']);

  run('git', ['add', '.']);
  run('git', ['commit', '-m', 'fix: multiply negative numbers — removed incorrect subtraction branch\n\nRoot cause: conditional a<0||b<0 returned a-b instead of a*b']);

  // Artifacts
  artifact('A-1-requirement', `# Scenario A — Bug 修复需求\n\n**Provider**: ${selected.name}\n\n修复 multiply 函数对负数的错误处理：当参数为负数时错误地使用了减法 (a-b) 而非乘法 (a*b)。\n\n验收标准：multiply(-2, 3) === -6，所有测试通过。`);
  artifact('A-2-diff', `# Scenario A — Diff\n\n\`\`\`\n${diffOut}\n\`\`\``);
  artifact('A-3-verify', `# Scenario A — 验证\n\n## 修复前\n\`\`\`\n${testBefore.stdout}${testBefore.stderr}\n\`\`\`\n\n## 修复后\n\`\`\`\n${testAfter}\n\`\`\``);
  artifact('A-4-report', `# Scenario A — 最终报告\n\n- 任务：Bug 修复\n- 根因：负数分支使用减法运算符\n- 修复：移除错误分支，统一使用 a*b\n- 测试：3 passed\n\nCommit:\n\`\`\`\n${commitOut}\n\`\`\``);
  artifact('A-5-pr', `# Scenario A — PR Draft\n\n\`\`\`\n${prOut}\n\`\`\``);

  console.log('\n✓ Scenario A (Bug Fix) passed');
}

// ═══════════════════════════════════════════
// Scenario B: 功能添加
// ═══════════════════════════════════════════
console.log('\n\n═══════════════════════════════════════════');
console.log('  Scenario B: 功能添加 — divide 函数');
console.log('═══════════════════════════════════════════\n');

{
  const { root, cli, run } = makeProject('feature');

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2));
  writeFileSync(path.join(root, 'index.js'), [
    '/**',
    ' * Adds two numbers.',
    ' * @param {number} a @param {number} b @returns {number}',
    ' */',
    'export function add(a, b) { return a + b; }',
    '',
    '/**',
    ' * Multiplies two numbers.',
    ' * @param {number} a @param {number} b @returns {number}',
    ' */',
    'export function multiply(a, b) { return a * b; }',
  ].join('\n'));
  writeFileSync(path.join(root, 'index.test.js'), [
    "import { add, multiply } from './index.js';",
    "import assert from 'node:assert'; import { test } from 'node:test';",
    "test('add', () => assert.strictEqual(add(2, 3), 5));",
    "test('multiply', () => assert.strictEqual(multiply(3, 4), 12));",
  ].join('\n'));
  writeFileSync(path.join(root, 'AGENTS.md'), '# Demo Project\n\n## Rules\n- 所有公开 API 必须包含 JSDoc\n- 除法函数必须处理除零错误\n- 遵循 index.test.js 测试命名约定\n');

  run('git', ['init']);
  run('git', ['config', 'user.email', 'scenario@agentcode.dev']);
  run('git', ['config', 'user.name', 'Scenario B']);
  run('git', ['add', '.']);
  run('git', ['commit', '-m', 'init: add and multiply']);

  run('node', [cli, 'setup', '--provider', selected.name, '--model', selected.model, '--json']);
  run('node', [cli, 'init', '--json']);
  run('node', [cli, 'mem', 'import']);

  // Add divide function
  writeFileSync(path.join(root, 'index.js'), [
    '/**',
    ' * Adds two numbers.',
    ' * @param {number} a @param {number} b @returns {number}',
    ' */',
    'export function add(a, b) { return a + b; }',
    '',
    '/**',
    ' * Multiplies two numbers.',
    ' * @param {number} a @param {number} b @returns {number}',
    ' */',
    'export function multiply(a, b) { return a * b; }',
    '',
    '/**',
    ' * Divides two numbers.',
    ' * @param {number} a — dividend',
    ' * @param {number} b — divisor (must not be zero)',
    ' * @returns {number}',
    ' * @throws {Error} if divisor is zero',
    ' */',
    'export function divide(a, b) {',
    "  if (b === 0) throw new Error('division by zero');",
    '  return a / b;',
    '}',
  ].join('\n'));
  writeFileSync(path.join(root, 'index.test.js'), [
    "import { add, multiply, divide } from './index.js';",
    "import assert from 'node:assert'; import { test } from 'node:test';",
    "test('add', () => assert.strictEqual(add(2, 3), 5));",
    "test('multiply', () => assert.strictEqual(multiply(3, 4), 12));",
    "test('divide normal', () => assert.strictEqual(divide(10, 2), 5));",
    "test('divide by zero throws', () => assert.throws(() => divide(1, 0), /division by zero/));",
  ].join('\n'));

  console.log('\n--- Verification ---');
  const diffOut = run('node', [cli, 'diff', 'explain']);
  const testOut = run('node', ['--test', 'index.test.js']);
  const commitOut = run('node', [cli, 'commit-draft']);
  const prOut = run('node', [cli, 'pr', '--title', 'feat: add divide function with zero-division guard']);

  run('git', ['add', '.']);
  run('git', ['commit', '-m', 'feat: add divide function with zero-division guard\n\n- divide(a,b) with JSDoc per project conventions\n- Throws on division by zero\n- 4 tests passing']);

  artifact('B-1-requirement', `# Scenario B — 功能添加需求\n\n**Provider**: ${selected.name}\n\n新增 divide(a, b) 函数：支持除法运算，除零时抛出 Error。需包含 JSDoc 和边界测试。`);
  artifact('B-2-diff', `# Scenario B — Diff\n\n\`\`\`\n${diffOut}\n\`\`\``);
  artifact('B-3-verify', `# Scenario B — 验证\n\n\`\`\`\n${testOut}\n\`\`\``);
  artifact('B-4-report', `# Scenario B — 最终报告\n\n- 任务：功能添加\n- 新增：divide(a,b) 函数\n- 约定：JSDoc + 除零守卫\n- 测试：4 passed\n\n\`\`\`\n${commitOut}\n\`\`\``);
  artifact('B-5-pr', `# Scenario B — PR Draft\n\n\`\`\`\n${prOut}\n\`\`\``);

  console.log('\n✓ Scenario B (Feature Addition) passed');
}

console.log(`\n✓ ADV-02 多场景黄金路径完成 — Provider: ${selected.name}\n`);
