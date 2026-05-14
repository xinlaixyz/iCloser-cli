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

// In-memory cache: query → { results, expiresAt }
const cache = new Map<string, { results: WebSearchResult[]; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  // Check if we have any cached results — if so, degraded, not unavailable
  return cache.size > 0 ? 'degraded' : 'unavailable';
}

export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const maxResults = options.maxResults || 5;
  const cacheKey = query.toLowerCase().trim();

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.results.slice(0, maxResults);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as Record<string, unknown>;
    const results = extractResults(data, query);

    // Cache
    cache.set(cacheKey, { results, expiresAt: Date.now() + CACHE_TTL_MS });

    // Mark as available
    setAvailable(true);

    return results.slice(0, maxResults);
  } catch (err) {
    setAvailable(false);

    // Return cached if available (even if expired — better than nothing)
    if (cached) return cached.results.slice(0, maxResults);

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
