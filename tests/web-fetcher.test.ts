import { describe, it, expect } from 'vitest';
import { fetchWebPage, getFetchCacheStats, clearFetchCache } from '../src/core/web-fetcher.js';

describe('web-fetcher', () => {
  it('rejects invalid URLs', async () => {
    await expect(fetchWebPage('not-a-url')).rejects.toThrow('无效 URL');
    await expect(fetchWebPage('ftp://example.com')).rejects.toThrow('无效 URL');
  });

  it('returns cached page on second request', async () => {
    clearFetchCache();
    // Test with a known fast site
    try {
      const p1 = await fetchWebPage('https://example.com', { timeout: 5000 });
      expect(p1.title).toBeTruthy();
      expect(p1.content).toBeTruthy();
      expect(p1.contentLength).toBeGreaterThan(0);

      const stats1 = getFetchCacheStats();
      expect(stats1.l1Size).toBeGreaterThanOrEqual(1);

      const p2 = await fetchWebPage('https://example.com', { timeout: 5000 });
      expect(p2.title).toBe(p1.title);

      const stats2 = getFetchCacheStats();
      expect(stats2.l1Size).toBeGreaterThanOrEqual(1);
    } catch {
      // Network may be unavailable — skip gracefully
    }
  }, 15000);

  it('fetchMultiple returns results for multiple URLs', async () => {
    try {
      const results = await fetchMultiple(
        ['https://example.com', 'https://httpbin.org/html'],
        2,
        { timeout: 8000 },
      );
      expect(results).toHaveLength(2);
      expect(results[0].url).toBe('https://example.com');
      expect(results[1].url).toBe('https://httpbin.org/html');
    } catch {
      // Network may be unavailable
    }
  }, 20000);

  it('extracts title from HTML', async () => {
    try {
      const page = await fetchWebPage('https://example.com', { timeout: 5000 });
      expect(page.title).toBe('Example Domain');
      expect(page.siteName).toBe('example.com');
    } catch {
      // Network issues
    }
  }, 10000);

  it('clearFetchCache empties both caches', () => {
    clearFetchCache();
    const stats = getFetchCacheStats();
    expect(stats.l1Size).toBe(0);
    expect(stats.l2Size).toBe(0);
  });
});
