// Task Engine — creation, scheduling, execution, parallel management
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import { ensureDir, writeJson, readJson, fileExists, listDir } from '../utils/fs.js';
import { advanceTaskLoop, createTaskLoopState, type TaskLoopIntervention, type TaskLoopStepId, type TaskLoopVerification } from './task-loop.js';
import type {
  Task, TaskStatus, TaskPriority, TaskPlan, SubGoal,
  FileChange, VerifyResult, ChangeReasoning,
  ProjectIdentity, ProjectIndex,
} from '../types.js';
export interface TaskEngineOptions {
  maxRetries: number;
  maxParallelTasks: number;
  defaultMode: 'preview' | 'execute';
}

// ============================================================
// Task store — lazy-load cache for disk-persisted tasks.
// Disk is the authoritative source of truth; taskStore is a
// read-through cache populated by loadTask / persistTask.
// All durable mutations must go through persistTask().
// ============================================================
const taskStore = new Map<string, Task>();
const fileLocks = new Map<string, string>();      // file -> taskId
const taskQueue: string[] = [];                    // ordered task IDs
const taskDependencies = new Map<string, string[]>(); // taskId -> depends on taskIds
let lastTaskCreatedAtMs = 0;

/**
 * Single choke-point for all in-memory task mutations.
 * Keeps taskStore and taskQueue in sync; future dirty-tracking or
 * reactive hooks should be added here rather than scattered in callers.
 */
function cacheTask(task: Task): void {
  taskStore.set(task.id, task);
  if (!taskQueue.includes(task.id)) taskQueue.push(task.id);
}

// ============================================================
// Task Creation
// ============================================================
export function createTask(
  description: string,
  options: { priority?: TaskPriority } = {}
): Task {
  const id = generateTaskId();
  const createdAtMs = Math.max(Date.now(), lastTaskCreatedAtMs + 1);
  lastTaskCreatedAtMs = createdAtMs;
  const task: Task = {
    id,
    description,
    status: 'queued',
    priority: options.priority || 'normal',
    createdAt: new Date(createdAtMs).toISOString(),
    changes: [],
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
    loopState: createTaskLoopState(),
    agentExecutions: [],
  };

  cacheTask(task);
  return task;
}

export function createTasks(
  descriptions: string[],
  options: { priority?: TaskPriority } = {}
): Task[] {
  return descriptions.map(d => createTask(d, options));
}

// ============================================================
// Plan generation
// ============================================================

/**
 * generatePlan now accepts an optional AI provider.
 * When provided it calls decomposeTaskWithAI first; on failure (no provider,
 * network error, malformed JSON) it falls back to the keyword-based decomposer.
 */
export async function generatePlanAsync(
  task: Task,
  description: string,
  identity: ProjectIdentity,
  index: ProjectIndex,
  provider?: import('../ai/provider.js').AIProviderAdapter,
): Promise<TaskPlan> {
  const subGoals = provider
    ? await decomposeTaskWithAI(description, identity, index, provider)
    : decomposeTask(description, identity, index);

  const affectedFiles = identifyFiles(description, index);
  const estimatedImpact = estimateImpact(description, affectedFiles, index);
  const lockedFiles = affectedFiles.filter(f => !fileLocks.has(f));
  const plan: TaskPlan = { subGoals, affectedFiles, estimatedImpact, dependencies: [], lockedFiles };
  task.plan = plan;
  cacheTask(task);
  return plan;
}

/** Synchronous overload kept for backward compatibility. */
export function generatePlan(
  task: Task,
  description: string,
  identity: ProjectIdentity,
  index: ProjectIndex
): TaskPlan {
  // Decompose description into sub-goals
  const subGoals = decomposeTask(description, identity, index);

  // Identify affected files
  const affectedFiles = identifyFiles(description, index);

  // Estimate impact
  const estimatedImpact = estimateImpact(description, affectedFiles, index);

  const lockedFiles = affectedFiles.filter(f => !fileLocks.has(f));

  const plan: TaskPlan = {
    subGoals,
    affectedFiles,
    estimatedImpact,
    dependencies: [],
    lockedFiles,
  };

  task.plan = plan;
  taskStore.set(task.id, task);

  return plan;
}

// ============================================================
// File locking for parallel execution
// ============================================================
export function acquireFileLocks(task: Task): string[] {
  const locked: string[] = [];
  const conflicts: string[] = [];

  for (const file of task.plan?.affectedFiles || []) {
    if (fileLocks.has(file)) {
      conflicts.push(file);
    } else {
      fileLocks.set(file, task.id);
      locked.push(file);
    }
  }

  if (conflicts.length > 0) {
    task.status = 'blocked';
    task.errorLog.push(`文件冲突：${conflicts.join(', ')} 被其他任务锁定`);
    cacheTask(task);
  }

  return locked;
}

