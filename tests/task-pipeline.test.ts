// Coverage: task-pipeline.ts unit tests
import { describe, it, expect } from 'vitest';

describe('task-pipeline', () => {
  it('isAnalysisOnlyTask detects analysis', async () => {
    const { isAnalysisOnlyTask } = await import('../src/core/task-pipeline.js');
    expect(isAnalysisOnlyTask('分析项目代码质量')).toBe(true);
    expect(isAnalysisOnlyTask('检查安全性')).toBe(true);
    expect(isAnalysisOnlyTask('修改 src/auth.ts')).toBe(false);
    expect(isAnalysisOnlyTask('修复 bug')).toBe(false);
  });

  it('isAnalysisOnlyTask handles edge cases', async () => {
    const { isAnalysisOnlyTask } = await import('../src/core/task-pipeline.js');
    expect(isAnalysisOnlyTask('当前目录是什么结构')).toBe(true);
    expect(isAnalysisOnlyTask('帮我分析一下')).toBe(true);
    expect(isAnalysisOnlyTask('修改并分析')).toBe(false); // has both, code wins
  });

  it('getToolStrategy returns strategy for code_change', async () => {
    const { getToolStrategy } = await import('../src/core/task-pipeline.js');
    const result = await getToolStrategy('修改 src/auth.ts 添加登录');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  it('getToolStrategy returns empty for unknown', async () => {
    const { getToolStrategy } = await import('../src/core/task-pipeline.js');
    const result = await getToolStrategy('');
    expect(result).toBe('');
  });

  it('getToolStrategy returns strategy for analysis', async () => {
    const { getToolStrategy } = await import('../src/core/task-pipeline.js');
    const result = await getToolStrategy('分析项目代码质量和结构');
    expect(result).toContain('read_file');
  });
});

describe('detect.ts edge cases', () => {
  it('detectProject handles empty directory', async () => {
    const { detectProject } = await import('../src/utils/detect.js');
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const d = mkdtempSync(join(tmpdir(), 'icloser-detect-'));
    try {
      const result = await detectProject(d);
      expect(result.language).toBeDefined();
      expect(result.framework).toBeDefined();
    } finally { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  });
});

describe('provider.ts edge cases', () => {
  it('createProvider returns mock by default', async () => {
    const { createProvider } = await import('../src/ai/provider.js');
    const p = createProvider({ provider: 'mock', model: 'mock-offline', apiKey: '', maxTokens: 4000, temperature: 0 });
    expect(p.name).toBe('mock');
    expect(p.supportsToolUse).toBe(false);
  });

  it('maskApiKey masks correctly', async () => {
    const { maskApiKey } = await import('../src/ai/provider.js');
    const masked = maskApiKey('sk-ant-test123456789');
    expect(masked).toContain('...');
    expect(masked.length).toBeLessThan('sk-ant-test123456789'.length);
  });

  it('inferProviderFromApiKey detects Claude', async () => {
    const { inferProviderFromApiKey } = await import('../src/ai/provider.js');
    expect(inferProviderFromApiKey('sk-ant-test123', 'deepseek')).toBe('claude');
    expect(inferProviderFromApiKey('sk-or-test123', 'deepseek')).toBe('openai');
    expect(inferProviderFromApiKey('unknown-key', 'deepseek')).toBe('deepseek');
  });
});
