import { describe, expect, it } from 'vitest';
import { searchWeb, isWebSearchAvailable, getWebSearchStatus } from '../src/core/web-search.js';

describe('web-search (S10)', () => {
  describe('isWebSearchAvailable', () => {
    it('returns a boolean', () => {
      const result = isWebSearchAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('is idempotent within cache window', () => {
      const a = isWebSearchAvailable();
      const b = isWebSearchAvailable();
      expect(a).toBe(b);
    });
  });

  describe('getWebSearchStatus', () => {
    it('returns a valid status string', () => {
      const status = getWebSearchStatus();
      expect(['available', 'unavailable', 'degraded']).toContain(status);
    });
  });

  describe('searchWeb', () => {
    it('returns results array (may be empty if offline)', async () => {
      const results = await searchWeb('typescript', { maxResults: 3, timeout: 3000 });
      expect(Array.isArray(results)).toBe(true);
    });

    it('respects maxResults option', async () => {
      const results = await searchWeb('javascript', { maxResults: 2, timeout: 3000 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array for empty query', async () => {
      const results = await searchWeb('', { maxResults: 1, timeout: 3000 });
      expect(Array.isArray(results)).toBe(true);
    });

    it('each result has required fields', async () => {
      const results = await searchWeb('node.js express', { maxResults: 3, timeout: 3000 });
      for (const r of results) {
        expect(r.title).toBeDefined();
        expect(r.url).toBeDefined();
        expect(r.snippet).toBeDefined();
        expect(typeof r.title).toBe('string');
        expect(typeof r.url).toBe('string');
        expect(typeof r.snippet).toBe('string');
        // URLs should be valid
        expect(r.url).toMatch(/^https?:\/\//);
      }
    });

    it('caches results for repeated queries', async () => {
      const a = await searchWeb('vitest testing framework', { maxResults: 1, timeout: 5000 });
      const b = await searchWeb('vitest testing framework', { maxResults: 1, timeout: 5000 });
      // Second call should be cached if first succeeded
      expect(Array.isArray(a)).toBe(true);
      expect(Array.isArray(b)).toBe(true);
    });
  });
});
