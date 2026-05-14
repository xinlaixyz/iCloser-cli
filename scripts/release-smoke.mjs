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
  process.stdout.write(`\n[smoke] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf-8',
    timeout: options.timeout || 120000,
    shell: options.shell || false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function runJson(args, cwd, env) {
  const stdout = run(process.execPath, [cli, ...args], { cwd, env });
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Command did not produce parseable JSON: ic ${args.join(' ')}\n${stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (process.platform === 'win32') {
    run(npmCmd, ['/d', '/s', '/c', 'npm run build']);
    run(npmCmd, ['/d', '/s', '/c', 'npm run test'], { timeout: 180000 });
  } else {
    run(npmCmd, ['run', 'build']);
    run(npmCmd, ['run', 'test'], { timeout: 180000 });
  }

  if (!existsSync(cli)) {
    throw new Error('dist/index.js not found after npm run build.');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-release-smoke-'));
  const icloserHome = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');
  const env = { ICLOSER_HOME: icloserHome, ICLOSER_AI_PROVIDER: 'mock' };

  try {
    await writeFile(join(tempRoot, '.keep'), 'release smoke\n', 'utf-8');
    await writeFile(join(tempRoot, 'README.txt'), 'temporary smoke workspace\n', 'utf-8');
    await rm(project, { recursive: true, force: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      scripts: {
        build: 'node -e "console.log(\'build ok\')"',
        lint: 'node -e "console.log(\'lint ok\')"',
        test: 'node -e "console.log(\'test ok\')"',
      },
    }), 'utf-8');
    await writeFile(join(project, 'notes.txt'), 'initial\n', 'utf-8');
    await writeFile(join(project, 'index.js'), 'export const ok = "release-smoke";\n', 'utf-8');

    const setup = runJson(['setup', '--mock', '--json'], project, env);
    assert(setup.kind === 'setup', 'setup JSON kind mismatch');

    run(process.execPath, [cli, 'init', '--force'], { cwd: project, env });
    run(process.execPath, [cli, 'provider', 'use', 'mock'], { cwd: project, env });

    const providerTest = runJson(['provider', 'test', '--json'], project, env);
    assert(providerTest.kind === 'provider-test', 'provider-test JSON kind mismatch');
    assert(providerTest.data.ok === true, 'mock provider test should pass');

    const doctor = runJson(['doctor', '--json'], project, env);
    assert(doctor.kind === 'doctor', 'doctor JSON kind mismatch');
    assert(doctor.data.ready === true, 'doctor should report project ready');
    assert(Array.isArray(doctor.data.nextActions), 'doctor nextActions should be an array');

    run(process.execPath, [cli, 't', '修改 notes.txt 添加 release smoke 标记', '--go'], { cwd: project, env, timeout: 180000 });

    const status = runJson(['status', '--json'], project, env);
    assert(status.kind === 'task-list', 'status JSON kind mismatch');
    assert(status.data.tasks.length > 0, 'expected at least one task');
    const task = status.data.tasks[0];
    assert(task.status === 'completed', `expected completed task, got ${task.status}`);

    const gate = runJson(['gate', task.id, '--json'], project, env);
    assert(gate.kind === 'gate-result', 'gate JSON kind mismatch');
    assert(gate.data.passed === true, 'gate should pass');

    run(process.execPath, [cli, 'report'], { cwd: project, env });

    const notes = await readFile(join(project, 'notes.txt'), 'utf-8');
    assert(notes.includes('iCloser mock edit'), 'notes.txt should contain mock edit marker');
    const report = await readFile(join(project, '.icloser', 'tasks', task.id, 'report.md'), 'utf-8');
    assert(report.includes('任务记忆候选'), 'report should include task memory candidates section');
    assert(report.includes('模板'), 'report should include proposed template candidate');
    assert(report.includes('ic mem review'), 'report should guide beginner memory review');

    process.stdout.write(`\n[smoke] PASS ${task.id}\n`);
    process.stdout.write(`[smoke] workspace ${project}\n`);
  } finally {
    if (process.env.ICLOSER_KEEP_SMOKE !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[smoke] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
