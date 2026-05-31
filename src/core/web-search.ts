// Web Search — DuckDuckGo primary, zero API key required.
// Fallback chain: DDG JSON API → DDG HTML scraping → L1 cache → L2 cache → disk cache.
// Disk cache survives restarts; in-memory L1/L2 for speed.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  maxResults?: number;     // default 5
  language?: string;       // not used by DDG but reserved
  timeout?: number;        // default 5000ms
  rootPath?: string;       // project root for disk cache persistence
}

// Tiered cache: L1 (short TTL) + L2 (long TTL) + disk (survives restart)
const l1Cache = new Map<string, { results: WebSearchResult[]; expiresAt: number }>();
const l2Cache = new Map<string, { results: WebSearchResult[]; expiresAt: number }>();
const L1_TTL_MS = 60 * 60 * 1000;       // 1 hour — fresh results
const L2_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours — stale fallback
const MAX_CACHE_SIZE = 200;              // Prevent unbounded growth
let cacheHits = 0;
let cacheMisses = 0;
let _diskCacheLoaded = false;

// ── Disk cache persistence (survives process restart) ──
const DISK_CACHE_FILE = '.icloser/web-cache.json';

async function loadDiskCache(rootPath?: string): Promise<void> {
  if (_diskCacheLoaded) return;
  _diskCacheLoaded = true;
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const cachePath = rootPath ? path.join(rootPath, DISK_CACHE_FILE) : DISK_CACHE_FILE;
    const raw = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(raw) as { key: string; results: WebSearchResult[]; expiresAt: number }[];
    const now = Date.now();
    for (const entry of data) {
      if (entry.expiresAt > now && entry.results?.length > 0) {
        l2Cache.set(entry.key, { results: entry.results, expiresAt: entry.expiresAt });
      }
    }
  } catch { /* no disk cache yet — ok */ }
}

async function saveDiskCache(rootPath?: string): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const cachePath = rootPath ? path.join(rootPath, DISK_CACHE_FILE) : DISK_CACHE_FILE;
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const entries = [...l2Cache.entries()].map(([key, v]) => ({ key, results: v.results, expiresAt: v.expiresAt }));
    await fs.writeFile(cachePath, JSON.stringify(entries), 'utf-8');
  } catch { /* disk cache write failure non-blocking */ }
}

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
  // Lazy-load disk cache on first search (keyed by rootPath)
  if (!_diskCacheLoaded) await loadDiskCache(options.rootPath);

  let results: WebSearchResult[] = [];

  // Primary: DDG JSON API (fast, structured)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      results = extractResults(data, query);
    }
  } catch { /* DDG JSON failed — try HTML fallback */ }

  // Fallback: DDG HTML scraping (zero API key, works behind most proxies)
  if (results.length === 0) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), (options.timeout || 5000) * 1.5);
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const resp = await fetch(htmlUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'icloser-Agent-Shell/0.1' },
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const html = await resp.text();
        results = extractHtmlResults(html);
      }
    } catch { /* HTML fallback also failed */ }
  }

  // If we got results, cache them
  if (results.length > 0) {
    l1Cache.set(cacheKey, { results, expiresAt: Date.now() + L1_TTL_MS });
    l2Cache.set(cacheKey, { results, expiresAt: Date.now() + L2_TTL_MS });
    saveDiskCache(options.rootPath).catch(() => {});

    if (l1Cache.size > MAX_CACHE_SIZE) {
      const oldest = [...l1Cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) { l1Cache.delete(oldest[0]); l2Cache.delete(oldest[0]); }
    }

    setAvailable(true);
    return results.slice(0, maxResults);
  }

  // All backends failed — return cached fallback
  setAvailable(false);
  if (l2Cached) return l2Cached.results.slice(0, maxResults);
  if (l1Cached) return l1Cached.results.slice(0, maxResults);
  return [];
}

// ── Multi-keyword parallel search with topic expansion ──

export interface ScoredResult extends WebSearchResult {
  score: number; // 0-1 relevance
}

export function expandSearchQueries(topic: string): string[] {
  const queries: string[] = [topic];

  // Year-tagged (high priority, insert early)
  const year = new Date().getFullYear();
  queries.push(`${topic} ${year}`);

  // "best" prefix
  queries.push(`best ${topic}`);

  // Suffix variations
  const suffixes = [
    'comparison', 'vs', 'alternatives', 'market share',
    'trends', 'analysis', 'review', 'best practices',
    '对比', '分析', '排名', '推荐',
  ];

  for (const suffix of suffixes) {
    queries.push(`${topic} ${suffix}`);
  }

  // Bilingual: if Chinese, add English; if English, add Chinese
  const hasChinese = /[一-鿿]/.test(topic);
  if (hasChinese) {
    // Try English variants of core keywords
    const enHints = extractEnglishKeywords(topic);
    for (const en of enHints) {
      queries.push(`${en} comparison ${year}`);
      queries.push(`${en} market analysis`);
    }
  } else {
    queries.push(`${topic} 市场分析`);
    queries.push(`${topic} 最新动态`);
  }

  return [...new Set(queries)].slice(0, 12);
}

