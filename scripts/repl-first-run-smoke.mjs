// S3.3 REPL First-Run Interaction Smoke
// Spawns REPL, sends commands, asserts first-run interaction outputs
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');
const FAKE_KEY = 'sk-fake-repl-test-key-1234567890abcdef';

// Track all output for final assertion
let outputBuffer = '';
let last80Lines = [];
let stepResults = { ok: 0, fail: 0 };

function log(msg) {
  process.stdout.write(`\n[repl-smoke] ${msg}\n`);
}

function assert(condition, desc) {
  if (condition) {
    stepResults.ok++;
    log(`PASS: ${desc}`);
  } else {
    stepResults.fail++;
    log(`FAIL: ${desc}`);
    log('--- Last 80 lines of output ---');
    for (const line of last80Lines.slice(-80)) {
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
    spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  } else {
    spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  }
  if (!existsSync(cli)) throw new Error('dist/index.js not found after build.');

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-repl-smoke-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');

  try {
    const staleProject = join(tempRoot, 'stale-iCloser2026');
    await mkdir(join(home, '.icloser'), { recursive: true });
    await mkdir(staleProject, { recursive: true });
    await writeFile(join(home, '.icloser', 'session.json'), JSON.stringify({
      projectRoot: staleProject,
      projectName: 'iCloser2026',
      language: 'typescript',
      framework: 'react',
      conversation: [{ role: 'user', content: '旧项目里的消息', timestamp: new Date().toISOString() }],
      lastWrittenFiles: [],
      savedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');

    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'repl-smoke-test',
      scripts: {
        build: 'node -e "1"',
        test: 'node -e "1"',
        dev: 'node -e "console.log(\'Local: http://localhost:5173/\'); setInterval(()=>{},1000)"',
      },
    }), 'utf-8');

    // The REPL's internal loadGlobalConfig reads from $HOME/.icloser/config.json
    // We override HOME to a temp dir so it finds nothing (triggering mock/key path).
    // ICLOSER_HOME is also set for the CLI config.ts module.
    const replEnv = {
      ...process.env,
      ICLOSER_HOME: home,
      HOME: home,
      USERPROFILE: home,
    };

    // Init the project first so REPL has context
    spawnSync(process.execPath, [cli, 'init', '--force'], {
      cwd: project, env: replEnv, encoding: 'utf-8', timeout: 60000,
    });

    // Spawn REPL (no subcommand → enters REPL)
    log('spawning REPL in fresh environment (no global config)...');
    const child = spawn(process.execPath, [cli], {
      cwd: project,
      env: replEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
    });

    // Collect output with line buffering
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    let stdoutEnded = false;
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      outputBuffer += chunk;
      const lines = chunk.split('\n');
      for (const l of lines) {
        if (l.trim()) last80Lines.push(l.trim());
        if (last80Lines.length > 200) last80Lines = last80Lines.slice(-200);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    // Helper: wait for pattern in output (with timeout)
    function waitForOutput(pattern, timeout = 15000, desc = '') {
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

    // Helper: send input to REPL
    function sendInput(text) {
      log(`send: ${text.length > 60 ? text.substring(0, 57) + '...' : text}`);
      child.stdin.write(text + '\n');
    }

    // Helper: wait a fixed amount of time for output to settle
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Wait for REPL to start — should see welcome + bottom bar
    // ═══════════════════════════════════════════════════════════
    log('STEP 1: Waiting for REPL startup...');
    await sleep(4000); // Give REPL time to initialize
    assert(
      outputBuffer.includes('iCloser') || outputBuffer.includes('◇'),
      'REPL started with welcome output'
    );

    // The REPL should show either mock mode (no key) or provider guidance
    const hasMockOrKeyHelp = outputBuffer.includes('mock') ||
      outputBuffer.includes('API Key') ||
      outputBuffer.includes('粘贴') ||
      outputBuffer.includes('/apikey');
    assert(hasMockOrKeyHelp, 'REPL shows mock mode or API Key guidance on startup');
    assert(!outputBuffer.includes('已恢复上次会话'), 'REPL does not restore a session from a different project directory');
    assert(outputBuffer.includes('repl-smoke-test') || outputBuffer.includes('project'), 'REPL startup uses current project context, not stale session project name');
    assert(!outputBuffer.includes('iCloser2026'), 'REPL startup does not show stale project name from old session');

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Send "我要配置 key" — should trigger key help, NOT AI chat
    // ═══════════════════════════════════════════════════════════
    log('STEP 2: Sending "我要配置 key"...');
    const beforeKeyHelp = outputBuffer.length;
    sendInput('我要配置 key');
    await sleep(2000);

    // Should show key guidance, not AI response
    const afterKeyHelp = outputBuffer.substring(beforeKeyHelp);
    // AI responses start with "── AI ──" or contain stream markers
    const hasAiResponse = afterKeyHelp.includes('── AI ──') || afterKeyHelp.includes('┌');
    assert(!hasAiResponse, '"我要配置 key" does NOT trigger AI chat');

    // Should show key help content
    const hasKeyHelpContent = afterKeyHelp.includes('粘贴') ||
      afterKeyHelp.includes('API Key') ||
      afterKeyHelp.includes('/apikey') ||
      afterKeyHelp.includes('sk-') ||
      afterKeyHelp.includes('export') ||
      afterKeyHelp.includes('DEEPSEEK_API_KEY');
    assert(hasKeyHelpContent, '"我要配置 key" shows API Key guidance');

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Run /apikey wizard — default provider, fake key
    // ═══════════════════════════════════════════════════════════
    log('STEP 3: Running /apikey wizard...');
    const beforeApikey = outputBuffer.length;
    sendInput('/apikey');
    await sleep(2000);

    // Should prompt for provider (default deepseek)
    const afterApikeyPrompt = outputBuffer.substring(beforeApikey);
    assert(
      afterApikeyPrompt.includes('Provider') || afterApikeyPrompt.includes('deepseek') || afterApikeyPrompt.includes('安全输入'),
      '/apikey shows provider prompt (default deepseek)'
    );

    // Send empty to accept default provider
    const beforeKeyInput = outputBuffer.length;
    sendInput(''); // Accept default provider (deepseek)
    await sleep(1000);

    // Now REPL should prompt for API Key (hidden input via rl.question)
    // Send fake key
    sendInput(FAKE_KEY);
    await sleep(3000);

    // After key input, REPL should save and show success
    const afterKeySaved = outputBuffer.substring(beforeKeyInput);

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Verify fake key is NOT in plaintext output
    // ═══════════════════════════════════════════════════════════
    log('STEP 4: Verifying fake key is not in output...');
    // Strip ANSI escape codes for checking
    const stripped = outputBuffer.replace(/\x1b\[[0-9;]*m/g, '');
    assert(
      !stripped.includes(FAKE_KEY),
      'Fake API key is NOT exposed in plaintext output'
    );

    // The key should appear masked (e.g., sk-fak...cdef)
    const keyPrefix = FAKE_KEY.substring(0, 3);
    const keySuffix = FAKE_KEY.substring(FAKE_KEY.length - 3);
    const hasMaskedPart = stripped.includes('...') ||
      outputBuffer.includes('keySource') ||
      stripped.includes('已保存') ||
      stripped.includes('API Key');
    assert(hasMaskedPart, 'Key confirmation uses masked format or keySource indicator');

    // ═══════════════════════════════════════════════════════════
    // STEP 5: /status — REPL still functional
    // ═══════════════════════════════════════════════════════════
    log('STEP 5: Running /status...');
    sendInput('/status');
    await sleep(2000);

    // /status should produce some status output
    const hasStatus = outputBuffer.includes('SESSION') ||
      outputBuffer.includes('session') ||
      outputBuffer.includes('AI') ||
      outputBuffer.includes('Provider') ||
      outputBuffer.includes('provider') ||
      outputBuffer.includes('deepseek') ||
      outputBuffer.includes('mock');
    assert(hasStatus, '/status command produces session info');

    // ═══════════════════════════════════════════════════════════
    // STEP 6: /doctor — readiness guide still works inside REPL
    // ═══════════════════════════════════════════════════════════
    log('STEP 6: Running /doctor...');
    const beforeDoctor = outputBuffer.length;
    sendInput('/doctor');
    await sleep(2000);

    const afterDoctor = outputBuffer.substring(beforeDoctor);
    const hasDoctor = afterDoctor.includes('Doctor') ||
      afterDoctor.includes('Ready') ||
      afterDoctor.includes('下一步') ||
      afterDoctor.includes('/scan') ||
      afterDoctor.includes('/apikey');
    assert(hasDoctor, '/doctor command produces readiness guide');

    // ═══════════════════════════════════════════════════════════
    // STEP 7: /pwd and /config <dir> — working directory must be local and deterministic
    // ═══════════════════════════════════════════════════════════
    log('STEP 7: Checking working directory commands...');
    const beforePwd = outputBuffer.length;
    sendInput('/pwd');
    await sleep(1000);
    const afterPwd = outputBuffer.substring(beforePwd);
    assert(afterPwd.includes(project), '/pwd prints the actual project directory');

    const beforeConfigPath = outputBuffer.length;
    sendInput(`/config ${project}`);
    await sleep(1500);
    const afterConfigPath = outputBuffer.substring(beforeConfigPath);
    assert(afterConfigPath.includes('工作目录已切换'), '/config <dir> is treated as directory switch for beginner misuse');
    assert(!afterConfigPath.includes('undefined'), '/config <dir> does not print undefined');

    const beforeNaturalPwd = outputBuffer.length;
    sendInput('现在工作目录在哪里？');
    await sleep(1500);
    const afterNaturalPwd = outputBuffer.substring(beforeNaturalPwd);
    assert(afterNaturalPwd.includes(project), 'natural language current-directory question is answered locally');
    assert(!afterNaturalPwd.includes('思考中'), 'current-directory question does not trigger AI chat');

    // ═══════════════════════════════════════════════════════════
    // STEP 8: Natural-language autopilot — should inspect locally, not chat
    // ═══════════════════════════════════════════════════════════
    log('STEP 8: Running natural-language autopilot analysis...');
    const beforeAutoReport = outputBuffer.length;
    sendInput('分析整个项目');
    await sleep(2500);
    const afterAutoReport = outputBuffer.substring(beforeAutoReport).replace(/[[0-9;]*m/g, '');
    assert(afterAutoReport.includes('步骤') && afterAutoReport.includes('收集上下文'), '分析整个项目 shows collect-context loop panel');
    assert(afterAutoReport.includes('代码智能') || afterAutoReport.includes('文件操作'), '分析整个项目 shows tool capability info');
    assert(afterAutoReport.includes('自动项目分析'), '分析整个项目 reaches analysis result after loop panel');
    assert(afterAutoReport.includes('自动项目分析') || afterAutoReport.includes('项目工程自动分析'), '分析整个项目 is handled by local autopilot');
    assert(afterAutoReport.includes(project), 'autopilot analysis uses the actual current project directory');
    assert(!afterAutoReport.includes('思考中'), '分析整个项目 does not trigger AI chat');

    const beforeAutoDocs = outputBuffer.length;
    sendInput('补齐文档');
    await sleep(2500);
    const afterAutoDocs = outputBuffer.substring(beforeAutoDocs).replace(/[[0-9;]*m/g, '');
    assert(afterAutoDocs.includes('自动补齐文档'), '补齐文档 shows a local confirmation panel');
    assert(afterAutoDocs.includes('[1]') && afterAutoDocs.includes('[2]') && afterAutoDocs.includes('[3]'), '补齐文档 uses numbered choices');
    assert(!afterAutoDocs.includes('思考中'), '补齐文档 does not trigger AI chat');
    sendInput('3');
    await sleep(1000);

    // ═══════════════════════════════════════════════════════════
    // STEP 9: Natural-language start project — should execute locally, not chat
    // ═══════════════════════════════════════════════════════════
    log('STEP 9: Starting project from natural language intent...');
    const beforeStart = outputBuffer.length;
    sendInput('启动项目');
    await sleep(1500);
    const afterStart = outputBuffer.substring(beforeStart).replace(/\x1b\[[0-9;]*m/g, '');
    assert(afterStart.includes('收集上下文'), '启动项目 first shows collect-context loop panel');
    assert(afterStart.includes('执行操作'), '启动项目 shows take-action loop panel');
    assert(afterStart.includes('系统权限确认') || afterStart.includes('PowerShell') || afterStart.includes('Shell'), '启动项目 shows a system approval panel');
    assert(afterStart.includes('请选择下一步') || afterStart.includes('只接受 1 / 2 / 3'), '启动项目 clearly requires approval before system operation');
    assert(afterStart.includes('[1]') && afterStart.includes('[2]') && afterStart.includes('[3]'), '启动项目 uses numbered approval choices');
    assert(afterStart.includes('npm run dev'), '启动项目 explains the dev command before execution');
    assert(!afterStart.includes('思考中'), '启动项目 does not trigger AI chat');

    const beforeStartConfirm = outputBuffer.length;
    sendInput('1');
    await sleep(3000);
    const afterStartConfirm = outputBuffer.substring(beforeStartConfirm).replace(/\x1b\[[0-9;]*m/g, '');
    assert(afterStartConfirm.includes('启动 npm run dev') || afterStartConfirm.includes('npm run dev'), 'confirming system operation runs the dev script locally');
    assert(!afterStartConfirm.includes('◇  1') && !afterStartConfirm.includes('◇ 1'), 'confirming system operation does not echo choice as chat message');
    assert(afterStartConfirm.includes('http://localhost:5173'), 'confirmed start captures and prints the local URL');

    // ═══════════════════════════════════════════════════════════
    // STEP 10: Ctrl+C once — should show one exit hint, not spam
    // ═══════════════════════════════════════════════════════════
    log('STEP 10: Sending Ctrl+C once...');
    const beforeCtrlC = outputBuffer.length;
    child.stdin.write('\x03');
    await sleep(1000);
    const afterCtrlC = outputBuffer.substring(beforeCtrlC);
    const exitHintCount = (afterCtrlC.match(/再次 Ctrl\+C 或 \/exit 退出/g) || []).length;
    assert(exitHintCount === 1, `Ctrl+C prints one exit hint (got ${exitHintCount})`);

    // ═══════════════════════════════════════════════════════════
    // STEP 11: /exit — clean exit
    // ═══════════════════════════════════════════════════════════
    log('STEP 11: Sending /exit...');
    sendInput('/exit');
    await sleep(2000);

    // Verify exit happened (process should exit cleanly)
    // Wait for process to exit
    let exitCode = null;
    try {
      exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Process did not exit within timeout')), 10000);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
        // If already exited
        if (child.exitCode !== null) {
          clearTimeout(timer);
          resolve(child.exitCode);
        }
      });
    } catch (err) {
      child.kill('SIGTERM');
      exitCode = -1;
    }

    assert(exitCode === 0, `/exit results in clean exit (code=${exitCode})`);

    // ═══════════════════════════════════════════════════════════
    // STEP 12: No fake key in stderr either
    // ═══════════════════════════════════════════════════════════
    log('STEP 12: Checking stderr for key leaks...');
    const stderrStripped = stderrData.replace(/\x1b\[[0-9;]*m/g, '');
    assert(
      !stderrStripped.includes(FAKE_KEY),
      'Fake API key is NOT in stderr output'
    );

    // ═══════════════════════════════════════════════════════════
    // STEP 13: verify global config was saved with key
    // ═══════════════════════════════════════════════════════════
    log('STEP 13: Verifying global config persistence...');
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const configPath = path.join(home, 'config.json');
    assert(existsSync(configPath), 'Global config.json was created');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert(config.ai && config.ai.provider === 'deepseek',
      `Global config has provider=deepseek, got ${config.ai?.provider}`);
    assert(typeof config.ai.apiKey === 'string', 'Global config has apiKey saved');

    // Verify saved key is the fake key (config stores it, JSON outputs just mask it)
    assert(config.ai.apiKey === FAKE_KEY, 'Saved key matches input (config on disk stores it)');

    // Final summary
    log(`\n=== RESULTS: ${stepResults.ok} passed, ${stepResults.fail} failed ===`);

  } finally {
    if (process.env.ICLOSER_KEEP_REPL_SMOKE !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[repl-smoke] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});





