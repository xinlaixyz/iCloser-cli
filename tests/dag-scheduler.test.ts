import { describe, expect, it } from 'vitest';
import { buildDAG, detectCycle, topologicalLevels, calculateParallelSavings } from '../src/core/dag-scheduler.js';
import type { PlanTask } from '../src/core/task-planner.js';

function t(seq: number, deps: number[] = []): PlanTask {
  return { id: String(seq), seq, title: `Task ${seq}`, description: '', files: [], dependencies: deps, estimated: '1h', status: 'pending' };
}

describe('dag-scheduler', () => {
  describe('detectCycle', () => {
    it('returns null for acyclic graph', () => {
      expect(detectCycle([t(1), t(2, [1]), t(3, [1, 2])])).toBeNull();
    });

    it('detects simple cycle', () => {
      expect(detectCycle([t(1, [2]), t(2, [1])])).not.toBeNull();
    });

    it('detects self-loop', () => {
      expect(detectCycle([t(1, [1])])).not.toBeNull();
    });

    it('handles empty list', () => {
      expect(detectCycle([])).toBeNull();
    });
  });

  describe('topologicalLevels', () => {
    it('returns levels for linear chain', () => {
      const levels = topologicalLevels([t(1), t(2, [1]), t(3, [2])]);
      expect(levels.length).toBe(3);
    });

    it('puts independent tasks in same level', () => {
      const levels = topologicalLevels([t(1), t(2), t(3, [1, 2])]);
      expect(levels.length).toBe(2);
      expect(levels[0].tasks.map(x => x.id).sort()).toEqual(['1', '2']);
    });
  });

  describe('buildDAG', () => {
    it('builds adjacency map', () => {
      const { taskMap } = buildDAG([t(1), t(2, [1])]);
      expect(taskMap.size).toBe(2);
    });
  });

  describe('calculateParallelSavings', () => {
    it('returns number >= 0', () => {
      const levels = topologicalLevels([t(1), t(2), t(3, [1, 2])]);
      expect(calculateParallelSavings(levels)).toBeGreaterThanOrEqual(0);
    });
  });
});
