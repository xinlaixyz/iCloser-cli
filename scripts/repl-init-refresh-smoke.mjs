// S3.10 REPL init/scan refresh smoke
// Starts REPL in an uninitialized project and verifies /init persists config + index.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

let outputBuffer = '';
let lastLines = [];
let stepResults = { ok: 0, fail: 0 };

function log(msg) {
  process.stdout.write(`\n[repl-init-smoke] ${msg}\n`);
}

function assert(condition, desc) {
  if (condition) {
    stepResults.ok++;
    log(`PASS: ${desc}`);
    return;
  }
  stepResults.fail++;
  log(`FAIL: ${desc}`);
  for (const line of lastLines.slice(-80)) {
    process.stderr.write(`  ${line}\n`);
  }
  throw new Error(`Assertion failed: ${desc}`);
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function main() {
  log('building...');
  if (process.platform === 'win32') {
    spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  } else {
    spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  }
  if (!existsSync(cli)) throw new Error('dist/index.js not found after build.');

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-repl-init-smoke-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');

  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'repl-init-refresh-test',
      scripts: { build: 'node -e "1"', test: 'node -e "1"' },
    }), 'utf-8');
    await writeFile(join(project, 'index.ts'), 'export const smoke = true;\n', 'utf-8');

    const replEnv = {
      ...process.env,
      ICLOSER_HOME: home,
      HOME: home,
      USERPROFILE: home,
    };

    log('spawning REPL in uninitialized project...');
    const child = spawn(process.execPath, [cli], {
      cwd: project,
      env: replEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
    });

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    let stderrData = '';

    child.stdout.on('data', chunk => {
      outputBuffer += chunk;
      for (const line of chunk.split('\n')) {
        if (line.trim()) lastLines.push(line.trim());
        if (lastLines.length > 200) lastLines = lastLines.slice(-200);
      }
    });
    child.stderr.on('data', chunk => {
      stderrData += chunk;
    });

    function sendInput(text) {
      log(`send: ${text}`);
      child.stdin.write(text + '\n');
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    await sleep(4000);
    assert(outputBuffer.includes('icloser') || outputBuffer.includes('◇'), 'REPL started');
    assert(!existsSync(join(project, '.icloser', 'icloser.json')), 'Project starts uninitialized');

    log('STEP 1: /doctor before init');
    const beforeDoctor = outputBuffer.length;
    sendInput('/doctor');
    await sleep(2000);
    const doctorBefore = stripAnsi(outputBuffer.substring(beforeDoctor));
    assert(doctorBefore.includes('未初始化') || doctorBefore.includes('/init'), '/doctor suggests init before project is initialized');

    log('STEP 2: /init');
    sendInput('/init');
    await sleep(5000);
    assert(existsSync(join(project, '.icloser', 'icloser.json')), '/init writes .icloser/icloser.json');
    assert(existsSync(join(project, '.icloser', 'index.json')), '/init writes .icloser/index.json');

    log('STEP 3: /doctor after init');
    const afterInitDoctorStart = outputBuffer.length;
    sendInput('/doctor');
    await sleep(2000);
    const doctorAfter = stripAnsi(outputBuffer.substring(afterInitDoctorStart));
    assert(doctorAfter.includes('已初始化'), '/doctor sees initialized project after /init');
    assert(doctorAfter.includes('已生成'), '/doctor sees generated index after /init');

    log('STEP 4: /scan refresh');
    sendInput('/scan');
    await sleep(4000);
    assert(existsSync(join(project, '.icloser', 'index.json')), '/scan keeps index persisted');

    log('STEP 5: /exit');
    sendInput('/exit');
    const exitCode = await new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(-1);
      }, 10000);
      child.on('close', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert(exitCode === 0, `/exit results in clean exit (code=${exitCode})`);

    assert(!stripAnsi(stderrData).includes('API Key'), 'stderr does not leak API Key text');
    log(`\n=== RESULTS: ${stepResults.ok} passed, ${stepResults.fail} failed ===`);
  } finally {
    if (process.env.ICLOSER_KEEP_REPL_INIT_SMOKE !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[repl-init-smoke] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
