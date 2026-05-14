import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  createAutopilotRollbackPlan,
  renderAutopilotRollbackPlan,
  renderAutopilotRollbackReceipts,
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
});
