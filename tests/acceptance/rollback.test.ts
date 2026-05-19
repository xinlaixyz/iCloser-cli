// Acceptance: autopilot snapshot → rollback → restore verification
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createAutopilotRollbackPlan,
  persistAutopilotRollbackPlan,
  loadLatestAutopilotRollbackPlan,
  rollbackAutopilotChanges,
  renderAutopilotRollbackReceipts,
} from '../../src/core/autopilot-rollback.js';

const roots: string[] = [];
async function makeRoot() {
  const r = await mkdtemp(join(tmpdir(), 'icloser-acc-rollback-'));
  roots.push(r);
  return r;
}

afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

describe('Acceptance: ic rollback --auto flow', () => {
  it('snapshot → persist → load → rollback restores original file', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'service.ts'), 'original\n', 'utf-8');

    const plan = await createAutopilotRollbackPlan(root, ['src/service.ts'], 'acceptance test');
    await persistAutopilotRollbackPlan(plan);

    await writeFile(join(root, 'src', 'service.ts'), 'overwritten\n', 'utf-8');

    const loaded = await loadLatestAutopilotRollbackPlan(root);
    expect(loaded).not.toBeNull();

    const receipts = await rollbackAutopilotChanges(loaded!);
    expect(receipts[0].action).toBe('restored');
    expect(receipts[0].ok).toBe(true);

    const content = await readFile(join(root, 'src', 'service.ts'), 'utf-8');
    expect(content).toBe('original\n');
  });

  it('snapshot → persist → load → rollback deletes new file', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'docs'), { recursive: true });

    const plan = await createAutopilotRollbackPlan(root, ['docs/NEW.md'], 'acceptance test');
    await persistAutopilotRollbackPlan(plan);

    await writeFile(join(root, 'docs', 'NEW.md'), '# New\n', 'utf-8');

    const loaded = await loadLatestAutopilotRollbackPlan(root);
    const receipts = await rollbackAutopilotChanges(loaded!);
    expect(receipts[0].action).toBe('deleted');

    const { existsSync } = await import('fs');
    expect(existsSync(join(root, 'docs', 'NEW.md'))).toBe(false);
  });

  it('rollback of multiple files produces receipts for each', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'a\n', 'utf-8');
    await writeFile(join(root, 'src', 'b.ts'), 'b\n', 'utf-8');

    const plan = await createAutopilotRollbackPlan(root, ['src/a.ts', 'src/b.ts'], 'multi-file');
    await persistAutopilotRollbackPlan(plan);

    await writeFile(join(root, 'src', 'a.ts'), 'a-overwritten\n', 'utf-8');
    await writeFile(join(root, 'src', 'b.ts'), 'b-overwritten\n', 'utf-8');

    const loaded = await loadLatestAutopilotRollbackPlan(root);
    const receipts = await rollbackAutopilotChanges(loaded!);
    expect(receipts).toHaveLength(2);
    expect(receipts.every(r => r.action === 'restored' && r.ok)).toBe(true);

    expect(await readFile(join(root, 'src', 'a.ts'), 'utf-8')).toBe('a\n');
    expect(await readFile(join(root, 'src', 'b.ts'), 'utf-8')).toBe('b\n');
  });

  it('renderAutopilotRollbackReceipts produces readable output', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'x.ts'), 'x\n', 'utf-8');

    const plan = await createAutopilotRollbackPlan(root, ['src/x.ts'], 'render test');
    await persistAutopilotRollbackPlan(plan);
    await writeFile(join(root, 'src', 'x.ts'), 'changed\n', 'utf-8');

    const loaded = await loadLatestAutopilotRollbackPlan(root);
    const receipts = await rollbackAutopilotChanges(loaded!);
    const text = renderAutopilotRollbackReceipts(receipts);
    expect(text).toContain('src/x.ts');
    expect(text).toContain('已恢复');
  });
});
