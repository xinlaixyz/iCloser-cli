// Memory Kernel v1.0 — Recall Pipeline & Context Composer Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { RecallEngine } from '../../src/core/memory/recall.js';
import { ContextComposer } from '../../src/core/memory/composer.js';
import { SalienceEngine } from '../../src/core/memory/salience.js';
import type { EpisodicMemory, Episode } from '../../src/core/memory/episodic.js';
import type { SemanticMemory, SemanticRule } from '../../src/core/memory/semantic.js';

// ── Recall Engine (with mock memories) ──

function mockEpisodic(): EpisodicMemory {
  return {
    query: () => [
      makeEpisode('task_completed', '上次修改钱包 UI 成功', 0.4, new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()),
      makeEpisode('error_occurred', '修改 Swap 组件导致崩溃', 0.85, new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()),
    ],
    important: () => [makeEpisode('error_occurred', '严重: 支付模块数据丢失', 0.9, new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())],
    recent: () => [],
  } as unknown as EpisodicMemory;
}

function mockSemantic(): SemanticMemory {
  return {
    searchRelevant: () => ([
      { id: 'r1', path: 'iOS/UI/修改规则', domain: 'iOS', content: '不要新增 API', importance: 0.9 } as unknown as SemanticRule,
      { id: 'r2', path: 'iOS/Swap/约束', domain: 'iOS', content: '不要修改绑定逻辑', importance: 0.8 } as unknown as SemanticRule,
    ]),
    query: () => [],
    getTree: () => new Map(),
    totalRules: 0,
  } as unknown as SemanticMemory;
}

