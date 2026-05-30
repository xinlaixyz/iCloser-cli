import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createEmptyProjectMemory, loadProjectMemory, saveProjectMemory } from '../src/core/memory.js';
import {
  addProjectMemoryRule,
  buildTaskMemorySummary,
  deleteProjectMemoryRule,
  detectMemoryConflicts,
  ensureAgentMemoryManifest,
  explainMemoryUse,
  getTaskMemoryPreview,
  proposePostTaskMemoryCandidate,
  renderTaskMemorySummary,
} from '../src/core/memory-experience.js';
import type { MemoryMetadata } from '../src/types.js';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'icloser-memory-exp-'));
}

function metadata(id: string): MemoryMetadata {
  const now = new Date().toISOString();
  return {
    id,
    scope: 'project',
    source: 'user',
    createdAt: now,
    updatedAt: now,
    reviewStatus: 'approved',
    version: 1,
    evidence: [],
    riskLevel: 'low',
    compressionLevel: 'rule',
    sourceEventIds: [],
    redacted: false,
  };
}

async function cleanupRoot(root: string): Promise<void> {
  const { resetMemoryRuntime } = await import('../src/core/memory/integration.js');
  await resetMemoryRuntime();
  rmSync(root, { recursive: true, force: true });
}

describe('memory experience helpers', () => {
  afterEach(async () => {
    const { resetMemoryRuntime } = await import('../src/core/memory/integration.js');
    await resetMemoryRuntime();
  });

  it('previews relevant approved memory candidates with Chinese and English aliases', async () => {
    const root = makeRoot();
    try {
      const memory = createEmptyProjectMemory(root);
      memory.memoryCandidates.push({
        id: 'mem-1',
        kind: 'preference',
        content: 'Always explain memory recall before code execution.',
        summary: '执行代码前解释长期记忆',
        suggestedScope: 'project',
        riskLevel: 'low',
        reviewStatus: 'approved',
        suggestedAction: 'auto-approve-project',
        reason: '用户要求长期记忆体验透明。',
        sourceEventIds: ['uie-1'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: metadata('meta-1'),
      });
      await saveProjectMemory(root, memory);
      const preview = await getTaskMemoryPreview(root, 'improve memory UX', 5);
      expect(preview.some(item => item.id === 'mem-1')).toBe(true);
    } finally {
      await cleanupRoot(root);
    }
  });

  it('explains a memory candidate by id', async () => {
    const root = makeRoot();
    try {
      const memory = createEmptyProjectMemory(root);
      memory.memoryCandidates.push({
        id: 'mem-why',
        kind: 'rule',
        content: 'Use task reports in PR drafts.',
        summary: 'PR 草稿必须带任务报告',
        suggestedScope: 'project',
        riskLevel: 'low',
        reviewStatus: 'approved',
        suggestedAction: 'auto-approve-project',
        reason: '团队协作需要验收证据。',
        sourceEventIds: ['uie-why'],
        taskId: 'task-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: metadata('meta-why'),
      });
      await saveProjectMemory(root, memory);
      const why = await explainMemoryUse(root, 'mem-why');
      expect(why?.reason).toContain('团队协作');
      expect(why?.taskId).toBe('task-1');
    } finally {
      await cleanupRoot(root);
    }
  });

  it('creates an AGENTS.md memory manifest when missing', async () => {
    const root = makeRoot();
    try {
      await saveProjectMemory(root, createEmptyProjectMemory(root));
      const manifest = await ensureAgentMemoryManifest(root);
      expect(manifest.created).toBe(true);
      expect(manifest.content).toContain('Claude Code alternative');
    } finally {
      await cleanupRoot(root);
    }
  });

  it('adds and deletes project rules while syncing AGENTS.md', async () => {
    const root = makeRoot();
    try {
      await saveProjectMemory(root, createEmptyProjectMemory(root));
      const rule = await addProjectMemoryRule(root, '默认先运行 tsc 验证');
      expect(rule.description).toContain('tsc');
      let manifest = await ensureAgentMemoryManifest(root);
      expect(manifest.content).toContain('默认先运行 tsc 验证');

      const removed = await deleteProjectMemoryRule(root, rule.id);
      expect(removed?.id).toBe(rule.id);
      manifest = await ensureAgentMemoryManifest(root);
      expect(manifest.content).not.toContain('默认先运行 tsc 验证');
    } finally {
      await cleanupRoot(root);
    }
  });

  it('renders startup memory summary with counts and conflict hints', async () => {
    const root = makeRoot();
    try {
      const memory = createEmptyProjectMemory(root);
      memory.rules.push(
        { id: 'r1', description: '必须使用中文输出', scope: '*', createdAt: new Date().toISOString(), permanent: true },
        { id: 'r2', description: '默认使用 English documentation', scope: '*', createdAt: new Date().toISOString(), permanent: true },
      );
      await saveProjectMemory(root, memory);
      const summary = await buildTaskMemorySummary(root, '输出文档', 5);
      const rendered = renderTaskMemorySummary(summary);
      expect(rendered).toContain('项目规则    2 条');
      expect(rendered).toContain('冲突提示');
      expect(detectMemoryConflicts(memory).length).toBeGreaterThan(0);
    } finally {
      await cleanupRoot(root);
    }
  });

  it('includes AGENTS.md imported semantic rules in task memory summary', async () => {
    const root = makeRoot();
    try {
      writeFileSync(join(root, 'AGENTS.md'), [
        '# Agent rules',
        '',
        '- 所有公开 API 必须包含 JSDoc 注释。',
        '- 数学函数必须处理 NaN/Infinity 边界情况。',
        '- 测试文件名遵循 index.test.js 约定。',
        '',
      ].join('\n'), 'utf-8');

      const { getMemoryRuntime } = await import('../src/core/memory/integration.js');
      const { importAgentMemoryManifests } = await import('../src/core/memory/manifest.js');
      const runtime = await getMemoryRuntime(root);
      await importAgentMemoryManifests(root, runtime.semantic);

      const summary = await buildTaskMemorySummary(root, '为 add 和 multiply 函数添加参数校验', 5);
      const rendered = renderTaskMemorySummary(summary);

      expect(summary.items.some(item => item.status === 'manifest')).toBe(true);
      expect(rendered).toContain('本次采用记忆');
      expect(rendered).toContain('数学函数必须处理 NaN/Infinity');
    } finally {
      await cleanupRoot(root);
    }
  });

  it('force sync writes approved memory candidates back to AGENTS.md', async () => {
    const root = makeRoot();
    try {
      const memory = createEmptyProjectMemory(root);
      memory.memoryCandidates.push({
        id: 'mem-approved',
        kind: 'rule',
        content: 'PR drafts must include verification logs.',
        summary: 'PR 草稿必须包含验证日志',
        suggestedScope: 'project',
        riskLevel: 'low',
        reviewStatus: 'approved',
        suggestedAction: 'auto-approve-project',
        reason: '交付验收需要证据链。',
        sourceEventIds: ['uie-approved'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: metadata('meta-approved'),
      });
      await saveProjectMemory(root, memory);
      const manifest = await ensureAgentMemoryManifest(root, 'AGENTS.md', { force: true });
      expect(manifest.content).toContain('PR 草稿必须包含验证日志');
    } finally {
      await cleanupRoot(root);
    }
  });

  it('proposes post-task memory only after quality gate passes', async () => {
    const root = makeRoot();
    try {
      await saveProjectMemory(root, createEmptyProjectMemory(root));
      const skipped = await proposePostTaskMemoryCandidate({
        rootPath: root,
        taskId: 'task-low',
        type: 'analysis',
        input: '写一份投资报告',
        finalResponse: '太短',
        qualityGate: {
          score: 60,
          status: 'fail',
          template: '投资/市场研究质量门',
          required: ['竞品分析'],
          present: [],
          missing: ['竞品分析'],
        },
        codeDelivery: { status: 'none', changes: [], summary: '' },
      });
      expect(skipped).toBeNull();

      const candidate = await proposePostTaskMemoryCandidate({
        rootPath: root,
        taskId: 'task-ok',
        type: 'analysis',
        input: '补齐 iCloser 投资报告和竞品分析',
        finalResponse: '完整报告',
        qualityGate: {
          score: 92,
          status: 'pass',
          template: '投资/市场研究质量门',
          required: ['公司概况', '竞品分析'],
          present: ['公司概况', '竞品分析'],
          missing: [],
        },
        codeDelivery: { status: 'none', changes: [], summary: '' },
      });

      expect(candidate?.summary).toContain('分析报告模板');
      const memory = await loadProjectMemory(root);
      expect(memory.memoryCandidates.some(item => item.taskId === 'task-ok')).toBe(true);
    } finally {
      await cleanupRoot(root);
    }
  });
});
