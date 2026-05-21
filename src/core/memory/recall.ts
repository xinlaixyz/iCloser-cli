// Recall Pipeline — PRD §5.2-5.4: structured memory retrieval
// RecallScore = SemanticSimilarity + TimelineRelevance + EmotionalWeight + RecentUsage + TaskSimilarity
// Three recall types: Timeline, Semantic, Emotion
// Default Top-K = 5 results injected into Working Memory
import type { EpisodicMemory, Episode } from './episodic.js';
import type { SemanticMemory, SemanticRule } from './semantic.js';
import { SalienceEngine } from './salience.js';

export interface RecallQuery {
  module?: string;
  platform?: string;
  action?: string;
  keywords: string[];
  entities: string[];     // e.g. file names, function names
  timeHints?: {           // from Chinese time expressions
    from?: string;
    until?: string;
  };
}

export interface RecallResult {
  type: 'timeline' | 'semantic' | 'emotion';
  source: string;          // episode ID or rule ID
  content: string;         // formatted for LLM injection
  score: number;           // 0-1
  raw: Episode | SemanticRule;
}

export interface RecallOptions {
  topK: number;            // default 5
  maxTokens: number;       // max tokens for all recall results (default 2000)
  weights: {               // configurable scoring weights
    semanticSimilarity: number;
    timelineRelevance: number;
    emotionalWeight: number;
    recentUsage: number;
    taskSimilarity: number;
  };
}

const DEFAULT_OPTIONS: RecallOptions = {
  topK: 12,
  maxTokens: 6000,
  weights: {
    semanticSimilarity: 0.25,
    timelineRelevance: 0.20,
    emotionalWeight: 0.25,
    recentUsage: 0.15,
    taskSimilarity: 0.15,
  },
};

// Chinese time expression → absolute date range
const TIME_PATTERNS: Array<{ regex: RegExp; daysBack: number }> = [
  { regex: /今天/, daysBack: 1 },
  { regex: /昨天/, daysBack: 2 },
  { regex: /前天/, daysBack: 3 },
  { regex: /上周/, daysBack: 7 },
  { regex: /上[个]?月/, daysBack: 30 },
  { regex: /本周/, daysBack: 7 },
  { regex: /这[个]?月/, daysBack: 30 },
  { regex: /最近/, daysBack: 7 },
  { regex: /部署前/, daysBack: 14 },
  { regex: /回滚后/, daysBack: 14 },
];

const ENG_TIME_PATTERNS: Array<{ regex: RegExp; daysBack: number }> = [
  { regex: /today/, daysBack: 1 },
  { regex: /yesterday/, daysBack: 2 },
  { regex: /last week/, daysBack: 7 },
  { regex: /last month/, daysBack: 30 },
  { regex: /this week/, daysBack: 7 },
  { regex: /recent/, daysBack: 7 },
  { regex: /before deploy/, daysBack: 14 },
  { regex: /after rollback/, daysBack: 14 },
];

export class RecallEngine {
  private episodic: EpisodicMemory;
  private semantic: SemanticMemory;
  private salience: SalienceEngine;
  private options: RecallOptions;
  private recentAccessLog = new Map<string, number>(); // sourceId → last access timestamp

