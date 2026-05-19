// Memory Kernel Integration — hooks into TaskEngine, Context, Verifier, REPL
// Lightweight adapter that wires MemoryRuntime into the existing system.
// All hooks are fire-and-forget — memory failures never block the main task flow.
// Errors are logged via memdbg for diagnostics (ICLOSER_MEMORY_DEBUG env var).
import { memdbg } from './debug.js';
import type { MemoryRuntime } from './runtime.js';

let _runtime: MemoryRuntime | null = null;
let _initRetries = 0;
const MAX_INIT_RETRIES = 2;

/** Get or lazily initialize the Memory Runtime singleton for a project */
export async function getMemoryRuntime(rootPath: string): Promise<MemoryRuntime> {
  if (_runtime) return _runtime;

  try {
    const { ensureMemoryStore } = await import('./store.js');
    const store = await ensureMemoryStore(rootPath);
    const { MemoryRuntime } = await import('./runtime.js');
    _runtime = new MemoryRuntime(store);
    await _runtime.init();
    _initRetries = 0;
    memdbg.info('integration', `MemoryRuntime 初始化成功 (${rootPath})`);
    return _runtime;
  } catch (err) {
    _runtime = null; // Don't cache a broken instance
    _initRetries++;
    memdbg.error('integration', `MemoryRuntime 初始化失败 (尝试 ${_initRetries}/${MAX_INIT_RETRIES})`, err);

    if (_initRetries <= MAX_INIT_RETRIES) {
      // Retry: clear singleton and try again next call
      memdbg.warn('integration', '下次调用时自动重试');
    } else {
      memdbg.warn('integration', `已达最大重试次数 (${MAX_INIT_RETRIES})，Memory Kernel 降级禁用`);
    }
    throw err; // Re-throw so callers know memory is unavailable
  }
}

/** Reset singleton (testing only). Calls shutdown to release resources. */
export async function resetMemoryRuntime(): Promise<void> {
  if (_runtime) {
    try { await _runtime.shutdown(); } catch { /* best-effort */ }
    _runtime = null;
  }
  _initRetries = 0;
}

/** Whether the Memory Runtime is currently active */
export function isMemoryActive(): boolean {
  return _runtime !== null;
}

// ── Logging helper for hook catch blocks ──

function logHookFailure(hook: string, err: unknown): void {
  // De-duplicate: only log once per hook kind per init cycle
  memdbg.warn('integration', `hook ${hook} 失败（主流程不受影响）`);
  if (process.env.ICLOSER_MEMORY_DEBUG === 'info') {
    memdbg.error('integration', `hook ${hook} 详情`, err);
  }
}

// ── Task lifecycle hooks (fire-and-forget) ──

export async function onTaskCreated(rootPath: string, taskId: string, description: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return; // Memory disabled after repeated failures
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onTaskStart(taskId, description);
  } catch (err) { logHookFailure('onTaskCreated', err); }
}

export async function onTaskProgress(rootPath: string, taskId: string, step: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onTaskProgress(taskId, step);
  } catch (err) { logHookFailure('onTaskProgress', err); }
}

export async function onTaskError(rootPath: string, taskId: string, error: Error | string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onTaskError(taskId, error);
  } catch (err) { logHookFailure('onTaskError', err); }
}

export async function onTaskCompleted(
  rootPath: string,
  taskId: string,
  result: { filesChanged?: string[]; verifyPassed?: boolean; summary?: string }
): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onTaskComplete(taskId, result);
  } catch (err) { logHookFailure('onTaskCompleted', err); }
}

export async function onUserFeedback(rootPath: string, taskId: string | undefined, feedback: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onUserFeedback(taskId, feedback);
  } catch (err) { logHookFailure('onUserFeedback', err); }
}

export async function onRollbackCompleted(
  rootPath: string,
  taskId: string | undefined,
  result: { reason: string; filesRestored: number; filesDeleted: number; totalFiles: number; receipts: Array<{ file: string; action: string; ok: boolean }> }
): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    await runtime.onRollback(taskId, result);
  } catch (err) { logHookFailure('onRollback', err); }
}

// ── Context injection hook ──

