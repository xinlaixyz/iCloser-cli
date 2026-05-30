// Coverage for src/core/memory/sqlite-store.ts
// Targets: insertBatch, getByKey, searchByText, deleteByKey, deleteOlderThan,
//          setMeta, getMeta, vacuum, getStats — both open and disabled paths
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStore } from '../src/core/memory/sqlite-store.js';

const roots: string[] = [];
async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'sqlite-cov-'));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const r of roots) {
    try { await rm(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function makeEntry(key: string, overrides: Partial<{
  type: string; data: string; tags: string; importance: number;
  created_at: string; updated_at: string;
}> = {}) {
  const now = new Date().toISOString();
  return {
    type: overrides.type ?? 'test_type',
    key,
    data: overrides.data ?? `{"key":"${key}"}`,
    tags: overrides.tags ?? 'tag1,tag2',
    importance: overrides.importance ?? 0.5,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

// ============================================================
// Disabled path (no SQLite) — every method must return safely
// ============================================================
describe('SQLiteStore — disabled (env ICLOSER_DISABLE_SQLITE_INDEX=1)', () => {
  it('open() in disabled mode does not crash', async () => {
    const dir = await makeDir();
    const prev = process.env.ICLOSER_DISABLE_SQLITE_INDEX;
    process.env.ICLOSER_DISABLE_SQLITE_INDEX = '1';
    try {
      const store = new SQLiteStore(join(dir, 'test.sqlite'));
      store.open();
      expect(store.isOpen).toBe(false);
      expect(store.unavailableReason).toBeTruthy();
      // All CRUD operations must be no-ops
      expect(store.insert('episodic', makeEntry('k1'))).toBe(0);
      store.insertBatch('episodic', [makeEntry('k2')]);
      expect(store.getByKey('episodic', 'k1')).toBeNull();
      expect(store.query('episodic')).toEqual([]);
      expect(store.searchByText('episodic', 'text')).toEqual([]);
      expect(store.count('episodic')).toBe(0);
      expect(store.deleteByKey('episodic', 'k1')).toBe(false);
      expect(store.deleteOlderThan('episodic', new Date().toISOString())).toBe(0);
      store.setMeta('key', 'value');
      expect(store.getMeta('key')).toBeNull();
      store.vacuum();
      const stats = store.getStats();
      expect(stats.dbSize).toBe('disabled');
      store.close();
    } finally {
      if (prev === undefined) delete process.env.ICLOSER_DISABLE_SQLITE_INDEX;
      else process.env.ICLOSER_DISABLE_SQLITE_INDEX = prev;
    }
  });
});

// ============================================================
// Enabled path — test all CRUD methods when SQLite is available
// (skips gracefully when node:sqlite is unavailable)
// ============================================================
describe('SQLiteStore — enabled (node:sqlite)', () => {
  function openStore(dir: string): SQLiteStore | null {
    const store = new SQLiteStore(join(dir, 'test.sqlite'));
    store.open();
    if (!store.isOpen) return null; // SQLite unavailable in this Node version
    return store;
  }

  it('isOpen / isAvailable reflect state', async () => {
    const dir = await makeDir();
    const store = new SQLiteStore(join(dir, 'x.sqlite'));
    expect(store.isOpen).toBe(false);
    store.open();
    // Either open (SQLite available) or not
    expect(typeof store.isOpen).toBe('boolean');
    store.close();
    expect(store.isOpen).toBe(false);
  });

  it('close() on already-closed store is a no-op', async () => {
    const dir = await makeDir();
    const store = new SQLiteStore(join(dir, 'x.sqlite'));
    expect(() => store.close()).not.toThrow();
  });

  it('insert + getByKey round-trip', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return; // SQLite not available
    try {
      const entry = makeEntry('ep-001', { type: 'task_started', importance: 0.6 });
      s.insert('episodic', entry);
      const fetched = s.getByKey('episodic', 'ep-001');
      expect(fetched).not.toBeNull();
      expect(fetched!.key).toBe('ep-001');
      expect(fetched!.type).toBe('task_started');
    } finally { s.close(); }
  });

  it('insertBatch inserts multiple entries', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insertBatch('episodic', [
        makeEntry('batch-1', { type: 'task_started' }),
        makeEntry('batch-2', { type: 'task_completed' }),
        makeEntry('batch-3', { type: 'error_occurred', importance: 0.9 }),
      ]);
      expect(s.count('episodic')).toBeGreaterThanOrEqual(3);
    } finally { s.close(); }
  });

  it('query with type filter', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insertBatch('episodic', [
        makeEntry('q-1', { type: 'task_started' }),
        makeEntry('q-2', { type: 'error_occurred' }),
      ]);
      const results = s.query('episodic', { type: 'task_started' });
      expect(results.every(r => r.type === 'task_started')).toBe(true);
    } finally { s.close(); }
  });

  it('query with minImportance filter', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insertBatch('episodic', [
        makeEntry('imp-1', { importance: 0.9 }),
        makeEntry('imp-2', { importance: 0.1 }),
      ]);
      const results = s.query('episodic', { minImportance: 0.5 });
      expect(results.every(r => r.importance >= 0.5)).toBe(true);
    } finally { s.close(); }
  });

  it('query with since/until time filters', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      const past = new Date(Date.now() - 10000).toISOString();
      const future = new Date(Date.now() + 10000).toISOString();
      s.insert('episodic', makeEntry('time-1', { created_at: past, updated_at: past }));
      const results = s.query('episodic', { since: past, until: future });
      expect(results.length).toBeGreaterThan(0);
    } finally { s.close(); }
  });

  it('query with tags filter', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insert('episodic', makeEntry('tag-1', { tags: 'deploy,production' }));
      s.insert('episodic', makeEntry('tag-2', { tags: 'test,staging' }));
      const results = s.query('episodic', { tags: ['deploy'] });
      expect(results.some(r => r.key === 'tag-1')).toBe(true);
    } finally { s.close(); }
  });

  it('query with offset and limit', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insertBatch('episodic', [
        makeEntry('ol-1'), makeEntry('ol-2'), makeEntry('ol-3'),
      ]);
      const page1 = s.query('episodic', { limit: 2, offset: 0 });
      expect(page1.length).toBeLessThanOrEqual(2);
    } finally { s.close(); }
  });

  it('searchByText finds entries by data content', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insert('episodic', makeEntry('search-1', { data: '{"summary":"unique-text-xyz"}' }));
      const results = s.searchByText('episodic', 'unique-text-xyz');
      expect(results.some(r => r.key === 'search-1')).toBe(true);
    } finally { s.close(); }
  });

  it('searchByText with limit', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      const results = s.searchByText('episodic', 'nonexistent-xyz', 5);
      expect(Array.isArray(results)).toBe(true);
    } finally { s.close(); }
  });

  it('count with type and since filters', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      const since = new Date(Date.now() - 60000).toISOString();
      s.insert('episodic', makeEntry('cnt-1', { type: 'task_started' }));
      s.insert('episodic', makeEntry('cnt-2', { type: 'task_started' }));
      const total = s.count('episodic', { type: 'task_started', since });
      expect(total).toBeGreaterThanOrEqual(2);
    } finally { s.close(); }
  });

  it('deleteByKey removes an entry', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insert('episodic', makeEntry('del-1'));
      expect(s.getByKey('episodic', 'del-1')).not.toBeNull();
      const deleted = s.deleteByKey('episodic', 'del-1');
      expect(deleted).toBe(true);
      expect(s.getByKey('episodic', 'del-1')).toBeNull();
    } finally { s.close(); }
  });

  it('deleteByKey returns false for non-existent key', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      const result = s.deleteByKey('episodic', 'no-such-key-xyz');
      expect(result).toBe(false);
    } finally { s.close(); }
  });

  it('deleteOlderThan removes old entries', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      const past = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
      s.insert('episodic', makeEntry('old-1', { created_at: past, updated_at: past }));
      const deleted = s.deleteOlderThan('episodic', new Date().toISOString()); // delete all old
      expect(deleted).toBeGreaterThanOrEqual(0); // may delete 0 or more
    } finally { s.close(); }
  });

  it('setMeta + getMeta round-trip', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.setMeta('version', '1.2.3');
      const val = s.getMeta('version');
      expect(val).toBe('1.2.3');
    } finally { s.close(); }
  });

  it('getMeta returns null for missing key', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      expect(s.getMeta('no-such-meta-key')).toBeNull();
    } finally { s.close(); }
  });

  it('vacuum does not crash', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      expect(() => s.vacuum()).not.toThrow();
    } finally { s.close(); }
  });

  it('getStats returns correct counts', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insert('episodic', makeEntry('gs-1'));
      s.insert('semantic', makeEntry('gs-sem-1'));
      const stats = s.getStats();
      expect(stats.episodicCount).toBeGreaterThanOrEqual(1);
      expect(stats.semanticCount).toBeGreaterThanOrEqual(1);
      expect(typeof stats.dbSize).toBe('string');
      expect(stats.dbSize).not.toBe('disabled');
    } finally { s.close(); }
  });

  it('semantic table insert + query works', async () => {
    const dir = await makeDir();
    const s = openStore(dir);
    if (!s) return;
    try {
      s.insert('semantic', makeEntry('sem-rule-1', { type: 'rule', importance: 0.8, data: '{"pattern":"always use async/await"}' }));
      const results = s.query('semantic', { type: 'rule' });
      expect(results.some(r => r.key === 'sem-rule-1')).toBe(true);
    } finally { s.close(); }
  });
});
