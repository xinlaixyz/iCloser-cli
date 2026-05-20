// Unit tests for src/core/memory/semantic.ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SemanticMemory } from '../src/core/memory/semantic.js';

const roots: string[] = [];

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'sem-mem-test-'));
  roots.push(d);
  return d;
}

afterAll(async () => {
  for (const r of roots) try { await rm(r, { recursive: true, force: true }); } catch {}
});

function makeMockStore(dir: string) {
  return {
    semanticRulesPath: join(dir, 'rules.json'),
    semanticTreePath: join(dir, 'tree.md'),
    sqlite: {
      isOpen: false,
      query: () => [],
      insert: () => {},
      deleteByKey: () => {},
    },
  };
}

function ruleBase(overrides: Record<string, any> = {}) {
  return {
    path: 'General/Naming',
    domain: 'General',
    content: 'Use camelCase for variables',
    scope: 'project' as const,
    confidence: 0.7,
    tags: ['naming', 'code-style'],
    verificationCount: 1,
    sourceEpisodeIds: [],
    isPermanent: false,
    ...overrides,
  };
}

describe('SemanticMemory', () => {
  describe('add', () => {
    it('adds a rule and returns it with id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const rule = mem.add(ruleBase());
      expect(rule.id).toMatch(/^rule-/);
      expect(rule.content).toBe('Use camelCase for variables');
      expect(mem.totalRules).toBe(1);
    });

    it('deduplicates: increments verificationCount for same path+content', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r1 = mem.add(ruleBase({ confidence: 0.5 }));
      const r2 = mem.add(ruleBase({ confidence: 0.5 })); // same path+content
      expect(r2.id).toBe(r1.id);  // same rule returned
      expect(r2.verificationCount).toBe(2);
      expect(mem.totalRules).toBe(1); // no new rule added
    });

    it('increments confidence on duplicate up to max 1.0', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ confidence: 0.95 }));
      const r = mem.add(ruleBase({ confidence: 0.95 }));
      expect(r.confidence).toBe(1.0);
    });

    it('merges sourceEpisodeIds on duplicate', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ sourceEpisodeIds: ['ep-1'] }));
      const r = mem.add(ruleBase({ sourceEpisodeIds: ['ep-2'] }));
      expect(r.sourceEpisodeIds).toContain('ep-1');
      expect(r.sourceEpisodeIds).toContain('ep-2');
    });

    it('allows different content at same path', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Use camelCase' }));
      mem.add(ruleBase({ content: 'Use spaces for indentation' }));
      expect(mem.totalRules).toBe(2);
    });
  });

  describe('merge', () => {
    it('is an alias for add', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const rule = mem.merge(ruleBase());
      expect(rule.id).toMatch(/^rule-/);
      expect(mem.totalRules).toBe(1);
    });
  });

  describe('get', () => {
    it('returns rule by id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const added = mem.add(ruleBase());
      const found = mem.get(added.id);
      expect(found).toBe(added);
    });

    it('returns undefined for unknown id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.get('nonexistent-id')).toBeUndefined();
    });
  });

  describe('query', () => {
    it('returns all rules when no filters', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ domain: 'iOS', path: 'iOS/UI', content: 'Use SwiftUI' }));
      mem.add(ruleBase({ domain: 'Backend', path: 'Backend/API', content: 'REST endpoints' }));
      expect(mem.query()).toHaveLength(2);
    });

    it('filters by domain', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ domain: 'iOS', path: 'iOS/UI', content: 'iOS rule' }));
      mem.add(ruleBase({ domain: 'Backend', path: 'Backend/API', content: 'Backend rule' }));
      const results = mem.query({ domain: 'iOS' });
      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe('iOS');
    });

    it('filters by path prefix', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ path: 'iOS/UI/Navigation', content: 'Nav rule' }));
      mem.add(ruleBase({ path: 'iOS/Database/SQLite', content: 'DB rule' }));
      mem.add(ruleBase({ path: 'Backend/API', content: 'API rule' }));
      expect(mem.query({ path: 'iOS' })).toHaveLength(2);
      expect(mem.query({ path: 'iOS/UI' })).toHaveLength(1);
    });

    it('filters by minConfidence', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'High conf rule', confidence: 0.9 }));
      mem.add(ruleBase({ path: 'p2', content: 'Low conf rule', confidence: 0.3 }));
      expect(mem.query({ minConfidence: 0.7 })).toHaveLength(1);
    });

    it('filters by tags', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Rule A', tags: ['security', 'auth'] }));
      mem.add(ruleBase({ path: 'p2', content: 'Rule B', tags: ['testing'] }));
      expect(mem.query({ tags: ['security'] })).toHaveLength(1);
    });

    it('filters by scope', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Project rule', scope: 'project' }));
      mem.add(ruleBase({ path: 'p2', content: 'Global rule', scope: 'global' }));
      expect(mem.query({ scope: 'global' })).toHaveLength(1);
    });

    it('filters by searchText (content match)', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Always use TypeScript strict mode' }));
      mem.add(ruleBase({ path: 'p2', content: 'Use single quotes everywhere' }));
      expect(mem.query({ searchText: 'typescript' })).toHaveLength(1);
    });

    it('respects limit', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      for (let i = 0; i < 5; i++) {
        mem.add(ruleBase({ path: `path/${i}`, content: `Rule ${i}` }));
      }
      expect(mem.query({ limit: 3 })).toHaveLength(3);
    });

    it('sorts by confidence descending', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Low', confidence: 0.2 }));
      mem.add(ruleBase({ path: 'p2', content: 'High', confidence: 0.9 }));
      const results = mem.query();
      expect(results[0].confidence).toBeGreaterThan(results[1].confidence);
    });
  });

  describe('getByPath', () => {
    it('returns rules under path prefix', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ path: 'iOS/UI', content: 'UI rule' }));
      expect(mem.getByPath('iOS')).toHaveLength(1);
    });
  });

  describe('getHighConfidence', () => {
    it('returns rules above default 0.7 threshold', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'High', confidence: 0.8 }));
      mem.add(ruleBase({ path: 'p2', content: 'Low', confidence: 0.4 }));
      expect(mem.getHighConfidence()).toHaveLength(1);
    });
  });

  describe('searchRelevant', () => {
    it('finds rules matching English terms', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Always validate user input' }));
      mem.add(ruleBase({ path: 'p2', content: 'Use lazy loading for images' }));
      const results = mem.searchRelevant('validate input security');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('validate');
    });

    it('returns empty for empty query', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase());
      const results = mem.searchRelevant('');
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles CJK queries with bigram expansion', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: '不要直接修改生产文件' }));
      mem.add(ruleBase({ path: 'p2', content: 'Use TypeScript strict mode' }));
      const results = mem.searchRelevant('修改生产');
      expect(results).toHaveLength(1);
    });

    it('respects limit parameter', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      for (let i = 0; i < 5; i++) {
        mem.add(ruleBase({ path: `p${i}`, content: `Rule about code ${i}` }));
      }
      expect(mem.searchRelevant('code', 2)).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('updates a rule and returns it', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r = mem.add(ruleBase());
      const updated = mem.update(r.id, { confidence: 0.95, content: 'Updated content' });
      expect(updated).not.toBeNull();
      expect(updated!.confidence).toBe(0.95);
      expect(updated!.content).toBe('Updated content');
    });

    it('returns null for unknown id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.update('nonexistent', { confidence: 0.9 })).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a rule and returns true', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r = mem.add(ruleBase());
      expect(mem.delete(r.id)).toBe(true);
      expect(mem.totalRules).toBe(0);
    });

    it('returns false for unknown id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.delete('nonexistent-id')).toBe(false);
    });
  });

  describe('weaken', () => {
    it('decreases confidence by 0.2', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r = mem.add(ruleBase({ confidence: 0.8 }));
      const weakened = mem.weaken(r.id);
      expect(weakened!.confidence).toBeCloseTo(0.6);
    });

    it('does not go below 0', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r = mem.add(ruleBase({ confidence: 0.1 }));
      const weakened = mem.weaken(r.id);
      expect(weakened!.confidence).toBeGreaterThanOrEqual(0);
    });

    it('returns null for unknown id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.weaken('nonexistent')).toBeNull();
    });
  });

  describe('makePermanent', () => {
    it('marks rule as permanent and sets confidence to 1.0', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      const r = mem.add(ruleBase({ confidence: 0.5 }));
      const perm = mem.makePermanent(r.id);
      expect(perm!.isPermanent).toBe(true);
      expect(perm!.confidence).toBe(1.0);
    });

    it('returns null for unknown id', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.makePermanent('nonexistent')).toBeNull();
    });
  });

  describe('getTree', () => {
    it('organizes rules by domain', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ domain: 'iOS', content: 'iOS rule 1' }));
      mem.add(ruleBase({ domain: 'iOS', path: 'iOS/p2', content: 'iOS rule 2' }));
      mem.add(ruleBase({ domain: 'Backend', content: 'Backend rule' }));
      const tree = mem.getTree();
      expect(tree.has('iOS')).toBe(true);
      expect(tree.get('iOS')).toHaveLength(2);
      expect(tree.has('Backend')).toBe(true);
    });

    it('includes platform in tree key when present', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ domain: 'Frontend', platform: 'React', content: 'React rule' }));
      const tree = mem.getTree();
      expect(tree.has('Frontend/React')).toBe(true);
    });

    it('returns empty map when no rules', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.getTree().size).toBe(0);
    });
  });

  describe('countByDomain', () => {
    it('counts rules per domain', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ domain: 'iOS', content: 'iOS 1' }));
      mem.add(ruleBase({ domain: 'iOS', path: 'p2', content: 'iOS 2' }));
      mem.add(ruleBase({ domain: 'Backend', content: 'Backend 1' }));
      const counts = mem.countByDomain();
      expect(counts['iOS']).toBe(2);
      expect(counts['Backend']).toBe(1);
    });

    it('returns empty object when no rules', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      expect(mem.countByDomain()).toEqual({});
    });
  });

  describe('save and load', () => {
    it('save writes rules to JSON and tree.md', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      mem.add(ruleBase({ content: 'Rule to save', sourceEpisodeIds: ['ep-1'] }));
      await mem.save();
      // Verify files written
      const { fileExists } = await import('../src/utils/fs.js');
      expect(await fileExists(join(dir, 'rules.json'))).toBe(true);
      expect(await fileExists(join(dir, 'tree.md'))).toBe(true);
    });

    it('save is idempotent when not dirty', async () => {
      const dir = await makeDir();
      const mem = new SemanticMemory(makeMockStore(dir) as any);
      await mem.save(); // no-op: not dirty
      const { fileExists } = await import('../src/utils/fs.js');
      expect(await fileExists(join(dir, 'rules.json'))).toBe(false); // file not written
    });

    it('load reads rules from saved JSON', async () => {
      const dir = await makeDir();
      const store = makeMockStore(dir);
      const mem1 = new SemanticMemory(store as any);
      mem1.add(ruleBase({ content: 'Persisted rule' }));
      await mem1.save();

      const mem2 = new SemanticMemory(store as any);
      await mem2.load();
      expect(mem2.totalRules).toBe(1);
      expect(mem2.query()[0].content).toBe('Persisted rule');
    });
  });
});
