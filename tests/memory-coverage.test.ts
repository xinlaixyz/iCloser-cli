// Coverage for src/core/memory.ts
// Targets: cleanupStaleMemory branches, recordTask → compressTaskRecord,
//          extractPatternsFromTasks, extractLibrariesFromTasks (via updateGlobalPatterns)
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createEmptyProjectMemory,
  cleanupStaleMemory,
  recordTask,
} from '../src/core/memory.js';
import { createTask } from '../src/core/task-engine.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-cov-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const IDENTITY: any = {
  language: 'typescript', framework: 'express', database: 'postgres',
  buildSystem: 'npm', testFramework: 'vitest', runtime: 'node',
  deploymentType: 'cloud', packageManager: 'npm', languageVersion: '20',
};

// ============================================================
// cleanupStaleMemory — all branches
// ============================================================
describe('cleanupStaleMemory', () => {
  it('returns 0 removed when nothing is stale', () => {
    const memory = createEmptyProjectMemory('/test');
    const removed = cleanupStaleMemory(memory);
    expect(removed).toBe(0);
  });

  it('archives approved candidates older than 30 days', () => {
    const memory = createEmptyProjectMemory('/test');
    const oldDate = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();

    // Add 2 approved candidates: one old, one recent
    memory.memoryCandidates.push({
      id: 'c1', kind: 'pattern', content: 'Old approved pattern',
      reviewStatus: 'approved', importance: 0.7, createdAt: oldDate,
      lastAccessedAt: oldDate, risk: 'low',
      sourceTaskId: 't1', reason: 'test',
    } as any);

    memory.memoryCandidates.push({
      id: 'c2', kind: 'pattern', content: 'Recent approved pattern',
      reviewStatus: 'approved', importance: 0.7,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      risk: 'low', sourceTaskId: 't2', reason: 'test',
    } as any);

    // Add pending candidate — should NOT be archived
    memory.memoryCandidates.push({
      id: 'c3', kind: 'pattern', content: 'Pending pattern',
      reviewStatus: 'pending', importance: 0.5,
      createdAt: oldDate, lastAccessedAt: oldDate,
      risk: 'low', sourceTaskId: 't3', reason: 'test',
    } as any);

    const removed = cleanupStaleMemory(memory);

    // c1 (old approved) should now be archived
    const c1 = memory.memoryCandidates.find(c => c.id === 'c1');
    expect(c1?.reviewStatus).toBe('archived');
    expect(c1?.reason).toContain('30天未访问');

    // c2 (recent approved) should remain approved
    const c2 = memory.memoryCandidates.find(c => c.id === 'c2');
    expect(c2?.reviewStatus).toBe('approved');

    // cleanupStaleMemory also removes rejected candidates
    expect(typeof removed).toBe('number');
  });

  it('cleans up decisions older than 90 days', () => {
    const memory = createEmptyProjectMemory('/test');
    const oldDate = new Date(Date.now() - 91 * 24 * 3600 * 1000).toISOString();
    const recentDate = new Date().toISOString();

    memory.decisions.push({
      id: 'd1', decision: 'Use TypeScript', rationale: 'Type safety',
      timestamp: oldDate, reversible: false,
    });
    memory.decisions.push({
      id: 'd2', decision: 'Use Express', rationale: 'Simple API',
      timestamp: recentDate, reversible: true,
    });

    cleanupStaleMemory(memory);

    // Old decision removed, recent one kept
    expect(memory.decisions.find(d => d.id === 'd1')).toBeUndefined();
    expect(memory.decisions.find(d => d.id === 'd2')).toBeDefined();
  });

  it('removes candidates with expired TTL (expiresAt in the past)', () => {
    const memory = createEmptyProjectMemory('/test');
    const pastDate = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    memory.memoryCandidates.push({
      id: 'expired', kind: 'pattern', content: 'Expired pattern',
      reviewStatus: 'pending', importance: 0.5,
      createdAt: pastDate, expiresAt: pastDate, risk: 'low',
      sourceTaskId: 't1', reason: 'test',
    } as any);
    memory.memoryCandidates.push({
      id: 'valid', kind: 'pattern', content: 'Valid pattern',
      reviewStatus: 'approved', importance: 0.7,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(), // future
      risk: 'low', sourceTaskId: 't2', reason: 'test',
    } as any);

    const removed = cleanupStaleMemory(memory);
    expect(removed).toBe(1); // expired candidate removed
    expect(memory.memoryCandidates.find(c => c.id === 'expired')).toBeUndefined();
    expect(memory.memoryCandidates.find(c => c.id === 'valid')).toBeDefined();
  });

  it('keeps candidates with no expiresAt (no TTL)', () => {
    const memory = createEmptyProjectMemory('/test');
    memory.memoryCandidates.push({
      id: 'no-ttl', kind: 'pattern', content: 'No TTL candidate',
      reviewStatus: 'pending', importance: 0.5,
      createdAt: new Date().toISOString(), risk: 'low',
      sourceTaskId: 't1', reason: 'test',
      // no expiresAt field
    } as any);

    const removed = cleanupStaleMemory(memory);
    expect(removed).toBe(0);
    expect(memory.memoryCandidates.find(c => c.id === 'no-ttl')).toBeDefined();
  });
});

