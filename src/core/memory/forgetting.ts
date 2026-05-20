// Forgetting Engine — PRD §4.6: decay-based memory retirement
// Formula: M(t) = M0 × e^(-t/S)
// Tiered half-life: high=90d, medium=30d, low=7d
// Protects permanent rules, recently-referenced memories, and user-pinned items.
import type { Episode } from './episodic.js';
import type { SemanticRule } from './semantic.js';
import type { MemoryStore } from './store.js';
import type { SalienceLevel } from './salience.js';

export interface ForgettingConfig {
  highHalfLifeDays: number;     // S for HIGH salience (default 90)
  mediumHalfLifeDays: number;   // S for MEDIUM salience (default 30)
  lowHalfLifeDays: number;      // S for LOW salience (default 7)
  archiveThreshold: number;     // M(t) below this → archive (default 0.05)
  deleteThreshold: number;      // M(t) below this → delete (default 0.01)
  protectionWindowDays: number; // recently referenced → protect from delete (default 14)
}

const DEFAULT_CONFIG: ForgettingConfig = {
  highHalfLifeDays: 90,
  mediumHalfLifeDays: 30,
  lowHalfLifeDays: 7,
  archiveThreshold: 0.05,
  deleteThreshold: 0.01,
  protectionWindowDays: 14,
};

export interface ForgettingResult {
  archived: number;
  deleted: number;
  protected: number;
  details: Array<{
    id: string;
    type: 'episodic' | 'semantic';
    action: 'archived' | 'deleted' | 'protected';
    reason: string;
    retentionScore: number;
  }>;
}

export class ForgettingEngine {
  private config: ForgettingConfig;

  constructor(config: Partial<ForgettingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Compute retention score: M(t) = M0 × e^(-t/S) */
  retentionScore(importance: number, timestamp: string, salienceLevel: SalienceLevel): number {
    const eventDate = new Date(timestamp);
    const now = new Date();
    const daysSince = (now.getTime() - eventDate.getTime()) / (24 * 3600 * 1000);

    const S = salienceLevel === 'high' ? this.config.highHalfLifeDays :
              salienceLevel === 'medium' ? this.config.mediumHalfLifeDays :
              this.config.lowHalfLifeDays;

    // M(t) = M0 × e^(-t/S)
    // M0 is the initial salience: high=0.85, medium=0.55, low=0.3
    const M0 = salienceLevel === 'high' ? 0.85 :
               salienceLevel === 'medium' ? 0.55 : 0.3;

    const retention = M0 * Math.exp(-daysSince / S);
    return Math.max(0, Math.min(1, retention));
  }

  /** Process episodic memory — archive/delete stale episodes */
  processEpisodes(
    episodes: Episode[],
    options: {
      protectedEpisodeIds?: Set<string>;
      recentTaskIds?: Set<string>;
    } = {}
  ): ForgettingResult {
    const result: ForgettingResult = { archived: 0, deleted: 0, protected: 0, details: [] };
    const protectedIds = options.protectedEpisodeIds || new Set<string>();
    const recentTasks = options.recentTaskIds || new Set<string>();
    const recentCutoff = new Date(Date.now() - this.config.protectionWindowDays * 24 * 3600 * 1000);

    for (const ep of episodes) {
      // Protection checks
      if (protectedIds.has(ep.id)) {
        result.protected++;
        result.details.push({ id: ep.id, type: 'episodic', action: 'protected', reason: '用户标记保护', retentionScore: 1 });
        continue;
      }
      if (ep.taskId && recentTasks.has(ep.taskId)) {
        result.protected++;
        result.details.push({ id: ep.id, type: 'episodic', action: 'protected', reason: '关联近期任务', retentionScore: 1 });
        continue;
      }
      const epDate = new Date(ep.timestamp);
      if (epDate > recentCutoff) {
        result.protected++;
        result.details.push({ id: ep.id, type: 'episodic', action: 'protected', reason: `近${this.config.protectionWindowDays}天内事件`, retentionScore: 1 });
        continue;
      }

      const salienceLevel = ep.importance >= 0.7 ? 'high' : ep.importance >= 0.4 ? 'medium' : 'low';
      const score = this.retentionScore(ep.importance, ep.timestamp, salienceLevel);

      if (score < this.config.deleteThreshold) {
        result.deleted++;
        result.details.push({ id: ep.id, type: 'episodic', action: 'deleted', reason: `保留分数 ${score.toFixed(3)} < 删除阈值 ${this.config.deleteThreshold}`, retentionScore: score });
      } else if (score < this.config.archiveThreshold) {
        result.archived++;
        result.details.push({ id: ep.id, type: 'episodic', action: 'archived', reason: `保留分数 ${score.toFixed(3)} < 归档阈值 ${this.config.archiveThreshold}`, retentionScore: score });
      } else {
        result.protected++;
      }
    }

    return result;
  }

  /** Process semantic rules — archive/delete low-confidence, non-permanent rules */
  processRules(rules: SemanticRule[]): ForgettingResult {
    const result: ForgettingResult = { archived: 0, deleted: 0, protected: 0, details: [] };

    for (const rule of rules) {
      if (rule.isPermanent) {
        result.protected++;
        continue;
      }
      if (rule.confidence >= 0.8) {
        result.protected++;
        continue; // High-confidence rules are protected
      }

      const salienceLevel = rule.confidence >= 0.7 ? 'high' : rule.confidence >= 0.4 ? 'medium' : 'low';
      const score = this.retentionScore(rule.confidence, rule.updated_at, salienceLevel);

      if (score < this.config.deleteThreshold) {
        result.deleted++;
        result.details.push({ id: rule.id, type: 'semantic', action: 'deleted', reason: `置信度 ${rule.confidence.toFixed(2)} 保留分 ${score.toFixed(3)}`, retentionScore: score });
      } else if (score < this.config.archiveThreshold && rule.verificationCount < 2) {
        result.archived++;
        result.details.push({ id: rule.id, type: 'semantic', action: 'archived', reason: `验证不足 (${rule.verificationCount}次)`, retentionScore: score });
      } else {
        result.protected++;
      }
    }

    return result;
  }

  /** Archive episodes to the archive store */
  async archiveEpisodes(store: MemoryStore, episodes: Episode[]): Promise<number> {
    let count = 0;
    for (const ep of episodes) {
      const archivePath = await store.archiveFile(
        `${store.paths.episodic}/${ep.timestamp.slice(0, 7)}.jsonl`,
        `episode-${ep.id}`
      );
      if (archivePath) count++;
    }
    return count;
  }

  /** Run a full cleanup cycle */
  async cleanup(
    store: MemoryStore,
    episodes: Episode[],
    rules: SemanticRule[],
    options: {
      protectedEpisodeIds?: Set<string>;
      recentTaskIds?: Set<string>;
    } = {}
  ): Promise<{ episodic: ForgettingResult; semantic: ForgettingResult }> {
    const epResult = this.processEpisodes(episodes, options);
    const semResult = this.processRules(rules);

    // Delete episodes marked for deletion
    if (store.sqlite.isOpen) {
      for (const detail of epResult.details.filter(d => d.action === 'deleted')) {
        store.sqlite.deleteByKey('episodic', detail.id);
      }
      for (const detail of semResult.details.filter(d => d.action === 'deleted')) {
        store.sqlite.deleteByKey('semantic', detail.id);
      }
    }

    // Archive episodes
    const toArchive = episodes.filter(e =>
      epResult.details.some(d => d.id === e.id && d.action === 'archived')
    );
    await this.archiveEpisodes(store, toArchive);

    return { episodic: epResult, semantic: semResult };
  }
}
