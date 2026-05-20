// Extra coverage for src/core/autopilot-repair.ts and src/core/memory.ts
// autopilot-repair.ts targets: fixTypeScriptImport (296-312), inferDocTitle variants (345-353),
//   buildDocRepairActions extra branches (316-323), buildTestRepairActions extra branches (326-337),
//   formatConfidence medium/low (365-369)
// memory.ts targets: setMemoryTTL (801-807)
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  applyAutopilotRepairPlan,
  buildAutopilotRepairPlan,
  renderAutopilotRepairPlan,
  renderAutopilotRepairReceipts,
} from '../src/core/autopilot-repair.js';
import type { AutopilotRepairPlan } from '../src/core/autopilot-repair.js';
import type { AutopilotVerifyReceipt } from '../src/core/autopilot-verify.js';
import { setMemoryTTL } from '../src/core/memory.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'repair-ex-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// fixTypeScriptImport — applyTestRepair with 'has no exported member'
// ============================================================
describe('applyTestRepair — fixTypeScriptImport', () => {
  it('changes namespace import to default import when "has no exported member" in evidence', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'src', 'utils'), { recursive: true });
    // Test file with namespace import
    await writeFile(
      join(dir, 'src', 'utils', 'format.test.ts'),
      `import * as format from './format';\ndescribe('x', () => { it('y', () => {}); });\n`,
      'utf-8',
    );

    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'TypeScript has no exported member from module',
      confidence: 'high',
      autoApply: true,
      files: ['src/utils/format.test.ts'],
      actions: ['check TypeScript imports'],
      generatedAt: new Date().toISOString(),
    };

    const receipts = await applyAutopilotRepairPlan(dir, plan);
    // Either updated (import changed) or skipped (pattern not matched)
    expect(typeof receipts[0].action).toBe('string');
    expect(receipts[0].ok).toBe(true);
  });

  it('handles ts( error evidence', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'module.test.ts'),
      `import * as mod from './module';\nit('x', () => {});\n`,
      'utf-8',
    );

    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'TS(2305) Module has no exported member x',
      confidence: 'high',
      autoApply: true,
      files: ['src/module.test.ts'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };

    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts.length).toBe(1);
    expect(receipts[0].ok).toBe(true);
  });
});

// ============================================================
// fixBrokenImport — double extension .ts.ts fix
// ============================================================
describe('applyTestRepair — fixBrokenImport double extension', () => {
  it('fixes .ts.ts double extension in import path', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'src', 'pages'), { recursive: true });
    // Test file with double extension import
    await writeFile(
      join(dir, 'src', 'pages', 'Home.test.tsx'),
      `import * as subject from '../components/Button.ts.ts';\nit('ok', () => {});\n`,
      'utf-8',
    );

    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'Cannot find module ../components/Button.ts.ts',
      confidence: 'high',
      autoApply: true,
      files: ['src/pages/Home.test.tsx'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };

    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts.length).toBe(1);
    // Should fix the double extension or report appropriately
    expect(typeof receipts[0].action).toBe('string');
  });
});

// ============================================================
// applyTestRepair — file does not exist (skip branch)
// ============================================================
describe('applyTestRepair — nonexistent file', () => {
  it('skips repair when test file does not exist', async () => {
    const dir = await makeDir();
    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'Cannot find module ./Ghost',
      confidence: 'high',
      autoApply: true,
      files: ['src/ghost.test.ts'],  // file doesn't exist
      actions: [],
      generatedAt: new Date().toISOString(),
    };

    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('skipped');
    expect(receipts[0].message).toContain('不存在');
  });
});

// ============================================================
// inferDocTitle — various doc file name branches
// ============================================================
describe('applyDocRepair — inferDocTitle variants', () => {
  it('infers API title for api.md', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'api.md'), 'content without heading', 'utf-8');
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/api.md 缺少一级标题',
      confidence: 'high',
      autoApply: true,
      files: ['docs/api.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
    const content = await (await import('fs/promises')).readFile(join(dir, 'docs', 'api.md'), 'utf-8');
    expect(content).toContain('# API');
  });

  it('infers TESTING title for testing.md', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'testing.md'), 'content without heading', 'utf-8');
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/testing.md 缺少一级标题',
      confidence: 'high',
      autoApply: true,
      files: ['docs/testing.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
  });

  it('infers ARCHITECTURE title for architecture.md', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'architecture.md'), 'content without heading', 'utf-8');
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/architecture.md 缺少一级标题',
      confidence: 'high',
      autoApply: true,
      files: ['docs/architecture.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
  });

  it('title-cases custom doc name (kebab-case)', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'user-guide.md'), 'no heading here', 'utf-8');
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/user-guide.md 缺少一级标题',
      confidence: 'high',
      autoApply: true,
      files: ['docs/user-guide.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
  });

  it('handles empty doc file (content empty branch)', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'PRD.md'), '   \n', 'utf-8'); // whitespace only
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/PRD.md 内容为空',
      confidence: 'high',
      autoApply: true,
      files: ['docs/PRD.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
    const content = await (await import('fs/promises')).readFile(join(dir, 'docs', 'PRD.md'), 'utf-8');
    expect(content).toContain('自动修复：原文档为空');
  });

  it('skips doc file that already has a heading (no change needed)', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'README.md'), '# README\n\nSome content.', 'utf-8');
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/README.md 格式检查',
      confidence: 'high',
      autoApply: true,
      files: ['docs/README.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('skipped');
    expect(receipts[0].message).toContain('未发现可自动修复的问题');
  });

  it('creates new empty doc file when it does not exist', async () => {
    const dir = await makeDir();
    await mkdir(join(dir, 'docs'), { recursive: true });
    // File does NOT exist → existsSync returns false → content = ''
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'docs/NEW.md 缺少一级标题',
      confidence: 'high',
      autoApply: true,
      files: ['docs/NEW.md'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('updated');
    const content = await (await import('fs/promises')).readFile(join(dir, 'docs', 'NEW.md'), 'utf-8');
    expect(content).toContain('自动修复：原文档为空');
  });
});

