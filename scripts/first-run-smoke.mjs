// S3.1 First-Run Wizard Acceptance Smoke
// Verifies the "completely new user" path: setup, config safety, global persistence
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  process.stdout.write(`\n[first-run] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf-8',
    timeout: options.timeout || 120000,
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 && !options.allowNonZero) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function runJson(args, cwd, env) {
  const stdout = run(process.execPath, [cli, ...args], { cwd, env });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Not parseable JSON: ic ${args.join(' ')}\n${stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function main() {
  // Build first
  process.stdout.write('[first-run] building...\n');
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm run build']);
  } else {
    run('npm', ['run', 'build']);
  }

  if (!existsSync(cli)) {
    throw new Error('dist/index.js not found after npm run build.');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'icloser-first-run-'));
  const home = join(tempRoot, 'home');
  const project = join(tempRoot, 'project');
  const env = { ICLOSER_HOME: home };

  try {
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'package.json'), JSON.stringify({
      name: 'first-run-test',
      scripts: { build: 'node -e "1"', lint: 'node -e "1"', test: 'node -e "1"' },
    }), 'utf-8');

    // ═══════════════════════════════════════════════════════════
    // TEST 1: ic setup --mock --json — no key leak
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 1: ic setup --mock --json ===\n');
    const mockSetup = runJson(['setup', '--mock', '--json'], project, env);
    assert(mockSetup.kind === 'setup', 'kind should be setup');
    assert(mockSetup.data.provider === 'mock', 'provider should be mock');
    assert(mockSetup.data.installed === true, 'installed should be true');
    // No apiKey field in JSON output
    assert(!('apiKey' in (mockSetup.data || {})), 'JSON must not contain apiKey');
    assert(!JSON.stringify(mockSetup).includes('apiKey'), 'JSON string must not mention apiKey');

    // ═══════════════════════════════════════════════════════════
    // TEST 2: ic setup --provider deepseek --key <fake> --json — no key leak, proper provider
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 2: ic setup --provider deepseek --key <fake> --json ===\n');
    const FAKE_KEY = 'sk-fake-test-key-for-acceptance-123456';
    const deepseekSetup = runJson(
      ['setup', '--provider', 'deepseek', '--key', FAKE_KEY, '--json'],
      project, env,
    );
    assert(deepseekSetup.kind === 'setup', 'kind should be setup');
    assert(deepseekSetup.data.provider === 'deepseek', 'provider should be deepseek');
    assert(deepseekSetup.data.installed === true, 'installed should be true');
    // Must NOT contain the actual fake key
    assert(!JSON.stringify(deepseekSetup).includes(FAKE_KEY),
      `JSON must not contain fake key "${FAKE_KEY}"`);
    // keySource should be 'config' (from global config)
    assert(deepseekSetup.data.keySource === 'config', `keySource should be config, got ${deepseekSetup.data.keySource}`);

    // ═══════════════════════════════════════════════════════════
    // TEST 3: ic config --json — never contains apiKey
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 3: ic config --json (no apiKey) ===\n');
    // First init the project so config exists
    run(process.execPath, [cli, 'init', '--force'], { cwd: project, env });
    const configJson = runJson(['config', '--json'], project, env);
    assert(configJson.kind === 'config', 'kind should be config');
    // Serialized config must never contain apiKey
    const configStr = JSON.stringify(configJson);
    assert(!configStr.includes('apiKey'), `config --json must not contain apiKey: ${configStr.substring(0, 200)}`);
    assert(!configStr.includes(FAKE_KEY), `config --json must not leak key: ${configStr.substring(0, 200)}`);
    // ai section should have provider/model but NOT apiKey
    assert(typeof configJson.data.ai.provider === 'string', 'ai.provider should be string');
    assert(typeof configJson.data.ai.model === 'string', 'ai.model should be string');
    assert(!('apiKey' in configJson.data.ai), 'ai.apiKey must not exist in config output');

    // ═══════════════════════════════════════════════════════════
    // TEST 4: After init, project inherits global provider/model
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 4: Project inherits global provider/model ===\n');
    const doctorJson = runJson(['doctor', '--json'], project, env);
    assert(doctorJson.kind === 'doctor', 'kind should be doctor');
    assert(doctorJson.data.provider.name === 'deepseek',
      `provider should be deepseek from global config, got ${doctorJson.data.provider.name}`);
    assert(doctorJson.data.provider.model === 'deepseek-v4-pro',
      `model should be deepseek-v4-pro, got ${doctorJson.data.provider.model}`);
    assert(doctorJson.data.provider.ready === true,
      `provider should be ready (key from global config), got ready=${doctorJson.data.provider.ready}`);
    assert(doctorJson.data.provider.keySource === 'config',
      `keySource should be config, got ${doctorJson.data.provider.keySource}`);

    // ═══════════════════════════════════════════════════════════
    // TEST 5: ic provider doctor --json shows keySource=config
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 5: provider doctor --json keySource=config ===\n');
    const provDoctor = runJson(['provider', 'doctor', '--json'], project, env);
    assert(provDoctor.kind === 'provider-doctor', 'kind should be provider-doctor');
    assert(provDoctor.data.provider === 'deepseek', 'provider should be deepseek');
    assert(provDoctor.data.keySource === 'config', `keySource should be config, got ${provDoctor.data.keySource}`);
    assert(provDoctor.data.ready === true, 'ready should be true');
    // No apiKey in the JSON
    assert(!JSON.stringify(provDoctor).includes(FAKE_KEY), 'provider doctor must not leak fake key');
    assert(!JSON.stringify(provDoctor).includes('apiKey'), 'provider doctor must not contain apiKey');

    // ═══════════════════════════════════════════════════════════
    // TEST 6: ic provider list --json — no key leaks
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 6: provider list --json (no key leaks) ===\n');
    const provList = runJson(['provider', 'list', '--json'], project, env);
    assert(provList.kind === 'providers', 'kind should be providers');
    assert(Array.isArray(provList.data.providers), 'should have providers array');
    assert(!JSON.stringify(provList).includes(FAKE_KEY), 'provider list must not leak key');

    // ═══════════════════════════════════════════════════════════
    // TEST 7: Mock project stays mock when global has real provider
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 7: Mock project isolation from global real provider ===\n');
    const mockProject = join(tempRoot, 'mock-project');
    await mkdir(mockProject, { recursive: true });
    await writeFile(join(mockProject, 'package.json'), JSON.stringify({
      name: 'mock-test',
      scripts: { build: 'node -e "1"' },
    }), 'utf-8');

    // Init with mock provider
    const mockEnv = { ...env, ICLOSER_AI_PROVIDER: 'mock' };
    run(process.execPath, [cli, 'init', '--force'], { cwd: mockProject, env: mockEnv });
    run(process.execPath, [cli, 'provider', 'use', 'mock'], { cwd: mockProject, env: mockEnv });

    // Verify this project stays mock even though global has deepseek
    const mockDoctor = runJson(['doctor', '--json'], mockProject, env);
    assert(mockDoctor.data.provider.name === 'mock',
      `mock project should stay mock, got ${mockDoctor.data.provider.name}`);

    // ═══════════════════════════════════════════════════════════
    // TEST 8: setup --provider unknown --json — graceful error
    // ═══════════════════════════════════════════════════════════
    process.stdout.write('\n=== TEST 8: setup --provider unknown (graceful error) ===\n');
    const unknownResult = spawnSync(process.execPath, [cli, 'setup', '--provider', 'unknown-prov', '--json'], {
      cwd: project, env, encoding: 'utf-8', timeout: 30000,
    });
    // Should exit without crashing; output may or may not be JSON
    assert(unknownResult.status !== null, 'should not hang');

    process.stdout.write('\n[first-run] ALL 8 TESTS PASSED\n');
    process.stdout.write(`[first-run] workspace ${tempRoot}\n`);
  } finally {
    if (process.env.ICLOSER_KEEP_FIRST_RUN !== '1') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  process.stderr.write(`\n[first-run] FAIL ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
