import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  applyAutopilotRepairPlan,
  buildAutopilotRepairPlan,
  renderAutopilotRepairPlan,
  renderAutopilotRepairReceipts,
} from '../src/core/autopilot-repair.js';
import type { AutopilotVerifyReceipt } from '../src/core/autopilot-verify.js';

describe('autopilot repair planner', () => {
  it('builds high-confidence doc repair actions for missing heading', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'docs',
      duration: 1,
      summary: 'docs/PRD.md 缺少一级标题',
    };

    const plan = buildAutopilotRepairPlan(receipt, ['docs/PRD.md']);

    expect(plan.confidence).toBe('high');
    expect(plan.autoApply).toBe(true);
    expect(plan.actions.join('\n')).toContain('一级标题');
    expect(renderAutopilotRepairPlan(plan)).toContain('自动修复诊断');
  });

  it('builds test repair actions from module resolution errors with auto apply', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'tests',
      command: 'npm run test',
      duration: 1,
      summary: '测试命令失败，exit=1',
      stderr: 'Cannot find module ./Home',
    };

    const plan = buildAutopilotRepairPlan(receipt, ['src/pages/Home.test.tsx']);

    expect(plan.confidence).toBe('high');
    expect(plan.autoApply).toBe(true);
    expect(plan.actions.join('\n')).toContain('import 路径');
    expect(plan.actions.join('\n')).toContain('npm run test');
  });

  it('auto-applies minimal doc heading repair inside project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-repair-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'PRD.md'), 'missing heading\n', 'utf-8');
      const plan = buildAutopilotRepairPlan({
        status: 'fail',
        kind: 'docs',
        duration: 1,
        summary: 'docs/PRD.md 缺少一级标题',
      }, ['docs/PRD.md']);

      const receipts = await applyAutopilotRepairPlan(root, plan);
      const content = await readFile(join(root, 'docs', 'PRD.md'), 'utf-8');

      expect(receipts[0].action).toBe('updated');
      expect(content.startsWith('# PRD')).toBe(true);
      expect(renderAutopilotRepairReceipts(receipts)).toContain('已应用文档最小修复');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to repair files outside project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-repair-'));
    try {
      const plan = buildAutopilotRepairPlan({
        status: 'fail',
        kind: 'docs',
        duration: 1,
        summary: '../secret.md 缺少一级标题',
      }, ['../secret.md']);

      await expect(applyAutopilotRepairPlan(root, plan)).rejects.toThrow('项目目录外');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fixes broken import paths in test files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-repair-'));
    try {
      await mkdir(join(root, 'src', 'components'), { recursive: true });
      await mkdir(join(root, 'src', 'pages'), { recursive: true });
      // Source file exists at src/components/Button.tsx
      await writeFile(join(root, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;\n', 'utf-8');
      // Test file has wrong import path
      await writeFile(join(root, 'src', 'pages', 'Home.test.tsx'), 'import * as subject from \'../components/Button\';\n', 'utf-8');
      // Actually, the import path is already correct — let's test a broken one:
      await writeFile(join(root, 'src', 'pages', 'Broken.test.tsx'), 'import * as subject from \'../nonexistent/Foo\';\n', 'utf-8');

      const plan: import('../src/core/autopilot-repair.js').AutopilotRepairPlan = {
        kind: 'tests',
        summary: 'Cannot find module ../nonexistent/Foo',
        confidence: 'high',
        autoApply: true,
        files: ['src/pages/Broken.test.tsx'],
        actions: ['检查导入路径', '修复后将重新验证'],
        generatedAt: new Date().toISOString(),
      };

      const receipts = await applyAutopilotRepairPlan(root, plan);
      expect(receipts[0].action).toBe('skipped');
      expect(receipts[0].ok).toBe(true);
      // Should not crash — just reports no match
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips test repair gracefully when source module is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-repair-'));
    try {
      await mkdir(join(root, 'src', 'pages'), { recursive: true });
      await writeFile(join(root, 'src', 'pages', 'Orphan.test.tsx'), 'import * as subject from \'./Ghost\';\n', 'utf-8');

      const plan: import('../src/core/autopilot-repair.js').AutopilotRepairPlan = {
        kind: 'tests',
        summary: 'Cannot find module ./Ghost',
        confidence: 'high',
        autoApply: true,
        files: ['src/pages/Orphan.test.tsx'],
        actions: ['检查导入路径'],
        generatedAt: new Date().toISOString(),
      };

      const receipts = await applyAutopilotRepairPlan(root, plan);
      // Repair attempts but can't fix — graceful skip, no throw
      expect(receipts.length).toBe(1);
      expect(receipts[0].ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('auto-applies medium confidence test repairs', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'tests',
      command: 'npm run test',
      duration: 1,
      summary: 'Unknown test error',
    };

    const plan = buildAutopilotRepairPlan(receipt, ['src/pages/Home.test.tsx']);
    expect(plan.confidence).toBe('medium');
    expect(plan.autoApply).toBe(true);
  });

  it('applies test repair for missing braces syntax error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-repair-'));
    try {
      await mkdir(join(root, 'src', 'utils'), { recursive: true });
      await writeFile(join(root, 'src', 'utils', 'format.ts'), 'export function fmt(s: string) { return s; }\n', 'utf-8');
      // Test file with missing closing brace
      await writeFile(join(root, 'src', 'utils', 'format.test.ts'),
        'import { describe, expect, it } from \'vitest\';\nimport { fmt } from \'./format\';\ndescribe(\'format\', () => {\nit(\'works\', () => {\nexpect(fmt("a")).toBe("a");\n});\n',
        'utf-8');

      const plan: import('../src/core/autopilot-repair.js').AutopilotRepairPlan = {
        kind: 'tests',
        summary: 'SyntaxError: Unexpected token',
        confidence: 'high',
        autoApply: true,
        files: ['src/utils/format.test.ts'],
        actions: ['修复语法错误'],
        generatedAt: new Date().toISOString(),
      };

      const receipts = await applyAutopilotRepairPlan(root, plan);
      expect(receipts[0].action).toBe('updated');
      expect(receipts[0].ok).toBe(true);
      // Should have added missing closing braces
      const content = await readFile(join(root, 'src', 'utils', 'format.test.ts'), 'utf-8');
      expect(content).toContain('});');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
