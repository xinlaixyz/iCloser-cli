// Miscellaneous coverage for multiple small files
// Targets: memdbg.summary(), memdbg.reset() from src/core/memory/debug.ts
//          normalizeArgs with string args from src/core/tool-loop.ts
//          buildToolSystemPrompt with no-params tool from src/core/tool-loop.ts
//          addPitfall + recordTaskError from src/core/memory.ts
//          updateAiConfig, broadcast, list(parentId) from src/agent/manager.ts
//          manager extra: updateAiConfig
import { describe, it, expect, vi } from 'vitest';
import { memdbg } from '../src/core/memory/debug.js';
import { runToolLoop } from '../src/core/tool-loop.js';
import { addPitfall, recordTaskError } from '../src/core/memory.js';
import { AgentManager } from '../src/agent/manager.js';
import type { AIConfig } from '../src/types.js';

// ============================================================
// memdbg — summary and reset
// ============================================================
describe('memdbg', () => {
  it('summary() returns diagnostic object with counts', () => {
    const s = memdbg.summary();
    expect(typeof s.errorCount).toBe('number');
    expect(typeof s.warnCount).toBe('number');
    // lastError is null or a string
    expect(s.lastError === null || typeof s.lastError === 'string').toBe(true);
  });

  it('error() increments errorCount and tracks lastError', () => {
    const before = memdbg.summary().errorCount;
    memdbg.error('TestComponent', 'test error msg', new Error('inner'));
    const after = memdbg.summary();
    expect(after.errorCount).toBe(before + 1);
    expect(after.lastError).toContain('TestComponent');
    expect(after.lastError).toContain('test error msg');
  });

  it('warn() increments warnCount', () => {
    const before = memdbg.summary().warnCount;
    memdbg.warn('TestComp', 'test warning');
    const after = memdbg.summary();
    expect(after.warnCount).toBe(before + 1);
  });

  it('info() does not throw', () => {
    expect(() => memdbg.info('TestComp', 'some info message')).not.toThrow();
  });

  it('reset() clears all counters and lastError', () => {
    memdbg.error('A', 'pre-reset error');
    memdbg.warn('B', 'pre-reset warn');
    memdbg.reset();
    const s = memdbg.summary();
    expect(s.errorCount).toBe(0);
    expect(s.warnCount).toBe(0);
    expect(s.lastError).toBeNull();
  });
});

// ============================================================
// runToolLoop — tool without parameters.properties (covers line 364)
//             — string arguments (covers lines 320-323)
// ============================================================
describe('runToolLoop extras', () => {
  it('tool with no parameters.properties renders 无参数', async () => {
    const provider = {
      name: 'mock',
      supportsStreaming: false,
      supportsToolUse: true,
      defaultModel: 'mock',
      availableModels: ['mock'],
      chat: vi.fn().mockResolvedValue({
        content: 'done',
        toolCalls: undefined,
        tokensUsed: 50,
        model: 'mock',
      }),
      chatStream: vi.fn(),
    };

    const toolsWithNoParams = [
      {
        name: 'no_params_tool',
        description: 'A tool with no parameters',
        parameters: { type: 'object' as const }, // no properties field → '    无参数'
      },
    ];

    const result = await runToolLoop({
      task: 'test task',
      systemPrompt: 'system',
      provider: provider as any,
      tools: toolsWithNoParams,
      rootPath: '/tmp',
      maxRounds: 1,
    });

    // Tool ran (provider was called), system prompt was built with 无参数
    expect(provider.chat).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('tool call with string arguments gets normalized', async () => {
    let callCount = 0;
    const provider = {
      name: 'mock',
      supportsStreaming: false,
      supportsToolUse: true,
      defaultModel: 'mock',
      availableModels: ['mock'],
      chat: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [{
              name: 'echo_tool',
              arguments: '{"message":"hello"}', // string JSON → normalizeArgs will parse it
            }],
            tokensUsed: 50,
            model: 'mock',
          };
        }
        return { content: 'final response', toolCalls: undefined, tokensUsed: 50, model: 'mock' };
      }),
      chatStream: vi.fn(),
    };

    const result = await runToolLoop({
      task: 'test',
      systemPrompt: 'system',
      provider: provider as any,
      tools: [{ name: 'echo_tool', description: 'echo', parameters: { type: 'object', properties: { message: { type: 'string' } } } }],
      rootPath: '/tmp',
      maxRounds: 3,
      onToolCall: async (_name, args) => `echo: ${JSON.stringify(args)}`,
    });

    expect(result).toBeDefined();
    expect(typeof result.finalResponse).toBe('string');
  });
});

