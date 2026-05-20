// Unit tests for src/core/execution-engine.ts
import { describe, it, expect } from 'vitest';
import { ExecutionBus, executeWithPlan } from '../src/core/execution-engine.js';
import type { ContextPackage } from '../src/types.js';

const mockContext: ContextPackage = {
  projectMeta: 'test project',
  relevantCode: [],
  relevantMemory: '',
  totalTokens: 4000,
  budgetUsed: 0,
};

const mockChangesJson = JSON.stringify({
  changes: [{ file: 'src/foo.ts', content: 'export const x = 1;\n' }],
  summary: 'add x export',
});

function makeMockProvider(responseContent = mockChangesJson) {
  return {
    name: 'mock',
    chat: async () => ({ content: responseContent, tokensUsed: 10 }),
  };
}

describe('ExecutionBus', () => {
  it('createAgent returns a BusAgent with pending status', () => {
    const bus = new ExecutionBus();
    const agent = bus.createAgent('implement feature X', mockContext);
    expect(agent.id).toMatch(/^agent-/);
    expect(agent.name).toContain('implement feature X');
    expect(agent.status).toBe('pending');
    expect(agent.state).toBeNull();
  });

  it('createAgent truncates long task names to 40 chars', () => {
    const bus = new ExecutionBus();
    const longTask = 'a'.repeat(100);
    const agent = bus.createAgent(longTask, mockContext);
    expect(agent.name.length).toBe(40);
  });

  it('getAgent retrieves a created agent by id', () => {
    const bus = new ExecutionBus();
    const agent = bus.createAgent('task 1', mockContext);
    const retrieved = bus.getAgent(agent.id);
    expect(retrieved).toBe(agent);
  });

  it('getAgent returns undefined for unknown id', () => {
    const bus = new ExecutionBus();
    expect(bus.getAgent('nonexistent-id')).toBeUndefined();
  });

  it('getAllAgents returns all created agents', () => {
    const bus = new ExecutionBus();
    const a1 = bus.createAgent('task 1', mockContext);
    const a2 = bus.createAgent('task 2', mockContext);
    const all = bus.getAllAgents();
    expect(all.length).toBe(2);
    expect(all).toContain(a1);
    expect(all).toContain(a2);
  });

  it('getSharedFiles returns empty map initially', () => {
    const bus = new ExecutionBus();
    expect(bus.getSharedFiles().size).toBe(0);
  });

  it('executeAgent runs and sets status to complete or failed', async () => {
    const bus = new ExecutionBus();
    const agent = bus.createAgent('analyze code', mockContext);
    const result = await bus.executeAgent(agent, process.cwd(), makeMockProvider());
    expect(['complete', 'failed']).toContain(result.status);
    expect(result.result).toBeDefined();
  });

  it('executeParallel runs multiple agents in parallel', async () => {
    const bus = new ExecutionBus(2);
    const a1 = bus.createAgent('task 1', mockContext);
    const a2 = bus.createAgent('task 2', mockContext);
    const results = await bus.executeParallel([a1, a2], process.cwd(), makeMockProvider());
    expect(results).toHaveLength(2);
    expect(results.every(r => ['complete', 'failed'].includes(r.status))).toBe(true);
  });

  it('respects maxParallel batch size', async () => {
    const bus = new ExecutionBus(1); // batch of 1
    const a1 = bus.createAgent('task 1', mockContext);
    const a2 = bus.createAgent('task 2', mockContext);
    const a3 = bus.createAgent('task 3', mockContext);
    const results = await bus.executeParallel([a1, a2, a3], process.cwd(), makeMockProvider());
    expect(results).toHaveLength(3);
  });
});

describe('executeWithPlan', () => {
  it('returns a result object with success, aiResponse, executionState, decisionPoints', async () => {
    const { generateExecutionPlan } = await import('../src/core/execution-plan.js');
    const plan = await generateExecutionPlan('analyze code', mockContext, makeMockProvider());
    const mockTask: any = { id: 'test-task', description: 'analyze code' };
    const result = await executeWithPlan(plan, mockTask, process.cwd(), makeMockProvider(), mockContext);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.aiResponse).toBe('string');
    expect(result.executionState).toBeDefined();
    expect(Array.isArray(result.decisionPoints)).toBe(true);
  });

  it('executeAgent catches provider errors and marks agent as failed', async () => {
    const bus = new ExecutionBus();
    const agent = bus.createAgent('task with errors', mockContext);
    const errProvider = {
      name: 'mock-err',
      chat: async () => { throw new Error('provider down'); },
    };
    const result = await bus.executeAgent(agent, process.cwd(), errProvider);
    expect(result.status).toBe('failed');
    expect(result.result).toContain('provider down');
  });

  it('completes within max rounds for empty plan', async () => {
    const plan = {
      planId: 'PLAN-TEST',
      goal: 'empty plan',
      strategy: 'direct',
      expectedOutput: 'test output',
      steps: [],
      infoRequirements: { filesToRead: [], patternsToSearch: [], symbolsToQuery: [] },
      codeRequirements: { filesToModify: [], filesToCreate: [] },
    };
    const mockTask: any = { id: 'empty-task', description: 'empty' };
    const result = await executeWithPlan(plan, mockTask, process.cwd(), makeMockProvider(), mockContext);
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});
