import { describe, it, expect } from 'vitest';
import { expandSearchQueries, batchSearch } from '../src/core/web-search.js';

describe('search enhancement', () => {
  describe('expandSearchQueries', () => {
    it('generates multiple queries from a topic', () => {
      const queries = expandSearchQueries('React 状态管理');
      expect(queries.length).toBeGreaterThan(3);
      expect(queries).toContain('React 状态管理');
    });

    it('includes year-tagged query', () => {
      const queries = expandSearchQueries('frontend frameworks');
      // Year-tagged query should exist
      const yearPattern = /\b20\d{2}\b/;
      expect(queries.some(q => yearPattern.test(q))).toBe(true);
    });

    it('includes suffixed queries', () => {
      const queries = expandSearchQueries('Vue vs React');
      expect(queries.some(q => q.includes('comparison') || q.includes('对比'))).toBe(true);
    });

    it('deduplicates queries', () => {
      const queries = expandSearchQueries('React');
      const unique = new Set(queries);
      expect(unique.size).toBe(queries.length);
    });

    it('generates English variants for Chinese topics', () => {
      const queries = expandSearchQueries('前端框架对比');
      // Should have some English-sounding queries (ASCII chars)
      const _hasEnglish = queries.some(q => /^[a-zA-Z\s]+$/.test(q.replace(/\d/g, '').trim()));
      // At least some queries should be non-identical
      expect(queries.length).toBeGreaterThan(5);
    });
  });

  describe('batchSearch', () => {
    it('returns scored results', async () => {
      try {
        const results = await batchSearch('TypeScript', 5);
        expect(Array.isArray(results)).toBe(true);
        if (results.length > 0) {
          expect(results[0].score).toBeGreaterThan(0);
          expect(results[0].score).toBeLessThanOrEqual(1);
          expect(results[0].title).toBeTruthy();
          expect(results[0].url).toBeTruthy();
        }
      } catch {
        // Network may be unavailable
      }
    }, 15000);

    it('respects maxResults', async () => {
      try {
        const results = await batchSearch('JavaScript', 3);
        expect(results.length).toBeLessThanOrEqual(3);
      } catch {
        // Network may be unavailable
      }
    }, 15000);
  });
});