function extractEnglishKeywords(chineseTopic: string): string[] {
  const map: Array<[RegExp, string]> = [
    [/react/i, 'React'],
    [/vue/i, 'Vue'],
    [/angular/i, 'Angular'],
    [/node/i, 'Node.js'],
    [/python/i, 'Python'],
    [/rust/i, 'Rust'],
    [/golang|go/i, 'Golang'],
    [/前端/i, 'frontend'],
    [/后端/i, 'backend'],
    [/框架/i, 'framework'],
    [/数据库/i, 'database'],
    [/云/i, 'cloud'],
    [/ai|人工智能/i, 'AI'],
    [/大模型/i, 'LLM'],
    [/微服务/i, 'microservices'],
    [/容器/i, 'container'],
    [/安全/i, 'security'],
    [/测试/i, 'testing'],
    [/api/i, 'API'],
    [/架构/i, 'architecture'],
    [/移动/i, 'mobile'],
    [/桌面/i, 'desktop'],
    [/开源/i, 'open source'],
    [/工具/i, 'tool'],
    [/库/i, 'library'],
    [/平台/i, 'platform'],
    [/服务/i, 'service'],
  ];
  const results: string[] = [];
  for (const [re, en] of map) {
    if (re.test(chineseTopic)) {
      // Extract surrounding context
      const clean = chineseTopic.replace(/[？！。，、\s]+/g, ' ').trim();
      results.push(clean.replace(re, en));
    }
  }
  return results.slice(0, 4);
}

export async function batchSearch(
  topic: string,
  maxResults = 15,
): Promise<ScoredResult[]> {
  const queries = expandSearchQueries(topic);
  const allResults: ScoredResult[] = [];
  const seenUrls = new Set<string>();

  // P2-10: Fire all searches in parallel — DDG handles rate limiting naturally
  const searchPromises = queries.map(q =>
    searchWeb(q, { maxResults: 5 }).catch(() => [] as WebSearchResult[])
  );
  const allBatches = await Promise.all(searchPromises);

  for (const batch of allBatches) {
    for (const r of batch) {
      const normalized = r.url.toLowerCase().replace(/\/+$/, '');
      if (seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);
      const score = computeRelevanceScore(topic, r);
      allResults.push({ ...r, score });
    }
  }

  // Sort by score descending, take top
  return allResults
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

function computeRelevanceScore(topic: string, result: WebSearchResult): number {
  const topicTokens = topic
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(t => t.length >= 2);

  if (topicTokens.length === 0) return 0.5;

  const text = `${result.title} ${result.snippet}`.toLowerCase();
  let hits = 0;
  for (const token of topicTokens) {
    if (text.includes(token)) hits++;
  }

  // Bonus: title match
  const titleLower = result.title.toLowerCase();
  for (const token of topicTokens) {
    if (titleLower.includes(token)) hits += 0.5;
  }

  return Math.min(1, hits / topicTokens.length);
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

// DDG HTML links are protocol-relative redirect wrappers
// (`//duckduckgo.com/l/?uddg=<encoded-target>&rut=...`). Unwrap them to the
// real absolute target URL so callers get a usable https?:// link.
function resolveDdgUrl(href: string): string {
  let u = href.trim();
  if (u.startsWith('//')) u = `https:${u}`;
  try {
    const parsed = new URL(u, 'https://duckduckgo.com');
    if (parsed.pathname.endsWith('/l/') && parsed.searchParams.has('uddg')) {
      return parsed.searchParams.get('uddg') as string; // already percent-decoded
    }
    return parsed.toString();
  } catch {
    return u;
  }
}

// Extract results from DuckDuckGo HTML page (fallback when JSON API fails)
function extractHtmlResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  // Match DDG HTML result blocks: <a class="result__a" href="URL">Title</a> + <a class="result__snippet">Snippet</a>
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/gi;

  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push({ url: resolveDdgUrl(m[1]), title: m[2].replace(/<[^>]+>/g, '').trim() });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < Math.min(links.length, snippets.length, 8); i++) {
    results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] });
  }

  // Fallback: broader pattern for older DDG HTML layout
  if (results.length === 0) {
    const broadLinkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi;
    while ((m = broadLinkRegex.exec(html)) !== null) {
      results.push({ title: m[2].replace(/<[^>]+>/g, '').trim(), url: resolveDdgUrl(m[1]), snippet: '' });
    }
  }

  return results.slice(0, 8);
}
