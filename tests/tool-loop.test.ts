import { describe, it, expect, vi } from 'vitest';
import { runToolLoop } from '../src/core/tool-loop.js';
import type { ToolDefinition } from '../src/ai/provider.js';

// Mock provider that returns tool calls then text
function createMockProvider(responses: Array<{ content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }>) {
  let callIdx = 0;
  return {
    name: 'mock',
    supportsStreaming: false,
    supportsToolUse: true,
    defaultModel: 'mock-test',
    availableModels: ['mock-test'],
    chat: vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx] || responses[responses.length - 1];
      callIdx++;
      return {
        content: resp.content,
        toolCalls: resp.toolCalls,
        tokensUsed: 100,
        model: 'mock-test',
      };
    }),
    chatStream: vi.fn(),
  };
}

const testTools: ToolDefinition[] = [
  {
    name: 'test_echo',
    description: 'Echo back the input',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Message to echo' } },
      required: ['message'],
    },
  },
];

describe('tool-loop', () => {
  it('returns direct response when AI gives text without tool calls', async () => {
    const provider = createMockProvider([
      { content: '这是最终分析结果。' },
    ]);

    const result = await runToolLoop({
      task: '分析市场',
      systemPrompt: '你是分析师',
      provider: provider as any,
      tools: testTools,
      rootPath: '/tmp',
      maxRounds: 3,
    });

    expect(result.success).toBe(true);
    expect(result.finalResponse).toBe('这是最终分析结果。');
    expect(result.rounds).toBe(1);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('executes tool calls and feeds results back', async () => {
    const provider = createMockProvider([
      {
        content: '',
        toolCalls: [{ name: 'test_echo', arguments: { message: 'hello' } }],
      },
      {
        content: '基于工具结果的分析。',
      },
    ]);

    const progressEvents: string[] = [];
    const result = await runToolLoop({
      task: '测试',
      systemPrompt: '你是测试专家',
      provider: provider as any,
      tools: testTools,
      rootPath: '/tmp',
      maxRounds: 3,
      onProgress: (e) => { progressEvents.push(e.phase); },
    });

    expect(result.success).toBe(true);
    expect(result.finalResponse).toBe('基于工具结果的分析。');
    expect(result.rounds).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('test_echo');
    expect(progressEvents).toContain('tool_call');
    expect(progressEvents).toContain('done');
  });

  it('stops at maxRounds and forces synthesis', async () => {
    // Always returns tool calls — will hit maxRounds
    const responses = Array.from({ length: 10 }, () => ({
      content: '',
      toolCalls: [{ name: 'test_echo', arguments: { message: 'x' } }],
    }));
    responses.push({ content: '强制合成结果。' }); // final forced response

    const provider = createMockProvider(responses);

    const result = await runToolLoop({
      task: '测试',
      systemPrompt: '你是测试专家',
      provider: provider as any,
      tools: testTools,
      rootPath: '/tmp',
      maxRounds: 2,
    });

    expect(result.rounds).toBe(3); // 2 tool rounds + 1 forced
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
  });
});
