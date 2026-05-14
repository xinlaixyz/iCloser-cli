import { describe, expect, it } from 'vitest';
import { generateTaskReport, generatePRDescription } from '../src/report/generator.js';
import type { Task, AgentExecutionRecord } from '../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-test-001',
    description: '测试 Agent 报告生成',
    status: 'completed',
    priority: 'normal',
    createdAt: '2026-05-14T10:00:00Z',
    startedAt: '2026-05-14T10:00:01Z',
    completedAt: '2026-05-14T10:01:00Z',
    changes: [
      { file: 'src/a.ts', intent: '添加功能', reasoning: '需要', added: 10, removed: 2 },
    ],
    diffs: [],
    reasoning: [
      { file: 'src/a.ts', intent: '添加功能', reasoning: '项目需要', impact: { directlyAffected: ['src/a.ts'], indirectlyAffected: [], notAffected: [] }, riskLevel: 'low' },
    ],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
    agentExecutions: [],
    ...overrides,
  };
}

function makeAgentExec(overrides: Partial<AgentExecutionRecord> = {}): AgentExecutionRecord {
  return {
    agentId: 'agent-test-001',
    agentName: '测试 Agent',
    agentType: 'task',
    status: 'done',
    startedAt: '2026-05-14T10:00:01Z',
    completedAt: '2026-05-14T10:00:30Z',
    result: {
      success: true,
      output: '执行成功，修改了 1 个文件',
      artifacts: ['src/a.ts'],
      tokensUsed: 1500,
      duration: 29000,
    },
    sandboxLevel: 'none',
    model: 'claude-sonnet-4-6',
    childAgentIds: [],
    tree: { id: 'agent-test-001', name: '测试 Agent', type: 'task', status: 'done', result: { success: true, tokensUsed: 1500, duration: 29000 }, children: [] },
    ...overrides,
  };
}

describe('Report Agent integration (S15)', { timeout: 15000 }, () => {
  it('includes agent section when task has agentExecutions', async () => {
    const task = makeTask({
      agentExecutions: [makeAgentExec()],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('## Agent 执行');
    expect(report).toContain('agent-test-001');
    expect(report).toContain('测试 Agent');
    expect(report).toContain('claude-sonnet-4-6');
    expect(report).toContain('1,500');
    expect(report).toContain('29.0s');
  });

  it('shows success/fail counts for multiple agents', async () => {
    const task = makeTask({
      agentExecutions: [
        makeAgentExec({ agentId: 'agent-1', agentName: 'A1', status: 'done' }),
        makeAgentExec({ agentId: 'agent-2', agentName: 'A2', status: 'done' }),
        makeAgentExec({ agentId: 'agent-3', agentName: 'A3', status: 'failed', result: { success: false, output: '', artifacts: [], tokensUsed: 300, duration: 5000, error: 'timeout' } }),
      ],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('3 个');
    expect(report).toContain('2 / 1');
  });

  it('shows agent output (short) in report', async () => {
    const task = makeTask({
      agentExecutions: [makeAgentExec({ result: { success: true, output: '简短输出', artifacts: ['f.ts'], tokensUsed: 100, duration: 1000 } })],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('简短输出');
  });

  it('truncates long agent output', async () => {
    const longOutput = 'x'.repeat(600);
    const task = makeTask({
      agentExecutions: [makeAgentExec({ result: { success: true, output: longOutput, artifacts: [], tokensUsed: 100, duration: 1000 } })],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('截断');
  });

  it('shows agent error when present', async () => {
    const task = makeTask({
      agentExecutions: [makeAgentExec({
        status: 'failed',
        result: { success: false, output: '', artifacts: [], tokensUsed: 0, duration: 5000, error: '连接超时' },
      })],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('连接超时');
  });

  it('shows hierarchy tree for orchestrated agents', async () => {
    const tree = {
      id: 'agent-orch',
      name: '编排 Agent',
      type: 'orchestrator',
      status: 'done',
      result: { success: true, tokensUsed: 3000, duration: 60000 },
      children: [
        {
          id: 'agent-child-1',
          name: '子任务 1',
          type: 'task',
          status: 'done',
          result: { success: true, tokensUsed: 1000, duration: 20000 },
          children: [],
        },
        {
          id: 'agent-child-2',
          name: '子任务 2',
          type: 'task',
          status: 'done',
          result: { success: true, tokensUsed: 800, duration: 15000 },
          children: [],
        },
      ],
    };
    const task = makeTask({
      agentExecutions: [makeAgentExec({
        agentId: 'agent-orch',
        agentName: '编排 Agent',
        agentType: 'orchestrator',
        childAgentIds: ['agent-child-1', 'agent-child-2'],
        tree,
      })],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('执行树');
    expect(report).toContain('编排 Agent');
    expect(report).toContain('子任务 1');
    expect(report).toContain('子任务 2');
  });

  it('no agent section when agentExecutions is empty', async () => {
    const task = makeTask({ agentExecutions: [] });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).not.toContain('## Agent 执行');
  });

  it('PR description does not include agent section', () => {
    const task = makeTask({
      agentExecutions: [makeAgentExec()],
    });
    const pr = generatePRDescription(task);
    expect(pr).not.toContain('Agent 执行');
    expect(pr).toContain('变更摘要');
  });

  it('report includes sandbox level', async () => {
    const task = makeTask({
      agentExecutions: [makeAgentExec({ sandboxLevel: 'readonly' })],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('readonly');
  });

  it('report includes total metrics across agents', async () => {
    const task = makeTask({
      agentExecutions: [
        makeAgentExec({ agentId: 'a1', result: { success: true, output: 'ok', artifacts: [], tokensUsed: 500, duration: 10000 } }),
        makeAgentExec({ agentId: 'a2', result: { success: true, output: 'ok', artifacts: [], tokensUsed: 700, duration: 20000 } }),
      ],
    });
    const report = await generateTaskReport('/tmp/test-project', task, {} as never);
    expect(report).toContain('1,200'); // total tokens
    expect(report).toContain('30.0s'); // total duration
  });
});
