// Episodic Memory — PRD §4.3.1: time-based event journal
// JSONL monthly logs + SQLite index via MemoryStore
import type { MemoryStore } from './store.js';
import type { JSONLStore } from './jsonl-store.js';
import { existsSync, readdirSync, readFileSync } from 'fs';

export type EpisodeType =
  | 'task_started' | 'task_completed' | 'task_failed'
  | 'file_changed' | 'file_created' | 'file_deleted'
  | 'error_occurred' | 'error_resolved'
  | 'deploy_triggered' | 'rollback_executed'
  | 'user_feedback' | 'user_correction'
  | 'rule_extracted' | 'memory_consolidated'
  | 'system_event';

export interface Episode {
  id: string;
  type: EpisodeType;
  taskId?: string;
  sessionId?: string;
  summary: string;          // 1-2 sentence summary
  details: string;          // full context (capped at 2k chars)
  importance: number;       // 0-1
  tags: string[];           // searchable keywords
  changedFiles?: string[];
  relatedEpisodeIds: string[];
  timestamp: string;        // ISO 8601
}

export interface TimelineQuery {
  from?: string;            // ISO timestamp
  until?: string;           // ISO timestamp
  types?: EpisodeType[];
  taskId?: string;
  tags?: string[];
  minImportance?: number;
  limit?: number;
  offset?: number;
  orderBy?: string;          // SQL ORDER BY clause (default: created_at DESC)
}

let seqCounter = 0;

export class EpisodicMemory {
  private store: MemoryStore;
  private currentLog: JSONLStore;
  private currentMonth: string;

  constructor(store: MemoryStore) {
    this.store = store;
    const now = new Date();
    this.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.currentLog = store.createEpisodicLog(this.currentMonth);
  }

  /** Record a new episode */
  async record(episode: Omit<Episode, 'id'>): Promise<Episode> {
    const id = `ep-${Date.now().toString(36)}-${(seqCounter++).toString(36)}`;
    const full: Episode = { ...episode, id };
    const now = new Date().toISOString();

    // Ensure we're writing to the correct monthly log
    const month = now.slice(0, 7);
    if (month !== this.currentMonth) {
      this.currentMonth = month;
      this.currentLog = this.store.createEpisodicLog(month);
    }

    // Write to JSONL log
    await this.currentLog.append(full as unknown as Record<string, unknown>);

    // Index in SQLite
    if (this.store.sqlite.isOpen) {
      try {
        this.store.sqlite.insert('episodic', {
          type: full.type,
          key: full.id,
          data: JSON.stringify(full),
          tags: full.tags.join(','),
          importance: full.importance,
          created_at: full.timestamp,
          updated_at: now,
        });
      } catch { /* best-effort indexing */ }
    }

    return full;
  }

  /** Record a batch of episodes */
  async recordBatch(episodes: Omit<Episode, 'id'>[]): Promise<Episode[]> {
    const results: Episode[] = [];
    for (const ep of episodes) {
      results.push(await this.record(ep));
    }
    return results;
  }

  /** Time-based query from SQLite index (fast) */
  query(options: TimelineQuery = {}): Episode[] {
    if (!this.store.sqlite.isOpen) return this.queryJsonl(options);

    const rows = this.store.sqlite.query('episodic', {
      type: options.types ? options.types[0] : undefined, // SQLite query handles one type
      tags: options.tags,
      minImportance: options.minImportance,
      since: options.from,
      until: options.until,
      limit: options.limit || 50,
      offset: options.offset,
      orderBy: options.orderBy || 'created_at DESC',
    });

    // Filter by taskId and multiple types in-memory
    let episodes = rows.map(r => JSON.parse(r.data) as Episode);

    if (options.types && options.types.length > 1) {
      episodes = episodes.filter(e => options.types!.includes(e.type));
    }
    if (options.taskId) {
      episodes = episodes.filter(e => e.taskId === options.taskId);
    }

    return episodes;
  }

  /** Get all episodes for a specific task */
  getTaskEpisodes(taskId: string): Episode[] {
    return this.query({ taskId, limit: 200 });
  }

  /** Search by text in data field */
  search(text: string, limit = 20): Episode[] {
    if (!this.store.sqlite.isOpen) {
      const q = text.toLowerCase();
      return this.queryJsonl({ limit: 10000 })
        .filter(ep =>
          ep.summary.toLowerCase().includes(q) ||
          ep.details.toLowerCase().includes(q) ||
          ep.tags.some(t => t.toLowerCase().includes(q))
        )
        .slice(0, limit);
    }
    const rows = this.store.sqlite.searchByText('episodic', text, limit);
    return rows.map(r => JSON.parse(r.data) as Episode);
  }

  /** Get episodes from the last N days */
  recent(days: number, limit = 50): Episode[] {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    return this.query({ from: since, limit });
  }

  /** Get high-importance episodes */
  important(minImportance = 0.7, limit = 20): Episode[] {
    return this.query({ minImportance, limit, orderBy: 'importance DESC' });
  }

