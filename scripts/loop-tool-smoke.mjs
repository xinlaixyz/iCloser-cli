import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf-8', timeout: 120000 });
}

// 1. Build
const build = process.platform === 'win32'
  ? run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], root)
  : run('npm', ['run', 'build'], root);
if (build.status !== 0 || !existsSync(cli)) {
  process.stderr.write(build.stdout + build.stderr);
  throw new Error('build failed');
}

const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-loop-smoke-'));
try {
  // 2. Create a realistic test project with source files and missing docs
  await mkdir(join(tempRoot, 'src', 'pages'), { recursive: true });
  await mkdir(join(tempRoot, 'src', 'utils'), { recursive: true });
  await writeFile(join(tempRoot, 'package.json'), JSON.stringify({
    name: 'loop-smoke',
    dependencies: { react: '^19.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
    scripts: { build: 'tsc', test: 'vitest run', dev: 'vite' },
  }, null, 2));
  await writeFile(join(tempRoot, 'src', 'pages', 'Home.tsx'), 'export function Home() { return null; }\n');
  await writeFile(join(tempRoot, 'src', 'utils', 'math.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  await writeFile(join(tempRoot, 'src', 'utils', 'math.test.ts'), 'import { it, expect } from "vitest"; import { add } from "./math"; it("adds two numbers", () => { expect(add(1, 2)).toBe(3); });\n');

  // Setup mock provider
  const setup = run(process.execPath, [cli, 'setup', '--mock', '--json'], tempRoot);
  if (setup.status !== 0) {
    process.stderr.write(setup.stdout + setup.stderr);
    throw new Error(`setup exited ${setup.status}`);
  }
  const setupPayload = JSON.parse(setup.stdout);
  if (setupPayload.kind !== 'setup') throw new Error('wrong setup json kind');

  // 3. Verify ic auto chain outputs the three-step loop × five-tool matrix
  const chainResult = run(process.execPath, [cli, 'auto', 'chain', '--json'], tempRoot);
  if (chainResult.status !== 0) {
    process.stderr.write(chainResult.stdout + chainResult.stderr);
    throw new Error(`auto chain exited ${chainResult.status}`);
  }
  const chainPayload = JSON.parse(chainResult.stdout);
  if (chainPayload.kind !== 'autonomous-execution-chain') throw new Error('wrong chain json kind');

  const { taskLoop } = chainPayload.data;
  if (!taskLoop || taskLoop.version !== 1) throw new Error('missing taskLoop in chain output');
  if (taskLoop.steps.length !== 3) throw new Error('expected 3 loop steps');
  if (taskLoop.toolCategories.length !== 5) throw new Error('expected 5 tool categories');

  const stepIds = taskLoop.steps.map(s => s.id);
  if (stepIds[0] !== 'collect-context' || stepIds[1] !== 'take-action' || stepIds[2] !== 'verify-result') {
    throw new Error('loop steps out of order');
  }

  const toolIds = taskLoop.toolCategories.map(t => t.id);
  const expectedTools = ['file-ops', 'search', 'command', 'web-search', 'code-intelligence'];
  if (JSON.stringify(toolIds) !== JSON.stringify(expectedTools)) throw new Error('wrong tool categories');

  // 4. Verify collect-context → take-action → verify-result tool bindings
  const byStep = {};
  for (const step of taskLoop.steps) byStep[step.id] = step.requiredToolCategories;
  if (JSON.stringify(byStep['collect-context']) !== JSON.stringify(['file-ops', 'search', 'web-search', 'code-intelligence'])) {
    throw new Error('collect-context tools mismatch');
  }
  if (JSON.stringify(byStep['take-action']) !== JSON.stringify(['file-ops', 'search', 'command'])) {
    throw new Error('take-action tools mismatch');
  }
  if (JSON.stringify(byStep['verify-result']) !== JSON.stringify(['file-ops', 'search', 'command', 'code-intelligence'])) {
    throw new Error('verify-result tools mismatch');
  }

  // 5. Verify Chinese human-readable chain rendering includes basic structure
  const chainText = run(process.execPath, [cli, 'auto', 'chain'], tempRoot);
  if (chainText.status !== 0) {
    process.stderr.write(chainText.stdout + chainText.stderr);
    throw new Error(`auto chain text exited ${chainText.status}`);
  }
  const text = chainText.stdout;
  // Chain rendering covers Chinese user-facing stages
  if (!text.includes('理解用户目标')) throw new Error('missing understand stage');
  if (!text.includes('自动验证')) throw new Error('missing verify stage');
  if (!text.includes('修复')) throw new Error('missing repair stage');
  if (!text.includes('回滚')) throw new Error('missing rollback stage');

  // 6. Exercise the real loop: ic auto docs --go (collect-context → take-action → verify-result)
  const docsResult = run(process.execPath, [cli, 'auto', 'docs', '--go', '--json'], tempRoot);
  if (docsResult.status !== 0) {
    process.stderr.write(docsResult.stdout + docsResult.stderr);
    throw new Error(`auto docs --go exited ${docsResult.status}`);
  }
  const docsPayload = JSON.parse(docsResult.stdout);
  if (docsPayload.kind !== 'autopilot-docs-written') throw new Error('wrong docs written json kind');
  if (!docsPayload.data.verification || docsPayload.data.verification.status !== 'pass') {
    throw new Error('docs verification did not pass after loop');
  }
  if (!Array.isArray(docsPayload.data.written) || docsPayload.data.written.length < 1) {
    throw new Error('no docs were written');
  }
  for (const receipt of docsPayload.data.written) {
    if (receipt.verified !== true) throw new Error(`doc ${receipt.file} was not verified on disk`);
    if (!existsSync(join(tempRoot, receipt.file))) throw new Error(`doc ${receipt.file} missing on disk`);
  }

  // 7. Tool registry covered by chain JSON + unit tests; smoke focuses on end-to-end

  process.stdout.write('[loop-smoke] PASS\n');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
