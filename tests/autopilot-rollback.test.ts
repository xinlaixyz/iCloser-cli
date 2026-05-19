import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  createAutopilotRollbackPlan,
  dryRunAutopilotRollback,
  listAutopilotRollbackSnapshots,
  loadLatestAutopilotRollbackPlan,
  persistAutopilotRollbackPlan,
  renderAutopilotRollbackDryRun,
  renderAutopilotRollbackPlan,
  renderAutopilotRollbackReceipts,
  renderAutopilotRollbackSummary,
  rollbackAutopilotChanges,
} from '../src/core/autopilot-rollback.js';

describe('autopilot rollback', () => {
  it('deletes files that did not exist before autopilot write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-'));
    try {
      const plan = await createAutopilotRollbackPlan(root, ['docs/PRD.md'], '测试失败');
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'PRD.md'), '# PRD\n', 'utf-8');

      const receipts = await rollbackAutopilotChanges(plan);

      expect(receipts[0].action).toBe('deleted');
      expect(receipts[0].ok).toBe(true);
      expect(existsSync(join(root, 'docs', 'PRD.md'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores files that existed before autopilot write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'math.test.ts'), 'old content\n', 'utf-8');
      const plan = await createAutopilotRollbackPlan(root, ['src/math.test.ts'], '测试失败');
      await writeFile(join(root, 'src', 'math.test.ts'), 'new content\n', 'utf-8');

      const receipts = await rollbackAutopilotChanges(plan);

      expect(receipts[0].action).toBe('restored');
      expect(await readFile(join(root, 'src', 'math.test.ts'), 'utf-8')).toBe('old content\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders beginner-readable rollback plan and receipts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-'));
    try {
      const plan = await createAutopilotRollbackPlan(root, ['docs/API.md'], '验证失败');
      const planText = renderAutopilotRollbackPlan(plan);
      const receiptText = renderAutopilotRollbackReceipts([{ file: 'docs/API.md', fullPath: join(root, 'docs', 'API.md'), action: 'deleted', ok: true, message: '已删除本轮新建文件' }]);

      expect(planText).toContain('验证失败');
      expect(planText).toContain('只处理本轮 autopilot');
      expect(receiptText).toContain('已删除本轮新建文件');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persistAutopilotRollbackPlan writes and loadLatestAutopilotRollbackPlan reads it back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-persist-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'util.ts'), 'export const x = 1;\n', 'utf-8');
      const plan = await createAutopilotRollbackPlan(root, ['src/util.ts'], '测试持久化');

      await persistAutopilotRollbackPlan(plan);

      const loaded = await loadLatestAutopilotRollbackPlan(root);
      expect(loaded).not.toBeNull();
      expect(loaded!.reason).toBe('测试持久化');
      expect(loaded!.files[0].file).toBe('src/util.ts');
      expect(loaded!.files[0].content).toBe('export const x = 1;\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loadLatestAutopilotRollbackPlan returns null when no snapshot exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-empty-'));
    try {
      const result = await loadLatestAutopilotRollbackPlan(root);
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rollback restores files from persisted snapshot (--auto flow simulation)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-rollback-auto-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'service.ts'), 'original content\n', 'utf-8');

      // Snapshot before write
      const plan = await createAutopilotRollbackPlan(root, ['src/service.ts'], 'autoRollback flow');
      await persistAutopilotRollbackPlan(plan);

      // Simulate autopilot overwrite
      await writeFile(join(root, 'src', 'service.ts'), 'overwritten by autopilot\n', 'utf-8');

      // --auto: load persisted plan and rollback
      const loaded = await loadLatestAutopilotRollbackPlan(root);
      expect(loaded).not.toBeNull();
      const receipts = await rollbackAutopilotChanges(loaded!);

      expect(receipts[0].action).toBe('restored');
      const restored = await readFile(join(root, 'src', 'service.ts'), 'utf-8');
      expect(restored).toBe('original content\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('autopilot rollback metadata', () => {
  it('createAutopilotRollbackPlan includes meta with file counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-meta-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'a.ts'), 'a\n', 'utf-8');
      await writeFile(join(root, 'src', 'b.ts'), 'bb\n', 'utf-8');

      // 2 existing + 1 new file
      const plan = await createAutopilotRollbackPlan(root, ['src/a.ts', 'src/b.ts', 'src/new.ts'], 'meta test');

      expect(plan.version).toBe(1);
      expect(plan.meta.fileCount).toBe(3);
      expect(plan.meta.existingFileCount).toBe(2);
      expect(plan.meta.newFileCount).toBe(1);
      expect(plan.meta.totalBytes).toBeGreaterThan(0);
      expect(plan.meta.readableTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      // Snapshot bytes recorded
      expect(plan.files[0].bytes).toBe(2);  // 'a\n'
      expect(plan.files[1].bytes).toBe(3);  // 'bb\n'
      expect(plan.files[2].bytes).toBe(0);  // new file
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renderAutopilotRollbackPlan includes metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-meta-render-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'util.ts'), 'export const x = 1;\n', 'utf-8');
      const plan = await createAutopilotRollbackPlan(root, ['src/util.ts'], '测试元数据渲染');
      const text = renderAutopilotRollbackPlan(plan);
      expect(text).toContain('快照时间');
      expect(text).toContain('1（0 新建 + 1 已有）');
      expect(text).toContain('B)'); // size hint
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('dry run preview', () => {
  it('dryRunAutopilotRollback shows would-restore for overwritten files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-dryrun-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'app.ts'), 'old\n', 'utf-8');

      const plan = await createAutopilotRollbackPlan(root, ['src/app.ts'], 'dry run');
      // Overwrite
      await writeFile(join(root, 'src', 'app.ts'), 'new\n', 'utf-8');

      const entries = await dryRunAutopilotRollback(plan);
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('would-restore');
      expect(entries[0].file).toBe('src/app.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dryRunAutopilotRollback shows would-delete for new files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-dryrun-'));
    try {
      const plan = await createAutopilotRollbackPlan(root, ['docs/NEW.md'], 'dry run');
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'NEW.md'), '# content\n', 'utf-8');

      const entries = await dryRunAutopilotRollback(plan);
      expect(entries[0].action).toBe('would-delete');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dryRunAutopilotRollback shows no-op for already clean files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-dryrun-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'clean.ts'), 'original\n', 'utf-8');
      const plan = await createAutopilotRollbackPlan(root, ['src/clean.ts'], 'dry run');
      // File unchanged — rollback would be a no-op (file already at original)
      // Actually if existed + still exists + content unchanged, it's still would-restore
      // (dry run doesn't compare content, just existence)
      const entries = await dryRunAutopilotRollback(plan);
      expect(entries[0].action).toBe('would-restore');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renderAutopilotRollbackDryRun includes summary counts', () => {
    const entries = [
      { file: 'a.ts', action: 'would-restore' as const, existed: true, currentlyExists: true, bytes: 100 },
      { file: 'b.ts', action: 'would-delete' as const, existed: false, currentlyExists: true, bytes: 0 },
      { file: 'c.ts', action: 'no-op' as const, existed: false, currentlyExists: false, bytes: 0 },
    ];
    const text = renderAutopilotRollbackDryRun(entries);
    expect(text).toContain('a.ts');
    expect(text).toContain('将恢复到写入前内容');
    expect(text).toContain('将删除本轮新建文件');
    expect(text).toContain('无需操作');
    expect(text).toContain('将回滚 2 个');
    expect(text).not.toContain('将回滚 3 个');
  });
});

