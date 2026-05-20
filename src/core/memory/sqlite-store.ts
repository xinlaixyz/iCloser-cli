// SQLite Store — structured index for episodic & semantic long-term memory
// Uses Node 24+ built-in node:sqlite (DatabaseSync) when available.
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);

export interface SQLEntry {
  id?: number;
  type: string;
  key: string;
  data: string;       // JSON-serialized payload
  tags: string;       // comma-separated
  importance: number; // 0-1
  created_at: string;
  updated_at: string;
}

type Row = Record<string, unknown>;
type SQLiteRunResult = { lastInsertRowid: bigint | number; changes: number };
type SQLiteStatement = {
  run: (...params: unknown[]) => SQLiteRunResult;
  get: (...params: unknown[]) => Row | undefined;
  all: (...params: unknown[]) => Row[];
};
type SQLiteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SQLiteStatement;
  close: () => void;
};
type SQLiteModule = {
  DatabaseSync: new (dbPath: string) => SQLiteDatabase;
};

function toEntry(row: Row): SQLEntry {
  return {
    id: row.id as number,
    type: row.type as string,
    key: row.key as string,
    data: row.data as string,
    tags: row.tags as string,
    importance: row.importance as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export class SQLiteStore {
  private db: SQLiteDatabase | null = null;
  private disabledReason: string | null = null;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  open(): void {
    if (this.db) return;
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const sqliteModule = loadSQLiteModule();
    if (!sqliteModule) {
      this.disabledReason = process.env.ICLOSER_DISABLE_SQLITE_INDEX === '1'
        ? 'SQLite index disabled by ICLOSER_DISABLE_SQLITE_INDEX=1.'
        : `node:sqlite is not available on ${process.version}; using JSONL/rules.json memory storage without SQLite indexing.`;
      return;
    }
    const { DatabaseSync } = sqliteModule;
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.initSchema();
  }

  close(): void {
    if (this.db) { this.db.close(); this.db = null; }
  }

  get isOpen(): boolean { return this.db !== null; }
  get isAvailable(): boolean { return this.db !== null || this.disabledReason === null; }
  get unavailableReason(): string | null { return this.disabledReason; }

  private initSchema(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS episodic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        key TEXT UNIQUE NOT NULL,
        data TEXT NOT NULL,
        tags TEXT DEFAULT '',
        importance REAL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic(type);
      CREATE INDEX IF NOT EXISTS idx_episodic_created ON episodic(created_at);
      CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_episodic_tags ON episodic(tags);

      CREATE TABLE IF NOT EXISTS semantic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'rule',
        key TEXT UNIQUE NOT NULL,
        data TEXT NOT NULL,
        tags TEXT DEFAULT '',
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_key ON semantic(key);
      CREATE INDEX IF NOT EXISTS idx_semantic_tags ON semantic(tags);
      CREATE INDEX IF NOT EXISTS idx_semantic_importance ON semantic(importance DESC);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ── Generic CRUD ──

  insert(table: 'episodic' | 'semantic', entry: Omit<SQLEntry, 'id'>): number {
    if (!this.db) return 0;
    const stmt = this.db!.prepare(
      `INSERT OR REPLACE INTO ${table} (type, key, data, tags, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      entry.type, entry.key, entry.data, entry.tags,
      entry.importance, entry.created_at, entry.updated_at
    );
    return Number(result.lastInsertRowid);
  }

  insertBatch(table: 'episodic' | 'semantic', entries: Omit<SQLEntry, 'id'>[]): void {
    if (!this.db) return;
    const stmt = this.db!.prepare(
      `INSERT OR REPLACE INTO ${table} (type, key, data, tags, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of entries) {
      stmt.run(e.type, e.key, e.data, e.tags, e.importance, e.created_at, e.updated_at);
    }
  }

  getByKey(table: 'episodic' | 'semantic', key: string): SQLEntry | null {
    if (!this.db) return null;
    const row = this.db!.prepare(`SELECT * FROM ${table} WHERE key = ?`).get(key) as Row | undefined;
    return row ? toEntry(row) : null;
  }

  query(
    table: 'episodic' | 'semantic',
    options: {
      type?: string;
      tags?: string[];
      minImportance?: number;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
      orderBy?: string;
    } = {}
  ): SQLEntry[] {
    if (!this.db) return [];
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.type) { conditions.push('type = ?'); params.push(options.type); }
    if (options.minImportance !== undefined) { conditions.push('importance >= ?'); params.push(options.minImportance); }
    if (options.since) { conditions.push('created_at >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('created_at <= ?'); params.push(options.until); }
    if (options.tags && options.tags.length > 0) {
      const tagConds = options.tags.map(() => "tags LIKE '%' || ? || '%'");
      conditions.push(`(${tagConds.join(' OR ')})`);
      params.push(...options.tags);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = options.orderBy || 'created_at DESC';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const sql = `SELECT * FROM ${table} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const rows = this.db!.prepare(sql).all(...params, limit, offset) as Row[];
    return rows.map(toEntry);
  }

  searchByText(table: 'episodic' | 'semantic', searchText: string, limit = 20): SQLEntry[] {
    if (!this.db) return [];
    const pattern = `%${searchText}%`;
    const rows = this.db!.prepare(
      `SELECT * FROM ${table} WHERE data LIKE ? OR tags LIKE ? OR key LIKE ? ORDER BY importance DESC LIMIT ?`
    ).all(pattern, pattern, pattern, limit) as Row[];
    return rows.map(toEntry);
  }

  count(table: 'episodic' | 'semantic', options: { type?: string; since?: string } = {}): number {
    if (!this.db) return 0;
    const conditions: string[] = [];
    const params: string[] = [];
    if (options.type) { conditions.push('type = ?'); params.push(options.type); }
    if (options.since) { conditions.push('created_at >= ?'); params.push(options.since); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db!.prepare(`SELECT COUNT(*) as cnt FROM ${table} ${where}`).get(...params) as Row | undefined;
    return (row?.cnt as number) || 0;
  }

  deleteByKey(table: 'episodic' | 'semantic', key: string): boolean {
    if (!this.db) return false;
    const result = this.db!.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
    return result.changes > 0;
  }

  deleteOlderThan(table: 'episodic' | 'semantic', date: string): number {
    if (!this.db) return 0;
    const result = this.db!.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(date);
    return Number(result.changes);
  }

  // ── Metadata ──

  setMeta(key: string, value: string): void {
    if (!this.db) return;
    this.db!.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, value);
  }

  getMeta(key: string): string | null {
    if (!this.db) return null;
    const row = this.db!.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as Row | undefined;
    return (row?.value as string) || null;
  }

  // ── Maintenance ──

  vacuum(): void {
    if (!this.db) return;
    this.db!.exec('PRAGMA optimize');
  }

  getStats(): { episodicCount: number; semanticCount: number; dbSize: string } {
    if (!this.db) return { episodicCount: 0, semanticCount: 0, dbSize: 'disabled' };
    const ep = this.count('episodic');
    const sem = this.count('semantic');
    let size = '0 KB';
    try { size = `${(statSync(this.dbPath).size / 1024).toFixed(1)} KB`; } catch { /* ignore */ }
    return { episodicCount: ep, semanticCount: sem, dbSize: size };
  }
}

function loadSQLiteModule(): SQLiteModule | null {
  if (process.env.ICLOSER_DISABLE_SQLITE_INDEX === '1') return null;
  try {
    return require('node:sqlite') as SQLiteModule;
  } catch {
    return null;
  }
}
