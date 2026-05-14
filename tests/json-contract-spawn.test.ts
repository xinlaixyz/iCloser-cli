// Integration tests: spawn CLI and parse JSON outputs
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { describe, expect, it, beforeAll } from 'vitest';

const CLI = 'node';
// Absolute path to dist/index.js — spawn needs absolute path when cwd != project root
import { fileURLToPath } from 'url';
const DIST_INDEX = join(fileURLToPath(import.meta.url), '..', '..', 'dist', 'index.js');

function ic(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(CLI, [DIST_INDEX, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf-8',
    timeout: 30000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'icloser-json-test-'));
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
    name: 'json-test', scripts: { build: 'tsc' }, devDependencies: { typescript: '^5.0' },
  }));
  await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
  await writeFile(join(tmpDir, 'index.ts'), 'export const x = 1;\n');
  // Init + mock task
  const initOut = ic(['init', '--force'], tmpDir);
  if (initOut.status !== 0) console.error('init failed:', initOut.stderr);
  ic(['config', 'provider', 'mock'], tmpDir);
  const taskOut = ic(['t', 'verify JSON gate output', '--go'], tmpDir);
  if (taskOut.status !== 0) console.error('task failed:', taskOut.stderr);
});

describe('JSON contract spawn tests', () => {
  it('ic st --json produces parseable task-list JSON', () => {
    const { stdout, status } = ic(['st', '--json'], tmpDir);
    expect(status).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('task-list');
    expect(Array.isArray(data.data.tasks)).toBe(true);
    for (const t of data.data.tasks) {
      expect(t.id).toBeTruthy();
      expect(t.status).toBeTruthy();
    }
  });

  it('ic config security rules --json produces parseable security-rules JSON', () => {
    const { stdout } = ic(['config', 'security', 'rules', '--json'], tmpDir);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('security-rules');
    expect(Array.isArray(data.data.rules)).toBe(true);
    expect(data.data.rules.length).toBeGreaterThanOrEqual(13);
    for (const r of data.data.rules) {
      expect(r.ruleId).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.severity).toBeTruthy();
    }
  });

  it('ic config --json produces parseable public config JSON', () => {
    const { stdout, status } = ic(['config', '--json'], tmpDir);
    expect(status).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('config');
    expect(data.data.project.name).toBeTruthy();
    expect(data.data.ai.provider).toBeTruthy();
    expect(typeof data.data.ai.ready).toBe('boolean');
    expect(stdout).not.toContain('apiKey');
  });

  it('ic doctor --json produces parseable readiness JSON', () => {
    const { stdout, status } = ic(['doctor', '--json'], tmpDir);
    expect(status).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('doctor');
    expect(data.data.initialized).toBe(true);
    expect(typeof data.data.ready).toBe('boolean');
    expect(data.data.provider.name).toBeTruthy();
    expect(data.data.index.exists).toBe(true);
    expect(Array.isArray(data.data.nextActions)).toBe(true);
  });

  it('ic doctor --strict --json exits non-zero when project is not ready', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'icloser-doctor-strict-'));
    try {
      const { stdout, status } = ic(['doctor', '--strict', '--json'], emptyDir);
      expect(status).toBe(1);
      expect(() => JSON.parse(stdout)).not.toThrow();
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('doctor');
      expect(data.data.ready).toBe(false);
      expect(data.data.initialized).toBe(false);
      expect(data.data.nextActions).toContain('ic init');
      expect(data.data.nextActions).toContain('ic');
      expect(data.data.nextActions.some((action: string) => action.includes('API Key'))).toBe(true);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('ic doctor --json gives beginner actions when provider key is missing', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'icloser-doctor-provider-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'icloser-doctor-home-'));
    try {
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'doctor-provider-test' }));
      ic(['init', '--force'], projectDir, { ICLOSER_HOME: homeDir, OPENAI_API_KEY: '' });
      ic(['provider', 'use', 'openai'], projectDir, { ICLOSER_HOME: homeDir, OPENAI_API_KEY: '' });

      const { stdout, status } = ic(['doctor', '--json'], projectDir, { ICLOSER_HOME: homeDir, OPENAI_API_KEY: '' });
      expect(status).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('doctor');
      expect(data.data.ready).toBe(false);
      expect(data.data.nextActions).toContain('ic');
      expect(data.data.nextActions).toContain('ic provider env openai');
      expect(data.data.nextActions).toContain('ic provider test');
      expect(data.data.nextActions.some((action: string) => action.includes('/apikey'))).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('ic doctor --json suggests scan when initialized project has no index', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'icloser-doctor-index-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'icloser-doctor-home-'));
    try {
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'doctor-index-test' }));
      ic(['init', '--force'], projectDir, { ICLOSER_HOME: homeDir });
      ic(['provider', 'use', 'mock'], projectDir, { ICLOSER_HOME: homeDir });
      await rm(join(projectDir, '.icloser', 'index.json'), { force: true });

      const { stdout, status } = ic(['doctor', '--json'], projectDir, { ICLOSER_HOME: homeDir });
      expect(status).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('doctor');
      expect(data.data.ready).toBe(false);
      expect(data.data.nextActions).toContain('ic scan');
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('ic gate <task-id> --json produces gate-result JSON', () => {
    const { stdout: listOut } = ic(['st', '--json'], tmpDir);
    const tasks = JSON.parse(listOut).data.tasks;
    const taskId = tasks[0]?.id;
    expect(taskId).toBeTruthy();

    const { stdout } = ic(['gate', taskId, '--json'], tmpDir);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('gate-result');
    expect(Array.isArray(data.data.checks)).toBe(true);
    expect(data.data.checks.length).toBeGreaterThanOrEqual(1);
    expect(typeof data.data.passed).toBe('boolean');
  });

  it('JSON stdout contains no ANSI escape codes or progress noise', () => {
    const { stdout: stOut } = ic(['st', '--json'], tmpDir);
    // No ANSI escape sequences
    expect(stOut).not.toMatch(/\x1b\[/);
    // No spinner chars
    expect(stOut).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    // No progress markers
    expect(stOut).not.toContain('[·]');
    expect(stOut).not.toContain('Progress');
  });

  it('ic config security disable rejects unknown ruleId', () => {
    const { stdout, stderr } = ic(['config', 'security', 'disable', 'nonexistent-rule'], tmpDir);
    expect(stdout + stderr).toContain('未知安全规则');
  });
});

