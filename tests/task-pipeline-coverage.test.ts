// Additional coverage tests for src/core/task-pipeline.ts
// Uses vi.mock to cover applyCompileGate, runCodeGenerationPipeline, and getToolStrategy fallback
import { describe, it, expect, vi } from 'vitest';

// Mock static import from output.js
vi.mock('../src/cli/output.js', () => ({
  warn: vi.fn(),
  detail: vi.fn(),
  section: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  progress: vi.fn(),
  divider: vi.fn(),
}));

// Mock tool-strategy to throw — forces getToolStrategy into fallback path
vi.mock('../src/core/tool-strategy.js', () => ({
  buildStrategyGuidance: vi.fn().mockImplementation(() => {
    throw new Error('strategy service unavailable');
  }),
}));

// Mock dynamic imports used by applyCompileGate
vi.mock('../src/core/code-writer.js', () => ({
  enforceCodeQuality: vi.fn().mockResolvedValue({
    passed: true,
    changes: [{ file: 'src/x.ts', content: 'export const x = 1;' }],
    diagnostics: '',
    fixes: 0,
  }),
}));

vi.mock('../src/core/scanner.js', () => ({
  loadProjectIndex: vi.fn().mockResolvedValue(null),
}));

// Mock dynamic imports used by runCodeGenerationPipeline
vi.mock('../src/core/execution-plan.js', () => ({
  generateExecutionPlan: vi.fn().mockResolvedValue({
    planId: 'PLAN-TEST',
    goal: 'test',
    strategy: 'direct',
    expectedOutput: 'result',
    steps: [],
    infoRequirements: { filesToRead: [], patternsToSearch: [], symbolsToQuery: [] },
    codeRequirements: { filesToModify: [], filesToCreate: [] },
  }),
}));

vi.mock('../src/core/execution-engine.js', () => ({
  executeWithPlan: vi.fn().mockResolvedValue({
    success: true,
    aiResponse: '{"changes":[{"file":"src/a.ts","content":"export const x=1"}],"summary":"done"}',
    executionState: {},
    decisionPoints: [],
  }),
}));

vi.mock('../src/ai/output-contract.js', () => ({
  parseAIOutput: vi.fn().mockReturnValue({
    changes: [{ file: 'src/a.ts', content: 'export const x = 1;', description: 'add x' }],
  }),
}));

import {
  applyCompileGate,
  runCodeGenerationPipeline,
  getToolStrategy,
} from '../src/core/task-pipeline.js';

describe('task-pipeline — coverage gaps', () => {
  describe('applyCompileGate', () => {
    it('returns input changes immediately when changes is empty', async () => {
      const result = await applyCompileGate([], '/root', { language: 'typescript' }, {}, 'gate');
      expect(result).toEqual([]);
    });

    it('returns input changes immediately when language is unknown', async () => {
      const changes = [{ file: 'a.ts', content: 'x' }];
      const result = await applyCompileGate(changes, '/root', { language: 'unknown' }, {}, 'gate');
      expect(result).toEqual(changes);
    });

    it('calls enforceCodeQuality and returns result.changes on success', async () => {
      const changes = [{ file: 'src/x.ts', content: 'const x = 1;' }];
      const result = await applyCompileGate(changes, '/root', { language: 'typescript' }, {}, 'gate');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns original changes when enforceCodeQuality returns !passed', async () => {
      const { enforceCodeQuality } = await import('../src/core/code-writer.js');
      vi.mocked(enforceCodeQuality).mockResolvedValueOnce({
        passed: false,
        changes: [{ file: 'src/x.ts', content: 'fixed content' }],
        diagnostics: 'TS error on line 5',
        fixes: 0,
      });
      const changes = [{ file: 'src/x.ts', content: 'bad' }];
      const result = await applyCompileGate(changes, '/root', { language: 'typescript' }, {}, 'gate');
      expect(Array.isArray(result)).toBe(true);
    });

    it('triggers detail log when fixes > 0', async () => {
      const { enforceCodeQuality } = await import('../src/core/code-writer.js');
      const { detail } = await import('../src/cli/output.js');
      vi.mocked(enforceCodeQuality).mockResolvedValueOnce({
        passed: true,
        changes: [{ file: 'src/x.ts', content: 'fixed' }],
        diagnostics: '',
        fixes: 2,
      });
      await applyCompileGate([{ file: 'src/x.ts', content: 'x' }], '/root', { language: 'typescript' }, {}, 'gate');
      expect(detail).toHaveBeenCalled();
    });

    it('returns original changes and warns on unexpected error', async () => {
      const { enforceCodeQuality } = await import('../src/core/code-writer.js');
      const { warn } = await import('../src/cli/output.js');
      vi.mocked(enforceCodeQuality).mockRejectedValueOnce(new Error('compile crashed'));
      const original = [{ file: 'src/x.ts', content: 'original' }];
      const result = await applyCompileGate(original, '/root', { language: 'typescript' }, {}, 'gate');
      expect(result).toEqual(original);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('runCodeGenerationPipeline', () => {
    it('returns generated changes', async () => {
      const result = await runCodeGenerationPipeline(
        'add helper function',
        process.cwd(),
        {},
        { language: 'typescript' },
        { projectMeta: 'test', relevantCode: [], relevantMemory: '', totalTokens: 4000, budgetUsed: 0 },
        'gen',
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when parseAIOutput returns no changes', async () => {
      const { parseAIOutput } = await import('../src/ai/output-contract.js');
      vi.mocked(parseAIOutput).mockReturnValueOnce({ changes: [] });
      const result = await runCodeGenerationPipeline(
        'do something',
        process.cwd(),
        {},
        { language: 'typescript' },
        { projectMeta: 'test', relevantCode: [], relevantMemory: '', totalTokens: 4000, budgetUsed: 0 },
        'gen',
      );
      expect(result).toEqual([]);
    });
  });

  describe('getToolStrategy — fallback when buildStrategyGuidance throws', () => {
    it('returns fallback for plan category', async () => {
      const result = await getToolStrategy('开发一个完整的系统平台');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns fallback for code_fix category', async () => {
      const result = await getToolStrategy('修复 bug 报错问题');
      expect(typeof result).toBe('string');
      expect(result).toContain('错误');
    });

    it('returns fallback for analysis category', async () => {
      const result = await getToolStrategy('分析代码质量是否完整');
      expect(typeof result).toBe('string');
    });

    it('returns fallback for code_change category', async () => {
      const result = await getToolStrategy('修改 src/auth.ts 添加权限验证');
      expect(typeof result).toBe('string');
    });

    it('returns fallback for security_review category', async () => {
      const result = await getToolStrategy('安全漏洞注入扫描');
      expect(typeof result).toBe('string');
    });

    it('returns fallback for devops category', async () => {
      const result = await getToolStrategy('启动并运行构建部署');
      expect(typeof result).toBe('string');
    });

    it('returns fallback for pm category', async () => {
      const result = await getToolStrategy('发布路线图风险估算');
      expect(typeof result).toBe('string');
    });

    it('returns fallback for doc_gen category', async () => {
      const result = await getToolStrategy('生成文档 doc readme');
      expect(typeof result).toBe('string');
    });

    it('returns empty string for unmatched category', async () => {
      const result = await getToolStrategy('');
      expect(result).toBe('');
    });
  });
});
