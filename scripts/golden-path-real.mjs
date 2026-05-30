#!/usr/bin/env node
/**
 * G1 — real Provider golden path.
 *
 * Runs a real AI Provider through a small code delivery loop:
 * setup -> init -> memory -> provider patch -> diff -> verify -> repair -> report -> commit.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createProvider } from '../dist/ai/provider.js';

const providers = [
  { name: 'claude', env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6' },
  { name: 'openai', env: 'OPENAI_API_KEY', model: 'gpt-4o' },
  { name: 'deepseek', env: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-pro' },
  { name: 'qwen', env: 'QWEN_API_KEY', model: 'qwen-max' },
];

const selected = providers.find(p => process.env[p.env]);
const artifactDirArg = process.argv.find(arg => arg.startsWith('--artifact-dir='));
if (!selected) {
  console.error('未检测到可用的 AI Provider API Key。请设置 ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY / QWEN_API_KEY。');
  process.exit(1);
}

const root = mkdtempSync(path.join(tmpdir(), 'icloser-golden-real-'));
const cli = path.join(process.cwd(), 'dist', 'index.js');
const requestedArtifactDir = artifactDirArg?.split('=').slice(1).join('=') || process.env.ICLOSER_GOLDEN_ARTIFACT_DIR || path.join(process.cwd(), 'doc', 'golden-path');
const artifactDir = path.resolve(requestedArtifactDir);
mkdirSync(artifactDir, { recursive: true });

const env = {
  ...process.env,
  ICLOSER_HOME: path.join(root, '.icloser-home'),
  XDG_CONFIG_HOME: path.join(root, '.xdg-config'),
  NODE_OPTIONS: '--no-warnings',
};
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

function artifact(name, content) {
  const file = path.join(artifactDir, `${timestamp}-${name}.md`);
  writeFileSync(file, content, 'utf-8');
  console.log(`  → 产物已保存: ${file}`);
  return file;
}

function run(command, args, cwd = root) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8', env, timeout: 180000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const err = new Error(`${label} failed with exit ${result.status}`);
    err.stdout = result.stdout || '';
    err.stderr = result.stderr || '';
    throw err;
  }
  return result.stdout || '';
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`Provider did not return JSON. Output: ${text.slice(0, 300)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function assertSafeChange(change) {
  if (!change || typeof change.file !== 'string' || typeof change.content !== 'string') {
    throw new Error('Provider change item must contain file and content strings');
  }
  const file = change.file.replace(/\\/g, '/');
  if (!['index.js', 'index.test.js'].includes(file)) throw new Error(`Provider attempted to edit non-allowed file: ${change.file}`);
  return file;
}

function applyProviderChanges(responseJson) {
  const changes = Array.isArray(responseJson.changes) ? responseJson.changes : [];
  if (changes.length === 0) throw new Error('Provider returned no code changes');
  const files = new Set();
  for (const change of changes) {
    const file = assertSafeChange(change);
    files.add(file);
    writeFileSync(path.join(root, file), change.content, 'utf-8');
  }
  if (!files.has('index.js') || !files.has('index.test.js')) {
    throw new Error('Provider must update both index.js and index.test.js');
  }
  return changes;
}

async function askProviderForPatch(provider, taskDescription, repairContext = '') {
  const indexSource = readFileSync(path.join(root, 'index.js'), 'utf-8');
  const testSource = readFileSync(path.join(root, 'index.test.js'), 'utf-8');
  const memorySource = readFileSync(path.join(root, 'AGENTS.md'), 'utf-8');
  const prompt = [
    repairContext ? 'Repair the previous patch.' : 'Create a complete patch.',
    'Return only one valid JSON object with this schema:',
    '{"plan":["short step"],"changes":[{"file":"index.js","content":"full file content"},{"file":"index.test.js","content":"full file content"}],"notes":["short note"]}',
    '',
    'Hard requirements:',
    '- Edit only index.js and index.test.js.',
    '- Preserve JavaScript ESM syntax.',
    '- add() and multiply() must accept only finite Number values.',
    '- Non-number, NaN, and Infinity must throw TypeError.',
    '- Public APIs must have JSDoc comments.',
    '- Tests must use node:test and node:assert.',
    '- Add positive tests and negative tests.',
    '',
    `Task: ${taskDescription}`,
    '',
    'Project memory:',
    memorySource,
    '',
    'Current index.js:',
    indexSource,
    '',
    'Current index.test.js:',
    testSource,
    '',
    repairContext,
  ].join('\n');

  const response = await provider.chat({
    systemPrompt: 'You are a senior coding agent. Output only valid JSON. No prose.',
    task: prompt,
    history: '',
    context: {
      projectMeta: 'Small JavaScript ESM package using node:test.',
      relevantCode: [],
      relevantMemory: memorySource,
      totalTokens: 0,
      budgetUsed: 0,
    },
  });
  return { response, json: extractJsonObject(response.content) };
}

console.log(`使用 Provider: ${selected.name} (${selected.model})`);
console.log(`工作目录: ${root}`);

writeFileSync(path.join(root, 'package.json'), JSON.stringify({
  name: 'golden-demo',
  type: 'module',
  scripts: { test: 'node --test index.test.js' },
}, null, 2), 'utf-8');
writeFileSync(path.join(root, '.gitignore'), ['.agent/', '.icloser/', '.icloser-home/', '.xdg-config/', ''].join('\n'), 'utf-8');
writeFileSync(path.join(root, 'index.js'), [
  '// Simple math utilities',
  'export function add(a, b) { return a + b; }',
  'export function multiply(a, b) { return a * b; }',
  '',
].join('\n'), 'utf-8');
writeFileSync(path.join(root, 'index.test.js'), [
  "import { add, multiply } from './index.js';",
  "import assert from 'node:assert';",
  "import { test } from 'node:test';",
  '',
  "test('add', () => { assert.strictEqual(add(1, 2), 3); });",
  "test('multiply', () => { assert.strictEqual(multiply(3, 4), 12); });",
  '',
].join('\n'), 'utf-8');

run('git', ['init']);
run('git', ['config', 'user.email', 'golden-path@agentcode.dev']);
run('git', ['config', 'user.name', 'Golden Path']);
run('git', ['add', '.']);
run('git', ['commit', '-m', 'init: math utilities with tests']);

console.log('\n═══ Step 1: setup + scan + memory ═══');
const setupOutput = run('node', [cli, 'setup', '--provider', selected.name, '--model', selected.model, '--json']);
const initOutput = run('node', [cli, 'init', '--json']);
writeFileSync(path.join(root, 'AGENTS.md'), [
  '# golden-demo Agent Memory',
  '',
  '## Persistent Rules',
  '- 所有公开 API 必须包含 JSDoc 注释。',
  '- 数学函数必须处理 NaN/Infinity 边界情况。',
  '- 测试文件名遵循 index.test.js 约定（非 .spec.js）。',
  '',
].join('\n'), 'utf-8');
const memImport = run('node', [cli, 'mem', 'import']);
const memUsed = run('node', [cli, 'mem', 'used', '为 add 和 multiply 函数添加参数校验']);

console.log('\n═══ Step 2: real provider patch ═══');
const taskDescription = '为 math 模块的 add 和 multiply 函数添加参数校验：参数必须为有限 Number，否则抛出 TypeError';
const provider = createProvider({
  provider: selected.name,
  model: selected.model,
  apiKey: process.env[selected.env],
  maxTokens: 4096,
  temperature: 0.1,
});
const aiPatch = await askProviderForPatch(provider, taskDescription);
const aiChanges = applyProviderChanges(aiPatch.json);

console.log('\n═══ Step 3: diff + verify + repair ═══');
const diffOutput = run('node', [cli, 'diff', 'explain']);
const diffExplainOutput = run('node', [cli, 'explain-diff']);
let repairRounds = 0;
let repairTranscript = '';
let testResult = '';
try {
  testResult = run('node', ['--test', 'index.test.js']);
} catch (err) {
  repairRounds = 1;
  repairTranscript += `Round 1 failed:\n${err.message}\n${err.stdout || ''}\n${err.stderr || ''}\n`;
  const repair = await askProviderForPatch(provider, taskDescription, [
    'Previous patch failed verification.',
    `Error: ${err.message}`,
    'Return a corrected full-file JSON patch.',
  ].join('\n'));
  applyProviderChanges(repair.json);
  repairTranscript += `Provider repair response:\n${repair.response.content.slice(0, 4000)}\n`;
  testResult = run('node', ['--test', 'index.test.js']);
}

console.log('\n═══ Step 4: report + commit ═══');
const commitDraft = run('node', [cli, 'commit-draft']);
const prDraft = run('node', [cli, 'pr', '--title', `feat: ${taskDescription}`]);
run('git', ['add', '.']);
run('git', ['commit', '-m', `feat: add input validation to math utilities

- Generated by real ${selected.name} provider
- add() and multiply() validate finite number arguments
- Added JSDoc and boundary tests`]);

console.log('\n═══ G1 产物归档 ═══');
artifact('1-requirement', [
  '# G1 Real Provider 产物 1 — 输入需求',
  '',
  `**Provider**: ${selected.name} (${selected.model})`,
  '**证据等级**: real provider（Provider 生成计划与代码变更）',
  `**时间**: ${new Date().toISOString()}`,
  '',
  '## 任务描述',
  taskDescription,
  '',
  '## 验收标准',
  '- [x] add() 和 multiply() 拒绝非有限 Number 参数',
  '- [x] TypeError 明确',
  '- [x] 所有公开 API 包含 JSDoc',
  '- [x] 测试覆盖正向与边界情况',
].join('\n'));

artifact('2-memory-adopted', [
  '# G1 Real Provider 产物 2 — 采用的记忆',
  '',
  '## 记忆召回结果',
  '```',
  memUsed,
  '```',
  '',
  '## setup/init 证据',
  '```json',
  setupOutput.slice(0, 1200),
  initOutput.slice(0, 1200),
  '```',
  '',
  '## mem import 证据',
  '```',
  memImport,
  '```',
].join('\n'));

artifact('3-plan', [
  '# G1 Real Provider 产物 3 — AI 计划',
  '',
  '## Provider 计划',
  ...(Array.isArray(aiPatch.json.plan) ? aiPatch.json.plan.map((item, idx) => `${idx + 1}. ${item}`) : ['Provider 未返回 plan 数组']),
  '',
  '## Provider 原始响应摘要',
  '```',
  aiPatch.response.content.slice(0, 4000),
  '```',
].join('\n'));

artifact('4-diff', [
  '# G1 Real Provider 产物 4 — 代码 Diff',
  '',
  '## Diff Explain',
  '```',
  diffOutput,
  '```',
  '',
  '## Provider 变更文件',
  ...aiChanges.map(change => `- \`${change.file}\` — ${change.content.length} chars`),
].join('\n'));

artifact('5-verify', [
  '# G1 Real Provider 产物 5 — 验证日志',
  '',
  '## node --test',
  '```',
  testResult,
  '```',
  '',
  '## Diff 风险评估',
  '```',
  diffExplainOutput,
  '```',
].join('\n'));

artifact('6-repair', [
  '# G1 Real Provider 产物 6 — 修复记录',
  '',
  `修复轮次：${repairRounds}`,
  '',
  '```',
  repairTranscript || '无失败修复，首次验证通过。',
  '```',
].join('\n'));

artifact('7-report', [
  '# G1 Real Provider 产物 7 — 最终报告',
  '',
  `- 任务：${taskDescription}`,
  `- Provider：${selected.name}`,
  `- Model：${selected.model}`,
  '- 证据等级：real provider',
  '- 变更文件：index.js, index.test.js',
  '- 验证：node --test index.test.js 通过',
  `- 修复轮次：${repairRounds}`,
].join('\n'));

artifact('8-commit', [
  '# G1 Real Provider 产物 8 — Commit / PR',
  '',
  '## Commit Draft',
  '```',
  commitDraft,
  '```',
  '',
  '## PR Draft',
  '```',
  prDraft,
  '```',
].join('\n'));

console.log(`\n✓ G1 real-provider 黄金路径通过 — Provider: ${selected.name} (${selected.model})`);
console.log(`  产物目录: ${artifactDir}`);
console.log(`  工作目录: ${root}`);
