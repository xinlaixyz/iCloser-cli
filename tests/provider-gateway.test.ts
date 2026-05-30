import { describe, expect, it, vi } from 'vitest';
import { formatAICallFailure } from '../src/ai/errors.js';
import { ProviderGateway } from '../src/ai/provider-gateway.js';

describe('ProviderGateway', () => {
  it('normalizes prompt content and enforces timeout', async () => {
    const inner = {
      name: 'deepseek',
      supportsStreaming: true,
      supportsToolUse: true,
      defaultModel: 'deepseek-v4-pro',
      availableModels: ['deepseek-v4-pro'],
      chat: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { content: 'late', tokensUsed: 1, model: 'deepseek-v4-pro' };
      }),
      chatStream: vi.fn(),
    };
    const gateway = new ProviderGateway({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-test',
      maxTokens: 1000,
      temperature: 0,
    }, inner as any, { timeoutMs: 5 });

    await expect(gateway.chat({
      systemPrompt: 'sys',
      task: 'D:\\temp\\x',
      history: 'h'.repeat(100),
      context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    })).rejects.toThrow(/超时|timeout/i);
  });

  it('formats provider failures with beginner recovery actions', async () => {
    const inner = {
      name: 'deepseek',
      supportsStreaming: true,
      supportsToolUse: true,
      defaultModel: 'deepseek-v4-pro',
      availableModels: ['deepseek-v4-pro'],
      chat: vi.fn(async () => {
        throw new Error('deepseek Provider 调用超时');
      }),
      chatStream: vi.fn(),
    };
    const gateway = new ProviderGateway({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-test',
      maxTokens: 1000,
      temperature: 0,
    }, inner as any);

    try {
      await gateway.chat({
        systemPrompt: 'sys',
        task: '生成 H5 页面',
        history: '',
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      });
      throw new Error('expected failure');
    } catch (err) {
      const text = formatAICallFailure(err);
      expect(text).toContain('恢复建议');
      expect(text).toContain('deepseek-v4-flash');
    }
  });
});
