// Sensory Buffer — PRD §4.1: FIFO memory buffer for transient I/O signals
// Short-lived (5-60s), low-value filtering, high-value marking
// Drains to JSONL log via MemoryStore
import type { JSONLStore } from './jsonl-store.js';

export type SensorySource =
  | 'cli_input' | 'shell_stdout' | 'shell_stderr' | 'git_diff'
  | 'compile_log' | 'test_result' | 'file_change' | 'security_log'
  | 'system_event';

export interface SensoryRecord {
  id: string;
  source: SensorySource;
  content: string;
  byteLength: number;
  isError: boolean;
  isDuplicate: boolean;
  importance: 'low' | 'medium' | 'high';
  ingestedAt: string;
}

const HIGH_IMPORTANCE_KEYWORDS = [
  'error', 'Error', 'ERROR', 'fail', 'FAIL', 'crash', 'panic',
  'fatal', 'FATAL', 'denied', 'DENIED', 'refuse', 'REFUSE',
  '严重', '崩溃', '致命', '拒绝', '失败', '紧急',
];

const LOW_VALUE_PATTERNS = [
  /^\s*$/,
  /^info\s/i,
  /^debug\s/i,
  /^\[INFO\]/i,
  /^\[DEBUG\]/i,
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+INFO/i,
  /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+DEBUG/i,
  /^Using /,
  /^Done in /,
];

export interface SensoryBufferOptions {
  maxSize: number;        // max records in buffer (default 200)
  lowValueTTLms: number;  // TTL for low-value records (default 5000)
  mediumTTLms: number;    // TTL for medium records (default 30000)
  highTTLms: number;      // TTL for high-value records (default 60000)
}

const DEFAULT_OPTIONS: SensoryBufferOptions = {
  maxSize: 200,
  lowValueTTLms: 5000,
  mediumTTLms: 30000,
  highTTLms: 60000,
};

let seq = 0;

export class SensoryBuffer {
  private records: SensoryRecord[] = [];
  private seenHashes = new Set<string>();
  private options: SensoryBufferOptions;
  private jsonlLog: JSONLStore | null = null;

  constructor(options: Partial<SensoryBufferOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Attach a JSONL log for persistence (created by MemoryStore) */
  attachLog(log: JSONLStore): void {
    this.jsonlLog = log;
  }

  /** Ingest a raw I/O signal */
  ingest(source: SensorySource, content: string): SensoryRecord {
    this.expireStale();

    const hash = simpleHash(source + ':' + content);
    const isDuplicate = this.seenHashes.has(hash);
    this.seenHashes.add(hash);

    const isError = this.classifyError(source, content);
    const importance = isError ? 'high' : this.classifyImportance(source, content);

    const record: SensoryRecord = {
      id: `sensory-${Date.now().toString(36)}-${(seq++).toString(36)}`,
      source,
      content: content.length > 4000 ? content.slice(0, 4000) + '...(truncated)' : content,
      byteLength: Buffer.byteLength(content, 'utf-8'),
      isError,
      isDuplicate,
      importance,
      ingestedAt: new Date().toISOString(),
    };

    // Filter out pure noise
    if (this.isNoise(content)) {
      return record; // Don't store, but return for caller awareness
    }

    this.records.push(record);

    // Trim overflow
    while (this.records.length > this.options.maxSize) {
      const removed = this.records.shift()!;
      this.seenHashes.delete(simpleHash(removed.source + ':' + removed.content));
    }

    // Persist to JSONL if log attached
    this.jsonlLog?.append(record as unknown as Record<string, unknown>).catch(() => {});

    return record;
  }

  /** Read all current buffer records (without clearing) */
  peek(): ReadonlyArray<SensoryRecord> {
    this.expireStale();
    return this.records;
  }

  /** Read and clear all records */
  drain(): SensoryRecord[] {
    this.expireStale();
    const all = [...this.records];
    this.records.length = 0;
    this.seenHashes.clear();
    return all;
  }

  /** Get only high-importance records */
  drainImportant(): SensoryRecord[] {
    this.expireStale();
    const important = this.records.filter(r => r.importance === 'high');
    this.records = this.records.filter(r => r.importance !== 'high');
    return important;
  }

  /** Get records by source type */
  getBySource(source: SensorySource): SensoryRecord[] {
    this.expireStale();
    return this.records.filter(r => r.source === source);
  }

  /** Get error records */
  getErrors(): SensoryRecord[] {
    return this.records.filter(r => r.isError);
  }

  /** Summarize buffer state (for UI display) */
  summary(): { total: number; bySource: Record<string, number>; errors: number; duplicates: number } {
    this.expireStale();
    const bySource: Record<string, number> = {};
    let errors = 0;
    let duplicates = 0;
    for (const r of this.records) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      if (r.isError) errors++;
      if (r.isDuplicate) duplicates++;
    }
    return { total: this.records.length, bySource, errors, duplicates };
  }

  /** Flush all records to attached JSONL log and clear */
  async flush(): Promise<void> {
    if (this.jsonlLog) {
      const all = this.drain();
      for (const r of all) {
        await this.jsonlLog.append(r as unknown as Record<string, unknown>);
      }
    }
  }

  /** Clear everything without flushing */
  clear(): void {
    this.records.length = 0;
    this.seenHashes.clear();
  }

  // ── Private helpers ──

  private expireStale(): void {
    const now = Date.now();
    this.records = this.records.filter(r => {
      const age = now - new Date(r.ingestedAt).getTime();
      switch (r.importance) {
        case 'high': return age < this.options.highTTLms;
        case 'medium': return age < this.options.mediumTTLms;
        default: return age < this.options.lowValueTTLms;
      }
    });
  }

  private classifyError(source: SensorySource, content: string): boolean {
    if (source === 'shell_stderr') return true;
    if (source === 'security_log') return true;
    for (const kw of HIGH_IMPORTANCE_KEYWORDS) {
      if (content.includes(kw)) return true;
    }
    return false;
  }

  private classifyImportance(source: SensorySource, content: string): 'low' | 'medium' | 'high' {
    // Git diffs > 50 lines are important
    if (source === 'git_diff' && content.split('\n').length > 50) return 'high';
    // Test failures are high
    if (source === 'test_result' && /fail|FAIL|error|Error/.test(content)) return 'high';
    // Compile errors
    if (source === 'compile_log' && /error|Error/.test(content)) return 'high';
    // User CLI input is medium by default
    if (source === 'cli_input') return 'medium';
    return 'low';
  }

  private isNoise(content: string): boolean {
    if (!content.trim()) return true;
    // Filter pure progress/debug lines
    for (const pattern of LOW_VALUE_PATTERNS) {
      if (pattern.test(content) && content.length < 120) return true;
    }
    // Repeated single characters (ANSI leftovers)
    if (/^[\x00-\x1F\x7F]+$/.test(content)) return true;
    return false;
  }
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}
