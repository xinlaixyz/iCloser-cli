import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  createTask, generatePlan, persistTask, loadTask,
  listTasks, acquireFileLocks, releaseFileLocks,
  addFileChange, addReasoning,
  updateTaskStatus,
  setTaskLoopStep, advanceTaskLoopState, completeTaskLoop,
} from '../src/core/task-engine.js';
import { saveProjectIndex } from '../src/core/scanner.js';
import { detectProject } from '../src/utils/detect.js';
import type { ProjectIndex } from '../src/types.js';

async function writeProjectFile(root: string, file: string, content: string) {
  const full = join(root, file);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

async function makeTestIndex(root: string): Promise<ProjectIndex> {
  await writeProjectFile(root, 'package.json', JSON.stringify({
    scripts: { build: 'tsc', test: 'vitest run' },
    devDependencies: { typescript: '^5.7.0', vitest: '^2.1.0' },
  }));
  await writeProjectFile(root, 'package-lock.json', '{}');
  await writeProjectFile(root, 'tsconfig.json', '{}');
  await writeProjectFile(root, 'src/auth/login.ts', [
    'export function login(email: string, password: string) {',
    '  return { token: "mock-token" };',
    '}',
  ].join('\n'));
  await writeProjectFile(root, 'src/types/user.ts', [
    'export interface User { id: string; email: string; }',
  ].join('\n'));
  await writeProjectFile(root, 'src/api/auth-routes.ts', [
    "import { login } from '../auth/login';",
    "router.post('/auth/login', login);",
  ].join('\n'));

  await detectProject(root);
  const { scanProject } = await import('../src/core/scanner.js');
  const result = await scanProject({
    rootPath: root, deep: false, includeTests: false, maxFileSize: 256 * 1024,
  });
  await saveProjectIndex(root, result.index);
  return result.index;
}

describe('task-engine', () => {
  it('createTask creates a task with correct structure', () => {
    const task = createTask('增加手机号登录');
    expect(task.id).toMatch(/^task-/);
    expect(task.description).toBe('增加手机号登录');
    expect(task.status).toBe('queued');
    expect(task.priority).toBe('normal');
    expect(task.changes).toEqual([]);
    expect(task.errorLog).toEqual([]);
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(3);
    expect(task.createdAt).toBeTruthy();
  });

  it('createTask accepts priority option', () => {
    const high = createTask('urgent fix', { priority: 'high' });
    expect(high.priority).toBe('high');
    const low = createTask('nice to have', { priority: 'low' });
    expect(low.priority).toBe('low');
  });

  it('generatePlan produces sub-goals from description', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-'));
    try {
      const index = await makeTestIndex(root);
      // Use keywords that match module names: auth, user, api
      const task = createTask('增加 auth 模块的 user 类型和 login 函数以及 api 接口');

      const plan = generatePlan(task, task.description, index.identity, index);

      // Check plan structure
      expect(plan.subGoals.length).toBeGreaterThan(0);
      expect(plan.affectedFiles.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(plan.estimatedImpact);

      // Plan should be attached to task
      expect(task.plan).toBe(plan);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persistTask + loadTask round-trips task data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-'));
    try {
      const index = await makeTestIndex(root);
      const task = createTask('测试持久化任务');
      generatePlan(task, task.description, index.identity, index);
      addFileChange(task.id, { file: 'src/types/user.ts', intent: 'add phone field', reasoning: 'test', added: 3, removed: 0 });
      addReasoning(task.id, { file: 'src/types/user.ts', intent: 'add phone', reasoning: 'needed for login', impact: { directlyAffected: ['src/types/user.ts'], indirectlyAffected: [], notAffected: [] }, riskLevel: 'low' });
      updateTaskStatus(task.id, 'completed');

      await persistTask(root, task);
      const loaded = await loadTask(root, task.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(task.id);
      expect(loaded!.description).toBe(task.description);
      expect(loaded!.status).toBe('completed');
      expect(loaded!.changes.length).toBe(1);
      expect(loaded!.changes[0].file).toBe('src/types/user.ts');
      expect(loaded!.reasoning.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loaded tasks stay connected to in-memory status updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-'));
    try {
      const task = createTask('持久化后更新状态');
      await persistTask(root, task);

      const loaded = await loadTask(root, task.id);
      expect(loaded).not.toBeNull();

      updateTaskStatus(task.id, 'running');
      await persistTask(root, loaded!);

      const reloaded = await loadTask(root, task.id);
      expect(reloaded?.status).toBe('running');
      expect(reloaded?.startedAt).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('listTasks returns all persisted tasks sorted by date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-'));
    try {
      const _index = await makeTestIndex(root);

      const t1 = createTask('任务一');
      const t2 = createTask('任务二');
      updateTaskStatus(t1.id, 'completed');
      updateTaskStatus(t2.id, 'failed');

      await persistTask(root, t1);
      await persistTask(root, t2);

      const tasks = await listTasks(root);
      expect(tasks.length).toBeGreaterThanOrEqual(2);

      const ids = tasks.map(t => t.id);
      expect(ids).toContain(t1.id);
      expect(ids).toContain(t2.id);

      // Most recent first (t2 was created after t1)
      expect(tasks[0].id).toBe(t2.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('acquireFileLocks blocks conflicting tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-'));
    try {
      const index = await makeTestIndex(root);

      // Use keywords that match module names in the test index
      const taskA = createTask('修改 auth 模块的 login 函数和 user 类型以及 api 路由');
      generatePlan(taskA, taskA.description, index.identity, index);

      // Task A acquires locks
      const lockedA = acquireFileLocks(taskA);
      expect(lockedA.length).toBeGreaterThan(0);
      expect(taskA.status).not.toBe('blocked');

      // Task B wants same files — should be blocked
      const taskB = createTask('也修改 auth 模块的 login 和 user 以及 api');
      generatePlan(taskB, taskB.description, index.identity, index);
      acquireFileLocks(taskB);

      // Task B should be blocked since files overlap
      expect(taskB.status).toBe('blocked');
      expect(taskB.errorLog.length).toBeGreaterThan(0);

      // Release task A locks
      releaseFileLocks(taskA);

      // Now task B should be able to acquire
      // (re-generate plan since taskB was blocked)
      taskB.status = 'queued';
      taskB.errorLog = [];
      acquireFileLocks(taskB);
      expect(taskB.status).not.toBe('blocked');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('updateTaskStatus sets timestamps correctly', () => {
    const task = createTask('状态流转测试');

    expect(task.startedAt).toBeUndefined();
    expect(task.completedAt).toBeUndefined();

    updateTaskStatus(task.id, 'running');
    expect(task.status).toBe('running');
    expect(task.startedAt).toBeTruthy();

    updateTaskStatus(task.id, 'completed');
    expect(task.status).toBe('completed');
    expect(task.completedAt).toBeTruthy();
  });

  it('addFileChange and addReasoning accumulate on task', () => {
    const task = createTask('累积变更测试');

    addFileChange(task.id, { file: 'a.ts', intent: 'change a', reasoning: '', added: 1, removed: 0 });
    addFileChange(task.id, { file: 'b.ts', intent: 'change b', reasoning: '', added: 2, removed: 1 });

    expect(task.changes.length).toBe(2);
    expect(task.changes[0].file).toBe('a.ts');
    expect(task.changes[1].file).toBe('b.ts');
  });
});

describe('task-engine loop state', () => {
  it('createTask initializes loopState at collect-context', () => {
    const task = createTask('loop 状态初始化');

    expect(task.loopState).toBeDefined();
    expect(task.loopState!.currentStep).toBe('collect-context');
    expect(task.loopState!.status).toBe('running');
    expect(task.loopState!.iteration).toBe(1);
    expect(task.loopState!.verification).toBe('unknown');
  });

  it('setTaskLoopStep transitions to the given step', () => {
    const task = createTask('loop 步骤切换');
    expect(task.loopState!.currentStep).toBe('collect-context');

    setTaskLoopStep(task.id, 'take-action');
    expect(task.loopState!.currentStep).toBe('take-action');
    expect(task.loopState!.status).toBe('running');

    setTaskLoopStep(task.id, 'verify-result');
    expect(task.loopState!.currentStep).toBe('verify-result');
  });

  it('advanceTaskLoopState on collect-context moves to take-action', () => {
    const task = createTask('loop 自动推进');
    advanceTaskLoopState(task.id);

    expect(task.loopState!.currentStep).toBe('take-action');
    expect(task.loopState!.status).toBe('running');
  });

  it('advanceTaskLoopState with verification fail returns to collect-context', () => {
    const task = createTask('loop 验证失败回退');
    // Manually set to verify-result first
    setTaskLoopStep(task.id, 'verify-result');

    advanceTaskLoopState(task.id, { verification: 'fail' });
    expect(task.loopState!.currentStep).toBe('collect-context');
    expect(task.loopState!.iteration).toBe(2);
    expect(task.loopState!.verification).toBe('fail');
    expect(task.loopState!.nextBranch).toBe('continue-loop');
  });

  it('completeTaskLoop with pass finishes the task', () => {
    const task = createTask('loop 验证通过');

    completeTaskLoop(task.id, 'pass');
    expect(task.loopState!.status).toBe('completed');
    expect(task.loopState!.verification).toBe('pass');
    expect(task.loopState!.nextBranch).toBe('complete');
  });

  it('completeTaskLoop with fail marks verification failed', () => {
    const task = createTask('loop 验证失败');

    completeTaskLoop(task.id, 'fail');
    expect(task.loopState!.verification).toBe('fail');
  });

  it('advanceTaskLoopState stops after max iterations', () => {
    const task = createTask('loop 超出最大轮次');

    // Simulate 3 rounds of fail → retry → fail
    for (let i = 0; i < 3; i++) {
      setTaskLoopStep(task.id, 'verify-result');
      advanceTaskLoopState(task.id, { verification: 'fail' });
    }

    expect(task.loopState!.status).toBe('stopped');
    expect(task.loopState!.interruptReason).toBe('max-iterations');
    expect(task.loopState!.nextBranch).toBe('ask-user');
  });

  it('advanceTaskLoopState with user intervention stops task', () => {
    const task = createTask('loop 用户中断');

    advanceTaskLoopState(task.id, { intervention: 'interrupt-task' });
    expect(task.loopState!.status).toBe('stopped');
    expect(task.loopState!.interruptReason).toBe('user-interrupt');
    expect(task.loopState!.nextBranch).toBe('ask-user');
  });

  it('persistTask + loadTask preserves loopState', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-te-loop-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({ scripts: { test: 'echo ok' } }));
      await writeProjectFile(root, 'package-lock.json', '{}');
      await writeProjectFile(root, 'tsconfig.json', '{}');

      const task = createTask('loop 持久化测试');
      setTaskLoopStep(task.id, 'take-action');
      setTaskLoopStep(task.id, 'verify-result');
      completeTaskLoop(task.id, 'pass');

      await persistTask(root, task);
      const loaded = await loadTask(root, task.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.loopState).toBeDefined();
      expect(loaded!.loopState!.status).toBe('completed');
      expect(loaded!.loopState!.verification).toBe('pass');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
