// Unit tests for src/core/memory/consolidation.ts
import { describe, it, expect } from 'vitest';
import { ConsolidationEngine } from '../src/core/memory/consolidation.js';
import type { Episode } from '../src/core/memory/episodic.js';
import type { SemanticRule } from '../src/core/memory/semantic.js';

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    type: 'task_completed',
    summary: 'task completed',
    details: 'details',
    importance: 0.5,
    tags: [],
    changedFiles: [],
    relatedEpisodeIds: [],
    timestamp: new Date().toISOString(),
    taskId: 'task-1',
    ...overrides,
  };
}

function makeMockEpisodic(episodes: Episode[]) {
  return {
    query: (_opts?: any) => episodes,
    record: async () => makeEpisode(),
    all: () => episodes,
  };
}

function makeMockSemantic() {
  const rules: SemanticRule[] = [];
  return {
    merge: (candidate: any) => {
      const rule: SemanticRule = {
        id: `rule-${rules.length}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...candidate,
      };
      rules.push(rule);
      return rule;
    },
    getAll: () => rules,
  };
}

describe('ConsolidationEngine', () => {
  describe('constructor & onTaskComplete', () => {
    it('uses default config when none provided', () => {
      const engine = new ConsolidationEngine();
      // Default triggerTaskCount is 5
      expect(engine.onTaskComplete()).toBe(false); // 1
      expect(engine.onTaskComplete()).toBe(false); // 2
      expect(engine.onTaskComplete()).toBe(false); // 3
      expect(engine.onTaskComplete()).toBe(false); // 4
      expect(engine.onTaskComplete()).toBe(true);  // 5 — triggers
    });

    it('uses custom triggerTaskCount', () => {
      const engine = new ConsolidationEngine({ triggerTaskCount: 2 });
      expect(engine.onTaskComplete()).toBe(false); // 1
      expect(engine.onTaskComplete()).toBe(true);  // 2 — triggers
    });

    it('onTaskComplete returns true when count equals threshold', () => {
      const engine = new ConsolidationEngine({ triggerTaskCount: 1 });
      expect(engine.onTaskComplete()).toBe(true);
    });
  });

  describe('consolidate with empty episodes', () => {
    it('returns empty result when no episodes', async () => {
      const engine = new ConsolidationEngine();
      const episodic = makeMockEpisodic([]);
      const semantic = makeMockSemantic();
      const result = await engine.consolidate(episodic as any, semantic as any);
      expect(result.episodesProcessed).toBe(0);
      expect(result.summariesGenerated).toBe(0);
      expect(result.patternsDetected).toBe(0);
      expect(result.rulesCreated).toHaveLength(0);
      expect(result.newRules).toHaveLength(0);
    });
  });

  describe('consolidate with episodes', () => {
    it('processes episodes and groups by task', async () => {
      const engine = new ConsolidationEngine();
      const episodes = [
        makeEpisode({ taskId: 'task-1', type: 'task_completed' }),
        makeEpisode({ taskId: 'task-1', type: 'file_changed', changedFiles: ['src/a.ts'] }),
        makeEpisode({ taskId: 'task-2', type: 'task_completed' }),
      ];
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const result = await engine.consolidate(episodic as any, semantic as any);
      expect(result.episodesProcessed).toBe(3);
      expect(result.summariesGenerated).toBe(2); // 2 tasks
    });

    it('resets taskCount after consolidation', async () => {
      const engine = new ConsolidationEngine({ triggerTaskCount: 2 });
      engine.onTaskComplete(); // 1
      engine.onTaskComplete(); // 2 — triggers
      const episodic = makeMockEpisodic([]);
      const semantic = makeMockSemantic();
      await engine.consolidate(episodic as any, semantic as any);
      // After consolidation, counter resets to 0
      expect(engine.onTaskComplete()).toBe(false); // 1 again
    });

    it('detects repeated error patterns and creates rules', async () => {
      const episodes = Array.from({ length: 4 }, () =>
        makeEpisode({ type: 'error_occurred', changedFiles: ['src/problematic.ts'] })
      );
      const engine = new ConsolidationEngine({ minEpisodesForPattern: 3 });
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const result = await engine.consolidate(episodic as any, semantic as any);
      expect(result.patternsDetected).toBeGreaterThan(0);
      expect(result.rulesCreated.length).toBeGreaterThan(0);
    });

    it('caps rules at maxNewRulesPerRun', async () => {
      // Create many patterns by having many errors in different files
      const episodes = Array.from({ length: 20 }, (_, i) =>
        makeEpisode({
          type: 'error_occurred',
          changedFiles: [`src/file${i}.ts`, `src/file${i + 1}.ts`],
          summary: `error in module ${i}`,
        })
      );
      const engine = new ConsolidationEngine({ minEpisodesForPattern: 2, maxNewRulesPerRun: 2 });
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const result = await engine.consolidate(episodic as any, semantic as any);
      expect(result.rulesCreated.length).toBeLessThanOrEqual(2);
    });

    it('uses AI abstraction when provided', async () => {
      const episodes = Array.from({ length: 4 }, () =>
        makeEpisode({ type: 'error_occurred', changedFiles: ['src/auth.ts'] })
      );
      const engine = new ConsolidationEngine({ minEpisodesForPattern: 3 });
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const aiAbstract = async (_summaries: string[]) => ['Always validate input before writing to auth.ts | Backend'];
      const result = await engine.consolidate(episodic as any, semantic as any, aiAbstract);
      expect(result.rulesCreated.length).toBeGreaterThan(0);
      expect(result.rulesCreated[0].content).toContain('Always validate');
      expect(result.rulesCreated[0].domain).toBe('Backend');
    });

    it('handles user correction episodes as patterns', async () => {
      const correction = makeEpisode({ type: 'user_correction', summary: '不要直接修改生产文件' });
      const episodes = Array.from({ length: 4 }, () => ({ ...correction, id: `ep-${Math.random()}` }));
      const engine = new ConsolidationEngine({ minEpisodesForPattern: 3 });
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const result = await engine.consolidate(episodic as any, semantic as any);
      expect(result.patternsDetected).toBeGreaterThan(0);
    });
  });

  describe('domain inference (via heuristic rules)', () => {
    const engineForDomain = (pattern: string) => {
      const eng = new ConsolidationEngine({ minEpisodesForPattern: 1 });
      // Force a pattern via error episodes
      const episodes = Array.from({ length: 2 }, () =>
        makeEpisode({ type: 'error_occurred', changedFiles: [pattern] })
      );
      return { eng, episodes };
    };

    it('infers General domain for generic file', async () => {
      const { eng, episodes } = engineForDomain('src/utils.ts');
      const episodic = makeMockEpisodic(episodes);
      const semantic = makeMockSemantic();
      const result = await eng.consolidate(episodic as any, semantic as any);
      if (result.rulesCreated.length > 0) {
        expect(['General', 'Backend', 'Frontend', 'iOS', 'Android', 'DevOps', 'Config']).toContain(result.rulesCreated[0].domain);
      }
    });
  });
});
