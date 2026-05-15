// Web Search — DuckDuckGo-based, zero API key required
// Falls back gracefully when network is unavailable

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  maxResults?: number;     // default 5
  language?: string;       // not used by DDG but reserved
  timeout?: number;        // default 5000ms
}

// Tiered cache: L1 (short TTL for fresh results) + L2 (long TTL as fallback)
const l1Cache = new Map<string, { results: WebSearchResult[]; expiresAt: number }>();
const l2Cache = new Map<string, { results: WebSearchResult[]; expiresAt: number }>();
const L1_TTL_MS = 60 * 60 * 1000;       // 1 hour — fresh results
const L2_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours — stale fallback
const MAX_CACHE_SIZE = 200;              // Prevent unbounded growth
let cacheHits = 0;
let cacheMisses = 0;

let _available: boolean | null = null;
let _lastCheck = 0;
const CHECK_INTERVAL_MS = 60_000; // re-check every 60s

export function isWebSearchAvailable(): boolean {
  const now = Date.now();
  if (_available !== null && now - _lastCheck < CHECK_INTERVAL_MS) return _available;
  // Will be set to true on first successful search, false on first failure
  // Initially optimistic — first search will determine
  return _available !== false;
}

function setAvailable(ok: boolean): void {
  _available = ok;
  _lastCheck = Date.now();
}

export function getWebSearchStatus(): 'available' | 'unavailable' | 'degraded' {
  if (isWebSearchAvailable()) return 'available';
  return (l1Cache.size > 0 || l2Cache.size > 0) ? 'degraded' : 'unavailable';
}

export function getCacheStats(): { l1Size: number; l2Size: number; hits: number; misses: number; hitRate: string } {
  const total = cacheHits + cacheMisses;
  return {
    l1Size: l1Cache.size,
    l2Size: l2Cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? `${Math.round((cacheHits / total) * 100)}%` : 'N/A',
  };
}

export function clearCache(): void { l1Cache.clear(); l2Cache.clear(); cacheHits = 0; cacheMisses = 0; }

export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const maxResults = options.maxResults || 5;
  const cacheKey = query.toLowerCase().trim();

  // L1 cache: fast, fresh
  const l1Cached = l1Cache.get(cacheKey);
  if (l1Cached && Date.now() < l1Cached.expiresAt) {
    cacheHits++;
    return l1Cached.results.slice(0, maxResults);
  }

  // L2 cache: stale but better than nothing
  const l2Cached = l2Cache.get(cacheKey);
  if (l2Cached && Date.now() < l2Cached.expiresAt) {
    cacheHits++;
    return l2Cached.results.slice(0, maxResults);
  }

  cacheMisses++;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as Record<string, unknown>;
    const results = extractResults(data, query);

    // Tiered caching
    l1Cache.set(cacheKey, { results, expiresAt: Date.now() + L1_TTL_MS });
    l2Cache.set(cacheKey, { results, expiresAt: Date.now() + L2_TTL_MS });

    // Cache cleanup: evict oldest if over limit
    if (l1Cache.size > MAX_CACHE_SIZE) {
      const oldest = [...l1Cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) { l1Cache.delete(oldest[0]); l2Cache.delete(oldest[0]); }
    }

    setAvailable(true);
    return results.slice(0, maxResults);
  } catch (err) {
    setAvailable(false);

    // Return L2 cached if available (better than nothing)
    if (l2Cached) return l2Cached.results.slice(0, maxResults);
    // Even check L1 even if expired — last resort
    if (l1Cached) return l1Cached.results.slice(0, maxResults);

    return [];
  }
}

function extractResults(data: Record<string, unknown>, query: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // Abstract (main answer box)
  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: (data.Heading as string) || query,
      url: data.AbstractURL as string,
      snippet: data.Abstract as string,
    });
  }

  // Related topics
  const related = data.RelatedTopics as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(related)) {
    for (const topic of related) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: (topic.Text as string).split(' - ')[0] || query,
          url: topic.FirstURL as string,
          snippet: topic.Text as string,
        });
      }
    }
  }

  // Results
  const rawResults = data.Results as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rawResults)) {
    for (const r of rawResults) {
      if (r.Text && r.FirstURL) {
        results.push({
          title: (r.Text as string).split(' - ')[0] || query,
          url: r.FirstURL as string,
          snippet: r.Text as string,
        });
      }
    }
  }

  return results;
}