// Provider management spawn tests
describe('provider CLI spawn tests', () => {
  it('ic provider list --json produces parseable providers JSON', () => {
    const { stdout } = ic(['provider', 'list', '--json'], tmpDir);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('providers');
    expect(Array.isArray(data.data.providers)).toBe(true);
    expect(data.data.providers.length).toBeGreaterThanOrEqual(3);
    for (const p of data.data.providers) {
      expect(p.name).toBeTruthy();
      expect(p.availableModels).toBeTruthy();
      expect(typeof p.requiresApiKey).toBe('boolean');
    }
  });

  it('ic provider doctor --json produces parseable doctor JSON', () => {
    const { stdout } = ic(['provider', 'doctor', '--json'], tmpDir);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('provider-doctor');
    expect(data.data.provider).toBeTruthy();
    expect(typeof data.data.ready).toBe('boolean');
    expect(typeof data.data.requiresApiKey).toBe('boolean');
  });

  it('ic provider use mock switches provider and shows success', () => {
    const { stdout } = ic(['provider', 'use', 'mock'], tmpDir);
    expect(stdout).toContain('Provider');
    expect(stdout).toContain('mock');
  });
});

describe('setup CLI spawn tests', () => {
  it('ic setup --mock --json writes global config to ICLOSER_HOME', async () => {
    const setupHome = await mkdtemp(join(tmpdir(), 'icloser-setup-home-'));
    try {
      const { stdout, status } = ic(['setup', '--mock', '--json'], tmpDir, { ICLOSER_HOME: setupHome });
      expect(status).toBe(0);
      expect(() => JSON.parse(stdout)).not.toThrow();
      const data = JSON.parse(stdout);
      expect(data.version).toBe(1);
      expect(data.kind).toBe('setup');
      expect(data.data.provider).toBe('mock');
      expect(data.data.providerReady).toBe(true);
    } finally {
      await rm(setupHome, { recursive: true, force: true });
    }
  });

  it('ic setup --provider openai --json is parseable without an API key', async () => {
    const setupHome = await mkdtemp(join(tmpdir(), 'icloser-setup-home-'));
    try {
      const { stdout, status } = ic(['setup', '--provider', 'openai', '--json'], tmpDir, {
        ICLOSER_HOME: setupHome,
        OPENAI_API_KEY: '',
      });
      expect(status).toBe(0);
      expect(() => JSON.parse(stdout)).not.toThrow();
      const data = JSON.parse(stdout);
      expect(data.kind).toBe('setup');
      expect(data.data.provider).toBe('openai');
      expect(data.data.keySource).toBe('missing');
    } finally {
      await rm(setupHome, { recursive: true, force: true });
    }
  });
});
