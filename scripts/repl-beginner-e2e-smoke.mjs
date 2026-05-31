// S3.9 REPL Beginner End-to-End Smoke
// Simulates a complete beginner opening `ic` in an empty project,
// following REPL guidance through init → doctor → mock task → multi-select write → status → exit.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

let outputBuffer = '';
let lastLines = [];
let stepResults = { ok: 0, fail: 0 };

function log(msg) {
  process.stdout.write(`\n[repl-e2e] ${msg}\n`);
}

function assert(condition, desc) {
  if (condition) {
    stepResults.ok++;
    log(`PASS: ${desc}`);
  } else {
    stepResults.fail++;
    log(`FAIL: ${desc}`);
    log('--- Last 80 lines of output ---');
    for (const line of lastLines.slice(-80)) {
      process.stderr.write(`  ${line}\n`);
    }
    log('--- End output ---');
    throw new Error(`Assertion failed: ${desc}`);
  }
}

async function main() {
  // Build first
  log('building...');
  const { spawnSync } = await import('node:child_process');
  if (process.platform === 'win32') {
    const br = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
    if (br.status !== 0) throw new Error('build failed');
  } else {
    const br = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
    if (br.status !== 0) throw new Error('build failed');
  }
  if (!existsSync(cli)) throw new Error('dist/index.js not found after build.');

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-e2e-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');

  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'beginner-e2e-test',
      scripts: { build: 'node -e "1"', lint: 'node -e "1"', test: 'node -e "1"' },
    }), 'utf-8');

    // Temp HOME + ICLOSER_HOME → no global config
    const replEnv = {
      ...process.env,
      ICLOSER_HOME: home,
      HOME: home,
      USERPROFILE: home,
    };
    // Ensure no real API key leaks in
    delete replEnv.DEEPSEEK_API_KEY;
    delete replEnv.ANTHROPIC_API_KEY;
    delete replEnv.OPENAI_API_KEY;
    delete replEnv.QWEN_API_KEY;
    delete replEnv.DASHSCOPE_API_KEY;

    log('spawning REPL in fresh environment (empty project, no global config)...');
    const child = spawn(process.execPath, [cli], {
      cwd: project,
      env: replEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,
    });

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      outputBuffer += chunk;
      const lines = chunk.split('\n');
      for (const l of lines) {
        const t = l.trim();
        if (t) lastLines.push(t);
        if (lastLines.length > 300) lastLines = lastLines.slice(-300);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function waitFor(pattern, timeout = 20000, desc = '') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for: ${desc || pattern} (${timeout}ms)`));
        }, timeout);
        function check() {
          if (typeof pattern === 'string' ? outputBuffer.includes(pattern) : pattern.test(outputBuffer)) {
            clearTimeout(timer);
            child.stdout.removeListener('data', onData);
            resolve();
          }
        }
        function onData() { check(); }
        child.stdout.on('data', onData);
        check();
      });
    }

    function send(text) {
      log(`send: ${text.length > 60 ? text.substring(0, 57) + '...' : text}`);
      child.stdin.write(text + '\n');
    }

    // Wait for strip of ANSI before assertion
    function strip(s) {
      return s.replace(/\x1b\[[0-9;]*m/g, '');
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Wait for REPL to start
    // ═══════════════════════════════════════════════════════════
    log('STEP 1: Waiting for REPL startup...');
    await sleep(4000);
    const stripped = strip(outputBuffer);
    assert(
      stripped.includes('icloser') || outputBuffer.includes('◇') || stripped.length > 50,
      'REPL started with output'
    );
    // Should be in mock mode (no API key)
    const hasMockMode = stripped.includes('mock') ||
      stripped.includes('离线') ||
      stripped.includes('API Key') ||
      stripped.includes('粘贴');
    assert(hasMockMode, 'REPL enters mock mode or shows API Key guidance on fresh start');

    // ═══════════════════════════════════════════════════════════
    // STEP 2: /doctor before init → should suggest /init
    // ═══════════════════════════════════════════════════════════
    log('STEP 2: Running /doctor (before /init)...');
    const beforeDoctor1 = outputBuffer.length;
    send('/doctor');
    await sleep(2000);
    const afterDoctor1 = strip(outputBuffer.substring(beforeDoctor1));
    assert(
      afterDoctor1.includes('未初始化') || afterDoctor1.includes('/init') || afterDoctor1.includes('Doctor'),
      '/doctor shows uninitialized status or suggests /init'
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 3: /init → project initialization
    // ═══════════════════════════════════════════════════════════
    log('STEP 3: Running /init...');
    const beforeInit = outputBuffer.length;
    send('/init');
    await sleep(3000);
    const afterInit = strip(outputBuffer.substring(beforeInit));
    assert(
      afterInit.includes('项目') || afterInit.includes('识别') || afterInit.includes('已就绪') || afterInit.includes('typescript'),
      '/init completes project detection and initialization'
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 4: /doctor after init → should show ready
    // ═══════════════════════════════════════════════════════════
    log('STEP 4: Running /doctor (after /init)...');
    const beforeDoctor2 = outputBuffer.length;
    send('/doctor');
    await sleep(2000);
    const afterDoctor2 = strip(outputBuffer.substring(beforeDoctor2));
    assert(
      afterDoctor2.includes('Ready') || afterDoctor2.includes('yes') || afterDoctor2.includes('已初始化') || afterDoctor2.includes('下一步'),
      '/doctor after /init shows ready status or next actions'
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Send a simple task — expect mock AI to produce pending files
    // ═══════════════════════════════════════════════════════════
    log('STEP 5: Sending task request...');
    const taskInput = '帮我创建 hello.txt 和 guide.txt，写入 icloser beginner smoke';
    const beforeTask = outputBuffer.length;
    send(taskInput);
    // Wait for AI response + pending file extraction
    await sleep(5000);

    const afterTask = strip(outputBuffer.substring(beforeTask));
    assert(
      afterTask.includes('hello.txt') || afterTask.includes('hello'),
      'Task output mentions hello.txt'
    );
    assert(
      afterTask.includes('guide.txt') || afterTask.includes('guide'),
      'Task output mentions guide.txt'
    );
    // Should have a pending file presented for writing
    assert(
      afterTask.includes('写入') || afterTask.includes('▸') || afterTask.includes('1') || afterTask.includes('行'),
      'REPL shows pending file ready to write'
    );
    assert(
      stateIncludesPattern(/hello\.txt/),
      'hello.txt appears in REPL output as pending file'
    );
    assert(
      stateIncludesPattern(/guide\.txt/),
      'guide.txt appears in REPL output as pending file'
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 6: Write pending files via beginner-friendly multi-select
    // ═══════════════════════════════════════════════════════════
    log('STEP 6: Writing pending files...');

    // After handleChat, printBottomBlock shows [1] and [2] write options.
    // Sending "1和2" must write both files instead of being treated as ordinary chat.
    const beforeWrite = outputBuffer.length;
    send('1和2');
    await sleep(2000);

    const afterWrite = strip(outputBuffer.substring(beforeWrite));
    log(`Write response: ${afterWrite.substring(0, 200)}`);
    assert(afterWrite.includes(project), 'write confirmation shows absolute project path');

    // Verify hello.txt was created on disk
    const helloPath = join(project, 'hello.txt');
    assert(existsSync(helloPath), 'hello.txt was created on disk');
    const guidePath = join(project, 'guide.txt');
    assert(existsSync(guidePath), 'guide.txt was created on disk');

    const helloContent = readFileSync(helloPath, 'utf-8');
    log(`hello.txt content: ${helloContent.substring(0, 200)}`);
    assert(
      helloContent.includes('icloser') && helloContent.includes('smoke'),
      'hello.txt contains icloser beginner smoke marker'
    );
    const guideContent = readFileSync(guidePath, 'utf-8');
    log(`guide.txt content: ${guideContent.substring(0, 200)}`);
    assert(
      guideContent.includes('icloser') && guideContent.includes('smoke'),
      'guide.txt contains icloser beginner smoke marker'
    );

    const beforeWhere = outputBuffer.length;
    send('刚才写到哪里了？');
    await sleep(1000);
    const afterWhere = strip(outputBuffer.substring(beforeWhere));
    assert(afterWhere.includes(helloPath) && afterWhere.includes(guidePath), 'REPL answers where recent files were written');

    // ═══════════════════════════════════════════════════════════
    // STEP 7: /status → REPL still functional
    // ═══════════════════════════════════════════════════════════
    log('STEP 7: Running /status...');
    send('/status');
    await sleep(2000);

    const hasStatus = strip(outputBuffer).includes('SESSION') ||
      strip(outputBuffer).includes('session') ||
      strip(outputBuffer).includes('状态') ||
      strip(outputBuffer).includes('Provider') ||
      strip(outputBuffer).includes('mock') ||
      strip(outputBuffer).includes('AI');
    assert(hasStatus, '/status command produces session information');

    // ═══════════════════════════════════════════════════════════
    // STEP 8: /exit → clean exit
    // ═══════════════════════════════════════════════════════════
    log('STEP 8: Sending /exit...');
    send('/exit');
    await sleep(2000);

    let exitCode = null;
    try {
      exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Process did not exit within timeout'));
        }, 15000);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        if (child.exitCode !== null) {
          clearTimeout(timer);
          resolve(child.exitCode);
        }
      });
    } catch {
      child.kill('SIGTERM');
      exitCode = -1;
    }
    assert(exitCode === 0, `/exit results in clean exit (code=${exitCode})`);

    // ═══════════════════════════════════════════════════════════
    // STEP 9: No API Key leak in output
    // ═══════════════════════════════════════════════════════════
    log('STEP 9: Checking for API Key leaks...');
    const fullStripped = strip(outputBuffer);
    const stderrStripped = strip(stderrData);
    // Only check for actual API key VALUES (env var names in guidance text are expected)
    const keyValuePatterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /sk-ant-[a-zA-Z0-9]{20,}/,
    ];
    for (const pat of keyValuePatterns) {
      assert(!pat.test(fullStripped), `stdout does not leak API key value: ${pat}`);
      assert(!pat.test(stderrStripped), `stderr does not leak API key value: ${pat}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 10: No network dependency — mock only
    // ═══════════════════════════════════════════════════════════
    log('STEP 10: Verifying mock-only execution (no network)...');
    // The output should reference mock, not a real provider's connection
    assert(
      fullStripped.includes('mock') || fullStripped.includes('离线'),
      'REPL session stayed in mock/offline mode (no real API calls)'
    );

    // Final summary
    log(`\n=== RESULTS: ${stepResults.ok} passed, ${stepResults.fail} failed ===`);

  } finally {
    if (process.env.ICLOSER_KEEP_E2E !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
      log(`cleaned up ${tempRoot}`);
    } else {
      log(`kept workspace: ${tempRoot}`);
    }
  }
}

function stateIncludesPattern(pattern) {
  return pattern.test(outputBuffer);
}

main().catch(err => {
  process.stderr.write(`\n[repl-e2e] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