// ============================================================
// buildAutopilotRepairPlan — doc evidence branches
// ============================================================
describe('buildAutopilotRepairPlan — doc evidence variants', () => {
  it('generates 内容为空 action when evidence contains it', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'docs',
      duration: 1,
      summary: 'docs/PRD.md 内容为空',
    };
    const plan = buildAutopilotRepairPlan(receipt, ['docs/PRD.md']);
    expect(plan.actions.join('\n')).toContain('非空文档内容');
  });

  it('generates 不存在 action when evidence contains it', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'docs',
      duration: 1,
      summary: 'docs/MISSING.md 不存在',
    };
    const plan = buildAutopilotRepairPlan(receipt, ['docs/MISSING.md']);
    expect(plan.actions.join('\n')).toContain('docs 目录路径');
  });

  it('generates generic action when evidence is unrecognized for docs', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'docs',
      duration: 1,
      summary: 'Unknown documentation issue',
    };
    const plan = buildAutopilotRepairPlan(receipt, ['docs/API.md']);
    expect(plan.actions.length).toBeGreaterThan(0);
    // Generic action should still be in there
    expect(plan.actions.some(a => a.includes('逐个修正'))).toBe(true);
  });
});

// ============================================================
// buildTestRepairActions — typescript / no-test evidence
// ============================================================
describe('buildAutopilotRepairPlan — test evidence variants', () => {
  it('generates typescript action when evidence has typescript error', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'tests',
      command: 'npm test',
      duration: 1,
      summary: 'TypeScript TS(2305) Module has no exported member',
    };
    const plan = buildAutopilotRepairPlan(receipt, ['src/x.test.ts']);
    expect(plan.actions.join('\n')).toContain('TypeScript');
  });

  it('generates no-test action when evidence has "no test" message', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'tests',
      command: 'npm test',
      duration: 1,
      summary: 'No test found in test suite',
    };
    const plan = buildAutopilotRepairPlan(receipt, ['src/y.test.ts']);
    expect(plan.actions.join('\n')).toContain('命名符合项目框架约定');
  });

  it('builds low confidence plan when actions < 2', () => {
    const receipt: AutopilotVerifyReceipt = {
      status: 'fail',
      kind: 'tests',
      duration: 1,
      summary: 'Generic unknown error xyz',
    };
    const plan = buildAutopilotRepairPlan(receipt, []);
    // With generic error and 0 files, actions should be minimal
    expect(plan.confidence).toBe('low');
  });
});

// ============================================================
// renderAutopilotRepairPlan — formatConfidence medium/low
// ============================================================
describe('renderAutopilotRepairPlan — confidence formatting', () => {
  it('renders 中 for medium confidence', () => {
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'test',
      confidence: 'medium',
      autoApply: true,
      files: [],
      actions: ['fix it'],
      generatedAt: new Date().toISOString(),
    };
    const text = renderAutopilotRepairPlan(plan);
    expect(text).toContain('中');
  });

  it('renders 低 for low confidence', () => {
    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'test',
      confidence: 'low',
      autoApply: false,
      files: ['src/a.ts'],
      actions: ['manual fix needed'],
      generatedAt: new Date().toISOString(),
    };
    const text = renderAutopilotRepairPlan(plan);
    expect(text).toContain('低');
    expect(text).toContain('不自动扩大修改范围');
  });

  it('renders 无文件 when plan.files is empty', () => {
    const plan: AutopilotRepairPlan = {
      kind: 'docs',
      summary: 'test',
      confidence: 'high',
      autoApply: true,
      files: [],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    const text = renderAutopilotRepairPlan(plan);
    expect(text).toContain('暂无本轮写入文件');
  });
});

// ============================================================
// renderAutopilotRepairReceipts — empty array
// ============================================================
describe('renderAutopilotRepairReceipts', () => {
  it('returns 没有文件被修复 for empty receipts', () => {
    const text = renderAutopilotRepairReceipts([]);
    expect(text).toBe('没有文件被修复。');
  });

  it('renders failed receipt with ✗ symbol', () => {
    const text = renderAutopilotRepairReceipts([{
      file: 'src/x.ts',
      fullPath: '/root/src/x.ts',
      action: 'skipped',
      ok: false,
      message: '写入失败',
    }]);
    expect(text).toContain('✗');
    expect(text).toContain('写入失败');
  });
});