export function releaseFileLocks(task: Task): void {
  for (const file of task.plan?.affectedFiles || []) {
    if (fileLocks.get(file) === task.id) {
      fileLocks.delete(file);
    }
  }
}

export function getFileConflicts(files: string[]): Map<string, string> {
  const conflicts = new Map<string, string>();
  for (const file of files) {
    const owner = fileLocks.get(file);
    if (owner) conflicts.set(file, owner);
  }
  return conflicts;
}

// ============================================================
// Task state management
// ============================================================
export function getTask(taskId: string): Task | undefined {
  return taskStore.get(taskId);
}

export function updateTaskStatus(taskId: string, status: TaskStatus, rootPath?: string): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.status = status;
    if (status === 'completed' || status === 'failed' || status === 'rolled-back') {
      task.completedAt = new Date().toISOString();
    }
    if (status === 'running' && !task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    cacheTask(task);

    // Memory Kernel hooks (fire-and-forget)
    if (rootPath) {
      if (status === 'running') {
        import('./memory/integration.js').then(m => m.onTaskCreated(rootPath!, taskId, task.description)).catch(() => {});
      } else if (status === 'completed') {
        import('./memory/integration.js').then(m => m.onTaskCompleted(rootPath!, taskId, {
          filesChanged: task.changes.map(c => c.file),
          verifyPassed: task.verifyResult?.overall === 'pass',
          summary: task.description,
        })).catch(() => {});
      } else if (status === 'failed') {
        import('./memory/integration.js').then(m => m.onTaskError(rootPath!, taskId,
          new Error(task.errorLog.slice(-1)[0] || 'task failed')
        )).catch(() => {});
      }
    }
  }
}


export function setTaskLoopStep(taskId: string, step: TaskLoopStepId): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.loopState = {
      ...(task.loopState || createTaskLoopState()),
      currentStep: step,
      status: 'running',
    };
    cacheTask(task);
  }
}

export function advanceTaskLoopState(taskId: string, options: { verification?: TaskLoopVerification; intervention?: TaskLoopIntervention } = {}): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.loopState = advanceTaskLoop(task.loopState || createTaskLoopState(), options);
    cacheTask(task);
  }
}

export function completeTaskLoop(taskId: string, verification: TaskLoopVerification): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.loopState = advanceTaskLoop({
      ...(task.loopState || createTaskLoopState()),
      currentStep: 'verify-result',
      verification,
    }, { verification });
    cacheTask(task);
  }
}
export function addFileChange(taskId: string, change: FileChange): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.changes.push(change);
    cacheTask(task);
  }
}

export function addReasoning(taskId: string, reasoning: ChangeReasoning): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.reasoning.push(reasoning);
    cacheTask(task);
  }
}

export function setVerifyResult(taskId: string, result: VerifyResult): void {
  const task = taskStore.get(taskId);
  if (task) {
    task.verifyResult = result;
    cacheTask(task);
  }
}

// ============================================================
// Queue management
// ============================================================
export function getQueue(): Task[] {
  return taskQueue.map(id => taskStore.get(id)!).filter(Boolean);
}

export function getNextTask(): Task | undefined {
  // Find highest priority queued task with no blocking dependencies
  const readyTasks = taskQueue
    .map(id => taskStore.get(id))
    .filter((t): t is Task => t !== undefined && t.status === 'queued')
    .filter(t => !isBlocked(t))
    .sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  return readyTasks[0];
}

export function getReadyCount(): number {
  return taskQueue
    .map(id => taskStore.get(id))
    .filter((t): t is Task => t !== undefined && t.status === 'queued' && !isBlocked(t))
    .length;
}

export function cancelTask(taskId: string): boolean {
  const task = taskStore.get(taskId);
  if (task && (task.status === 'queued' || task.status === 'scheduled')) {
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    releaseFileLocks(task);
    cacheTask(task);
    return true;
  }
  return false;
}

function isBlocked(task: Task): boolean {
  const deps = taskDependencies.get(task.id) || [];
  for (const depId of deps) {
    const dep = taskStore.get(depId);
    if (dep && dep.status !== 'completed') return true;
  }
  return false;
}

// ============================================================
// Parallel execution scheduler
// ============================================================
export interface ScheduleSlot {
  id: number;
  task: Task | null;
}

