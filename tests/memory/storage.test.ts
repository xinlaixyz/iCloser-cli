// Memory Kernel v1.0 — Storage Foundation Tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { existsSync, readFileSync } from 'fs';
import { JSONLStore } from '../../src/core/memory/jsonl-store.js';
import { MemoryRuntime } from '../../src/core/memory/runtime.js';
import { createMemoryStore, ensureMemoryStore, getMemoryStore, resetMemoryStore } from '../../src/core/memory/store.js';
import { ensureDir } from '../../src/utils/fs.js';

const tmpDir = path.join(os.tmpdir(), 'icloser-memory-test-' + Date.now().toString(36));
const memoryRoot = path.join(tmpDir, '.agent', 'memory');

beforeAll(async () => {
  await ensureDir(tmpDir);
  process.chdir(tmpDir);
});

afterAll(() => {
  resetMemoryStore();
  try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
});

// ── JSONL Store ──

describe('JSONLStore', () => {
  it('creates and appends records', async () => {
    const store = new JSONLStore(path.join(memoryRoot, 'test.jsonl'));
    await store.init();
    await store.append({ type: 'test', message: 'hello' });
    await store.append({ type: 'test', message: 'world' });
    const all = await store.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].message).toBe('hello');
  });

  it('reads tail records', async () => {
    const store = new JSONLStore(path.join(memoryRoot, 'tail.jsonl'));
    await store.init();
    for (let i = 0; i < 10; i++) await store.append({ idx: i });
    const tail = await store.readTail(3);
    expect(tail).toHaveLength(3);
    expect(tail[0].idx).toBe(7);
  });

  it('counts lines', async () => {
    const store = new JSONLStore(path.join(memoryRoot, 'count.jsonl'));
    await store.init();
    await store.append({ a: 1 });
    await store.append({ a: 2 });
    expect(await store.count()).toBe(2);
  });

  it('handles empty store gracefully', async () => {
    const store = new JSONLStore(path.join(memoryRoot, 'empty.jsonl'));
    expect(await store.readAll()).toEqual([]);
  });

  it('batch appends', async () => {
    const store = new JSONLStore(path.join(memoryRoot, 'batch.jsonl'));
    await store.init();
    await store.appendBatch([{ x: 1 }, { x: 2 }, { x: 3 }]);
    expect(await store.count()).toBe(3);
  });
});

// ── Memory Store ──

describe('MemoryStore', () => {
  it('creates store with correct paths', () => {
    const store = createMemoryStore(tmpDir);
    const sep = path.sep;
    expect(store.paths.root).toContain(['.agent', 'memory'].join(sep));
    expect(store.paths.sensory).toContain('sensory');
    expect(store.paths.working).toContain('working');
    expect(store.paths.episodic).toContain('episodic');
    expect(store.paths.semantic).toContain('semantic');
    expect(store.paths.archive).toContain('archive');
    expect(store.paths.sqlite).toContain('index.sqlite');
  });

  it('getMemoryStore returns singleton', () => {
    const a = getMemoryStore(tmpDir);
    const b = getMemoryStore(tmpDir);
    expect(a).toBe(b);
    resetMemoryStore();
  });

  it('creates sensory and episodic log instances', () => {
    const store = createMemoryStore(tmpDir);
    expect(store.createSensoryLog('session-abc')).toBeTruthy();
    expect(store.createEpisodicLog('2026-05')).toBeTruthy();
  });

  it('keeps Memory Kernel usable when SQLite indexing is unavailable', async () => {
    resetMemoryStore();
    const prev = process.env.ICLOSER_DISABLE_SQLITE_INDEX;
    process.env.ICLOSER_DISABLE_SQLITE_INDEX = '1';
    const root = path.join(tmpDir, 'no-sqlite');

    try {
      const store = await ensureMemoryStore(root);
      expect(store.sqlite.isOpen).toBe(false);
      expect(store.sqlite.unavailableReason).toContain('SQLite index disabled');

      const runtime = new MemoryRuntime(store);
      await runtime.init();
      await runtime.onTaskStart('task-no-sqlite', '验证 Node 18/20 记忆降级');
      await runtime.onTaskComplete('task-no-sqlite', { verifyPassed: true, summary: '降级可用' });
      expect(runtime.episodic.recent(1).some(ep => ep.taskId === 'task-no-sqlite')).toBe(true);
      expect(runtime.getStatus().episodic.totalEvents).toBeGreaterThan(0);
      await runtime.shutdown();

      const ym = new Date().toISOString().slice(0, 7);
      const logPath = path.join(root, '.agent', 'memory', 'long-term', 'episodic', `${ym}.jsonl`);
      expect(existsSync(logPath)).toBe(true);
      expect(readFileSync(logPath, 'utf-8')).toContain('task-no-sqlite');
    } finally {
      if (prev === undefined) {
        delete process.env.ICLOSER_DISABLE_SQLITE_INDEX;
      } else {
        process.env.ICLOSER_DISABLE_SQLITE_INDEX = prev;
      }
      resetMemoryStore();
    }
  });
});
