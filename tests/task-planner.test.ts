// Unit tests for src/core/task-planner.ts — all pure functions
import { describe, it, expect } from 'vitest';
import {
  createDevPlan,
  formatPlanForDisplay,
  getNextPendingTask,
  allTasksDone,
  formatDAGLevels,
  type PlanTask,
  // type DevPlan,
} from '../src/core/task-planner.js';

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'task-1',
    seq: 1,
    title: 'Test Task',
    description: 'A test task',
    files: ['src/foo.ts'],
    dependencies: [],
    estimated: '1h',
    status: 'pending',
    ...overrides,
  };
}

describe('createDevPlan', () => {
  it('creates a plan with correct fields', () => {
    const tasks = [makeTask()];
    const plan = createDevPlan('add auth', 'needs JWT', tasks);
    expect(plan.requirement).toBe('add auth');
    expect(plan.analysis).toBe('needs JWT');
    expect(plan.tasks).toBe(tasks);
    expect(plan.planId).toMatch(/^plan-/);
    expect(typeof plan.createdAt).toBe('string');
  });

  it('generates planId matching expected format', () => {
    const p = createDevPlan('req1', 'a', []);
    expect(p.planId).toMatch(/^plan-[a-z0-9]+$/);
  });

  it('works with empty tasks array', () => {
    const plan = createDevPlan('requirement', 'analysis', []);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.planId).toMatch(/^plan-[a-z0-9]+$/);
  });
});

describe('formatPlanForDisplay', () => {
  it('includes requirement in output', () => {
    const plan = createDevPlan('implement login', 'need OAuth', [
      makeTask({ seq: 1, title: 'Create endpoint', estimated: '2h', status: 'pending', dependencies: [] }),
    ]);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('implement login');
    expect(out).toContain('need OAuth');
    expect(out).toContain('Create endpoint');
    expect(out).toContain('2h');
  });

  it('shows task status icons', () => {
    const tasks = [
      makeTask({ seq: 1, title: 'Done task', status: 'done', dependencies: [] }),
      makeTask({ seq: 2, title: 'Running task', status: 'in_progress', dependencies: [] }),
      makeTask({ seq: 3, title: 'Pending task', status: 'pending', dependencies: [] }),
    ];
    const plan = createDevPlan('req', 'analysis', tasks);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('✅');
    expect(out).toContain('▶');
    expect(out).toContain('·');
  });

  it('shows deps when present', () => {
    const tasks = [
      makeTask({ seq: 1, title: 'Task A', status: 'done', dependencies: [] }),
      makeTask({ seq: 2, title: 'Task B', status: 'pending', dependencies: [1] }),
    ];
    const plan = createDevPlan('req', 'analysis', tasks);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('Task-1');
  });

  it('shows — for no deps', () => {
    const plan = createDevPlan('req', 'analysis', [makeTask({ seq: 1, dependencies: [] })]);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('—');
  });

  it('truncates requirement to 60 chars in header', () => {
    const longReq = 'a'.repeat(100);
    const plan = createDevPlan(longReq, 'analysis', []);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('a'.repeat(60));
    expect(out).not.toContain('a'.repeat(61));
  });

  it('includes action instructions', () => {
    const plan = createDevPlan('req', 'analysis', []);
    const out = formatPlanForDisplay(plan);
    expect(out).toContain('开始 Task-N');
    expect(out).toContain('跳过 Task-N');
    expect(out).toContain('验收');
  });
});

