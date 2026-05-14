import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { assembleContextFromProject, summarizeContextDebug } from '../src/core/context.js';
import { loadProjectMemory, saveProjectMemory } from '../src/core/memory.js';
import { loadProjectIndex } from '../src/core/scanner.js';
import type { Task } from '../src/types.js';

async function writeProjectFile(root: string, file: string, content: string) {
  const full = join(root, file);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

function createTask(description: string): Task {
  return {
    id: 'task-context-test',
    description,
    status: 'queued',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    changes: [],
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
  };
}

describe('assembleContextFromProject', () => {
  it('builds context from persisted or auto-generated project index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-context-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        dependencies: { express: '^4.18.0' },
        devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      await writeProjectFile(root, 'src/service/user.ts', [
        'export interface User { id: string; name: string; }',
        'export function updateUser(user: User) {',
        '  return { ...user, name: user.name.trim() };',
        '}',
      ].join('\n'));
      await writeProjectFile(root, 'src/api/user-routes.ts', [
        "import { updateUser } from '../service/user';",
        "router.put('/users/:id', updateUser);",
      ].join('\n'));

      const context = await assembleContextFromProject(
        root,
        createTask('update user service validation'),
        { maxTokens: 12000 }
      );

      const loadedIndex = await loadProjectIndex(root);
      expect(loadedIndex).not.toBeNull();
      expect(context.projectMeta).toContain('语言: typescript');
      expect(context.projectMeta).toContain('框架: express');
      expect(context.relevantCode.length).toBeGreaterThan(0);
      expect(context.relevantCode.some(s => s.file.includes('user'))).toBe(true);
      expect(context.totalTokens).toBeGreaterThan(0);
      expect(context.budgetUsed).toBeGreaterThanOrEqual(0);

      const summary = summarizeContextDebug(context, 1);
      expect(summary.codeSnippetCount).toBe(context.relevantCode.length);
      expect(summary.topFiles.length).toBe(1);
      expect(summary.topFiles[0].tokens).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('matches Chinese task descriptions to English source files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-context-cn-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        devDependencies: { typescript: '^5.7.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      await writeProjectFile(root, 'src/service/user.ts', [
        'export interface User { id: string; email: string; }',
        'export function validateUser(user: User) {',
        '  return user.email.includes("@");',
        '}',
      ].join('\n'));
      await writeProjectFile(root, 'src/security/token.ts', [
        'export function signToken() {',
        '  return "token";',
        '}',
      ].join('\n'));

      const context = await assembleContextFromProject(
        root,
        createTask('给用户服务增加邮箱校验'),
        { maxTokens: 12000 }
      );

      expect(context.relevantCode.length).toBeGreaterThan(0);
      expect(context.relevantCode[0].file.replace(/\\/g, '/')).toContain('src/service/user.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes approved reusable memory candidates but excludes proposed ones', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-context-memory-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        devDependencies: { typescript: '^5.7.0' },
      }));
      await writeProjectFile(root, 'tsconfig.json', '{}');
      await writeProjectFile(root, 'docs/README.md', '# docs\n');

      const now = new Date().toISOString();
      const memory = await loadProjectMemory(root);
      memory.memoryCandidates.push({
        id: 'mem-approved-template',
        kind: 'template',
        content: '任务：创建 docs/PRD.md 产品需求文档\n变更文件：docs/PRD.md',
        summary: '流程模板：创建 docs/PRD.md 产品需求文档',
        suggestedScope: 'project',
        riskLevel: 'low',
        reviewStatus: 'approved',
        suggestedAction: 'batch-candidate',
        reason: 'approved template should be reusable',
        sourceEventIds: [],
        createdAt: now,
        updatedAt: now,
        metadata: {
          id: 'meta-approved-template',
          scope: 'project',
          source: 'agent',
          createdAt: now,
          updatedAt: now,
          reviewStatus: 'approved',
          version: 1,
          evidence: [{ type: 'summary', ref: 'task-docs', summary: 'docs PRD' }],
          riskLevel: 'low',
          compressionLevel: 'template',
          sourceEventIds: [],
          redacted: false,
        },
      });
      memory.memoryCandidates.push({
        id: 'mem-proposed-template',
        kind: 'template',
        content: '任务：创建 mobile onboarding',
        summary: '流程模板：未确认 onboarding 模板',
        suggestedScope: 'project',
        riskLevel: 'low',
        reviewStatus: 'proposed',
        suggestedAction: 'batch-candidate',
        reason: 'proposed template should not be injected',
        sourceEventIds: [],
        createdAt: now,
        updatedAt: now,
        metadata: {
          id: 'meta-proposed-template',
          scope: 'project',
          source: 'agent',
          createdAt: now,
          updatedAt: now,
          reviewStatus: 'proposed',
          version: 1,
          evidence: [{ type: 'summary', ref: 'task-mobile', summary: 'mobile' }],
          riskLevel: 'low',
          compressionLevel: 'template',
          sourceEventIds: [],
          redacted: false,
        },
      });
      await saveProjectMemory(root, memory);

      const context = await assembleContextFromProject(
        root,
        createTask('继续生成 docs PRD 文档'),
        { maxTokens: 12000 }
      );

      expect(context.relevantMemory).toContain('## 已确认可复用记忆');
      expect(context.relevantMemory).toContain('流程模板：创建 docs/PRD.md 产品需求文档');
      expect(context.relevantMemory).not.toContain('未确认 onboarding 模板');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
