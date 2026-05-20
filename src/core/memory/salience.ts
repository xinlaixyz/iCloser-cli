// Salience Engine — PRD §4.5: importance/emotion weighting for memory events
// SalienceScore = baseImportance + keywordBoost + feedbackWeight + repetitionBonus
// Salience defines which memories are kept, recalled first, and consolidated.
import type { Episode } from './episodic.js';

export interface SalienceConfig {
  keywordWeight: number;      // per-keyword boost (default 0.15, max 0.5)
  userCorrectionBoost: number; // when user corrects the system (default 0.3)
  userApprovalBoost: number;  // when user confirms/corrects (default 0.1)
  maxKeywordBoost: number;    // cap on keyword boost (default 0.5)
  highThreshold: number;      // ≥ this = HIGH (default 0.7)
  mediumThreshold: number;    // ≥ this = MEDIUM (default 0.4)
}

const DEFAULT_CONFIG: SalienceConfig = {
  keywordWeight: 0.15,
  userCorrectionBoost: 0.3,
  userApprovalBoost: 0.1,
  maxKeywordBoost: 0.5,
  highThreshold: 0.7,
  mediumThreshold: 0.4,
};

// PRD-defined high-weight keywords (Chinese + English)
const HIGH_WEIGHT_KEYWORDS_CN = [
  '严重', '紧急', '立刻', '马上', '生产事故', '崩溃', '数据丢失',
  '安全漏洞', '金钱', '支付', '核心', '关键', '致命', '阻断',
  '不可恢复', '回滚', '回退', '事故', '报警', '告警',
];

const HIGH_WEIGHT_KEYWORDS_EN = [
  'critical', 'urgent', 'P0', 'production', 'incident', 'crash',
  'data loss', 'security breach', 'revenue', 'payment', 'blocker',
  'fatal', 'unrecoverable', 'rollback', 'outage', 'downtime',
];

export type SalienceLevel = 'high' | 'medium' | 'low';

export interface SalienceResult {
  score: number;        // 0-1
  level: SalienceLevel;
  components: {
    base: number;
    keywordBoost: number;
    feedbackBoost: number;
    repetitionBonus: number;
    timeDecay: number;
  };
}

export class SalienceEngine {
  private config: SalienceConfig;
  // Track how many times similar events occurred (for repetition bonus)
  private eventTypeCounts = new Map<string, number>();

  constructor(config: Partial<SalienceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Compute salience score for an episode */
  rate(episode: Episode): SalienceResult {
    const components = {
      base: episode.importance,  // already set by episodic creator
      keywordBoost: this.computeKeywordBoost(episode.summary + ' ' + episode.details),
      feedbackBoost: this.computeFeedbackBoost(episode),
      repetitionBonus: this.computeRepetitionBonus(episode.type),
      timeDecay: 0,              // fresh events have no decay
    };

    let score = components.base + components.keywordBoost + components.feedbackBoost + components.repetitionBonus;
    score = Math.max(0, Math.min(1, score));

    const level: SalienceLevel =
      score >= this.config.highThreshold ? 'high' :
      score >= this.config.mediumThreshold ? 'medium' : 'low';

    return { score, level, components };
  }

  /** Rate with time decay applied */
  rateWithDecay(episode: Episode, referenceDate?: Date): SalienceResult {
    const result = this.rate(episode);
    const decay = this.computeTimeDecay(episode.timestamp, referenceDate);
    const score = Math.max(0, result.score - decay);
    const level: SalienceLevel =
      score >= this.config.highThreshold ? 'high' :
      score >= this.config.mediumThreshold ? 'medium' : 'low';

    return {
      score,
      level,
      components: { ...result.components, timeDecay: decay },
    };
  }

  /** Rate multiple episodes and sort by salience */
  rank(episodes: Episode[], referenceDate?: Date): (Episode & { salience: SalienceResult })[] {
    return episodes
      .map(e => ({ ...e, salience: this.rateWithDecay(e, referenceDate) }))
      .sort((a, b) => b.salience.score - a.salience.score);
  }

  /** Is this episode worth keeping? */
  isWorthKeeping(episode: Episode, referenceDate?: Date): boolean {
    const result = this.rateWithDecay(episode, referenceDate);
    return result.level !== 'low';
  }

  /** Filter to only high-salience episodes */
  filterImportant(episodes: Episode[], referenceDate?: Date): Episode[] {
    return episodes.filter(e => {
      const result = this.rateWithDecay(e, referenceDate);
      return result.level === 'high';
    });
  }

  /** Record an event occurrence for repetition tracking */
  recordOccurrence(type: string): void {
    this.eventTypeCounts.set(type, (this.eventTypeCounts.get(type) || 0) + 1);
  }

  /** Get the event type repetition count */
  getOccurrenceCount(type: string): number {
    return this.eventTypeCounts.get(type) || 0;
  }

  /** Reset tracking (e.g., session end) */
  reset(): void {
    this.eventTypeCounts.clear();
  }

  // ── Quick classification without full scoring ──

  /** Quick check if text content signals high importance */
  static hasHighSignal(text: string): boolean {
    const lower = text.toLowerCase();
    for (const kw of HIGH_WEIGHT_KEYWORDS_CN) {
      if (text.includes(kw)) return true;
    }
    for (const kw of HIGH_WEIGHT_KEYWORDS_EN) {
      if (lower.includes(kw)) return true;
    }
    return false;
  }
  private computeKeywordBoost(text: string): number {
    let boost = 0;
    const lower = text.toLowerCase();

    for (const kw of HIGH_WEIGHT_KEYWORDS_CN) {
      if (text.includes(kw)) boost += this.config.keywordWeight;
    }
    for (const kw of HIGH_WEIGHT_KEYWORDS_EN) {
      if (lower.includes(kw)) boost += this.config.keywordWeight;
    }

    return Math.min(boost, this.config.maxKeywordBoost);
  }

  private computeFeedbackBoost(episode: Episode): number {
    if (episode.type === 'user_correction') return this.config.userCorrectionBoost;
    if (episode.type === 'user_feedback') return this.config.userApprovalBoost;
    return 0;
  }

  private computeRepetitionBonus(type: string): number {
    const count = this.eventTypeCounts.get(type) || 0;
    if (count >= 5) return 0.2;
    if (count >= 3) return 0.1;
    return 0;
  }

  private computeTimeDecay(timestamp: string, referenceDate?: Date): number {
    const eventDate = new Date(timestamp);
    const ref = referenceDate || new Date();
    const daysSince = (ref.getTime() - eventDate.getTime()) / (24 * 3600 * 1000);
    if (daysSince <= 0) return 0;
    // Exponential decay: 0.5 after ~90 days for medium, ~30 days for low
    return 0.3 * (1 - Math.exp(-daysSince / 60));
  }
}