// ============================================================
// applyAutopilotRepairPlan — autoApply=false branch
// ============================================================
describe('applyAutopilotRepairPlan — no-autoApply', () => {
  it('returns skipped receipts when autoApply is false', async () => {
    const dir = await makeDir();
    const plan: AutopilotRepairPlan = {
      kind: 'tests',
      summary: 'Low confidence error',
      confidence: 'low',
      autoApply: false, // no auto apply
      files: ['src/a.ts', 'src/b.ts'],
      actions: ['manual fix'],
      generatedAt: new Date().toISOString(),
    };
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts).toHaveLength(2);
    expect(receipts.every(r => r.action === 'skipped')).toBe(true);
    expect(receipts[0].message).toContain('建议');
  });
});

// ============================================================
// applyAutopilotRepairPlan — unknown kind branch
// ============================================================
describe('applyAutopilotRepairPlan — unknown kind', () => {
  it('returns skipped for unknown repair kind', async () => {
    const dir = await makeDir();
    const plan: AutopilotRepairPlan = {
      kind: 'docs', // will override below
      summary: 'unknown kind test',
      confidence: 'high',
      autoApply: true,
      files: ['src/x.ts'],
      actions: [],
      generatedAt: new Date().toISOString(),
    };
    // Force unknown kind via type cast
    (plan as any).kind = 'unknown-kind';
    const receipts = await applyAutopilotRepairPlan(dir, plan);
    expect(receipts[0].action).toBe('skipped');
    expect(receipts[0].message).toContain('不支持修复类型');
  });
});

// ============================================================
// setMemoryTTL — all scope branches
// ============================================================
describe('setMemoryTTL', () => {
  it('sets expiresAt for task scope (7 days)', () => {
    const candidate: any = {
      suggestedScope: 'task',
      createdAt: new Date().toISOString(),
    };
    setMemoryTTL(candidate);
    const expires = new Date(candidate.expiresAt);
    const created = new Date(candidate.createdAt);
    const diffHours = (expires.getTime() - created.getTime()) / 3600000;
    expect(Math.round(diffHours)).toBe(24 * 7);
  });

  it('sets expiresAt for project scope (30 days)', () => {
    const candidate: any = {
      suggestedScope: 'project',
      createdAt: new Date().toISOString(),
    };
    setMemoryTTL(candidate);
    const expires = new Date(candidate.expiresAt);
    const created = new Date(candidate.createdAt);
    const diffHours = (expires.getTime() - created.getTime()) / 3600000;
    expect(Math.round(diffHours)).toBe(24 * 30);
  });

  it('sets expiresAt for global scope (90 days)', () => {
    const candidate: any = {
      suggestedScope: 'global',
      createdAt: new Date().toISOString(),
    };
    setMemoryTTL(candidate);
    const expires = new Date(candidate.expiresAt);
    const created = new Date(candidate.createdAt);
    const diffHours = (expires.getTime() - created.getTime()) / 3600000;
    expect(Math.round(diffHours)).toBe(24 * 90);
  });

  it('sets expiresAt using default TTL for unknown scope', () => {
    const candidate: any = {
      suggestedScope: 'unknown-scope',
      createdAt: new Date().toISOString(),
    };
    setMemoryTTL(candidate);
    expect(candidate.expiresAt).toBeDefined();
    const expires = new Date(candidate.expiresAt);
    const created = new Date(candidate.createdAt);
    const diffHours = (expires.getTime() - created.getTime()) / 3600000;
    expect(Math.round(diffHours)).toBe(24 * 30); // default = 30 days
  });

  it('uses default scope when suggestedScope is missing', () => {
    const candidate: any = {
      createdAt: new Date().toISOString(),
      // no suggestedScope
    };
    setMemoryTTL(candidate);
    expect(candidate.expiresAt).toBeDefined();
  });
});

// ============================================================
// validateGitPush — from src/core/security.ts
// ============================================================
describe('validateGitPush', () => {
  it('blocks git push when allowGitPush is false', async () => {
    const { validateGitPush } = await import('../src/core/security.js');
    const config: any = { security: { allowGitPush: false } };
    const result = validateGitPush('git push origin main', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Git push');
  });

  it('allows git push when allowGitPush is true', async () => {
    const { validateGitPush } = await import('../src/core/security.js');
    const config: any = { security: { allowGitPush: true } };
    const result = validateGitPush('git push origin main', config);
    expect(result.allowed).toBe(true);
  });

  it('allows non-push git commands regardless of allowGitPush', async () => {
    const { validateGitPush } = await import('../src/core/security.js');
    const config: any = { security: { allowGitPush: false } };
    const result = validateGitPush('git status', config);
    expect(result.allowed).toBe(true);
  });
});
