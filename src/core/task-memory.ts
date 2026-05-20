// Auto-7: Persistent Task Memory — records execution patterns, learns from past tasks
// After each task completes, records strategies used, files changed, and outcomes.
// Future similar tasks get pattern suggestions from past successes.
import type { Task } from '../types.js';

export interface TaskRecord {
  taskId: string;
  description: string;
  intent: string;
  status: 'completed' | 'failed';
  strategies: string[];       // tools used in order
  filesChanged: string[];
  verifyPassed: boolean;
  duration: number;           // ms
  tokensUsed: number;
  errors: string[];
  createdAt: string;
}

export interface PatternSuggestion {
  pattern: string;            // e.g. "auth middleware", "API endpoint"
  recommendedStrategy: string[];
  commonFiles: string[];
  successRate: number;        // 0-1
  averageDuration: number;    // ms
  sampleCount: number;
}

const TASK_MEMORY_PATH = '.icloser/task-memory.json';
const MAX_RECORDS = 200;
const MIN_SAMPLES_FOR_PATTERN = 2;

/** Record a completed or failed task execution */
export async function recordTaskExecution(
  rootPath: string,
  task: Task,
  options: {
    status: 'completed' | 'failed';
    strategies: string[];
    filesChanged: string[];
    verifyPassed: boolean;
    duration: number;
    tokensUsed: number;
    errors: string[];
  },
): Promise<void> {
  try {
    const records = await loadTaskRecords(rootPath);
    const record: TaskRecord = {
      taskId: task.id,
      description: task.description,
      intent: inferIntent(task.description),
      ...options,
      createdAt: new Date().toISOString(),
    };
    records.push(record);

    // Keep only last MAX_RECORDS
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }

    const path = await import('path');
    const { writeJson, ensureDir } = await import('../utils/fs.js');
    const memPath = path.join(rootPath, TASK_MEMORY_PATH);
    await ensureDir(path.dirname(memPath));
    await writeJson(memPath, records);
  } catch { /* best-effort */ }
}

/** Get pattern suggestions for a new task based on past executions */
export async function getTaskSuggestions(
  rootPath: string,
  taskDescription: string,
): Promise<PatternSuggestion[]> {
  try {
    const records = await loadTaskRecords(rootPath);
    const intent = inferIntent(taskDescription);
    const matched = records.filter(r => r.intent === intent && r.status === 'completed');

    // Group by common patterns (files changed, strategies used)
    const patterns = new Map<string, TaskRecord[]>();
    for (const r of matched) {
      const key = r.filesChanged.slice(0, 3).sort().join('|') || r.strategies.slice(0, 3).join('|');
      if (!patterns.has(key)) patterns.set(key, []);
      patterns.get(key)!.push(r);
    }

    const suggestions: PatternSuggestion[] = [];
    for (const [key, group] of patterns) {
      if (group.length < MIN_SAMPLES_FOR_PATTERN) continue;
      // Derive recommended strategy from most successful in group
      const best = group.reduce((a, b) =>
        (a.verifyPassed && !b.verifyPassed) ? a :
        (!a.verifyPassed && b.verifyPassed) ? b :
        a.duration < b.duration ? a : b
      );
      suggestions.push({
        pattern: key,
        recommendedStrategy: best.strategies,
        commonFiles: best.filesChanged,
        successRate: group.filter(r => r.verifyPassed).length / group.length,
        averageDuration: Math.round(group.reduce((s, r) => s + r.duration, 0) / group.length),
        sampleCount: group.length,
      });
    }

    return suggestions.sort((a, b) => b.successRate - a.successRate).slice(0, 5);
  } catch { return []; }
}

/** Get success rate for a specific intent type */
export async function getIntentStats(rootPath: string): Promise<Record<string, { total: number; passed: number; avgDuration: number }>> {
  try {
    const records = await loadTaskRecords(rootPath);
    const stats: Record<string, { total: number; passed: number; totalDuration: number }> = {};
    for (const r of records) {
      if (!stats[r.intent]) stats[r.intent] = { total: 0, passed: 0, totalDuration: 0 };
      stats[r.intent].total++;
      if (r.verifyPassed) stats[r.intent].passed++;
      stats[r.intent].totalDuration += r.duration;
    }
    const result: Record<string, { total: number; passed: number; avgDuration: number }> = {};
    for (const [intent, s] of Object.entries(stats)) {
      result[intent] = { total: s.total, passed: s.passed, avgDuration: Math.round(s.totalDuration / s.total) };
    }
    return result;
  } catch { return {}; }
}

async function loadTaskRecords(rootPath: string): Promise<TaskRecord[]> {
  try {
    const path = await import('path');
    const { readJson } = await import('../utils/fs.js');
    const memPath = path.join(rootPath, TASK_MEMORY_PATH);
    const data = await readJson(memPath).catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function inferIntent(description: string): string {
  if (/(修改|创建|新增|添加|fix|修复|补全|生成|实现|写|改|加)/.test(description)) return 'code_change';
  if (/(分析|检查|审查|质量|扫描)/.test(description)) return 'analysis';
  if (/(测试|test|spec)/.test(description)) return 'test_gen';
  if (/(文档|doc|readme|说明)/.test(description)) return 'doc_gen';
  if (/(重构|优化|拆分|整理)/.test(description)) return 'refactor';
  if (/(安全|漏洞|注入)/.test(description)) return 'security';
  return 'general';
}
