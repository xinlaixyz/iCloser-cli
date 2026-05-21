// Consolidation Engine — PRD §4.4: compress episodes → extract semantic rules
// Triggers: every N tasks, manual, session end
// Process: group episodes by task → summarize each → detect patterns → create rules
import type { Episode } from './episodic.js';
import type { SemanticRule } from './semantic.js';
import type { EpisodicMemory } from './episodic.js';
import type { SemanticMemory } from './semantic.js';
import { SalienceEngine } from './salience.js';

export interface ConsolidationConfig {
  triggerTaskCount: number;   // trigger every N tasks (default 5)
  lookbackDays: number;        // how far back to scan episodes (default 30)
  minEpisodesForPattern: number; // min occurrences to form a rule (default 3)
  maxNewRulesPerRun: number;   // cap on auto-generated rules (default 5)
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  triggerTaskCount: 5,
  lookbackDays: 30,
  minEpisodesForPattern: 3,
  maxNewRulesPerRun: 5,
};

export interface ConsolidationResult {
  episodesProcessed: number;
  summariesGenerated: number;
  patternsDetected: number;
  rulesCreated: SemanticRule[];
  newRules: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>[];
  ranAt: string;
}

export class ConsolidationEngine {
  private config: ConsolidationConfig;
  private taskCount = 0;
  private salience: SalienceEngine;

