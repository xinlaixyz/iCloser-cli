import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dirs: string[] = [];
function tmpDir() { const d = mkdtempSync(join(tmpdir(), 'icloser-ap-')); dirs.push(d); return d; }
afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {} });

describe('autopilot-router', () => {
  it('returns AutopilotRoute with valid intent', async () => {
    const { routeAutopilotIntent } = await import('../src/core/autopilot-router.js');
    const r = routeAutopilotIntent('检查');
    expect(['none','report','docs','tests','test-write','chain']).toContain(r.intent);
  });

  it('returns none for unrelated', async () => {
    const { routeAutopilotIntent } = await import('../src/core/autopilot-router.js');
    expect(routeAutopilotIntent('xyz123').intent).toBe('none');
  });
});

describe('autopilot-rollback', () => {
  it('creates rollback plan', async () => {
    const d = tmpDir();
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'src/test.ts'), 'original');
    const { createAutopilotRollbackPlan } = await import('../src/core/autopilot-rollback.js');
    const plan = await createAutopilotRollbackPlan(d, ['src/test.ts'], 'test');
    expect(plan.files.length).toBe(1);
  });

  it('rollback restores content', async () => {
    const d = tmpDir();
    mkdirSync(join(d, 'src'), { recursive: true });
    writeFileSync(join(d, 'src/test.ts'), 'original');
    const { createAutopilotRollbackPlan, rollbackAutopilotChanges } = await import('../src/core/autopilot-rollback.js');
    const plan = await createAutopilotRollbackPlan(d, ['src/test.ts'], 'test');
    writeFileSync(join(d, 'src/test.ts'), 'modified');
    const results = await rollbackAutopilotChanges(plan);
    expect(results.length).toBe(1);
    const fs = await import('fs');
    expect(fs.readFileSync(join(d, 'src/test.ts'), 'utf-8')).toBe('original');
  });

  it('renderRollbackPlan returns string', async () => {
    const d = tmpDir();
    writeFileSync(join(d, 'test.txt'), 'content');
    const { createAutopilotRollbackPlan, renderAutopilotRollbackPlan } = await import('../src/core/autopilot-rollback.js');
    const plan = await createAutopilotRollbackPlan(d, ['test.txt'], 'test');
    const rendered = renderAutopilotRollbackPlan(plan);
    expect(typeof rendered).toBe('string');
    expect(rendered.length).toBeGreaterThan(0);
  });
});

describe('autopilot-verify', () => {
  it('exports verify function', async () => {
    const mod = await import('../src/core/autopilot-verify.js');
    expect(typeof mod.verifyAutopilotDocs).toBe('function');
    expect(typeof mod.verifyAutopilotTests).toBe('function');
  });
});

describe('autopilot-repair', () => {
  it('exports build function', async () => {
    const mod = await import('../src/core/autopilot-repair.js');
    expect(typeof mod.buildAutopilotRepairPlan).toBe('function');
    expect(typeof mod.renderAutopilotRepairPlan).toBe('function');
  });
});