describe('getNextPendingTask', () => {
  it('returns null when all tasks are done', () => {
    const plan = createDevPlan('req', 'analysis', [
      makeTask({ seq: 1, status: 'done', dependencies: [] }),
    ]);
    expect(getNextPendingTask(plan)).toBeNull();
  });

  it('returns null when no task has dependencies satisfied', () => {
    const plan = createDevPlan('req', 'analysis', [
      makeTask({ seq: 1, status: 'pending', dependencies: [2] }),
      makeTask({ seq: 2, status: 'pending', dependencies: [1] }),
    ]);
    expect(getNextPendingTask(plan)).toBeNull();
  });

  it('returns first pending task with no deps', () => {
    const t1 = makeTask({ seq: 1, status: 'pending', dependencies: [] });
    const t2 = makeTask({ seq: 2, status: 'pending', dependencies: [] });
    const plan = createDevPlan('req', 'analysis', [t1, t2]);
    expect(getNextPendingTask(plan)).toBe(t1);
  });

  it('returns pending task whose dependency is done', () => {
    const t1 = makeTask({ seq: 1, status: 'done', dependencies: [] });
    const t2 = makeTask({ seq: 2, status: 'pending', dependencies: [1] });
    const plan = createDevPlan('req', 'analysis', [t1, t2]);
    expect(getNextPendingTask(plan)).toBe(t2);
  });

  it('skips in_progress tasks', () => {
    const t1 = makeTask({ seq: 1, status: 'in_progress', dependencies: [] });
    const t2 = makeTask({ seq: 2, status: 'pending', dependencies: [] });
    const plan = createDevPlan('req', 'analysis', [t1, t2]);
    expect(getNextPendingTask(plan)).toBe(t2);
  });

  it('returns null for empty plan', () => {
    const plan = createDevPlan('req', 'analysis', []);
    expect(getNextPendingTask(plan)).toBeNull();
  });
});

describe('allTasksDone', () => {
  it('returns true when all tasks are done', () => {
    const plan = createDevPlan('req', 'analysis', [
      makeTask({ seq: 1, status: 'done' }),
      makeTask({ seq: 2, status: 'done' }),
    ]);
    expect(allTasksDone(plan)).toBe(true);
  });

  it('returns false when any task is pending', () => {
    const plan = createDevPlan('req', 'analysis', [
      makeTask({ seq: 1, status: 'done' }),
      makeTask({ seq: 2, status: 'pending' }),
    ]);
    expect(allTasksDone(plan)).toBe(false);
  });

  it('returns false when any task is in_progress', () => {
    const plan = createDevPlan('req', 'analysis', [
      makeTask({ seq: 1, status: 'in_progress' }),
    ]);
    expect(allTasksDone(plan)).toBe(false);
  });

  it('returns true for empty task list', () => {
    const plan = createDevPlan('req', 'analysis', []);
    expect(allTasksDone(plan)).toBe(true);
  });
});

describe('formatDAGLevels', () => {
  it('formats a single level correctly', () => {
    const levels = [{
      level: 0,
      tasks: [makeTask({ seq: 1, title: 'Init DB', status: 'done' })],
      estimatedTime: '1h',
    }];
    const out = formatDAGLevels(levels);
    expect(out).toContain('[层 0]');
    expect(out).toContain('Task-1');
    expect(out).toContain('1h');
    expect(out).toContain('Init DB');
    expect(out).toContain('✅');
  });

  it('shows · for pending tasks', () => {
    const levels = [{
      level: 0,
      tasks: [makeTask({ seq: 2, title: 'Pending', status: 'pending' })],
      estimatedTime: '2h',
    }];
    const out = formatDAGLevels(levels);
    expect(out).toContain('·');
    expect(out).toContain('Pending');
  });

  it('handles multiple levels', () => {
    const levels = [
      {
        level: 0,
        tasks: [makeTask({ seq: 1, title: 'Setup', status: 'done' })],
        estimatedTime: '30m',
      },
      {
        level: 1,
        tasks: [
          makeTask({ seq: 2, title: 'Build', status: 'pending' }),
          makeTask({ seq: 3, title: 'Test', status: 'pending' }),
        ],
        estimatedTime: '2h',
      },
    ];
    const out = formatDAGLevels(levels);
    expect(out).toContain('[层 0]');
    expect(out).toContain('[层 1]');
    expect(out).toContain('Task-2 ⏺ Task-3');
    expect(out).toContain('30m');
    expect(out).toContain('2h');
  });

  it('returns empty string for empty levels', () => {
    expect(formatDAGLevels([])).toBe('');
  });
});
