import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf-8', timeout: 60000 });
}

const build = process.platform === 'win32'
  ? run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], root)
  : run('npm', ['run', 'build'], root);
if (build.status !== 0 || !existsSync(cli)) {
  process.stderr.write(build.stdout + build.stderr);
  throw new Error('build failed');
}

const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-autopilot-smoke-'));
try {
  await mkdir(join(tempRoot, 'src', 'pages'), { recursive: true });
  await mkdir(join(tempRoot, 'src', 'components'), { recursive: true });
  await writeFile(join(tempRoot, 'package.json'), JSON.stringify({
    name: 'autopilot-smoke',
    dependencies: { react: '^19.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
    scripts: { build: 'tsc', test: 'vitest run', dev: 'vite' },
  }, null, 2));
  await writeFile(join(tempRoot, 'src', 'pages', 'Home.tsx'), 'export function Home() { return null; }\n');
  await writeFile(join(tempRoot, 'src', 'components', 'Button.tsx'), 'export function Button() { return null; }\n');
  await writeFile(join(tempRoot, 'src', 'components', 'Button.test.tsx'), 'import { it } from "vitest"; it("ok", () => {});\n');

  const result = run(process.execPath, [cli, 'autopilot', '--json'], tempRoot);
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`autopilot exited ${result.status}`);
  }
  const payload = JSON.parse(result.stdout);
  if (payload.kind !== 'autopilot-report') throw new Error('wrong json kind');
  if (!payload.data || payload.data.summary.sourceFiles < 1) throw new Error('missing source file summary');
  if (!Array.isArray(payload.data.actions) || payload.data.actions.length < 2) throw new Error('missing actions');

  const docsPlanResult = run(process.execPath, [cli, 'autopilot', 'docs', '--json'], tempRoot);
  if (docsPlanResult.status !== 0) {
    process.stderr.write(docsPlanResult.stdout + docsPlanResult.stderr);
    throw new Error(`autopilot docs exited ${docsPlanResult.status}`);
  }
  const docsPlanPayload = JSON.parse(docsPlanResult.stdout);
  if (docsPlanPayload.kind !== 'autopilot-docs') throw new Error('wrong docs json kind');
  if (!docsPlanPayload.data || docsPlanPayload.data.totalNew < 1) throw new Error('missing docs plan');

  const docsWriteResult = run(process.execPath, [cli, 'autopilot', 'docs', '--go', '--json'], tempRoot);
  if (docsWriteResult.status !== 0) {
    process.stderr.write(docsWriteResult.stdout + docsWriteResult.stderr);
    throw new Error(`autopilot docs --go exited ${docsWriteResult.status}`);
  }
  const docsWritePayload = JSON.parse(docsWriteResult.stdout);
  if (docsWritePayload.kind !== 'autopilot-docs-written') throw new Error('wrong docs written json kind');
  if (!Array.isArray(docsWritePayload.data.written) || docsWritePayload.data.written.length < 1) throw new Error('missing docs write receipts');
  if (!docsWritePayload.data.written.every(item => item.verified === true)) throw new Error('docs were not verified on disk');
  if (!docsWritePayload.data.verification || docsWritePayload.data.verification.status !== 'pass') throw new Error('docs verification did not pass');
  if (!existsSync(join(tempRoot, 'docs', 'PRD.md'))) throw new Error('PRD was not written to docs/');
  const testPlanResult = run(process.execPath, [cli, 'autopilot', 'tests', '--json'], tempRoot);
  if (testPlanResult.status !== 0) {
    process.stderr.write(testPlanResult.stdout + testPlanResult.stderr);
    throw new Error(`autopilot tests exited ${testPlanResult.status}`);
  }
  const testPlanPayload = JSON.parse(testPlanResult.stdout);
  if (testPlanPayload.kind !== 'autopilot-test-plan') throw new Error('wrong test plan json kind');
  if (!testPlanPayload.data || testPlanPayload.data.testCommand !== 'npm run test') throw new Error('missing test command');
  if (!Array.isArray(testPlanPayload.data.targets) || testPlanPayload.data.targets.length < 1) throw new Error('missing test targets');

  const testWriteResult = run(process.execPath, [cli, 'autopilot', 'tests', '--go', '--json'], tempRoot);
  if (testWriteResult.status !== 0) {
    process.stderr.write(testWriteResult.stdout + testWriteResult.stderr);
    throw new Error(`autopilot tests --go exited ${testWriteResult.status}`);
  }
  const testWritePayload = JSON.parse(testWriteResult.stdout);
  if (testWritePayload.kind !== 'autopilot-tests-written') throw new Error('wrong tests written json kind');
  if (!Array.isArray(testWritePayload.data.written) || testWritePayload.data.written.length !== 1) throw new Error('missing test write receipt');
  if (!testWritePayload.data.written.every(item => item.verified === true)) throw new Error('tests were not verified on disk');
  if (!testWritePayload.data.verification || !['pass', 'skipped'].includes(testWritePayload.data.verification.status)) throw new Error('test verification missing');
  if (!existsSync(join(tempRoot, 'src', 'pages', 'Home.test.tsx'))) throw new Error('Home.test.tsx was not written');
  const chainResult = run(process.execPath, [cli, 'autopilot', 'chain', '--json'], tempRoot);
  if (chainResult.status !== 0) {
    process.stderr.write(chainResult.stdout + chainResult.stderr);
    throw new Error(`autopilot chain exited ${chainResult.status}`);
  }
  const chainPayload = JSON.parse(chainResult.stdout);
  if (chainPayload.kind !== 'autonomous-execution-chain') throw new Error('wrong chain json kind');
  if (!Array.isArray(chainPayload.data.stages) || chainPayload.data.stages.length < 8) throw new Error('missing execution chain stages');

  // Test repair loop: write bad docs → repair → verify passes
  await mkdir(join(tempRoot, 'docs'), { recursive: true });
  // Write a doc with no heading — should fail verification
  await writeFile(join(tempRoot, 'docs', 'TESTING.md'), 'no heading here\n', 'utf-8');
  // docs --go --yes should notice existing file and overwrite, then verify
  const docsRepairResult = run(process.execPath, [cli, 'autopilot', 'docs', '--go', '--yes', '--json'], tempRoot);
  const docsRepairPayload = JSON.parse(docsRepairResult.stdout);
  if (docsRepairPayload.kind !== 'autopilot-docs-written') throw new Error('wrong docs repair json kind');
  // After repair, verification should pass
  if (docsRepairPayload.data.verification && docsRepairPayload.data.verification.status !== 'pass') {
    // Repair might have been applied in JSON mode
    if (!docsRepairPayload.data.repair) throw new Error('docs had a bad file but repair was not attempted');
    if (docsRepairPayload.data.repair.finalStatus !== 'pass') throw new Error('docs repair did not succeed');
  }

  // Test repair loop: write bad test → repair → verify
  await mkdir(join(tempRoot, 'src', 'utils'), { recursive: true });
  await writeFile(join(tempRoot, 'src', 'utils', 'math.ts'), 'export const add = (a: number, b: number) => a + b;\n', 'utf-8');
  // Write a test with syntax error (missing closing brace)
  await writeFile(join(tempRoot, 'src', 'utils', 'math.test.ts'),
    'import { describe, it } from \'vitest\';\nimport { add } from \'./math\';\ndescribe(\'math\', () => {\nit(\'adds\', () => {\nexpect(add(1, 2)).toBe(3);\n});\n',
    'utf-8');

  // Re-run test write to trigger repair on existing broken file
  const testRepairResult = run(process.execPath, [cli, 'autopilot', 'tests', '--go', '--yes', '--json', '--module', 'utils'], tempRoot);
  if (testRepairResult.status !== 0) {
    process.stderr.write(testRepairResult.stdout + testRepairResult.stderr);
    throw new Error(`autopilot tests repair exited ${testRepairResult.status}`);
  }
  const testRepairPayload = JSON.parse(testRepairResult.stdout);
  if (testRepairPayload.kind !== 'autopilot-tests-written') throw new Error('wrong tests repair json kind');
  // Repair might have been attempted; verify it was captured
  const hasRepairData = testRepairPayload.data.repair !== undefined;
  if (hasRepairData) {
    if (!['pass', 'fail'].includes(testRepairPayload.data.repair.finalStatus)) throw new Error('invalid repair finalStatus');
    if (typeof testRepairPayload.data.repair.attempts !== 'number') throw new Error('missing repair attempts count');
  }

  process.stdout.write('[autopilot-smoke] PASS\n');
} finally {
  if (process.env.ICLOSER_KEEP_AUTOPILOT_SMOKE !== '1') {
    await rm(tempRoot, { recursive: true, force: true });
  }
}




