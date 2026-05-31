import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');
const npmCmd = process.platform === 'win32' ? 'cmd.exe' : 'npm';

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  process.stdout.write(`\n[project-smoke] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf-8',
    timeout: options.timeout || 120000,
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return run(npmCmd, ['/d', '/s', '/c', ['npm', ...args].join(' ')], options);
  }
  return run(npmCmd, args, options);
}

function runJson(args, cwd, env) {
  const stdout = run(process.execPath, [cli, ...args], { cwd, env });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Command did not produce parseable JSON: ic ${args.join(' ')}\n${stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeFixture(project) {
  await mkdir(join(project, 'src'), { recursive: true });
  await mkdir(join(project, 'scripts'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'icloser-real-project-smoke',
    version: '0.0.0',
    type: 'module',
    scripts: {
      build: 'node scripts/check-build.mjs',
      lint: 'node scripts/check-lint.mjs',
      test: 'node scripts/check-test.mjs',
    },
    devDependencies: {
      typescript: '^5.7.0',
    },
  }, null, 2), 'utf-8');
  await writeFile(join(project, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      strict: true,
      outDir: 'dist',
    },
    include: ['src/**/*.ts'],
  }, null, 2), 'utf-8');
  await writeFile(join(project, 'src', 'math.ts'), [
    'export function add(a: number, b: number): number {',
    '  return a + b;',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await writeFile(join(project, 'src', 'index.ts'), [
    'import { add } from "./math";',
    '',
    'export const answer = add(20, 22);',
    '',
  ].join('\n'), 'utf-8');
  await writeFile(join(project, 'scripts', 'check-build.mjs'), [
    'import { readFileSync } from "node:fs";',
    'const math = readFileSync("src/math.ts", "utf-8");',
    'if (!math.includes("export function add")) throw new Error("missing add function");',
    'console.log("build ok");',
    '',
  ].join('\n'), 'utf-8');
  await writeFile(join(project, 'scripts', 'check-lint.mjs'), [
    'import { readFileSync } from "node:fs";',
    'for (const file of ["src/math.ts", "src/index.ts"]) {',
    '  const content = readFileSync(file, "utf-8");',
    '  if (/\\t/.test(content)) throw new Error(`${file} contains tab indentation`);',
    '}',
    'console.log("lint ok");',
    '',
  ].join('\n'), 'utf-8');
  await writeFile(join(project, 'scripts', 'check-test.mjs'), [
    'import { readFileSync } from "node:fs";',
    'const math = readFileSync("src/math.ts", "utf-8");',
    'if (!math.includes("icloser mock edit")) throw new Error("mock edit marker missing");',
    'console.log("test ok");',
    '',
  ].join('\n'), 'utf-8');
}

async function main() {
  runNpm(['run', 'build']);
  if (!existsSync(cli)) {
    throw new Error('dist/index.js not found after npm run build.');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-real-project-smoke-'));
  const icloserHome = join(tempRoot, 'home');
  const project = join(tempRoot, 'typescript-project');
  const env = { ICLOSER_HOME: icloserHome, ICLOSER_AI_PROVIDER: 'mock' };

  try {
    await mkdir(project, { recursive: true });
    await writeFixture(project);

    const setup = runJson(['setup', '--mock', '--json'], project, env);
    assert(setup.kind === 'setup', 'setup JSON kind mismatch');
    assert(setup.data.provider === 'mock', 'setup should use mock provider');

    run(process.execPath, [cli, 'init', '--force'], { cwd: project, env });
    run(process.execPath, [cli, 'provider', 'use', 'mock'], { cwd: project, env });

    const doctor = runJson(['doctor', '--strict', '--json'], project, env);
    assert(doctor.kind === 'doctor', 'doctor JSON kind mismatch');
    assert(doctor.data.ready === true, 'doctor should report project ready');
    assert(doctor.data.project.identity.language === 'typescript', 'project should be detected as TypeScript');

    const providerTest = runJson(['provider', 'test', '--json'], project, env);
    assert(providerTest.kind === 'provider-test', 'provider-test JSON kind mismatch');
    assert(providerTest.data.ok === true, 'mock provider test should pass');

    run(process.execPath, [cli, 't', '修改 src/math.ts 添加真实项目验收标记', '--go'], {
      cwd: project,
      env,
      timeout: 180000,
    });

    const status = runJson(['status', '--json'], project, env);
    assert(status.kind === 'task-list', 'status JSON kind mismatch');
    assert(status.data.tasks.length > 0, 'expected at least one task');
    const task = status.data.tasks[0];
    assert(task.status === 'completed', `expected completed task, got ${task.status}`);
    assert(task.changes.some(change => change.file === 'src/math.ts'), 'expected src/math.ts change');

    const gate = runJson(['gate', task.id, '--json'], project, env);
    assert(gate.kind === 'gate-result', 'gate JSON kind mismatch');
    assert(gate.data.passed === true, 'gate should pass');

    run(process.execPath, [cli, 'report'], { cwd: project, env });

    const math = await readFile(join(project, 'src', 'math.ts'), 'utf-8');
    assert(math.includes('icloser mock edit'), 'src/math.ts should contain mock edit marker');

    process.stdout.write(`\n[project-smoke] PASS ${task.id}\n`);
    process.stdout.write(`[project-smoke] workspace ${project}\n`);
  } finally {
    if (process.env.ICLOSER_KEEP_PROJECT_SMOKE !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[project-smoke] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
