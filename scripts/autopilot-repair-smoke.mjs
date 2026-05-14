import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const build = process.platform === 'win32'
  ? run('cmd.exe', ['/d', '/s', '/c', 'npm run build'], root)
  : run('npm', ['run', 'build'], root);
if (build.status !== 0 || !existsSync(cli)) {
  process.stderr.write(build.stdout + build.stderr);
  throw new Error('build failed');
}

const repair = await import('../dist/core/autopilot-repair.js');
const verify = await import('../dist/core/autopilot-verify.js');
const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-repair-smoke-'));

try {
  await mkdir(join(tempRoot, 'docs'), { recursive: true });
  await mkdir(join(tempRoot, 'src'), { recursive: true });
  await writeFile(join(tempRoot, 'docs', 'PRD.md'), '这里没有一级标题，但有正文。\n', 'utf-8');
  await writeFile(join(tempRoot, 'src', 'broken.test.ts'), 'import { it } from "vitest";\nit("broken", () => {\n', 'utf-8');

  const beforeDocVerify = await verify.verifyAutopilotDocs(tempRoot, ['docs/PRD.md']);
  assert(beforeDocVerify.status === 'fail', 'bad doc should fail before repair');

  const docPlan = repair.buildAutopilotRepairPlan(beforeDocVerify, ['docs/PRD.md']);
  assert(docPlan.kind === 'docs', 'doc repair plan should be docs kind');
  assert(docPlan.autoApply === true, 'high-confidence doc repair should auto apply');

  const docReceipts = await repair.applyAutopilotRepairPlan(tempRoot, docPlan);
  assert(docReceipts.length === 1, 'doc repair should return one receipt');
  assert(docReceipts[0].action === 'updated', 'doc repair should update the bad doc');

  const docContent = await readFile(join(tempRoot, 'docs', 'PRD.md'), 'utf-8');
  assert(docContent.startsWith('# PRD'), 'doc repair should prepend a Markdown title');

  const afterDocVerify = await verify.verifyAutopilotDocs(tempRoot, ['docs/PRD.md']);
  assert(afterDocVerify.status === 'pass', 'doc verification should pass after repair');

  const testReceipt = {
    status: 'fail',
    kind: 'tests',
    command: 'npm run test',
    duration: 1,
    summary: 'SyntaxError: Unexpected end of input',
    stderr: 'SyntaxError: Unexpected end of input',
  };
  const testPlan = repair.buildAutopilotRepairPlan(testReceipt, ['src/broken.test.ts']);
  assert(testPlan.kind === 'tests', 'test repair plan should be tests kind');
  assert(testPlan.autoApply === true, 'high-confidence syntax repair should auto apply');
  const testReceipts = await repair.applyAutopilotRepairPlan(tempRoot, testPlan);
  const testAfter = await readFile(join(tempRoot, 'src', 'broken.test.ts'), 'utf-8');
  assert(testReceipts[0].action === 'updated', 'test syntax repair should update the test file');
  assert((testAfter.match(/}/g) || []).length > 0, 'test syntax repair should add a closing brace');

  let blocked = false;
  try {
    const unsafePlan = repair.buildAutopilotRepairPlan(beforeDocVerify, ['../outside.md']);
    await repair.applyAutopilotRepairPlan(tempRoot, unsafePlan);
  } catch {
    blocked = true;
  }
  assert(blocked, 'repair should reject paths outside the project root');

  process.stdout.write('[repair-smoke] PASS\n');
} finally {
  if (process.env.ICLOSER_KEEP_REPAIR_SMOKE !== '1') {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