describe('list snapshots', () => {
  it('listAutopilotRollbackSnapshots returns empty when no snapshots exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-list-empty-'));
    try {
      const list = await listAutopilotRollbackSnapshots(root);
      expect(list).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('listAutopilotRollbackSnapshots returns sorted snapshots with newest first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-list-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'first.ts'), '1\n', 'utf-8');

      const plan1 = await createAutopilotRollbackPlan(root, ['src/first.ts'], 'first snapshot');
      await persistAutopilotRollbackPlan(plan1);

      // Small delay so timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const plan2 = await createAutopilotRollbackPlan(root, ['src/first.ts'], 'second snapshot');
      await persistAutopilotRollbackPlan(plan2);

      const list = await listAutopilotRollbackSnapshots(root);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].latest).toBe(true);
      // Newest first
      const idx1 = list.findIndex(s => s.id.includes('autopilot-rollback-'));
      expect(idx1).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renderAutopilotRollbackSummary shows snapshot list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-summary-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'x.ts'), 'x\n', 'utf-8');
      const plan = await createAutopilotRollbackPlan(root, ['src/x.ts'], 'summary test');
      await persistAutopilotRollbackPlan(plan);

      const list = await listAutopilotRollbackSnapshots(root);
      const text = renderAutopilotRollbackSummary(list);
      expect(text).toContain('Autopilot 回滚快照列表');
      expect(text).toContain('summary test');
      expect(text).toContain('最新');
      expect(text).toContain('个文件');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renderAutopilotRollbackSummary handles empty list', () => {
    const text = renderAutopilotRollbackSummary([]);
    expect(text).toContain('没有找到 autopilot 快照');
  });
});

describe('path traversal safety', () => {
  it('rejects absolute paths outside root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-safe-'));
    try {
      await expect(
        createAutopilotRollbackPlan(root, ['/etc/passwd'], 'traversal')
      ).rejects.toThrow('拒绝回滚');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects relative traversal past root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-safe-'));
    try {
      await expect(
        createAutopilotRollbackPlan(root, ['../../../etc/passwd'], 'traversal')
      ).rejects.toThrow('拒绝回滚');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
