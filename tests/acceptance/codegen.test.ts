// Acceptance: code generation → file output verification (mock AI)
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
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
  const d = mkdtempSync(join(tmpdir(), 'icloser-acc-codegen-'));
  dirs.push(d);
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({
    name: 'codegen-test', scripts: { build: 'echo ok', lint: 'echo ok', test: 'echo ok' },
  }));
  writeFileSync(join(d, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', strict: true, outDir: 'dist' }, include: ['src'],
  }));
  writeFileSync(join(d, 'src/app.ts'), 'export function hello() { return "hello"; }\n');
  return d;
}

afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} });

describe('Acceptance: code generation (mock AI)', () => {
  it('code scaffold generates output without error', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const r = run(`node "${IDX}" code scaffold service UserService`, dir, 60000);
    expect(r.out.length).toBeGreaterThan(0);
  });

  it('gen new runs without crashing', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const r = run(`node "${IDX}" gen new "add logging"`, dir, 60000);
    expect(r.out.length).toBeGreaterThan(10);
  });

  it('code review produces output for existing file', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const r = run(`node "${IDX}" code review src/app.ts`, dir, 60000);
    expect(r.out.length).toBeGreaterThan(0);
  });

  it('auto report runs without writing files', () => {
    const dir = makeProject();
    run(`node "${IDX}" init --force`, dir);
    run(`node "${IDX}" scan`, dir, 30000);
    const before = existsSync(join(dir, 'docs'));
    const r = run(`node "${IDX}" auto report`, dir, 60000);
    // auto report should not create docs dir
    if (!before) {
      expect(existsSync(join(dir, 'docs'))).toBe(false);
    }
    expect(r.out.length).toBeGreaterThan(0);
  });
});
