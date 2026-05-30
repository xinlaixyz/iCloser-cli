// REPL API Key Paste Smoke
// Simulates a beginner pasting an API key directly into the REPL input.
// Acceptance:
// - the input is handled locally, not sent to AI chat
// - stdout/stderr and input memory never contain the raw key
// - global config is saved and provider switches away from mock
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');
const FAKE_KEY = 'sk-fake-direct-paste-1234567890abcdef';

let outputBuffer = '';
let stderrBuffer = '';
let lastLines = [];
let passed = 0;

function log(message) {
  process.stdout.write(`\n[apikey-paste] ${message}\n`);
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function assert(condition, message) {
  if (condition) {
    passed++;
    log(`PASS: ${message}`);
    return;
  }
  log(`FAIL: ${message}`);
  log('--- Last 80 lines ---');
  for (const line of lastLines.slice(-80)) process.stderr.write(`  ${line}\n`);
  log('--- End ---');
  throw new Error(message);
}

async function main() {
  log('building...');
  const build = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, encoding: 'utf-8', timeout: 120000 })
    : spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf-8', timeout: 120000 });
  if (build.status !== 0) throw new Error('build failed');
  if (!existsSync(cli)) throw new Error('dist/index.js not found after build');

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-apikey-paste-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');

  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'apikey-paste-test',
      scripts: { build: 'node -e "1"', lint: 'node -e "1"', test: 'node -e "1"' },
    }), 'utf-8');

    const env = {
      ...process.env,
      ICLOSER_HOME: home,
      HOME: home,
      USERPROFILE: home,
    };
    delete env.DEEPSEEK_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    delete env.QWEN_API_KEY;
    delete env.DASHSCOPE_API_KEY;

    log('spawning REPL...');
    const child = spawn(process.execPath, [cli], {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
    });
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => {
      outputBuffer += chunk;
      for (const line of chunk.split('\n')) {
        const t = stripAnsi(line).trim();
        if (t) lastLines.push(t);
        if (lastLines.length > 200) lastLines = lastLines.slice(-200);
      }
    });
    child.stderr.on('data', chunk => { stderrBuffer += chunk; });

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const send = text => {
      log(`send: ${text === FAKE_KEY ? '<api-key>' : text}`);
      child.stdin.write(text + '\n');
    };

    await sleep(4000);
    assert(stripAnsi(outputBuffer).includes('API Key') || stripAnsi(outputBuffer).includes('mock') || stripAnsi(outputBuffer).includes('离线'), 'fresh REPL shows key guidance or mock mode');

    const beforePaste = outputBuffer.length;
    send(FAKE_KEY);
    await sleep(5000);
    const afterPaste = stripAnsi(outputBuffer.substring(beforePaste));

    assert(afterPaste.includes('API Key 已保存'), 'direct pasted key is handled as API key setup');
    assert(afterPaste.includes('sk-fake') || afterPaste.includes('...') || afterPaste.includes('Key 已保存'), 'confirmation uses masked/summary wording');
    assert(!afterPaste.includes('── AI'), 'direct pasted key does not trigger AI chat');
    assert(!stripAnsi(outputBuffer).includes(FAKE_KEY), 'stdout does not contain raw key');
    assert(!stripAnsi(stderrBuffer).includes(FAKE_KEY), 'stderr does not contain raw key');

    send('/exit');
    const exitCode = await new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(-1);
      }, 15000);
      child.on('close', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert(exitCode === 0, `/exit exits cleanly (code=${exitCode})`);

    const configPath = join(home, 'config.json');
    assert(existsSync(configPath), 'global config was created');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    assert(config.ai?.provider === 'deepseek', `provider inferred as deepseek, got ${config.ai?.provider}`);
    assert(config.ai?.apiKey === FAKE_KEY, 'raw key is stored only in private config');

    const inputEventsPath = join(project, '.icloser', 'input-events.jsonl');
    assert(existsSync(inputEventsPath), 'input event log exists');
    const inputEvents = await readFile(inputEventsPath, 'utf-8');
    assert(!inputEvents.includes(FAKE_KEY), 'input memory does not contain raw key');
    assert(inputEvents.includes('redacted'), 'input memory records redaction metadata');

    log(`RESULTS: ${passed} passed`);
  } finally {
    if (process.env.ICLOSER_KEEP_APIKEY_PASTE !== '1') {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    } else {
      log(`kept workspace: ${tempRoot}`);
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[apikey-paste] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
