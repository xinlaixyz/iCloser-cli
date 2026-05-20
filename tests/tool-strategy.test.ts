// P4-3: Tool strategy mapping tests
import { describe, it, expect } from 'vitest';
import type { UserIntentCategory } from '../src/types.js';

describe('getStrategyForIntent (P1-1)', () => {
  it('returns a valid strategy for every intent category', async () => {
    const { getAllStrategies } = await import('../src/core/tool-strategy.js');
    const strategies = getAllStrategies();

    expect(strategies.length).toBeGreaterThanOrEqual(14);

    const categories: UserIntentCategory[] = [
      'analysis', 'code_change', 'code_fix', 'code_complete', 'plan',
      'security_review', 'refactor', 'test_gen', 'doc_gen', 'devops',
      'pm', 'question', 'config', 'chat', 'unknown',
    ];

    for (const cat of categories) {
      const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
      const strategy = getStrategyForIntent(cat);
      expect(strategy).toBeDefined();
      expect(strategy.intent).toBe(cat);
      expect(strategy.guidance).toBeTruthy();
    }
  });

  it('returns UNKNOWN_STRATEGY for unknown intent', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('unknown');
    expect(strategy.intent).toBe('unknown');
  });

  it('analysis strategy has at least 3 tool steps', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('analysis');
    expect(strategy.steps.length).toBeGreaterThanOrEqual(3);
    // Must include read_file step
    expect(strategy.steps.some(s => s.tool === 'read_file')).toBe(true);
    // Must include search_code step
    expect(strategy.steps.some(s => s.tool === 'search_code')).toBe(true);
  });

  it('code_change strategy emphasizes reading before writing', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('code_change');
    // First step should be read_file
    expect(strategy.steps[0].tool).toBe('read_file');
    expect(strategy.guidance).toContain('读');
  });

  it('code_fix strategy has run_command as first step', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('code_fix');
    expect(strategy.steps[0].tool).toBe('run_command');
  });

  it('security_review strategy does not include file writing steps', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('security_review');
    // All steps should be read-only tools
    const readOnlyTools = ['read_file', 'search_code', 'code_intel', 'web_search', 'git_status'];
    expect(strategy.steps.every(s => readOnlyTools.includes(s.tool))).toBe(true);
  });

  it('chat strategy has no tool steps (conversation only)', async () => {
    const { getStrategyForIntent } = await import('../src/core/tool-strategy.js');
    const strategy = getStrategyForIntent('chat');
    expect(strategy.steps).toEqual([]);
  });

  it('buildStrategyGuidance produces non-empty string', async () => {
    const { buildStrategyGuidance } = await import('../src/core/tool-strategy.js');
    const guidance = buildStrategyGuidance('analysis');
    expect(guidance.length).toBeGreaterThan(50);
    expect(guidance).toContain('read_file');
    expect(guidance).toContain('search_code');
  });

  it('buildStrategyGuidance for unknown produces useful guidance', async () => {
    const { buildStrategyGuidance } = await import('../src/core/tool-strategy.js');
    const guidance = buildStrategyGuidance('unknown');
    expect(guidance.length).toBeGreaterThan(20);
    expect(guidance).toContain('read_file');
  });

  it('all strategy steps have description and tool name', async () => {
    const { getAllStrategies } = await import('../src/core/tool-strategy.js');
    const strategies = getAllStrategies();
    for (const s of strategies) {
      for (const step of s.steps) {
        expect(step.tool).toBeTruthy();
        expect(step.description).toBeTruthy();
      }
    }
  });

  it('all strategies provide guidance text', async () => {
    const { getAllStrategies } = await import('../src/core/tool-strategy.js');
    const strategies = getAllStrategies();
    for (const s of strategies) {
      expect(s.guidance).toBeTruthy();
      expect(s.guidance.length).toBeGreaterThan(5);
    }
  });
});
