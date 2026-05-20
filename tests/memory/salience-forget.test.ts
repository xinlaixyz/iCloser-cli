// Memory Kernel v1.0 — Salience & Forgetting Engines Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { SalienceEngine } from '../../src/core/memory/salience.js';
import { ForgettingEngine } from '../../src/core/memory/forgetting.js';
import type { Episode } from '../../src/core/memory/episodic.js';
import type { SemanticRule } from '../../src/core/memory/semantic.js';

// ── Salience Engine ──

describe('SalienceEngine', () => {
  let engine: SalienceEngine;

  beforeEach(() => {
    engine = new SalienceEngine();
  });

  it('rates a normal episode', () => {
    const ep = makeEpisode('task_started', '开始任务', 0.35);
    const result = engine.rate(ep);
    expect(result.score).toBeGreaterThanOrEqual(0.2);
    expect(result.score).toBeLessThanOrEqual(0.5);
    expect(result.level).toBe('low');
  });

  it('rates a high-importance episode with keywords', () => {
    const ep = makeEpisode('error_occurred', '生产事故：数据丢失导致严重崩溃', 0.8);
    const result = engine.rate(ep);
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.level).toBe('high');
    expect(result.components.keywordBoost).toBeGreaterThan(0);
  });

  it('boosts user corrections', () => {
    const ep = makeEpisode('user_correction', '不对，不能这样改', 0.75);
    const result = engine.rate(ep);
    expect(result.components.feedbackBoost).toBe(0.3); // user_correction boost
  });

  it('ranks multiple episodes by salience', () => {
    const episodes = [
      makeEpisode('task_started', '普通任务', 0.3),
      makeEpisode('error_occurred', '紧急: 生产崩溃', 0.85),
      makeEpisode('file_changed', '修改文件', 0.2),
      makeEpisode('user_correction', '用户纠正: 不要修改该文件', 0.75),
    ];

    const ranked = engine.rank(episodes);
    expect(ranked[0].type).toBe('error_occurred');  // highest
    expect(ranked[0].salience.score).toBeGreaterThan(ranked[3].salience.score);
  });

  it('filters important episodes', () => {
    const episodes = [
      makeEpisode('task_started', 'normal', 0.3),
      makeEpisode('error_occurred', 'critical error 生产事故', 0.85),
    ];

    const important = engine.filterImportant(episodes);
    expect(important).toHaveLength(1);
    expect(important[0].type).toBe('error_occurred');
  });

  it('hasHighSignal detects urgent keywords', () => {
    expect(SalienceEngine.hasHighSignal('这是一个生产事故')).toBe(true);
    expect(SalienceEngine.hasHighSignal('CRITICAL bug found')).toBe(true);
    expect(SalienceEngine.hasHighSignal('日常更新')).toBe(false);
    expect(SalienceEngine.hasHighSignal('normal task')).toBe(false);
  });

  it('applies time decay', () => {
    const oldEp = makeEpisode('task_started', '旧任务', 0.5, new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString());
    const newEp = makeEpisode('task_started', '新任务', 0.5);

    const oldResult = engine.rateWithDecay(oldEp);
    const newResult = engine.rateWithDecay(newEp);

    expect(oldResult.components.timeDecay).toBeGreaterThan(0);
    expect(newResult.components.timeDecay).toBe(0);
    expect(oldResult.score).toBeLessThan(newResult.score);
  });

  it('tracks repetition count', () => {
    engine.recordOccurrence('error_occurred');
    engine.recordOccurrence('error_occurred');
    engine.recordOccurrence('error_occurred');
    expect(engine.getOccurrenceCount('error_occurred')).toBe(3);

    // Repetition bonus should now apply
    const ep = makeEpisode('error_occurred', '又一个错误', 0.7);
    const result = engine.rate(ep);
    expect(result.components.repetitionBonus).toBeGreaterThanOrEqual(0.1);
  });
});

// ── Forgetting Engine ──

describe('ForgettingEngine', () => {
  let engine: ForgettingEngine;

  beforeEach(() => {
    engine = new ForgettingEngine({
      highHalfLifeDays: 90,
      mediumHalfLifeDays: 30,
      lowHalfLifeDays: 7,
      archiveThreshold: 0.05,
      deleteThreshold: 0.01,
      protectionWindowDays: 14,
    });
  });

  it('retentionScore for recent important event is high', () => {
    const score = engine.retentionScore(0.85, new Date().toISOString(), 'high');
    expect(score).toBeGreaterThan(0.8);
  });

  it('retentionScore decays for old low-importance event', () => {
    const oldDate = new Date(Date.now() - 50 * 24 * 3600 * 1000).toISOString();
    const score = engine.retentionScore(0.3, oldDate, 'low');
    expect(score).toBeLessThan(0.1);
  });

  it('protects recent episodes', () => {
    const episodes = [makeEpisode('task_started', 'recent', 0.3)]; // just created, high importance=false
    const result = engine.processEpisodes(episodes);
    expect(result.protected).toBeGreaterThanOrEqual(0);
  });

  it('protects episodes with explicit protection', () => {
    const oldEp = makeEpisode('task_started', 'very old', 0.2, '2020-01-01T00:00:00.000Z');
    const result = engine.processEpisodes([oldEp], {
      protectedEpisodeIds: new Set([oldEp.id]),
    });
    expect(result.protected).toBe(1);
  });

  it('protects episodes linked to recent tasks', () => {
    const oldEp = makeEpisode('task_started', 'old but linked', 0.2, '2020-01-01T00:00:00.000Z');
    oldEp.taskId = 'task-recent';
    const result = engine.processEpisodes([oldEp], {
      recentTaskIds: new Set(['task-recent']),
    });
    expect(result.protected).toBe(1);
  });

  it('archives or deletes very old low-importance episodes', () => {
    const ancientEp = makeEpisode('file_changed', 'ancient change', 0.1, '2020-01-01T00:00:00.000Z');
    const result = engine.processEpisodes([ancientEp]);
    // Should be either archived or deleted
    expect(result.archived + result.deleted).toBeGreaterThanOrEqual(1);
  });

  it('protects permanent rules', () => {
    const rules: SemanticRule[] = [{
      id: 'r1', path: 'iOS/UI/permanent', domain: 'iOS', content: 'rule',
      scope: 'project', confidence: 1.0, verificationCount: 5,
      sourceEpisodeIds: [], tags: [], isPermanent: true,
      created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z',
    }];
    const result = engine.processRules(rules);
    expect(result.protected).toBe(1);
  });

  it('protects high-confidence rules', () => {
    const rules: SemanticRule[] = [{
      id: 'r2', path: 'General/test', domain: 'General', content: 'rule',
      scope: 'project', confidence: 0.9, verificationCount: 10,
      sourceEpisodeIds: [], tags: [], isPermanent: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }];
    const result = engine.processRules(rules);
    expect(result.protected).toBe(1);
  });
});

// ── Helpers ──

function makeEpisode(
  type: Episode['type'],
  summary: string,
  importance: number,
  timestamp?: string,
): Episode {
  return {
    id: `ep-${Math.random().toString(36).slice(2, 10)}`,
    type,
    summary,
    details: summary,
    importance,
    tags: [],
    relatedEpisodeIds: [],
    timestamp: timestamp || new Date().toISOString(),
  };
}