export function scheduleTasks(maxParallel: number): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const ready = taskQueue
    .map(id => taskStore.get(id))
    .filter((t): t is Task => t !== undefined && t.status === 'queued' && !isBlocked(t))
    .sort((a, b) => {
      const order = { high: 0, normal: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

  for (let i = 0; i < maxParallel; i++) {
    const task = ready[i] || null;
    if (task) {
      // Check file conflicts with already-scheduled tasks
      const conflictFiles: string[] = [];
      for (const file of task.plan?.affectedFiles || []) {
        for (const slot of slots) {
          if (slot.task && slot.task.plan?.affectedFiles.includes(file)) {
            conflictFiles.push(file);
          }
        }
      }
      if (conflictFiles.length > 0) {
        task.status = 'blocked';
        task.errorLog.push(`文件冲突（与其他并行任务）：${conflictFiles.join(', ')}`);
        cacheTask(task); // mark blocked in cache
        // Try next task
        continue;
      }
    }
    slots.push({ id: i + 1, task });
  }

  return slots;
}

// ============================================================
// AI-powered task decomposition (P2#14)
// ============================================================

/**
 * Ask the AI provider to semantically decompose the task description into
 * sub-goals and return them as structured SubGoal objects.
 *
 * Expected AI response format (JSON block):
 * ```json
 * [
 *   { "description": "...", "files": ["src/..."] },
 *   ...
 * ]
 * ```
 * Falls back to keyword decomposition if the AI is unavailable or returns
 * unparseable output.
 */
async function decomposeTaskWithAI(
  description: string,
  identity: ProjectIdentity,
  index: ProjectIndex,
  provider: import('../ai/provider.js').AIProviderAdapter,
): Promise<SubGoal[]> {
  const fileList = index.modules
    .flatMap(m => m.files)
    .slice(0, 60)
    .join('\n');

  const prompt = [
    `你是一个工程规划专家。将以下任务分解为 2-6 个有序子目标，每个子目标对应一个具体的代码改动范围。`,
    ``,
    `任务：${description}`,
    `项目语言：${identity.language}，框架：${identity.framework}`,
    ``,
    `项目文件（前 60 个）：`,
    fileList,
    ``,
    `以如下 JSON 格式回复（不要添加任何其他文字）：`,
    `[{"description":"子目标说明","files":["相关文件路径"]},...]`,
  ].join('\n');

  try {
    const response = await provider.chat({
      systemPrompt: '你是工程任务分解助手，只输出 JSON，不输出其他内容。',
      task: prompt,
      history: '',
      context: {
        projectMeta: '',
        relevantCode: [],
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
      },
    });

    // Extract JSON block from response (handle markdown code fences)
    const raw = response.content.trim();
    const jsonStr = raw.startsWith('[') ? raw : (raw.match(/```(?:json)?\s*([\s\S]+?)```/)?.[1] ?? raw);
    const parsed = JSON.parse(jsonStr) as Array<{ description: string; files?: string[] }>;

    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty');

    let counter = 1;
    return parsed.slice(0, 8).map(item => ({
      id: `sg-${counter++}`,
      description: String(item.description || '').trim() || '代码修改',
      files: Array.isArray(item.files) ? item.files.slice(0, 10) : [],
      status: 'pending' as const,
    }));
  } catch {
    // AI unavailable or returned malformed output — fall back gracefully
    return decomposeTask(description, identity, index);
  }
}

// ============================================================
// Task decomposition (keyword-based fallback)
// ============================================================
function decomposeTask(
  description: string,
  identity: ProjectIdentity,
  index: ProjectIndex
): SubGoal[] {
  const goals: SubGoal[] = [];
  const lower = description.toLowerCase();
  let counter = 1;

  // Type/model changes
  if (lower.includes('字段') || lower.includes('属性') || lower.includes('model') || lower.includes('类型') || lower.includes('type')) {
    goals.push({
      id: `sg-${counter++}`,
      description: '数据模型/类型变更',
      files: findModelFiles(index),
      status: 'pending',
    });
  }

  // Logic/function changes
  if (lower.includes('逻辑') || lower.includes('功能') || lower.includes('函数') || lower.includes('方法')) {
    goals.push({
      id: `sg-${counter++}`,
      description: '业务逻辑修改',
      files: findLogicFiles(description, index),
      status: 'pending',
    });
  }

  // API/route changes
  if (lower.includes('api') || lower.includes('接口') || lower.includes('路由') || lower.includes('route')) {
    goals.push({
      id: `sg-${counter++}`,
      description: 'API 接口变更',
      files: findApiFiles(index),
      status: 'pending',
    });
  }

  // UI changes
  if (lower.includes('ui') || lower.includes('界面') || lower.includes('组件') || lower.includes('component') || lower.includes('页面')) {
    goals.push({
      id: `sg-${counter++}`,
      description: 'UI 组件变更',
      files: findUiFiles(index),
      status: 'pending',
    });
  }

  // Test changes
  goals.push({
    id: `sg-${counter++}`,
    description: '测试用例更新',
    files: findTestFiles(description, index),
    status: 'pending',
  });

  // If no specific area detected, add a general goal
  if (goals.length === 1) { // only test goal
    goals.unshift({
      id: `sg-${counter++}`,
      description: '代码修改',
      files: identifyFiles(description, index),
      status: 'pending',
    });
  }

  return goals;
}

function findModelFiles(index: ProjectIndex): string[] {
  return index.modules
    .filter(m => m.name.includes('model') || m.name.includes('type') || m.name.includes('entity') || m.name.includes('schema'))
    .flatMap(m => m.files)
    .slice(0, 10);
}

function findLogicFiles(description: string, index: ProjectIndex): string[] {
  const keywords = ['service', 'usecase', 'handler', 'controller', 'repository', 'manager'];
  const matching = index.modules.filter(m =>
    keywords.some(k => m.name.toLowerCase().includes(k))
  );
  return matching.flatMap(m => m.files).slice(0, 15);
}

function findApiFiles(index: ProjectIndex): string[] {
  return index.modules
    .filter(m => m.name.includes('api') || m.name.includes('route') || m.name.includes('handler'))
    .flatMap(m => m.files)
    .slice(0, 10);
}

function findUiFiles(index: ProjectIndex): string[] {
  return index.modules
    .filter(m => m.name.includes('component') || m.name.includes('page') || m.name.includes('view') || m.name.includes('ui'))
    .flatMap(m => m.files)
    .slice(0, 10);
}

function findTestFiles(description: string, index: ProjectIndex): string[] {
  const baseFiles = identifyFiles(description, index);
  return baseFiles.map(f => {
    // Simple test file mapping
    const dir = path.dirname(f);
    const name = path.basename(f, path.extname(f));
    return path.join(dir, `__tests__`, `${name}.test${path.extname(f)}`);
  });
}

function identifyFiles(description: string, index: ProjectIndex): string[] {
  const lower = description.toLowerCase();
  const keywords = lower.split(/\s+/).filter(w => w.length > 1);

  const scored = index.modules.map(mod => {
    const nameLower = mod.name.toLowerCase();
    const score = keywords.filter(k => nameLower.includes(k)).length;
    return { module: mod, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .flatMap(s => s.module.files)
    .slice(0, 20);
}

function estimateImpact(
  description: string,
  files: string[],
  _index: ProjectIndex
): 'low' | 'medium' | 'high' {
  if (files.length > 10) return 'high';
  if (files.length > 5) return 'medium';

  // Check if any files are core/infrastructure
  const lower = description.toLowerCase();
  if (lower.includes('数据库') || lower.includes('database') || lower.includes('schema')) return 'high';
  if (lower.includes('auth') || lower.includes('认证') || lower.includes('权限')) return 'medium';

  return 'low';
}

// ============================================================
// Helpers
// ============================================================
function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = randomUUID().substring(0, 8);
  return `task-${ts}-${rand}`;
}

/**
 * Canonical write path — updates both the in-memory cache and disk.
 * All durable mutations should call this instead of raw taskStore.set().
 */
export async function persistTask(rootPath: string, task: Task): Promise<void> {
  // Keep the cache in sync first (fast path for subsequent reads)
  cacheTask(task);
  // Then flush to disk (authoritative store)
  const taskDir = path.join(rootPath, '.icloser', 'tasks', task.id);
  await ensureDir(taskDir);
  await writeJson(path.join(taskDir, 'task.json'), task);
}

export async function loadTask(rootPath: string, taskId: string): Promise<Task | null> {
  const taskPath = path.join(rootPath, '.icloser', 'tasks', taskId, 'task.json');
  if (await fileExists(taskPath)) {
    const task = await readJson(taskPath) as unknown as Task;
    cacheTask(task);
    if (task.plan?.dependencies?.length) {
      taskDependencies.set(task.id, task.plan.dependencies);
    }
    return task;
  }
  return null;
}

export async function listTasks(rootPath: string): Promise<Task[]> {
  const tasksDir = path.join(rootPath, '.icloser', 'tasks');

  // Disk is authoritative: read all persisted tasks first
  const seen = new Map<string, Task>();
  if (await fileExists(tasksDir)) {
    const dirs = await listDir(tasksDir);
    for (const dir of dirs) {
      const taskPath = path.join(tasksDir, dir, 'task.json');
      if (await fileExists(taskPath)) {
        const t = await readJson(taskPath) as unknown as Task;
        seen.set(t.id, t);
      }
    }
  }

  // Supplement with in-memory tasks not yet flushed to disk
  // (e.g. created but persistTask not called yet)
  for (const [id, task] of taskStore) {
    if (!seen.has(id)) seen.set(id, task);
  }

  return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


