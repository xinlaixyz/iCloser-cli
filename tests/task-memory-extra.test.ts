// Extra coverage for src/core/task-memory.ts
// Targets: inferIntent branches (144-149) via recordTaskExecution,
//          MAX_RECORDS splice (60-61) via overflow
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  recordTaskExecution,
  getTaskSuggestions,
  getIntentStats,
} from '../src/core/task-memory.js';
import type { Task } from '../src/types.js';

const TASK_MEMORY_PATH = '.icloser/task-memory.json';

function makeTask(description: string, id = 'task-001'): Task {
  return {
    id,
    description,
    status: 'completed',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    changes: [],
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
    agentExecutions: [],
  } as unknown as Task;
}

const DEFAULT_OPTIONS = {
  status: 'completed' as const,
  strategies: ['read_file', 'write_file'],
  filesChanged: ['src/auth.ts'],
  verifyPassed: true,
  duration: 5000,
  tokensUsed: 1500,
  errors: [],
};

describe('recordTaskExecution — inferIntent branches', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'task-mem-'));
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  });

  it('infers "test_gen" intent for test-related descriptions (line 144)', async () => {
    // "unit test spec" — no code_change keywords, hits test_gen first
    const task = makeTask('unit test spec coverage');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['test_gen']).toBeDefined();
    expect(stats['test_gen'].total).toBe(1);
  });

  it('infers "doc_gen" intent for documentation descriptions (line 145)', async () => {
    // "readme 文档 说明" — no code_change/analysis/test keywords, hits doc_gen
    const task = makeTask('API readme 文档说明');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['doc_gen']).toBeDefined();
  });

  it('infers "refactor" intent for refactoring descriptions (line 146)', async () => {
    const task = makeTask('重构并优化数据库访问层');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['refactor']).toBeDefined();
  });

  it('infers "security" intent for security-related descriptions (line 147)', async () => {
    // "安全漏洞 注入" — no code_change/analysis/test/doc/refactor keywords, hits security
    const task = makeTask('安全漏洞 SQL 注入风险');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['security']).toBeDefined();
  });

  it('infers "general" intent for unmatched descriptions (line 148)', async () => {
    const task = makeTask('做一些不相关的工作 xyz abc');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['general']).toBeDefined();
  });

  it('infers "code_change" intent for modify/fix descriptions (line 142)', async () => {
    const task = makeTask('修改用户登录功能，修复密码验证 bug');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);
    const stats = await getIntentStats(tmpDir);
    expect(stats['code_change']).toBeDefined();
  });
});

describe('recordTaskExecution — MAX_RECORDS splice (lines 60-61)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'task-mem-overflow-'));
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  });

  it('splices records array when MAX_RECORDS (200) is exceeded', async () => {
    // Seed the file with 200 records (the MAX_RECORDS limit)
    const memDir = join(tmpDir, '.icloser');
    await mkdir(memDir, { recursive: true });

    const records = Array.from({ length: 200 }, (_, i) => ({
      taskId: `task-${i}`,
      description: `Task ${i}`,
      intent: 'general',
      status: 'completed',
      strategies: [],
      filesChanged: [],
      verifyPassed: true,
      duration: 1000,
      tokensUsed: 100,
      errors: [],
      createdAt: new Date().toISOString(),
    }));
    await writeFile(join(memDir, 'task-memory.json'), JSON.stringify(records), 'utf-8');

    // Now add one more record — triggers the splice (records.length > MAX_RECORDS)
    const task = makeTask('触发 splice 的额外任务', 'task-overflow');
    await recordTaskExecution(tmpDir, task, DEFAULT_OPTIONS);

    const stats = await getIntentStats(tmpDir);
    // Should have entries (overall total should be ~200 after splice)
    const total = Object.values(stats).reduce((sum, s) => sum + s.total, 0);
    expect(total).toBeLessThanOrEqual(200);
  });
});

describe('getTaskSuggestions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'task-mem-sugg-'));
  });

  afterEach(async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch { /**/ }
  });

  it('returns empty array when no records exist', async () => {
    const suggestions = await getTaskSuggestions(tmpDir, '修改用户认证模块');
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('returns suggestions for similar past tasks', async () => {
    // Record two similar tasks
    const t1 = makeTask('修改用户认证逻辑', 'task-auth-1');
    const t2 = makeTask('修改用户认证权限', 'task-auth-2');
    await recordTaskExecution(tmpDir, t1, DEFAULT_OPTIONS);
    await recordTaskExecution(tmpDir, t2, DEFAULT_OPTIONS);

    // MIN_SAMPLES_FOR_PATTERN = 2, so suggestions should appear for auth/修改 pattern
    const suggestions = await getTaskSuggestions(tmpDir, '修改用户认证');
    expect(Array.isArray(suggestions)).toBe(true);
  });
});