export async function getMemoryContextForLLM(rootPath: string, taskDescription: string): Promise<string> {
  if (_initRetries > MAX_INIT_RETRIES) return '';
  try {
    const runtime = await getMemoryRuntime(rootPath);
    const results = await runtime.recall.recall(taskDescription);

    if (results.length === 0) return '';

    const { ContextComposer } = await import('./composer.js');
    const composer = new ContextComposer();
    const ctx = composer.composeCompact(results, taskDescription);
    memdbg.info('integration', `Recall 注入 ${results.length} 条记忆 (${ctx.length} chars)`);
    return ctx;
  } catch (err) {
    logHookFailure('getMemoryContextForLLM', err);
    return '';
  }
}

// ── Verification hook ──

export async function onVerifyComplete(
  rootPath: string, taskId: string, passed: boolean, summary: string
): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    const type = passed ? 'task_completed' : 'task_failed';
    await runtime.episodic.record({
      type, taskId,
      summary: passed ? `验证通过: ${summary}` : `验证失败: ${summary}`,
      details: summary,
      importance: passed ? 0.4 : 0.7,
      tags: ['verification', passed ? 'passed' : 'failed'],
      relatedEpisodeIds: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) { logHookFailure('onVerifyComplete', err); }
}

// ── REPL sensory ingestion hooks ──

export async function ingestUserInput(rootPath: string, input: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    runtime.sensory.ingest('cli_input', input);
  } catch (err) { logHookFailure('ingestUserInput', err); }
}

export async function ingestShellOutput(rootPath: string, output: string, isError: boolean): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    runtime.sensory.ingest(isError ? 'shell_stderr' : 'shell_stdout', output);
  } catch (err) { logHookFailure('ingestShellOutput', err); }
}

export async function ingestGitDiff(rootPath: string, diff: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    const runtime = await getMemoryRuntime(rootPath);
    runtime.sensory.ingest('git_diff', diff);
  } catch (err) { logHookFailure('ingestGitDiff', err); }
}

// ── M6: User preference auto-detection ──

const PREFERENCE_PATTERNS: Array<{ regex: RegExp; category: string; extract: (match: RegExpMatchArray) => string }> = [
  { regex: /(?:用|使用|偏好|喜欢|默认)\s*(camelCase|PascalCase|snake_case|kebab-case)/, category: 'naming', extract: m => `命名约定: ${m[1]}` },
  { regex: /(?:用|使用|偏好|喜欢)\s*(单引号|双引号)/, category: 'quoting', extract: m => `引号风格: ${m[1]}` },
  { regex: /(?:用|使用|偏好|喜欢|默认)\s*(中文|英文|English|Chinese)\s*(?:注释|回答|输出|文档)/, category: 'language', extract: m => `语言偏好: ${m[1]}` },
  { regex: /(?:不要|禁止|别|不能|千万别)\s*(?:修改|改|动|碰)\s*([^\s，,。.!！?？]{2,30})/, category: 'constraint', extract: m => `禁止修改: ${m[1].trim()}` },
  { regex: /(?:总是|每次|一定|必须)\s*(?:先|首先)?\s*([^\s，,。.!！?？]{2,40})/, category: 'rule', extract: m => `规则: ${m[1].trim()}` },
];

export async function detectAndRecordPreference(rootPath: string, userInput: string): Promise<void> {
  if (_initRetries > MAX_INIT_RETRIES) return;
  try {
    for (const pattern of PREFERENCE_PATTERNS) {
      const match = userInput.match(pattern.regex);
      if (match) {
        const content = pattern.extract(match);
        const runtime = await getMemoryRuntime(rootPath);
        // Check if similar rule already exists
        const existing = runtime.semantic.searchRelevant(content, 1);
        if (existing.length === 0) {
          runtime.semantic.add({
            path: `偏好/${pattern.category}`, domain: 'General',
            content, scope: 'project', confidence: 0.4, tags: ['preference', pattern.category, 'auto-detected'],
            verificationCount: 1, sourceEpisodeIds: [], isPermanent: false,
          });
          await runtime.semantic.save();
          memdbg.info('integration', `偏好提取: ${content}`);
        }
      }
    }
  } catch (err) { logHookFailure('detectAndRecordPreference', err); }
}