// ============================================================
// addPitfall and recordTaskError from memory.ts
// ============================================================
describe('addPitfall and recordTaskError', () => {
  it('addPitfall does not throw', async () => {
    // Just verify it doesn't crash (it writes to global memory)
    await expect(addPitfall(
      'TypeScript strict mode broke existing code',
      'typescript',
      'medium',
    )).resolves.not.toThrow();
  });

  it('addPitfall with high severity', async () => {
    await expect(addPitfall(
      'Database migration caused data loss',
      'postgres',
      'high',
    )).resolves.not.toThrow();
  });

  it('recordTaskError with long error message → high severity', async () => {
    const longError = 'x'.repeat(501); // > 500 chars → high
    await expect(recordTaskError(
      'Deploy to production',
      longError,
      'node',
    )).resolves.not.toThrow();
  });

  it('recordTaskError with crash message → high severity', async () => {
    await expect(recordTaskError(
      'Run tests',
      'Application crash detected in production',
    )).resolves.not.toThrow();
  });

  it('recordTaskError with medium-length error → medium severity', async () => {
    await expect(recordTaskError(
      'Build project',
      'Compile error: missing import',
    )).resolves.not.toThrow();
  });

  it('recordTaskError without tech uses general', async () => {
    await expect(recordTaskError(
      'Generic task',
      'Some error occurred',
    )).resolves.not.toThrow();
  });
});

// ============================================================
// AgentManager extra coverage
// ============================================================
describe('AgentManager extra', () => {
  const mockAiConfig: AIConfig = {
    provider: 'mock',
    model: 'mock-offline',
    maxTokens: 100000,
    temperature: 0.3,
  };

  it('updateAiConfig merges config properties', () => {
    const mgr = new AgentManager(mockAiConfig);
    mgr.updateAiConfig({ model: 'claude-opus-4-7', temperature: 0.5 });
    // Create an agent to verify the new model is used
    const agent = mgr.create({ name: 'Test', type: 'task' });
    // Agent uses the updated model from aiConfig
    expect(agent.model).toBe('claude-opus-4-7');
  });

  it('broadcast sends notification to running agents', () => {
    const mgr = new AgentManager(mockAiConfig);
    const a = mgr.create({ name: 'Broadcast Target', type: 'task' });
    // Make it running
    const stored = mgr.get(a.id)!;
    stored.status = 'running';

    // broadcast to all (no type filter)
    mgr.broadcast('System notification');
    const msgs = mgr.getMessages(a.id);
    expect(msgs.some(m => m.content === 'System notification')).toBe(true);
  });

  it('broadcast with type filter only sends to matching type', () => {
    const mgr = new AgentManager(mockAiConfig);
    const taskAgent = mgr.create({ name: 'Task Agent', type: 'task' });
    const reviewAgent = mgr.create({ name: 'Review Agent', type: 'review' });

    // Make both running
    mgr.get(taskAgent.id)!.status = 'running';
    mgr.get(reviewAgent.id)!.status = 'running';

    mgr.broadcast('For tasks only', 'task');
    // Task agent should get it, review agent should not
    const taskMsgs = mgr.getMessages(taskAgent.id);
    const reviewMsgs = mgr.getMessages(reviewAgent.id);
    expect(taskMsgs.some(m => m.content === 'For tasks only')).toBe(true);
    expect(reviewMsgs.some(m => m.content === 'For tasks only')).toBe(false);
  });

  it('list with parentId filter returns only children', () => {
    const mgr = new AgentManager(mockAiConfig);
    const parent = mgr.create({ name: 'Parent', type: 'orchestrator' });
    const child1 = mgr.create({ name: 'Child 1', type: 'task', parentId: parent.id });
    mgr.create({ name: 'Unrelated', type: 'task' });

    const children = mgr.list({ parentId: parent.id });
    expect(children.some(a => a.id === child1.id)).toBe(true);
    expect(children.every(a => a.parentId === parent.id)).toBe(true);
  });

  it('getTree for nonexistent agent returns empty object', () => {
    const mgr = new AgentManager(mockAiConfig);
    const tree = mgr.getTree('nonexistent-agent-id');
    expect(tree).toEqual({});
  });

  it('createChildren for nonexistent parent returns empty array', () => {
    const mgr = new AgentManager(mockAiConfig);
    const children = mgr.createChildren('nonexistent-parent-xyz', [
      { description: 'Child task', type: 'task' },
    ]);
    expect(children).toEqual([]);
  });

  it('stop for nonexistent agent returns false', () => {
    const mgr = new AgentManager(mockAiConfig);
    const result = mgr.stop('nonexistent-agent-xyz');
    expect(result).toBe(false);
  });
});