  constructor(config: Partial<ConsolidationConfig> = {}, salience?: SalienceEngine) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.salience = salience || new SalienceEngine();
  }

  /** Call after each task completes. Returns true if consolidation should run. */
  onTaskComplete(): boolean {
    this.taskCount++;
    return this.taskCount >= this.config.triggerTaskCount;
  }

  /** Run consolidation: episodes → summaries → rules */
  async consolidate(
    episodic: EpisodicMemory,
    semantic: SemanticMemory,
    aiAbstract?: (summaries: string[]) => Promise<string[]>
  ): Promise<ConsolidationResult> {
    this.taskCount = 0; // reset counter

    const since = new Date(Date.now() - this.config.lookbackDays * 24 * 3600 * 1000).toISOString();
    const episodes = episodic.query({ from: since, limit: 500 });

    const result: ConsolidationResult = {
      episodesProcessed: episodes.length,
      summariesGenerated: 0,
      patternsDetected: 0,
      rulesCreated: [],
      newRules: [],
      ranAt: new Date().toISOString(),
    };

    if (episodes.length === 0) return result;

    // Step 1: Group episodes by task
    const byTask = this.groupByTask(episodes);
    result.summariesGenerated = byTask.size;

    // Step 2: Generate summaries for each task group
    const summaries: string[] = [];
    for (const [taskId, eps] of byTask) {
      const summary = this.summarizeTaskGroup(taskId, eps);
      summaries.push(summary);
    }

    // Step 3: Detect patterns across task summaries
    const patterns = this.detectPatterns(summaries, episodes);

    // Step 4: Use AI to abstract rules if available, otherwise use heuristics
    let ruleCandidates: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>[];

    if (aiAbstract && patterns.length > 0) {
      const aiGenerated = await aiAbstract(patterns);
      ruleCandidates = aiGenerated.map(content => this.parseAIRule(content, episodes));
    } else {
      ruleCandidates = this.heuristicRules(patterns, episodes);
    }

    // Step 5: Merge rules into semantic memory (capped)
    result.patternsDetected = patterns.length;
    for (const candidate of ruleCandidates.slice(0, this.config.maxNewRulesPerRun)) {
      result.newRules.push(candidate);
      const rule = semantic.merge(candidate);
      result.rulesCreated.push(rule);
    }

    // Record consolidation event
    await episodic.record({
      type: 'memory_consolidated',
      summary: `固化完成: ${result.rulesCreated.length} 条新规则, ${result.summariesGenerated} 个任务摘要`,
      details: `处理 ${episodes.length} 条事件, 检测 ${patterns.length} 个模式`,
      importance: 0.3,
      tags: ['consolidation', 'system'],
      relatedEpisodeIds: [],
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  // ── Private ──

  private groupByTask(episodes: Episode[]): Map<string, Episode[]> {
    const map = new Map<string, Episode[]>();
    for (const ep of episodes) {
      const key = ep.taskId || '__no_task__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ep);
    }
    return map;
  }

  private summarizeTaskGroup(taskId: string, episodes: Episode[]): string {
    const _types = episodes.map(e => e.type);
    const errors = episodes.filter(e => e.type === 'error_occurred');
    const changes = episodes.filter(e => e.type === 'file_changed');
    const completed = episodes.some(e => e.type === 'task_completed');
    const failed = episodes.some(e => e.type === 'task_failed');

    const parts: string[] = [`任务 ${taskId.slice(0, 12)}`];
    if (completed) parts.push('已完成');
    if (failed) parts.push('失败');
    if (errors.length > 0) parts.push(`${errors.length} 个错误`);
    if (changes.length > 0) parts.push(`${changes.length} 个文件变更`);

    // Collect all changed files
    const allFiles = new Set<string>();
    for (const ch of changes) {
      if (ch.changedFiles) for (const f of ch.changedFiles) allFiles.add(f);
    }
    if (allFiles.size > 0) {
      parts.push(`涉及: ${[...allFiles].slice(0, 5).join(', ')}${allFiles.size > 5 ? ' 等' : ''}`);
    }

    return parts.join(' | ');
  }

  private detectPatterns(summaries: string[], episodes: Episode[]): string[] {
    const patterns: string[] = [];
    const errorEpisodes = episodes.filter(e => e.type === 'error_occurred');
    const correctionEpisodes = episodes.filter(e => e.type === 'user_correction');

    // Pattern 1: Repeated errors in same file
    const errorFiles = new Map<string, number>();
    for (const ep of errorEpisodes) {
      if (ep.changedFiles) {
        for (const f of ep.changedFiles) {
          errorFiles.set(f, (errorFiles.get(f) || 0) + 1);
        }
      }
    }
    for (const [file, count] of errorFiles) {
      if (count >= this.config.minEpisodesForPattern) {
        patterns.push(`文件 ${file} 反复出现错误 (${count}次)，修改前需仔细检查`);
      }
    }

    // Pattern 2: Repeated user corrections on same topic
    const correctionTopics = new Map<string, number>();
    for (const ep of correctionEpisodes) {
      const topic = ep.summary.slice(0, 60);
      correctionTopics.set(topic, (correctionTopics.get(topic) || 0) + 1);
    }
    for (const [topic, count] of correctionTopics) {
      if (count >= this.config.minEpisodesForPattern) {
        patterns.push(`用户多次纠正: ${topic} (${count}次)`);
      }
    }

    // Pattern 3: Tasks modifying certain files tend to fail
    const failureFiles = new Map<string, number>();
    for (const ep of episodes.filter(e => e.type === 'task_failed')) {
      if (ep.changedFiles) {
        for (const f of ep.changedFiles) {
          failureFiles.set(f, (failureFiles.get(f) || 0) + 1);
        }
      }
    }
    for (const [file, count] of failureFiles) {
      if (count >= 2) {
        patterns.push(`修改 ${file} 容易导致任务失败 (${count}次失败记录)`);
      }
    }

    // Pattern 4: Common file groups (files often changed together)
    const filePairs = new Map<string, number>();
    for (const ep of episodes) {
      const files = ep.changedFiles || [];
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          const key = [files[i], files[j]].sort().join(' + ');
          filePairs.set(key, (filePairs.get(key) || 0) + 1);
        }
      }
    }
    for (const [pair, count] of filePairs) {
      if (count >= this.config.minEpisodesForPattern) {
        patterns.push(`文件经常一起修改: ${pair} (${count}次)`);
      }
    }

    return patterns;
  }

  private heuristicRules(patterns: string[], episodes: Episode[]): Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>[] {
    const rules: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>[] = [];

    for (const pattern of patterns) {
      // Determine domain from pattern content
      const domain = this.inferDomain(pattern, episodes);

      rules.push({
        path: `${domain}/自动规则`,
        domain,
        content: pattern,
        scope: 'project',
        confidence: 0.3,
        verificationCount: 0,
        sourceEpisodeIds: episodes.slice(0, 5).map(e => e.id),
        tags: ['auto-generated', 'consolidation', domain.toLowerCase()],
        isPermanent: false,
      });
    }

    return rules;
  }

  private inferDomain(pattern: string, _episodes: Episode[]): string {
    const lower = pattern.toLowerCase();
    if (/ios|swift|uikit|swiftui|xcode/.test(lower)) return 'iOS';
    if (/android|kotlin|java|gradle/.test(lower)) return 'Android';
    if (/react|vue|angular|frontend|css|html|component/.test(lower)) return 'Frontend';
    if (/api|backend|server|database|sql|endpoint/.test(lower)) return 'Backend';
    if (/deploy|docker|kubernetes|ci|cd|pipeline/.test(lower)) return 'DevOps';
    if (/config|env|setting|preference/.test(lower)) return 'Config';
    return 'General';
  }

  private parseAIRule(aiOutput: string, episodes: Episode[]): Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'> {
    // AI should output: "规则内容 | domain"
    const parts = aiOutput.split('|').map(s => s.trim());
    const content = parts[0] || aiOutput;
    const domain = parts[1] || 'General';

    return {
      path: `${domain}/AI抽象规则`,
      domain,
      content: content.slice(0, 300),
      scope: 'project',
      confidence: 0.4,
      verificationCount: 0,
      sourceEpisodeIds: episodes.slice(0, 5).map(e => e.id),
      tags: ['ai-generated', 'consolidation'],
      isPermanent: false,
    };
  }
}