  constructor(
    episodic: EpisodicMemory,
    semantic: SemanticMemory,
    salience: SalienceEngine,
    options: Partial<RecallOptions> = {}
  ) {
    this.episodic = episodic;
    this.semantic = semantic;
    this.salience = salience;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── Public API ──

  /** Main entry: execute full recall for a task description */
  async recall(taskDescription: string): Promise<RecallResult[]> {
    const query = this.parseTask(taskDescription);
    const allResults: RecallResult[] = [];

    // Step 1: Timeline Recall — recent relevant episodes
    const timelineResults = await this.timelineRecall(query);
    allResults.push(...timelineResults);

    // Step 2: Semantic Recall — matching rules
    const semanticResults = await this.semanticRecall(query);
    allResults.push(...semanticResults);

    // Step 3: Emotion Recall — high-salience events
    const emotionResults = await this.emotionRecall(query);
    allResults.push(...emotionResults);

    // Step 4: Deduplicate
    const deduped = this.deduplicate(allResults);

    // Step 5: Rank and select Top-K
    const ranked = this.rank(deduped, query);
    const topK = ranked.slice(0, this.options.topK);

    // Step 6: Record accesses
    for (const r of topK) {
      this.recentAccessLog.set(r.source, Date.now());
    }

    return topK;
  }

  /** Single-type recall */
  async recallType(type: 'timeline' | 'semantic' | 'emotion', query: RecallQuery): Promise<RecallResult[]> {
    switch (type) {
      case 'timeline': return this.timelineRecall(query);
      case 'semantic': return this.semanticRecall(query);
      case 'emotion': return this.emotionRecall(query);
    }
  }

  /** Parse a natural language task into a structured RecallQuery */
  parseTask(task: string): RecallQuery {
    const keywords: string[] = [];
    const entities: string[] = [];
    let module: string | undefined;
    let platform: string | undefined;
    let action: string | undefined;

    // Extract time hints
    const timeHints = this.parseTimeHints(task);

    // Extract module (first Chinese/English word group before action words)
    const moduleMatch = task.match(/(?:修改|更改|添加|创建|新增|删除|重构|优化|检查|修复|fix|modify|add|create|delete|refactor|check)\s*([a-zA-Z_\-\/.一-鿿]+)/i);
    if (moduleMatch) module = moduleMatch[1];

    // Extract platform
    for (const p of ['iOS', 'Android', 'Web', '后端', '前端', 'macOS', 'Windows', 'Linux']) {
      if (task.includes(p)) { platform = p; break; }
    }

    // Extract action
    for (const [pattern, act] of [
      [/修改|修改|改|modify|update|change/, 'modification'],
      [/创建|新增|添加|create|add|new/, 'creation'],
      [/删除|delete|remove/, 'deletion'],
      [/重构|优化|refactor|optimize/, 'refactor'],
      [/修复|fix|repair/, 'fix'],
      [/检查|审查|review|inspect/, 'review'],
      [/测试|test/, 'testing'],
      [/部署|deploy/, 'deployment'],
    ] as [RegExp, string][]) {
      if (pattern.test(task)) { action = act; break; }
    }

    // Extract keywords: split by common delimiters and filter
    const cleanTask = task.replace(/[，,。.!！?？\s]+/g, ' ').trim();
    const words = cleanTask.split(' ');
    for (const w of words) {
      const trimmed = w.trim();
      if (trimmed.length >= 2 && !/^(修改|更改|添加|创建|新增|的|在|和|与|或|是|请|帮|给|为)$/.test(trimmed)) {
        keywords.push(trimmed);
      }
    }

    // Extract entities (filenames, paths)
    const fileMatches = task.matchAll(/([a-zA-Z0-9_\-./]+\.(ts|js|py|go|java|kt|swift|tsx|jsx|vue|css|json|yaml|md))/gi);
    for (const m of fileMatches) entities.push(m[1]);

    return { module, platform, action, keywords, entities, timeHints };
  }

  /** Log that a memory source was accessed (for recentUsage scoring) */
  logAccess(sourceId: string): void {
    this.recentAccessLog.set(sourceId, Date.now());
  }

  // ── Recall Types ──

  private async timelineRecall(query: RecallQuery): Promise<RecallResult[]> {
    const from = query.timeHints?.from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const until = query.timeHints?.until;

    const episodes = this.episodic.query({ from, until, limit: 50 });

    return episodes.map(ep => ({
      type: 'timeline' as const,
      source: ep.id,
      content: `[时间轴记忆 ${ep.timestamp.slice(0, 10)}] ${ep.summary}${ep.details ? '\n' + ep.details.slice(0, 200) : ''}`,
      score: 0, // filled in by rank()
      raw: ep,
    }));
  }

  private async semanticRecall(query: RecallQuery): Promise<RecallResult[]> {
    // Search by keywords + module + platform
    const searchTerms = [
      ...query.keywords,
      query.module,
      query.platform,
      query.action,
    ].filter(Boolean) as string[];

    const searchText = searchTerms.join(' ');
    const rules = this.semantic.searchRelevant(searchText, 20);

    return rules.map(rule => ({
      type: 'semantic' as const,
      source: rule.id,
      content: `[规则 ${rule.path}] (置信度 ${(rule.confidence * 100).toFixed(0)}%) ${rule.content}`,
      score: 0,
      raw: rule as unknown as Episode,
    }));
  }

  private async emotionRecall(_query: RecallQuery): Promise<RecallResult[]> {
    // High-importance episodes only
    const episodes = this.episodic.important(0.6, 15);
    const ranked = this.salience.rank(episodes);

    return ranked.map(({ salience, ...ep }) => ({
      type: 'emotion' as const,
      source: ep.id,
      content: `[重要记忆 重要度 ${(salience.score * 100).toFixed(0)}%] ${ep.summary}`,
      score: 0,
      raw: ep,
    }));
  }

  // ── Ranking Engine (PRD §5.4) ──

  private rank(results: RecallResult[], query: RecallQuery): RecallResult[] {
    const w = this.options.weights;

    for (const r of results) {
      const semanticSim = this.semanticSimilarityScore(r, query);
      const timelineRel = this.timelineRelevanceScore(r);
      const emotional = this.emotionWeightScore(r);
      const recent = this.recentUsageScore(r);
      const taskSim = this.taskSimilarityScore(r, query);

      r.score =
        w.semanticSimilarity * semanticSim +
        w.timelineRelevance * timelineRel +
        w.emotionalWeight * emotional +
        w.recentUsage * recent +
        w.taskSimilarity * taskSim;
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private semanticSimilarityScore(result: RecallResult, query: RecallQuery): number {
    const content = result.content.toLowerCase();
    let matches = 0;
    const searchTerms = [...query.keywords, query.module, query.platform, query.action].filter(Boolean) as string[];

    if (searchTerms.length === 0) return 0.3; // neutral

    for (const term of searchTerms) {
      if (content.includes(term.toLowerCase())) matches++;
    }
    return Math.min(1, matches / Math.max(1, searchTerms.length));
  }

  private timelineRelevanceScore(result: RecallResult): number {
    if (result.type !== 'timeline') return 0;
    const ep = result.raw as Episode;
    if (!ep.timestamp) return 0.3;

    const daysAgo = (Date.now() - new Date(ep.timestamp).getTime()) / (24 * 3600 * 1000);
    // Exponential decay: today=1.0, 7 days=0.5, 30 days=0.2
    return Math.exp(-daysAgo / 10);
  }

  private emotionWeightScore(result: RecallResult): number {
    if (result.type === 'emotion') {
      const ep = result.raw as Episode;
      return ep.importance || 0.5;
    }
    // Check if result has high-salience signal
    if (SalienceEngine.hasHighSignal(result.content)) return 0.7;
    return 0.2;
  }

  private recentUsageScore(result: RecallResult): number {
    const lastAccess = this.recentAccessLog.get(result.source);
    if (!lastAccess) return 0;
    const hoursAgo = (Date.now() - lastAccess) / (3600 * 1000);
    if (hoursAgo < 1) return 1.0;
    if (hoursAgo < 24) return 0.7;
    if (hoursAgo < 168) return 0.3; // within a week
    return 0.1;
  }

  private taskSimilarityScore(result: RecallResult, query: RecallQuery): number {
    // Compare current task's module/keywords with episode tags
    const content = result.content.toLowerCase();
    let score = 0;

    for (const kw of query.keywords) {
      if (content.includes(kw.toLowerCase())) score += 0.2;
    }
    if (query.module && content.includes(query.module.toLowerCase())) score += 0.3;
    if (query.action && content.includes(query.action.toLowerCase())) score += 0.2;

    return Math.min(1, score);
  }

  // ── Deduplication ──

  private deduplicate(results: RecallResult[]): RecallResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = r.content.slice(0, 120).replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Time parsing ──

  private parseTimeHints(text: string): { from?: string; until?: string } {
    const allPatterns = [...TIME_PATTERNS, ...ENG_TIME_PATTERNS];

    for (const { regex, daysBack } of allPatterns) {
      if (regex.test(text)) {
        const from = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
        return { from: from.toISOString() };
      }
    }

    return {};
  }
}