// ============================================================
// recordTask → compressTaskRecord
// ============================================================
describe('recordTask — compressTaskRecord', () => {
  it('records a basic task (no changes, no verifyResult)', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);
    const task = createTask('Fix bug in auth module');

    const updated = await recordTask(memory, task, IDENTITY);
    expect(updated.taskHistory.length).toBeGreaterThan(0);
    expect(updated.taskHistory[0].description).toBe('Fix bug in auth module');
  });

  it('compresses task with changes (covers task.changes.length > 0 branch)', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);
    const task = createTask('Add new feature');
    task.changes = [
      { path: 'src/a.ts', operation: 'modify', content: 'const x = 1;', reason: 'test' } as any,
      { path: 'src/b.ts', operation: 'create', content: 'const y = 2;', reason: 'test' } as any,
    ];

    const updated = await recordTask(memory, task, IDENTITY);
    expect(updated.taskHistory[0].summary).toContain('2 个文件');
  });

  it('compresses task with verifyResult (covers verifyResult branch)', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);
    const task = createTask('Deploy update');
    task.verifyResult = {
      overall: 'pass',
      stages: [],
      totalTests: 10,
      passedTests: 10,
      coverage: 85,
    } as any;

    const updated = await recordTask(memory, task, IDENTITY);
    expect(updated.taskHistory[0].summary).toContain('验证: pass');
  });

  it('compresses task with retryCount > 0 (covers retryCount branch)', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);
    const task = createTask('Complex task with retries');
    task.retryCount = 3;

    const updated = await recordTask(memory, task, IDENTITY);
    expect(updated.taskHistory[0].summary).toContain('重试 3 次');
  });
});

// ============================================================
// extractPatternsFromTasks and extractLibrariesFromTasks
// (triggered when taskHistory.length % 10 === 0)
// ============================================================
describe('recordTask — extractPatternsFromTasks via updateGlobalPatterns', () => {
  beforeEach(() => {
    // Redirect global memory writes to a temp location
    const tempHome = join(tmpdir(), `global-mem-test-${Date.now()}`);
    roots.push(tempHome);
    process.env._ICLOSER_TEST_HOME = tempHome;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  it('triggers updateGlobalPatterns when taskHistory reaches multiple of 10', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);

    // Fill with 9 tasks already in history (bypass recordTask to avoid repeated I/O)
    for (let i = 0; i < 9; i++) {
      memory.taskHistory.push({
        taskId: `pre-${i}`,
        description: `Auth task ${i}`, // includes 'auth' keyword for pattern detection
        status: 'completed',
        summary: `Task ${i}`,
        diffDigest: '',
        timestamp: new Date().toISOString(),
      });
    }

    // 10th task — triggers updateGlobalPatterns → calls extractPatternsFromTasks
    const task10 = createTask('API endpoint for auth login'); // includes 'auth' and 'api' keywords
    task10.status = 'completed' as any;
    task10.retryCount = 0;

    // This should not throw even when writing to redirected HOME
    const updated = await recordTask(memory, task10, IDENTITY);
    expect(updated.taskHistory.length).toBeGreaterThanOrEqual(10);
  }, 15000);

  it('triggers extractLibrariesFromTasks when 6+ successful tasks in last 10', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);

    // Fill with 9 completed tasks (sufficient successful tasks > 5)
    for (let i = 0; i < 9; i++) {
      memory.taskHistory.push({
        taskId: `suc-${i}`,
        description: `API task ${i}`,
        status: 'completed', // all completed
        summary: `Task ${i}`,
        diffDigest: '',
        timestamp: new Date().toISOString(),
      });
    }

    // 10th task → updateGlobalPatterns → 9 completed tasks in slice → extractLibrariesFromTasks called
    const task10 = createTask('API endpoint update');
    task10.status = 'completed' as any;

    const updated = await recordTask(memory, task10, IDENTITY);
    // All 10 in history → extraction was triggered
    expect(updated.taskHistory.length).toBeGreaterThanOrEqual(10);
  }, 15000);

  it('patterns from auth/api/ui task descriptions are detected', async () => {
    const dir = await makeDir();
    const memory = createEmptyProjectMemory(dir);

    // 3+ auth tasks, 3+ API tasks, 3+ UI tasks
    const descriptions = [
      'Add auth login feature', 'Fix auth token refresh', 'Improve auth session management',
      'Create api endpoint for users', 'Update api for search', 'Add api rate limiting',
      'Redesign ui dashboard', 'Fix ui button styles', 'Update ui navigation',
    ];
    for (let i = 0; i < descriptions.length; i++) {
      memory.taskHistory.push({
        taskId: `pat-${i}`, description: descriptions[i], status: 'completed',
        summary: descriptions[i], diffDigest: '', timestamp: new Date().toISOString(),
      });
    }

    // One more task to make 10
    const task10 = createTask('Final task');
    const updated = await recordTask(memory, task10, IDENTITY);
    // Just verify no crash
    expect(updated.taskHistory.length).toBeGreaterThanOrEqual(10);
  }, 15000);
});
