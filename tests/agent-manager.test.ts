import { describe, expect, it } from 'vitest';
import { AgentManager } from '../src/agent/manager.js';
import type { AIConfig } from '../src/types.js';

const mockAiConfig: AIConfig = {
  provider: 'mock',
  model: 'mock-offline',
  maxTokens: 100000,
  temperature: 0.3,
};

describe('AgentManager lifecycle', () => {
  it('creates an agent with default values', () => {
    const mgr = new AgentManager(mockAiConfig);
    const agent = mgr.create({ name: '测试 Agent', type: 'task' });

    expect(agent.id).toMatch(/^agent-/);
    expect(agent.name).toBe('测试 Agent');
    expect(agent.type).toBe('task');
    expect(agent.status).toBe('idle');
    expect(agent.model).toBe('mock-offline');
    expect(agent.tools).toEqual([]);
    expect(agent.childIds).toEqual([]);
    expect(agent.sandboxLevel).toBe('readonly');
    expect(agent.createdAt).toBeTruthy();
  });

  it('uses agent-specific model when provided', () => {
    const mgr = new AgentManager(mockAiConfig);
    const agent = mgr.create({ name: 'Reviewer', type: 'review', model: 'claude-opus-4-7' });
    expect(agent.model).toBe('claude-opus-4-7');
  });

  it('links child to parent on creation', () => {
    const mgr = new AgentManager(mockAiConfig);
    const parent = mgr.create({ name: '编排器', type: 'orchestrator' });
    const child = mgr.create({ name: '执行器', type: 'task', parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
    const updatedParent = mgr.get(parent.id);
    expect(updatedParent!.childIds).toContain(child.id);
  });

  it('lists agents by status', () => {
    const mgr = new AgentManager(mockAiConfig);
    const a = mgr.create({ name: 'ListTestTask', type: 'task' });
    mgr.create({ name: 'ListTestReview', type: 'review' });

    const running = mgr.list({ status: 'running' });
    // No agents should be running (all idle)
    expect(running.filter(x => x.name.includes('ListTest')).length).toBe(0);

    const idle = mgr.list({ status: 'idle' });
    expect(idle.filter(x => x.name.includes('ListTest')).length).toBe(2);

    const byType = mgr.list({ type: 'task' });
    expect(byType.some(x => x.id === a.id)).toBe(true);
  });

  it('activeCount only counts running + waiting', () => {
    const mgr = new AgentManager(mockAiConfig);
    const before = mgr.activeCount();
    mgr.create({ name: 'IdleCounter', type: 'task' });
    // Idle agents don't count toward activeCount
    expect(mgr.activeCount()).toBe(before);
  });

  it('stops agent and all children', () => {
    const mgr = new AgentManager(mockAiConfig);
    const parent = mgr.create({ name: '父', type: 'orchestrator' });
    mgr.create({ name: '子1', type: 'task', parentId: parent.id });
    mgr.create({ name: '子2', type: 'task', parentId: parent.id });

    mgr.stop(parent.id);
    expect(mgr.get(parent.id)?.status).toBe('done');
  });
});

describe('AgentManager communication', () => {
  it('sends and receives messages between agents', () => {
    const mgr = new AgentManager(mockAiConfig);
    const a = mgr.create({ name: '发送方', type: 'task' });

    // Manually set to running so message is accepted
    const stored = mgr.get(a.id)!;
    stored.status = 'running';

    mgr.sendMessage({ from: 'system', to: a.id, content: 'hello', type: 'instruction' });
    const msgs = mgr.getMessages(a.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('hello');
    expect(msgs[0].from).toBe('system');
    expect(msgs[0].type).toBe('instruction');
  });

  it('drops messages to non-running agents', () => {
    const mgr = new AgentManager(mockAiConfig);
    const a = mgr.create({ name: '空闲', type: 'task' });
    mgr.sendMessage({ from: 'system', to: a.id, content: 'hi', type: 'notification' });
    expect(mgr.getMessages(a.id).length).toBe(0);
  });
});

describe('AgentManager shared context', () => {
  it('writes and reads shared context', () => {
    const mgr = new AgentManager(mockAiConfig);
    mgr.writeContext('config', { env: 'test' });
    expect(mgr.readContext('config')).toEqual({ env: 'test' });
    expect(mgr.readContext('missing')).toBeUndefined();
  });

  it('clears all shared context', () => {
    const mgr = new AgentManager(mockAiConfig);
    mgr.writeContext('a', { x: 1 });
    mgr.writeContext('b', { y: 2 });
    mgr.clearContext();
    expect(mgr.readContext('a')).toBeUndefined();
    expect(mgr.readContext('b')).toBeUndefined();
  });
});

describe('AgentManager hierarchy', () => {
  it('creates children from task descriptions', () => {
    const mgr = new AgentManager(mockAiConfig);
    const parent = mgr.create({ name: '编排', type: 'orchestrator' });
    const children = mgr.createChildren(parent.id, [
      { description: '审查代码', type: 'review' },
      { description: '运行测试', type: 'verify' },
    ]);

    expect(children.length).toBe(2);
    expect(children[0].parentId).toBe(parent.id);
    expect(children[1].parentId).toBe(parent.id);
    expect(children[0].type).toBe('review');

    const updated = mgr.get(parent.id);
    expect(updated!.childIds.length).toBe(2);
  });

  it('builds agent hierarchy tree', () => {
    const mgr = new AgentManager(mockAiConfig);
    const root = mgr.create({ name: '根', type: 'orchestrator' });
    mgr.create({ name: '叶子1', type: 'task', parentId: root.id });
    mgr.create({ name: '叶子2', type: 'task', parentId: root.id });

    const tree = mgr.getTree(root.id) as { id: string; name: string; children: unknown[] };
    expect(tree.name).toBe('根');
    expect(tree.children.length).toBe(2);
  });
});

describe('AgentManager concurrency', () => {
  it('respects maxConcurrent limit', async () => {
    const mgr = new AgentManager(mockAiConfig, 1); // only 1 agent at a time
    const a = mgr.create({ name: 'A', type: 'task' });
    const b = mgr.create({ name: 'B', type: 'task' });

    // Start first agent (mock provider will resolve immediately)
    await mgr.start(a.id, '任务 A');
    // Wait briefly for mock to complete
    await new Promise(r => setTimeout(r, 200));
    expect(mgr.get(a.id)?.status).toBe('done');

    // Second should now be able to start
    await mgr.start(b.id, '任务 B');
    await new Promise(r => setTimeout(r, 200));
    expect(mgr.get(b.id)?.status).toBe('done');
  });

  it('pauses and resumes an agent', async () => {
    const mgr = new AgentManager(mockAiConfig);
    const agent = mgr.create({ name: '可暂停', type: 'task' });

    await mgr.start(agent.id, '长时间任务');
    // Immediately pause
    mgr.pause(agent.id);
    expect(mgr.get(agent.id)?.status).toBe('paused');

    // Resume
    const resumed = await mgr.resume(agent.id);
    expect(resumed).toBe(true);
  });
});
