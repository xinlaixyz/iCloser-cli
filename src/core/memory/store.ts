// Memory Store Factory — creates and manages the .agent/memory directory structure
// Provides unified access to SQLite index + JSONL logs + Markdown semantic tree
import * as path from 'path';
import { ensureDir } from '../../utils/fs.js';
import { SQLiteStore } from './sqlite-store.js';
import { JSONLStore } from './jsonl-store.js';

// ============================================================
// Directory layout (PRD §7):
//   .agent/memory/
//     sensory/       — FIFO buffer JSONL logs
//     working/       — working memory snapshots
//     long-term/
//       episodic/    — episodic event JSONL (by month)
//       semantic/    — semantic rules (rules.json + tree.md)
//       index.sqlite — structured index
//     archive/       — archived/expired memories
//     policies/      — consolidation & forgetting logs
// ============================================================

export interface MemoryStorePaths {
  root: string;
  sensory: string;
  working: string;
  episodic: string;
  semantic: string;
  archive: string;
  policies: string;
  sqlite: string;
}

export interface MemoryStore {
  paths: MemoryStorePaths;
  sqlite: SQLiteStore;
  /** Create a JSONL store for sensory data (session-scoped) */
  createSensoryLog(sessionId: string): JSONLStore;
  /** Create a JSONL store for episodic events (month-scoped) */
  createEpisodicLog(yearMonth?: string): JSONLStore;
  /** Get the semantic rules JSON file path */
  semanticRulesPath: string;
  /** Get the semantic tree markdown file path */
  semanticTreePath: string;
  /** Archive an old memory file */
  archiveFile(sourcePath: string, label?: string): Promise<string>;
  /** Decommission: close SQLite and flush buffers */
  close(): void;
}

let _store: MemoryStore | null = null;

/** Get or create the memory store for a project root */
export function getMemoryStore(rootPath: string): MemoryStore {
  if (_store) return _store;
  _store = createMemoryStore(rootPath);
  return _store;
}

/** Reset the singleton (for testing) */
export function resetMemoryStore(): void {
  if (_store) { _store.close(); _store = null; }
}

/** @internal — exported for testing. Prefer getMemoryStore() for production use. */
export function createMemoryStore(rootPath: string): MemoryStore {
  const memoryRoot = path.join(rootPath, '.agent', 'memory');
  const paths: MemoryStorePaths = {
    root: memoryRoot,
    sensory: path.join(memoryRoot, 'sensory'),
    working: path.join(memoryRoot, 'working'),
    episodic: path.join(memoryRoot, 'long-term', 'episodic'),
    semantic: path.join(memoryRoot, 'long-term', 'semantic'),
    archive: path.join(memoryRoot, 'archive'),
    policies: path.join(memoryRoot, 'policies'),
    sqlite: path.join(memoryRoot, 'long-term', 'index.sqlite'),
  };

  // Lazy-loaded SQLite — only initialized when accessed, not at store creation time.
  // SQLiteStore itself loads node:sqlite at open time, so Node 18/20 can still
  // import the Memory Kernel and degrade before touching SQLite.
  let _sqlite: SQLiteStore | null = null;
  let _sqliteError: Error | null = null; // Cache first error to avoid repeated throws

  const store: MemoryStore = {
    paths,
    get sqlite(): SQLiteStore {
      if (_sqliteError) throw _sqliteError; // Re-throw cached error
      if (!_sqlite) {
        try {
          _sqlite = new SQLiteStore(paths.sqlite);
        } catch (err) {
          _sqliteError = err instanceof Error ? err : new Error(String(err));
          throw _sqliteError;
        }
      }
      return _sqlite;
    },
    semanticRulesPath: path.join(paths.semantic, 'rules.json'),
    semanticTreePath: path.join(paths.semantic, 'tree.md'),

    createSensoryLog(sessionId: string): JSONLStore {
      const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      return new JSONLStore(path.join(paths.sensory, `${safeId}.jsonl`), { maxLines: 5000 });
    },

    createEpisodicLog(yearMonth?: string): JSONLStore {
      const now = new Date();
      const ym = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return new JSONLStore(path.join(paths.episodic, `${ym}.jsonl`), { maxLines: 20000 });
    },

    async archiveFile(sourcePath: string, label?: string): Promise<string> {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = path.basename(sourcePath);
      const archiveName = label
        ? `${ts}-${label}-${baseName}`
        : `${ts}-${baseName}`;
      const dest = path.join(paths.archive, archiveName);

      await ensureDir(paths.archive);
      const { copyFile, unlink } = await import('fs/promises');
      await copyFile(sourcePath, dest);
      try { await unlink(sourcePath); } catch { /* source may already be gone */ }
      return dest;
    },

    close(): void {
      if (_sqlite) { _sqlite.close(); _sqlite = null; }
    },
  };

  return store;
}

/** Initialize the memory directory structure and open SQLite */
export async function initMemoryStore(rootPath: string): Promise<MemoryStore> {
  const store = getMemoryStore(rootPath);

  // Create all directories
  const dirs = [
    store.paths.root,
    store.paths.sensory,
    store.paths.working,
    store.paths.episodic,
    store.paths.semantic,
    store.paths.archive,
    store.paths.policies,
  ];
  for (const dir of dirs) {
    await ensureDir(dir);
  }

  // Open SQLite
  if (!store.sqlite.isOpen) {
    store.sqlite.open();
  }

  // Store version marker
  store.sqlite.setMeta('memory_kernel_version', '1.0');
  store.sqlite.setMeta('initialized_at', new Date().toISOString());

  return store;
}

/** Ensure the memory store is initialized (idempotent — safe to call repeatedly) */
export async function ensureMemoryStore(rootPath: string): Promise<MemoryStore> {
  const store = getMemoryStore(rootPath);
  if (!store.sqlite.isOpen) {
    await initMemoryStore(rootPath);
  }
  return store;
}
