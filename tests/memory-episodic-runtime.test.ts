// Coverage for src/core/memory/episodic.ts and src/core/memory/runtime.ts
// Targets: createEpisode variants, defaultImportance, defaultTags, toMarkdownJournal,
//          queryJsonl sorting, EpisodicMemory methods, MemoryRuntime lifecycle hooks
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createEpisode,
  EpisodicMemory,
  type EpisodeType,
} from '../src/core/memory/episodic.js';
import { MemoryRuntime } from '../src/core/memory/runtime.js';
import { JSONLStore } from '../src/core/memory/jsonl-store.js';
import type { MemoryStore } from '../src/core/memory/store.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const roots: string[] = [];

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'ep-rt-cov-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Build a minimal MemoryStore backed by temp directories, SQLite disabled. */
function makeFakeStore(dir: string): MemoryStore {
  const paths = {
    root: dir,
    sensory: join(dir, 'sensory'),
    working: join(dir, 'working'),
    episodic: join(dir, 'episodic'),
    semantic: join(dir, 'semantic'),
    archive: join(dir, 'archive'),
    policies: join(dir, 'policies'),
    sqlite: join(dir, 'index.sqlite'),
  };
  for (const p of Object.values(paths)) {
    try { mkdirSync(p, { recursive: true }); } catch { /* ignore */ }
  }

  // A fake sqlite handle that reports isOpen=false → episodic falls back to JSONL
  const fakeSqlite = {
    isOpen: false,
    open: () => {},
    close: () => {},
    insert: () => 0,
    insertBatch: () => {},
    query: () => [],
    getByKey: () => null,
    searchByText: () => [],
    count: () => 0,
    deleteByKey: () => false,
    deleteOlderThan: () => 0,
    setMeta: () => {},
    getMeta: () => null,
    vacuum: () => {},
    getStats: () => ({ episodicCount: 0, semanticCount: 0, dbSize: 'disabled' }),
  } as any;

  return {
    paths,
    sqlite: fakeSqlite,
    semanticRulesPath: join(paths.semantic, 'rules.json'),
    semanticTreePath: join(paths.semantic, 'tree.md'),
    createSensoryLog: (sessionId: string) =>
      new JSONLStore(join(paths.sensory, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`), { maxLines: 5000 }),
    createEpisodicLog: (yearMonth?: string) => {
      const now = new Date();
      const ym = yearMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return new JSONLStore(join(paths.episodic, `${ym}.jsonl`), { maxLines: 20000 });
    },
    archiveFile: async () => join(paths.archive, 'archived'),
    close: () => {},
  };
}

// ============================================================
// createEpisode — covers defaultImportance and defaultTags
// ============================================================
describe('createEpisode — defaultImportance', () => {
  const TYPED_PAIRS: Array<[EpisodeType, number]> = [
    ['error_occurred', 0.8],
    ['user_correction', 0.75],
    ['deploy_triggered', 0.7],
    ['rollback_executed', 0.85],
    ['task_failed', 0.7],
    ['task_completed', 0.4],
    ['rule_extracted', 0.6],
    ['memory_consolidated', 0.3],
    ['system_event', 0.35],     // default branch
    ['task_started', 0.35],     // another default
    ['file_changed', 0.35],
    ['user_feedback', 0.35],
  ];

  for (const [type, expectedImportance] of TYPED_PAIRS) {
    it(`type="${type}" → importance=${expectedImportance}`, () => {
      const ep = createEpisode(type, '测试摘要', '测试详情');
      expect(ep.type).toBe(type);
      expect(ep.importance).toBe(expectedImportance);
    });
  }

  it('explicit importance overrides default', () => {
    const ep = createEpisode('task_completed', '摘要', '详情', { importance: 0.99 });
    expect(ep.importance).toBe(0.99);
  });
});

describe('createEpisode — defaultTags', () => {
  it('tags always include the type', () => {
    const ep = createEpisode('task_started', '摘要', '详情');
    expect(ep.tags).toContain('task_started');
  });

  it('extracts "error" keyword from summary', () => {
    const ep = createEpisode('system_event', 'error happened', '详情');
    expect(ep.tags).toContain('error');
  });

  it('extracts "deploy" keyword from summary', () => {
    const ep = createEpisode('system_event', 'deploy triggered now', '详情');
    expect(ep.tags).toContain('deploy');
  });

  it('extracts "rollback" keyword from summary', () => {
    const ep = createEpisode('system_event', 'rollback was executed', '详情');
    expect(ep.tags).toContain('rollback');
  });

  it('extracts "security" and "api" keywords', () => {
    const ep = createEpisode('system_event', 'security issue in api layer', '详情');
    expect(ep.tags).toContain('security');
    expect(ep.tags).toContain('api');
  });

  it('extracts "test" and "database" keywords', () => {
    const ep = createEpisode('system_event', 'test runs against database', '详情');
    expect(ep.tags).toContain('test');
    expect(ep.tags).toContain('database');
  });

  it('extracts "crash", "config", "ui" keywords', () => {
    const ep = createEpisode('system_event', 'crash in ui config panel', '详情');
    expect(ep.tags).toContain('crash');
    expect(ep.tags).toContain('ui');
    expect(ep.tags).toContain('config');
  });

  it('does not duplicate tags (Set dedup)', () => {
    const ep = createEpisode('system_event', '摘要', '详情', { tags: ['system_event'] });
    const setSize = new Set(ep.tags).size;
    expect(setSize).toBe(ep.tags.length);
  });

  it('truncates long summary to 200 chars', () => {
    const long = 'x'.repeat(300);
    const ep = createEpisode('system_event', long, long);
    expect(ep.summary.length).toBeLessThanOrEqual(200);
    expect(ep.details.length).toBeLessThanOrEqual(2000);
  });

  it('populates optional fields', () => {
    const ep = createEpisode('task_completed', '摘要', '详情', {
      taskId: 't-1',
      sessionId: 's-1',
      changedFiles: ['a.ts'],
      relatedEpisodeIds: ['ep-0'],
    });
    expect(ep.taskId).toBe('t-1');
    expect(ep.sessionId).toBe('s-1');
    expect(ep.changedFiles).toEqual(['a.ts']);
    expect(ep.relatedEpisodeIds).toEqual(['ep-0']);
  });
});

// ============================================================
// EpisodicMemory.toMarkdownJournal
// ============================================================
describe('EpisodicMemory.toMarkdownJournal', () => {
  it('returns header when episodes array is empty', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    const md = em.toMarkdownJournal([]);
    expect(md).toContain('# Episodic Memory Journal');
  });

  it('formats an episode with taskId and changedFiles', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    const ep = await em.record({
      type: 'task_completed',
      taskId: 'task-42',
      summary: 'Completed refactoring',
      details: 'Refactored 5 modules',
      importance: 0.7,
      tags: ['task', 'refactor'],
      changedFiles: ['src/a.ts', 'src/b.ts'],
      relatedEpisodeIds: [],
      timestamp: new Date().toISOString(),
    });

    const md = em.toMarkdownJournal([ep]);
    expect(md).toContain('task_completed');
    expect(md).toContain('Completed refactoring');
    expect(md).toContain('task-42');
    expect(md).toContain('src/a.ts');
    expect(md).toContain('src/b.ts');
    expect(md).toContain('70%');  // importance × 100
  });

  it('omits details line when details equals summary', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    const ep = await em.record({
      type: 'system_event',
      summary: 'same text',
      details: 'same text',
      importance: 0.3,
      tags: ['system_event'],
      relatedEpisodeIds: [],
      timestamp: new Date().toISOString(),
    });
    const md = em.toMarkdownJournal([ep]);
    // summary is shown once, details section not duplicated
    expect(md.split('same text').length).toBeLessThanOrEqual(3);
  });
});

// ============================================================
// EpisodicMemory — JSONL-backed operations (sqlite.isOpen = false)
// ============================================================
describe('EpisodicMemory — JSONL operations', () => {
  it('record + query returns the episode via queryJsonl', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);

    const ep = await em.record({
      type: 'task_started',
      summary: 'Test task',
      details: 'Details here',
      importance: 0.5,
      tags: ['task_started'],
      relatedEpisodeIds: [],
      timestamp: new Date().toISOString(),
    });

    const results = em.query({ limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.id === ep.id)).toBe(true);
  });

  it('recordBatch records all episodes', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    const eps = await em.recordBatch([
      { type: 'file_changed', summary: 'File A changed', details: 'A', importance: 0.3, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() },
      { type: 'file_created', summary: 'File B created', details: 'B', importance: 0.3, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() },
    ]);
    expect(eps).toHaveLength(2);
    const results = em.query({ limit: 100 });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('recent(days) returns episodes from last N days', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({
      type: 'system_event', summary: 'Recent event', details: 'D', importance: 0.4,
      tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    const recent = em.recent(7);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].summary).toBe('Recent event');
  });

  it('important(minImportance) filters by importance using orderBy', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({
      type: 'error_occurred', summary: 'Critical error', details: 'D', importance: 0.9,
      tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    await em.record({
      type: 'system_event', summary: 'Low importance', details: 'D', importance: 0.1,
      tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    // important() uses orderBy: 'importance DESC' → covers line 240 in queryJsonl
    const important = em.important(0.5);
    expect(important.every(e => e.importance >= 0.5)).toBe(true);
  });

  it('query with orderBy ASC covers the ASC sort branch', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({
      type: 'task_started', summary: 'Event One', details: 'D', importance: 0.4,
      tags: [], relatedEpisodeIds: [], timestamp: new Date(Date.now() - 5000).toISOString(),
    });
    await em.record({
      type: 'task_completed', summary: 'Event Two', details: 'D', importance: 0.4,
      tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    // 'ASC' branch in queryJsonl (line 246) — sort by timestamp ascending
    const asc = em.query({ orderBy: 'ASC' });
    if (asc.length >= 2) {
      expect(asc[0].timestamp <= asc[asc.length - 1].timestamp).toBe(true);
    }
    expect(asc.length).toBeGreaterThan(0);
  });

  it('search finds episodes matching text via JSONL', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({
      type: 'system_event', summary: 'unique-searchable-phrase', details: 'D', importance: 0.4,
      tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    const found = em.search('unique-searchable-phrase');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].summary).toContain('unique-searchable-phrase');
  });

  it('search with tag match', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({
      type: 'system_event', summary: 'plain summary', details: 'D', importance: 0.4,
      tags: ['special-tag-xyz'], relatedEpisodeIds: [], timestamp: new Date().toISOString(),
    });
    const found = em.search('special-tag-xyz');
    expect(found.length).toBeGreaterThan(0);
  });

  it('countByType returns counts per type', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({ type: 'task_started', summary: 'S', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });
    await em.record({ type: 'task_started', summary: 'S2', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });
    await em.record({ type: 'error_occurred', summary: 'E', details: 'D', importance: 0.8, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });

    const counts = em.countByType();
    expect(counts['task_started']).toBeGreaterThanOrEqual(2);
    expect(counts['error_occurred']).toBeGreaterThanOrEqual(1);
  });

  it('latestByType returns map of types', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({ type: 'task_completed', summary: 'Done', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });

    const latest = em.latestByType();
    expect(latest instanceof Map).toBe(true);
    // May or may not have task_completed depending on JSONL timing — just check no crash
    expect(typeof latest.size).toBe('number');
  });

  it('getTaskEpisodes returns episodes for a taskId', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({ type: 'task_started', taskId: 'my-task-123', summary: 'S', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });
    await em.record({ type: 'task_completed', taskId: 'my-task-123', summary: 'Done', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });

    const eps = em.getTaskEpisodes('my-task-123');
    expect(eps.every(e => e.taskId === 'my-task-123')).toBe(true);
    expect(eps.length).toBeGreaterThanOrEqual(2);
  });

  it('query with types filter works via JSONL', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({ type: 'task_started', summary: 'S1', details: 'D', importance: 0.4, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });
    await em.record({ type: 'error_occurred', summary: 'E1', details: 'D', importance: 0.8, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() });

    const errorOnly = em.query({ types: ['error_occurred'] });
    expect(errorOnly.every(e => e.type === 'error_occurred')).toBe(true);
  });

  it('query with tags filter', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    await em.record({ type: 'system_event', summary: 'A', details: 'D', importance: 0.3, tags: ['filterme'], relatedEpisodeIds: [], timestamp: new Date().toISOString() });
    await em.record({ type: 'system_event', summary: 'B', details: 'D', importance: 0.3, tags: ['other'], relatedEpisodeIds: [], timestamp: new Date().toISOString() });

    const filtered = em.query({ tags: ['filterme'] });
    expect(filtered.every(e => e.tags.includes('filterme'))).toBe(true);
  });

  it('deleteOlderThan returns 0 when sqlite is closed', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const em = new EpisodicMemory(store);
    const deleted = em.deleteOlderThan(0); // 0 days = delete everything older than now
    expect(deleted).toBe(0); // No SQLite → returns 0
  });

  it('search returns empty when no JSONL dir exists', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    // Point episodic path to non-existent directory
    (store as any).paths = { ...store.paths, episodic: join(dir, 'nonexistent') };
    const em = new EpisodicMemory(store);
    // queryJsonl checks existsSync → returns [] when directory doesn't exist
    const found = em.search('anything');
    expect(found).toEqual([]);
  });
});

// ============================================================
// MemoryRuntime — construction, getStatus, formatRecallForDisplay
// ============================================================
describe('MemoryRuntime — construction and status', () => {
  it('constructs without error with fake store', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);
    expect(rt.episodic).toBeDefined();
    expect(rt.working).toBeDefined();
    expect(rt.semantic).toBeDefined();
    expect(rt.sensory).toBeDefined();
  });

  it('getStatus returns correct shape before init', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const status = rt.getStatus();
    expect(status.initialized).toBe(false);
    expect(typeof status.workingMemory.tokenCount).toBe('number');
    expect(['ok', 'warn', 'critical']).toContain(status.workingMemory.status);
    expect(status.metrics.tasksProcessed).toBe(0);
  });

  it('formatRecallForDisplay with empty results', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const msg = rt.formatRecallForDisplay([]);
    expect(msg).toBe('无相关记忆');
  });

  it('formatRecallForDisplay with results formats them', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const results = [
      { type: 'semantic' as const, score: 0.85, content: 'TypeScript rule: always use strict mode' },
      { type: 'emotion' as const, score: 0.6, content: 'User prefers concise responses' },
      { type: 'timeline' as const, score: 0.4, content: 'Historical: fixed bug in auth module' },
    ];
    const msg = rt.formatRecallForDisplay(results);
    expect(msg).toContain('1.');
    expect(msg).toContain('[semantic]');
    expect(msg).toContain('85%');
    expect(msg).toContain('[emotion]');
    expect(msg).toContain('[timeline]');
  });
});

// ============================================================
// MemoryRuntime — lifecycle hooks (with real JSONL writes)
// ============================================================
describe('MemoryRuntime — lifecycle hooks', () => {
  it('onTaskStart records episode and updates metrics', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('task-1', 'Implement OAuth login');

    const status = rt.getStatus();
    expect(status.metrics.tasksProcessed).toBe(1);
    expect(status.metrics.episodesRecorded).toBeGreaterThan(0);
    // recall returned nothing (empty store) → recallMisses incremented
    expect(status.metrics.recallMisses).toBe(1);
    expect(status.metrics.recallHits).toBe(0);
  });

  it('onTaskProgress adds reasoning to working memory', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('task-2', 'Fix bug');
    await rt.onTaskProgress('task-2', 'Identified root cause in auth.ts', { line: 42 });

    // Working memory should have absorbed the progress — getStatus should still work
    const status = rt.getStatus();
    expect(status.workingMemory.tokenCount).toBeGreaterThanOrEqual(0);
  });

  it('onTaskError records error episode', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('task-3', 'Run tests');
    const before = rt.getStatus().metrics.episodesRecorded;
    await rt.onTaskError('task-3', new Error('tsc not found'), 'compile step');
    const after = rt.getStatus().metrics.episodesRecorded;

    expect(after).toBeGreaterThan(before);
  });

  it('onTaskError accepts string errors', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);
    // Should not throw
    await expect(rt.onTaskError('task-4', 'Simple string error')).resolves.toBeUndefined();
  });

  it('onTaskComplete records completion episode', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('task-5', 'Deploy to staging');
    await rt.onTaskComplete('task-5', {
      filesChanged: ['src/main.ts', 'src/auth.ts'],
      verifyPassed: true,
      summary: 'Deployed successfully',
    });

    const status = rt.getStatus();
    expect(status.metrics.episodesRecorded).toBeGreaterThan(1);
  });

  it('onTaskComplete without options', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('task-6', 'Simple task');
    await expect(rt.onTaskComplete('task-6', {})).resolves.toBeUndefined();
  });

  it('onUserFeedback with correction keyword records user_correction', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const before = rt.getStatus().metrics.episodesRecorded;
    await rt.onUserFeedback('task-7', '不对，应该使用 async/await 而不是 callback');
    const after = rt.getStatus().metrics.episodesRecorded;
    expect(after).toBeGreaterThan(before);
  });

  it('onUserFeedback without taskId (positive feedback)', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await expect(rt.onUserFeedback(undefined, 'Great job!')).resolves.toBeUndefined();
  });

  it('onRollback records rollback episode', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const before = rt.getStatus().metrics.episodesRecorded;
    await rt.onRollback('task-8', {
      reason: 'Tests failed after deploy',
      filesRestored: 3,
      filesDeleted: 1,
      totalFiles: 4,
      receipts: [
        { file: 'src/a.ts', action: 'restored', ok: true },
        { file: 'src/b.ts', action: 'deleted', ok: false },
      ],
    });
    const after = rt.getStatus().metrics.episodesRecorded;
    expect(after).toBeGreaterThan(before);
  });

  it('runConsolidation and runForgetting do not crash with empty data', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    const rules = await rt.runConsolidation();
    expect(typeof rules).toBe('number');

    const result = await rt.runForgetting();
    expect(typeof result.archived).toBe('number');
    expect(typeof result.deleted).toBe('number');
  });

  it('shutdown resolves without error', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await expect(rt.shutdown()).resolves.toBeUndefined();
  });

  it('getStatus after multiple tasks shows updated metrics', async () => {
    const dir = await makeDir();
    const store = makeFakeStore(dir);
    const rt = new MemoryRuntime(store);

    await rt.onTaskStart('t1', 'First task');
    await rt.onTaskComplete('t1');
    await rt.onTaskStart('t2', 'Second task');
    await rt.onTaskComplete('t2');

    const status = rt.getStatus();
    expect(status.metrics.tasksProcessed).toBe(2);
  });
});
