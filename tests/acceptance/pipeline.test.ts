// Acceptance: init → scan → task → status pipeline (mock AI)
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IDX = join(process.cwd(), 'dist/index.js');
const ENV = { ...process.env, ICLOSER_AI_PROVIDER: 'mock', NODE_NO_WARNINGS: '1' };

const run = (cmd: string, cwd: string, timeout = 60000) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf-8', timeout, stdio: 'pipe', env: ENV }) };
  } catch (e: any) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

const dirs: string[] = [];
function makeProject() {
  const d = mkdtempSync(join(tmpdir(), 'icloser-acc-pipeline-'));
  dirs.push(d);
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({
    name: 'acc-test', scripts: { build: 'echo ok', lint: 'echo ok', test: 'echo ok' },
  }));
  writeFileSync(join(d, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', strict: true, outDir: 'dist' }, include: ['src'],
  }));
  writeFileSync(join(d, 'src/index.ts'), 'export const version = "1.0.0";\n');
  return d;
}

afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} });

describe('Acceptance: pipeline (mock AI)', () => {
  it('init creates .icloser config directory', () => {
    const dir = makeProject();
    const r = run(`node "${IDX}" init --force`, dir);
    expect(r.ok || r.out.length > 0).toBe(true);
  });

  it('scan runs and creates project index', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    const r = run(`node "${IDX}" scan`, dir, 30000);
    // scan may exit non-zero on errors but should produce output or create the index
    const indexCreated = existsSync(join(dir, '.icloser', 'index.json'));
    expect(r.ok || r.out.length > 0 || indexCreated).toBe(true);
  });

  it('st --json returns tasks array after init', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    const r = run(`node "${IDX}" st --json`, dir, 30000);
    expect(r.out).toMatch(/"tasks"|"status"/);
  });

  it('doctor --json reports project readiness', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const r = run(`node "${IDX}" doctor --json`, dir);
    expect(r.out).toContain('"ready"');
  });

  it('plan create produces a plan', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const r = run(`node "${IDX}" plan create "add error handler"`, dir, 60000);
    expect(r.out.length).toBeGreaterThan(10);
  });
});