  /** Count episodes by type in a time range */
  countByType(from?: string, until?: string): Record<string, number> {
    const episodes = this.query({ from, until, limit: 10000 });
    const counts: Record<string, number> = {};
    for (const ep of episodes) {
      counts[ep.type] = (counts[ep.type] || 0) + 1;
    }
    return counts;
  }

  /** Get the most recent episode of each type */
  latestByType(): Map<EpisodeType, Episode> {
    const types: EpisodeType[] = [
      'task_completed', 'task_failed', 'error_occurred',
      'deploy_triggered', 'user_correction', 'rule_extracted',
    ];
    const result = new Map<EpisodeType, Episode>();
    for (const t of types) {
      const episodes = this.query({ types: [t], limit: 1 });
      if (episodes.length > 0) result.set(t, episodes[0]);
    }
    return result;
  }

  /** Delete episodes older than N days (used by Forgetting Engine) */
  deleteOlderThan(days: number): number {
    const date = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    if (!this.store.sqlite.isOpen) return 0;
    return this.store.sqlite.deleteOlderThan('episodic', date);
  }

  /** Export episodes as markdown journal for human reading */
  toMarkdownJournal(episodes: Episode[]): string {
    const lines: string[] = ['# Episodic Memory Journal', ''];

    for (const ep of episodes) {
      const ts = ep.timestamp.slice(0, 19).replace('T', ' ');
      const tags = ep.tags.length > 0 ? ` [${ep.tags.join(', ')}]` : '';
      lines.push(`## ${ts} — ${ep.type}${tags}`);
      lines.push('');
      lines.push(`> **重要度**: ${(ep.importance * 100).toFixed(0)}%`);
      if (ep.taskId) lines.push(`> **任务**: ${ep.taskId}`);
      lines.push('');
      lines.push(ep.summary);
      if (ep.details && ep.details !== ep.summary) {
        lines.push('');
        lines.push(ep.details.slice(0, 500));
      }
      if (ep.changedFiles && ep.changedFiles.length > 0) {
        lines.push('');
        lines.push('**变更文件**: ' + ep.changedFiles.map(f => `\`${f}\``).join(', '));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private queryJsonl(options: TimelineQuery = {}): Episode[] {
    if (!existsSync(this.store.paths.episodic)) return [];

    const episodes: Episode[] = [];
    for (const file of readdirSync(this.store.paths.episodic)) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = `${this.store.paths.episodic}/${file}`;
      const content = readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { episodes.push(JSON.parse(trimmed) as Episode); } catch { /* skip malformed line */ }
      }
    }

    let results = episodes;
    if (options.from) results = results.filter(e => e.timestamp >= options.from!);
    if (options.until) results = results.filter(e => e.timestamp <= options.until!);
    if (options.types && options.types.length > 0) results = results.filter(e => options.types!.includes(e.type));
    if (options.taskId) results = results.filter(e => e.taskId === options.taskId);
    if (options.minImportance !== undefined) results = results.filter(e => e.importance >= options.minImportance!);
    if (options.tags && options.tags.length > 0) {
      results = results.filter(e => options.tags!.some(tag => e.tags.includes(tag)));
    }

    const orderBy = options.orderBy || 'created_at DESC';
    if (/importance\s+DESC/i.test(orderBy)) {
      results.sort((a, b) => b.importance - a.importance || b.timestamp.localeCompare(a.timestamp));
    } else if (/\bASC\b/i.test(orderBy)) {
      results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else {
      results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    const offset = options.offset || 0;
    const limit = options.limit || 50;
    return results.slice(offset, offset + limit);
  }
}

// ── Convenience constructors ──

export function createEpisode(
  type: EpisodeType,
  summary: string,
  details: string,
  options: {
    taskId?: string;
    sessionId?: string;
    importance?: number;
    tags?: string[];
    changedFiles?: string[];
    relatedEpisodeIds?: string[];
  } = {}
): Omit<Episode, 'id'> {
  return {
    type,
    taskId: options.taskId,
    sessionId: options.sessionId,
    summary: summary.slice(0, 200),
    details: details.slice(0, 2000),
    importance: options.importance ?? defaultImportance(type),
    tags: options.tags || defaultTags(type, summary),
    changedFiles: options.changedFiles,
    relatedEpisodeIds: options.relatedEpisodeIds || [],
    timestamp: new Date().toISOString(),
  };
}

function defaultImportance(type: EpisodeType): number {
  switch (type) {
    case 'error_occurred': return 0.8;
    case 'user_correction': return 0.75;
    case 'deploy_triggered': return 0.7;
    case 'rollback_executed': return 0.85;
    case 'task_failed': return 0.7;
    case 'task_completed': return 0.4;
    case 'rule_extracted': return 0.6;
    case 'memory_consolidated': return 0.3;
    default: return 0.35;
  }
}

function defaultTags(type: EpisodeType, summary: string): string[] {
  const tags: string[] = [type];
  // Extract common keywords
  for (const kw of ['error', 'crash', 'deploy', 'rollback', 'security', 'api', 'ui', 'test', 'database', 'config']) {
    if (summary.toLowerCase().includes(kw)) tags.push(kw);
  }
  return [...new Set(tags)];
}
