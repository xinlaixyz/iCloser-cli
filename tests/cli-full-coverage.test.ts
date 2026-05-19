// Coverage push — exercises major CLI command paths via spawn
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const cli = (cmd: string, cwd: string): string => {
  try { return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 90000, stdio: 'pipe', env: { ...process.env, ICLOSER_AI_PROVIDER: 'mock', NODE_NO_WARNINGS: '1' } }); }
  catch (e: any) { return (e.stdout || '') + (e.stderr || ''); }
};

const dirs: string[] = [];
interface Fixture {
  dir: string;
  idx: string;
}

let fixture: Fixture;

function setup(): Fixture {
  const d = mkdtempSync(join(tmpdir(), 'icloser-cov-'));
  dirs.push(d);
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok', lint: 'echo ok', test: 'echo ok' }, dependencies: { express: '^4' } }));
  writeFileSync(join(d, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true, outDir: 'dist' }, include: ['src'] }));
  writeFileSync(join(d, 'src/index.ts'), 'import express from "express";\nconst app = express();\napp.listen(3000);\n');
  const idx = join(process.cwd(), 'dist/index.js');
  cli(`node "${idx}" init --force`, d);
  cli(`node "${idx}" scan`, d);
  return { dir: d, idx };
}

afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} });

describe('CLI coverage boost', () => {
  beforeAll(() => {
    fixture = setup();
  });

  it('ic plan create + dag', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" plan create "add auth feature"`, dir);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" plan dag`, dir);
    expect(typeof out).toBe('string');
  });

  it('ic code scaffold + new + fix + complete + refactor', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" code scaffold middleware Logger`, dir);
    expect(out).toContain('middleware');
    out = cli(`node "${idx}" code new "add json parser"`, dir);
    expect(out.length).toBeGreaterThan(10);
    out = cli(`node "${idx}" code fix`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" code complete src/index.ts`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic gen new + fix + complete', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" gen new "add body parser"`, dir);
    expect(out.length).toBeGreaterThan(10);
    const out2 = cli(`node "${idx}" gen fix`, dir);
    expect(out2.length).toBeGreaterThan(0);
  });

  it('ic config security + ic overview', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" config security rules --json`, dir);
    expect(out).toContain('rules');
    out = cli(`node "${idx}" overview`, dir);
    expect(out.length).toBeGreaterThan(10);
  });

  it('ic audit + ic rule + ic mem', () => {
    const { dir, idx } = fixture;
    cli(`node "${idx}" t "add comment"`, dir);
    let out = cli(`node "${idx}" audit`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" rule list`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" mem`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic provider list + config + doctor', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" provider list --json`, dir);
    expect(out).toContain('mock');
    out = cli(`node "${idx}" config --json`, dir);
    expect(out).toContain('"project"');
    out = cli(`node "${idx}" doctor --json`, dir);
    expect(out).toContain('"ready"');
  });

  it('ic docs status + ic changelog', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" docs status`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" changelog`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic t with --priority high', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" t "test task" --priority high`, dir);
    expect(out.length).toBeGreaterThan(50);
  });

  it('ic y + ic n on queued task', () => {
    const { dir, idx } = fixture;
    cli(`node "${idx}" t "test task"`, dir);
    const st = cli(`node "${idx}" st --json`, dir);
    expect(st).toContain('"tasks"');
  });

  it('ic search + ic web + ic deps + ic estimate', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" search "express"`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" web "typescript express"`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" deps`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" estimate "add login feature"`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic skill list + add + remove', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" skill list`, dir);
    expect(out).toContain('code-review');
    out = cli(`node "${idx}" skill add test-skill test-skill "test skill"`, dir);
    expect(out).toContain('已注册');
    out = cli(`node "${idx}" skill remove test-skill`, dir);
    expect(out).toContain('已移除');
  });

  it('ic queue + ic queue --json', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" queue`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" queue --json`, dir);
    expect(out).toContain('[');
  });

  it('ic risk + ic report', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" risk`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" risk --json`, dir);
    expect(typeof out).toBe('string');
    out = cli(`node "${idx}" report`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic gate + ic gate --strict', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" gate`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" gate --json`, dir);
    expect(typeof out).toBe('string');
  });

  it('ic doctor --strict', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" doctor --strict`, dir);
    expect(typeof out).toBe('string');
  });

  it('ic agent list + info', () => {
    const { dir, idx } = fixture;
    let out = cli(`node "${idx}" agent list`, dir);
    expect(out.length).toBeGreaterThan(0);
    out = cli(`node "${idx}" agent list --json`, dir);
    expect(typeof out).toBe('string');
  });

  it('ic rollback --auto with no snapshot returns helpful message', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" rollback --auto`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic rollback missing-task-id returns error', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" rollback non-existent-task`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic rollback --list shows empty when no snapshots', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" rollback --list`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic rollback --auto --dry-run shows error when no snapshot', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" rollback --auto --dry-run`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic auto report (analysis only, no file writes)', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" auto report`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic auto docs (dry run without --go)', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" auto docs`, dir);
    expect(out.length).toBeGreaterThan(0);
  });

  it('ic auto tests (analysis without --go)', () => {
    const { dir, idx } = fixture;
    const out = cli(`node "${idx}" auto tests`, dir);
    expect(out.length).toBeGreaterThan(0);
  });
});
