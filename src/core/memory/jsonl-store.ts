// JSONL Store — append-only JSON Lines storage for sensory buffer & episodic logs
import { appendFile, readFile } from 'fs/promises';
import { ensureDir, fileExists } from '../../utils/fs.js';
import * as path from 'path';

export interface JSONLOptions {
  maxLines?: number;    // auto-rotate when exceeded (default 10000)
  flushIntervalMs?: number; // auto-flush batch interval (default 0 = immediate)
}

const DEFAULT_MAX_LINES = 10_000;

export class JSONLStore {
  readonly filePath: string;
  private maxLines: number;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;

  constructor(filePath: string, options: JSONLOptions = {}) {
    this.filePath = filePath;
    this.maxLines = options.maxLines || DEFAULT_MAX_LINES;
    this.flushIntervalMs = options.flushIntervalMs || 0;
  }

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.filePath));
  }

  /** Append a single JSON-serializable record */
  async append(record: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify(record);
    this.buffer.push(line);

    if (this.flushIntervalMs > 0) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
      }
      if (this.buffer.length >= 100) await this.flush();
    } else {
      await this.flush();
    }
  }

  /** Append multiple records in batch */
  async appendBatch(records: Record<string, unknown>[]): Promise<void> {
    for (const r of records) this.buffer.push(JSON.stringify(r));
    await this.flush();
  }

  /** Force flush buffer to disk */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }

    const chunk = this.buffer.join('\n') + '\n';
    this.buffer.length = 0;

    await ensureDir(path.dirname(this.filePath));
    await appendFile(this.filePath, chunk, 'utf-8');

    // Auto-rotate if exceeding maxLines
    this.rotateIfNeeded().catch(() => {});
  }

  /** Read all lines as parsed objects */
  async readAll(): Promise<Record<string, unknown>[]> {
    if (!(await fileExists(this.filePath))) return [];
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
        .filter((r): r is Record<string, unknown> => r !== null);
    } catch { return []; }
  }

  /** Read last N records */
  async readTail(n: number): Promise<Record<string, unknown>[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  /** Get line count without parsing all records */
  async count(): Promise<number> {
    if (!(await fileExists(this.filePath))) return 0;
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return content.split('\n').filter(line => line.trim()).length;
    } catch { return 0; }
  }

  /** Clear all records */
  async clear(): Promise<void> {
    this.buffer.length = 0;
    await ensureDir(path.dirname(this.filePath));
    await appendFile(this.filePath, '', 'utf-8'); // truncate via append hack
    const { writeFile } = await import('fs/promises');
    await writeFile(this.filePath, '', 'utf-8');
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const lineCount = await this.count();
      if (lineCount < this.maxLines) return;

      const dir = path.dirname(this.filePath);
      const ext = path.extname(this.filePath);
      const base = path.basename(this.filePath, ext);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rotated = path.join(dir, `${base}-${ts}${ext}`);

      const { rename, writeFile: wf } = await import('fs/promises');
      await rename(this.filePath, rotated);
      await wf(this.filePath, '', 'utf-8');
    } catch { /* best-effort rotation */ }
  }
}
