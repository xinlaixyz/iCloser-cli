// Context Composer — PRD §5.5: ranking, compression, injection of recall results
// Ensures Working Memory stays compact and relevant: Top-5, max 2k tokens, anti-explosion
import type { RecallResult } from './recall.js';
import { estimateTokens } from '../../utils/fs.js';

export interface ComposedContext {
  /** Formatted text ready for LLM injection */
  injectedText: string;
  /** Individual injected items */
  items: ComposedItem[];
  /** Token statistics */
  stats: {
    totalTokens: number;
    itemCount: number;
    truncated: boolean;
    truncatedCount: number;
  };
}

export interface ComposedItem {
  category: 'rule' | 'history' | 'preference' | 'pitfall' | 'pattern';
  content: string;
  priority: number;
  tokenEstimate: number;
  source: string;
}

export interface ComposeOptions {
  maxTokens: number;        // default 6000
  maxItems: number;         // default 20
  maxItemsPerType: number;  // default 8
  dedupThreshold: number;   // similarity for dedup (0.8 = 80%)
}

const DEFAULT_OPTIONS: ComposeOptions = {
  maxTokens: 6000,
  maxItems: 20,
  maxItemsPerType: 8,
  dedupThreshold: 0.8,
};

export class ContextComposer {
  private options: ComposeOptions;

  constructor(options: Partial<ComposeOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Compose recall results into injection-ready context */
  compose(recallResults: RecallResult[], _taskDescription: string): ComposedContext {
    // Step 1: Convert recall results to ComposedItems with categories
    let items = recallResults.map(r => this.toComposedItem(r));

    // Step 2: Deduplicate similar items
    items = this.deduplicate(items);

    // Step 3: Rank by priority
    items.sort((a, b) => b.priority - a.priority);

    // Step 4: Enforce per-type limits
    const typeCounts: Record<string, number> = {};
    items = items.filter(item => {
      typeCounts[item.category] = (typeCounts[item.category] || 0) + 1;
      return typeCounts[item.category] <= this.options.maxItemsPerType;
    });

    // Step 5: Enforce total item limit
    if (items.length > this.options.maxItems) {
      items = items.slice(0, this.options.maxItems);
    }

    // Step 6: Token budget — compress items until they fit
    let tokens = items.reduce((sum, i) => sum + i.tokenEstimate, 0);
    let truncated = false;
    let truncatedCount = 0;

    if (tokens > this.options.maxTokens) {
      truncated = true;
      // Compress: keep high-priority items intact, compress low-priority
      const budgetPerItem = Math.floor(this.options.maxTokens / items.length);

      for (const item of items) {
        if (item.tokenEstimate > budgetPerItem) {
          item.content = this.compressItem(item, budgetPerItem);
          item.tokenEstimate = estimateTokens(item.content);
          truncatedCount++;
        }
      }

      // Re-check total
      tokens = items.reduce((sum, i) => sum + i.tokenEstimate, 0);
      while (tokens > this.options.maxTokens && items.length > 0) {
        const removed = items.pop()!;
        tokens -= removed.tokenEstimate;
      }
    }

    // Step 7: Format injection text
    const injectedText = this.formatInjection(items);

    return {
      injectedText,
      items,
      stats: {
        totalTokens: tokens,
        itemCount: items.length,
        truncated,
        truncatedCount,
      },
    };
  }

  /** Compose with a custom format suitable for system prompt injection */
  composeCompact(recallResults: RecallResult[], taskDescription: string): string {
    const { injectedText } = this.compose(recallResults, taskDescription);
    if (!injectedText) return '';

    // Compact header
    return [
      '## 相关记忆 (Memory Recall)',
      injectedText,
      '---',
      '',
    ].join('\n');
  }

  // ── Private ──

  private toComposedItem(r: RecallResult): ComposedItem {
    switch (r.type) {
      case 'semantic':
        return {
          category: 'rule',
          content: r.content,
          priority: Math.round(r.score * 80) + 20,
          tokenEstimate: estimateTokens(r.content),
          source: r.source,
        };
      case 'emotion':
        return {
          category: 'pitfall',
          content: r.content,
          priority: Math.round(r.score * 90) + 10,
          tokenEstimate: estimateTokens(r.content),
          source: r.source,
        };
      case 'timeline':
        // Distinguish: if it contains error/failure keywords → pitfall, else → history
        if (/错误|失败|crash|error|fail|bug/i.test(r.content)) {
          return {
            category: 'pitfall',
            content: r.content,
            priority: Math.round(r.score * 85),
            tokenEstimate: estimateTokens(r.content),
            source: r.source,
          };
        }
        return {
          category: 'history',
          content: r.content,
          priority: Math.round(r.score * 70),
          tokenEstimate: estimateTokens(r.content),
          source: r.source,
        };
    }
  }

  private deduplicate(items: ComposedItem[]): ComposedItem[] {
    const result: ComposedItem[] = [];
    for (const item of items) {
      const isDup = result.some(existing =>
        this.similarity(existing.content, item.content) >= this.options.dedupThreshold
      );
      if (!isDup) result.push(item);
    }
    return result;
  }

  private similarity(a: string, b: string): number {
    // Simple Jaccard-like word overlap
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 1));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 1));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }

    const union = new Set([...wordsA, ...wordsB]);
    return overlap / union.size;
  }

  private compressItem(item: ComposedItem, budgetTokens: number): string {
    // Rule: keep the rule content, drop extra metadata
    const clean = item.content
      .replace(/^\[.*?\]\s*/, '')     // remove leading [tag]
      .replace(/\(\S+\)\s*/, '')      // remove (metadata)
      .trim();

    if (estimateTokens(clean) <= budgetTokens) return clean;

    // Truncate to fit budget (rough: 1 token ≈ 4 chars for CJK, 2 chars for English)
    const charBudget = budgetTokens * 3;
    return clean.slice(0, charBudget) + '...';
  }

  private formatInjection(items: ComposedItem[]): string {
    if (items.length === 0) return '';

    // Group by category
    const groups: Record<string, ComposedItem[]> = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }

    const sections: string[] = [];

    // Rules first (most important)
    if (groups.rule) {
      sections.push('[记忆: 相关规则]');
      sections.push(...groups.rule.map(r => `- ${r.content.replace(/^\[规则.*?\]\s*/, '')}`));
      sections.push('');
    }

    // Pitfalls (errors, failures)
    if (groups.pitfall) {
      sections.push('[记忆: 历史失败与风险]');
      sections.push(...groups.pitfall.map(r => `- ${r.content.replace(/^\[.*?\]\s*/, '')}`));
      sections.push('');
    }

    // History (timeline)
    if (groups.history) {
      sections.push('[记忆: 历史任务]');
      sections.push(...groups.history.map(r => `- ${r.content.replace(/^\[时间轴记忆.*?\]\s*/, '')}`));
      sections.push('');
    }

    // Preferences / patterns
    if (groups.preference) {
      sections.push('[记忆: 用户偏好]');
      sections.push(...groups.preference.map(r => `- ${r.content}`));
      sections.push('');
    }

    if (groups.pattern) {
      sections.push('[记忆: 工程模式]');
      sections.push(...groups.pattern.map(r => `- ${r.content}`));
      sections.push('');
    }

    return sections.join('\n').trim();
  }
}
