// Coverage: execution-plan.ts unit tests
import { describe, it, expect } from 'vitest';

describe('generateExecutionPlan', () => {
  it('buildDefaultPlan returns analysis plan for analysis task', async () => {
    // buildDefaultPlan is private, tested through the module's fallback path
    const { generateExecutionPlan } = await import('../src/core/execution-plan.js');
    const plan = await generateExecutionPlan(
      '分析项目代码质量和结构',
      { projectMeta: 'TypeScript project', relevantCode: [], relevantMemory: '', totalTokens: 1000, budgetUsed: 20 },
      { chat: async () => ({ content: 'no json here', tokensUsed: 0 }) }, // will trigger fallback
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps[0].tool).toBe('read_file');
    expect(plan.expectedOutput).toContain('分析');
  });

  it('buildDefaultPlan returns code plan for code task', async () => {
    const { generateExecutionPlan } = await import('../src/core/execution-plan.js');
    const plan = await generateExecutionPlan(
      '修改 src/auth.ts 添加登录验证',
      { projectMeta: '', relevantCode: [{ file: 'src/auth.ts', content: 'export const login = () => {}' }], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      { chat: async () => ({ content: 'not json', tokensUsed: 0 }) },
    );
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.expectedOutput).toContain('代码变更');
  });

  it('handles AI plan generation error gracefully', async () => {
    const { generateExecutionPlan } = await import('../src/core/execution-plan.js');
    const plan = await generateExecutionPlan(
      'test task',
      { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      { chat: async () => { throw new Error('AI unavailable'); } },
    );
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.planId).toContain('PLAN-');
  });

  it('parses valid AI plan JSON correctly', async () => {
    const { generateExecutionPlan } = await import('../src/core/execution-plan.js');
    const mockPlan = {
      planId: 'PLAN-test',
      taskDescription: 'test',
      steps: [
        { seq: 1, tool: 'read_file', args: { path: 'test.ts' }, why: 'read test', expectedOutcome: 'get content' },
        { seq: 2, tool: 'search_code', args: { pattern: 'test' }, why: 'search', expectedOutcome: 'find matches' },
      ],
      expectedOutput: 'generate code',
      infoRequirements: { filesToRead: ['test.ts'], patternsToSearch: [], symbolsToQuery: [] },
      estimatedSteps: 2,
      createdAt: new Date().toISOString(),
    };
    const plan = await generateExecutionPlan(
      'test',
      { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      { chat: async () => ({ content: JSON.stringify(mockPlan), tokensUsed: 0 }) },
    );
    expect(plan.steps.length).toBe(2);
    expect(plan.planId).toBe('PLAN-test');
    expect(plan.expectedOutput).toBe('generate code');
  });
});

describe('buildExecutionSummary', () => {
  it('produces structured summary from execution state', async () => {
    const { buildExecutionSummary } = await import('../src/core/execution-plan.js');
    const summary = buildExecutionSummary({
      plan: {
        planId: 'test', taskDescription: 'analyze project',
        steps: [], expectedOutput: 'analysis', estimatedSteps: 3,
        infoRequirements: { filesToRead: ['README.md'], patternsToSearch: ['test'], symbolsToQuery: [] },
        createdAt: new Date().toISOString(),
      },
      completedSteps: [
        { seq: 1, tool: 'read_file', success: true, output: 'content of README.md here...', emptyResult: false, duration: 100 },
        { seq: 2, tool: 'search_code', success: true, output: 'found 5 matches', emptyResult: false, duration: 50 },
      ],
      pendingSteps: [],
      collectedFiles: new Map(),
      collectedSymbols: new Map(),
      infoGathered: { filesRead: new Set(['README.md']), patternsSearched: new Set(), symbolsQueried: new Set() },
      decisionPoints: 1,
      phase: 'executing',
    });
    expect(summary).toContain('analyze project');
    expect(summary).toContain('read_file');
    expect(summary).toContain('search_code');
    expect(summary).toContain('系统干预');
    expect(summary).toContain('仍缺失');
  });

  it('shows completion message when all info gathered', async () => {
    const { buildExecutionSummary } = await import('../src/core/execution-plan.js');
    const summary = buildExecutionSummary({
      plan: {
        planId: 'test', taskDescription: 'task', steps: [], expectedOutput: 'output',
        infoRequirements: { filesToRead: ['a.ts'], patternsToSearch: [], symbolsToQuery: [] },
        estimatedSteps: 1, createdAt: new Date().toISOString(),
      },
      completedSteps: [{ seq: 1, tool: 'read_file', success: true, output: 'ok', emptyResult: false, duration: 10 }],
      pendingSteps: [],
      collectedFiles: new Map(),
      collectedSymbols: new Map(),
      infoGathered: { filesRead: new Set(['a.ts']), patternsSearched: new Set(), symbolsQueried: new Set() },
      decisionPoints: 0,
      phase: 'synthesizing',
    });
    expect(summary).toContain('信息收集完成');
  });
});