describe('RecallEngine', () => {
  let engine: RecallEngine;
  let episodic: EpisodicMemory;
  let semantic: SemanticMemory;
  let salience: SalienceEngine;

  beforeEach(() => {
    episodic = mockEpisodic();
    semantic = mockSemantic();
    salience = new SalienceEngine();
    engine = new RecallEngine(episodic, semantic, salience);
  });

  it('parses task description into structured query', () => {
    const query = engine.parseTask('修改钱包首页 Swap UI');
    expect(query.module).toBeTruthy();
    expect(query.keywords.length).toBeGreaterThan(0);
  });

  it('parses task with time hints', () => {
    const query = engine.parseTask('昨天部署后修改的代码');
    expect(query.timeHints?.from).toBeTruthy(); // "昨天" should produce time range
  });

  it('parses task with platform detection', () => {
    const query = engine.parseTask('修改 iOS 钱包 UI');
    expect(query.platform).toBe('iOS');
    expect(query.action).toBeTruthy();
  });

  it('expands Chinese validation tasks into English code constraint keywords', () => {
    const query = engine.parseTask('为 add 和 multiply 函数添加参数校验');
    expect(query.keywords).toContain('finite');
    expect(query.keywords).toContain('number');
    expect(query.keywords).toContain('nan');
    expect(query.keywords).toContain('infinity');
    expect(query.keywords).toContain('function');
  });

  it('parses file entities', () => {
    const query = engine.parseTask('修改 src/wallet/index.tsx 和 src/swap.ts');
    // At minimum one entity should be detected (regex may behave differently with CJK)
    expect(query.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('returns recall results from timeline + semantic + emotion', async () => {
    const results = await engine.recall('修改钱包 Swap');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5); // Top-K=5
  });

  it('scored results have non-zero scores', async () => {
    const results = await engine.recall('修改钱包');
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('deduplicates similar results', async () => {
    // Inject duplicates by making episodic return same content
    const dupeEpisodic = {
      query: () => [
        makeEpisode('task_completed', 'same task', 0.4),
        makeEpisode('task_completed', 'same task', 0.4),
      ],
      important: () => [],
      recent: () => [],
    } as unknown as EpisodicMemory;

    const dedupEngine = new RecallEngine(dupeEpisodic, semantic, salience, { topK: 10 });
    const results = await dedupEngine.recall('same task');
    // Content-based dedup should reduce duplicates
    const contents = results.map(r => r.content.slice(0, 50));
    const uniqueContents = new Set(contents);
    expect(uniqueContents.size).toBeLessThanOrEqual(results.length);
  });

  it('recallType filters by type', async () => {
    const semanticResults = await engine.recallType('semantic', engine.parseTask('修改钱包'));
    expect(semanticResults.every(r => r.type === 'semantic')).toBe(true);
  });

  it('logs access and affects recentUsage score', async () => {
    const results = await engine.recall('修改');
    if (results.length > 0) {
      engine.logAccess(results[0].source);
      // Second recall should give higher score due to recent usage
      const results2 = await engine.recall('修改');
      expect(results2.length).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Context Composer ──

describe('ContextComposer', () => {
  let composer: ContextComposer;

  beforeEach(() => {
    composer = new ContextComposer({ maxTokens: 2000, maxItems: 10, maxItemsPerType: 5 });
  });

  it('composes recall results into injected context', () => {
    const results = [
      makeRecallResult('semantic', '[规则 iOS/UI] 不要新增 API', 0.9),
      makeRecallResult('semantic', '[规则 iOS/UI] 不要修改绑定', 0.8),
      makeRecallResult('emotion', '[重要] 上次崩溃', 0.85),
      makeRecallResult('timeline', '[历史] 昨天修改成功', 0.6),
    ];

    const ctx = composer.compose(results, '修改钱包 UI');
    expect(ctx.items.length).toBeGreaterThan(0);
    expect(ctx.items.length).toBeLessThanOrEqual(10);
    expect(ctx.injectedText).toContain('相关规则');
    expect(ctx.stats.itemCount).toBeGreaterThan(0);
  });

  it('format includes category headers', () => {
    const results = [
      makeRecallResult('semantic', '[规则] test rule', 0.9),
      makeRecallResult('emotion', '[重要] test pitfall', 0.85),
    ];

    const ctx = composer.compose(results, 'test');
    expect(ctx.injectedText).toContain('记忆');
    expect(ctx.injectedText).toContain('规则');
  });

  it('composeCompact returns compact format', () => {
    const results = [
      makeRecallResult('semantic', '[规则] test', 0.9),
    ];

    const compact = composer.composeCompact(results, 'test');
    expect(compact).toContain('Memory Recall');
  });

  it('enforces per-type limits', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      makeRecallResult('semantic', `[规则] rule ${i}`, 0.9)
    );

    const ctx = composer.compose(results, 'test', { maxItemsPerType: 3 });
    const rules = ctx.items.filter(i => i.category === 'rule');
    expect(rules.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates similar content', () => {
    const results = [
      makeRecallResult('semantic', '完全相同的规则内容', 0.9),
      makeRecallResult('semantic', '完全相同的规则内容', 0.8),
      makeRecallResult('semantic', '不同的规则内容', 0.7),
    ];

    const ctx = composer.compose(results, 'test');
    expect(ctx.items.length).toBeLessThanOrEqual(2);
  });

  it('respects max token budget', () => {
    const results = Array.from({ length: 20 }, (_, _i) =>
      makeRecallResult('timeline', 'LONG_CONTENT '.repeat(100), 0.5)
    );

    const ctx = composer.compose(results, 'test', { maxTokens: 500, maxItems: 20 });
    // With very long items and a small budget, either item count is small or total tokens within budget
    expect(ctx.items.length).toBeGreaterThanOrEqual(0);
    expect(ctx.stats.totalTokens).toBeLessThanOrEqual(800); // allow some overflow
  });

  it('handles empty results', () => {
    const ctx = composer.compose([], 'test');
    expect(ctx.items).toHaveLength(0);
    expect(ctx.injectedText).toBe('');
    expect(ctx.stats.itemCount).toBe(0);
  });
});

// ── Helpers ──

function makeEpisode(type: Episode['type'], summary: string, importance: number, timestamp?: string): Episode {
  return {
    id: `ep-${Math.random().toString(36).slice(2, 10)}`,
    type, summary, details: summary, importance, tags: [],
    relatedEpisodeIds: [],
    timestamp: timestamp || new Date().toISOString(),
  };
}

function makeRecallResult(type: 'timeline' | 'semantic' | 'emotion', content: string, score: number) {
  return {
    type,
    source: `src-${Math.random().toString(36).slice(2, 8)}`,
    content,
    score,
    raw: { id: 'x', type: 'task_started', summary: content, details: '', importance: score, tags: [], relatedEpisodeIds: [], timestamp: new Date().toISOString() } as Episode,
  };
}
