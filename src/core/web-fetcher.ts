// Web Page Fetcher — fetch full page content and extract clean Markdown/plain text
// Zero external dependencies — uses built-in fetch (Node 18+) and regex heuristics

export interface FetchedPage {
  title: string;
  content: string;          // Markdown body text
  textContent: string;      // plain text (no markup)
  url: string;
  siteName?: string;
  publishedAt?: string;
  contentLength: number;
  cachedAt: string;
}

export interface FetchOptions {
  timeout?: number;          // default 10000ms
  maxContentLength?: number; // default 50000 chars
  userAgent?: string;
}

// Two-tier cache (same pattern as web-search.ts)
const l1Cache = new Map<string, { page: FetchedPage; expiresAt: number }>();
const l2Cache = new Map<string, { page: FetchedPage; expiresAt: number }>();
const L1_TTL_MS = 60 * 60 * 1000;       // 1 hour
const L2_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_CACHE_SIZE = 200;

export function getFetchCacheStats(): { l1Size: number; l2Size: number } {
  return { l1Size: l1Cache.size, l2Size: l2Cache.size };
}

export function clearFetchCache(): void { l1Cache.clear(); l2Cache.clear(); }

export async function fetchWebPage(url: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) throw new Error(`无效 URL: ${url}`);

  const cacheKey = normalizedUrl;

  // L1 cache check
  const l1 = l1Cache.get(cacheKey);
  if (l1 && Date.now() < l1.expiresAt) return l1.page;

  // L2 cache check
  const l2 = l2Cache.get(cacheKey);
  if (l2 && Date.now() < l2.expiresAt) return l2.page;

  const timeout = options.timeout ?? 10000;
  const maxLen = options.maxContentLength ?? 50000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`不支持的内容类型: ${contentType}`);
    }

    const html = await response.text();
    const page = extractPage(html, normalizedUrl, maxLen);

    // Tiered cache store
    l1Cache.set(cacheKey, { page, expiresAt: Date.now() + L1_TTL_MS });
    l2Cache.set(cacheKey, { page, expiresAt: Date.now() + L2_TTL_MS });
    evictIfNeeded();

    return page;
  } catch (err) {
    clearTimeout(timer);
    // Fall back to L2 expired but still better than nothing
    if (l2) return l2.page;
    if (l1) return l1.page;
    throw err;
  }
}

export async function fetchMultiple(
  urls: string[],
  concurrency = 4,
  options?: FetchOptions,
): Promise<{ url: string; page?: FetchedPage; error?: string }[]> {
  const results: { url: string; page?: FetchedPage; error?: string }[] = [];
  const queue = [...urls];
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const url = queue[i];
      try {
        const page = await fetchWebPage(url, options);
        results[i] = { url, page };
      } catch (err) {
        results[i] = { url, error: (err as Error).message };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}

// ── HTML → Markdown extraction ──

function extractPage(html: string, url: string, maxLength: number): FetchedPage {
  const title = extractTitle(html);
  const _metaDesc = extractMeta(html, 'description');
  const publishedAt = extractMeta(html, 'article:published_time') ||
                      extractMeta(html, 'date') ||
                      undefined;

  // Strip unwanted elements
  let cleaned = html;
  cleaned = stripTags(cleaned, ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'object', 'embed']);
  cleaned = stripTagByClass(cleaned, ['nav', 'footer', 'header', 'aside', 'form'], []);
  cleaned = stripComments(cleaned);

  // Extract body
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : cleaned;

  // Convert to markdown
  let markdown = htmlToMarkdown(bodyHtml);

  // Trim and limit — avoid cutting mid-word/mid-link
  if (markdown.length > maxLength) {
    const cutPoint = findSafeCutPoint(markdown, maxLength);
    markdown = markdown.slice(0, cutPoint) + '\n\n... (内容已截断)';
  }

  const textContent = markdown
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>|-]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Build site name from URL
  let siteName: string | undefined;
  try {
    const u = new URL(url);
    siteName = u.hostname.replace(/^www\./, '');
  } catch {}

  return {
    title,
    content: markdown.trim() || title,
    textContent: textContent || title,
    url,
    siteName,
    publishedAt,
    contentLength: markdown.length,
    cachedAt: new Date().toISOString(),
  };
}

function stripTags(html: string, tags: string[]): string {
  for (const tag of tags) {
    html = html.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}[^>]*\\/>`, 'gi'), '');
  }
  return html;
}

function stripTagByClass(html: string, tags: string[], _classes: string[]): string {
  // P0-4: depth-based removal for tags that may nest (nav, div, section, etc.)
  // The regex approach works for void-like tags (script, style) but not for
  // block-level tags that can contain children of the same type.
  for (const tag of tags) {
    const openRe = new RegExp(`<${tag}[^>]*>`, 'gi');
    const closeRe = new RegExp(`<\\/${tag}>`, 'gi');

    // Find all open/close positions
    const events: Array<{ pos: number; type: 'open' | 'close' }> = [];
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(html)) !== null) {
      events.push({ pos: m.index, type: 'open' });
    }
    while ((m = closeRe.exec(html)) !== null) {
      events.push({ pos: m.index + m[0].length, type: 'close' });
    }
    events.sort((a, b) => a.pos - b.pos);

    // Find top-level tag regions to remove
    const regions: Array<{ start: number; end: number }> = [];
    let depth = 0;
    let regionStart = 0;
    for (const ev of events) {
      if (ev.type === 'open') {
        if (depth === 0) regionStart = ev.pos;
        depth++;
      } else {
        depth--;
        if (depth === 0) regions.push({ start: regionStart, end: ev.pos });
      }
    }

    // Remove from end to start to preserve indices
    let result = html;
    for (let i = regions.length - 1; i >= 0; i--) {
      result = result.slice(0, regions[i].start) + result.slice(regions[i].end);
    }
    html = result;
  }
  return html;
}

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return decodeEntities(m[1].trim()).slice(0, 200);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripAllTags(h1[1].trim()).slice(0, 200);
  return '(无标题)';
}

function extractMeta(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`<meta\\s+property=["']${name}["']\\s+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+property=["']${name}["']`, 'i'),
    new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+name=["']${name}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].slice(0, 300);
  }
  return undefined;
}

function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove remaining tags except content-bearing ones
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<\/div>/gi, '\n');
  md = md.replace(/<\/li>/gi, '\n');
  md = md.replace(/<\/h[1-6]>/gi, '\n\n');
  md = md.replace(/<\/blockquote>/gi, '\n\n');
  md = md.replace(/<\/pre>/gi, '\n\n');
  md = md.replace(/<\/code>/gi, '`');
  md = md.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // h1-h6
  md = md.replace(/<h1[^>]*>/gi, '\n\n# ');
  md = md.replace(/<h2[^>]*>/gi, '\n\n## ');
  md = md.replace(/<h3[^>]*>/gi, '\n\n### ');
  md = md.replace(/<h4[^>]*>/gi, '\n\n#### ');
  md = md.replace(/<h5[^>]*>/gi, '\n\n##### ');
  md = md.replace(/<h6[^>]*>/gi, '\n\n###### ');

  // bold, italic
  md = md.replace(/<strong[^>]*>/gi, '**');
  md = md.replace(/<\/strong>/gi, '**');
  md = md.replace(/<b[^>]*>/gi, '**');
  md = md.replace(/<\/b>/gi, '**');
  md = md.replace(/<em[^>]*>/gi, '*');
  md = md.replace(/<\/em>/gi, '*');
  md = md.replace(/<i[^>]*>/gi, '*');
  md = md.replace(/<\/i>/gi, '*');

  // code
  md = md.replace(/<code[^>]*>/gi, '`');
  md = md.replace(/<pre[^>]*>/gi, '\n\n```\n');
  md = md.replace(/<\/pre>/gi, '\n```\n\n');

  // links: <a href="...">text</a> → [text](href)
  md = md.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const cleanText = stripAllTags(text).trim();
    if (!cleanText) return '';
    return `[${cleanText}](${href})`;
  });

  // images: <img src="..." alt="..."> → ![alt](src)
  md = md.replace(/<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![$1]($2)');

  // list items
  md = md.replace(/<li[^>]*>/gi, '\n- ');

  // blockquote
  md = md.replace(/<blockquote[^>]*>/gi, '\n\n> ');

  // strip all remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // decode entities
  md = decodeEntities(md);

  // clean up whitespace
  md = md.replace(/[ \t]+/g, ' ');
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/^\s+|\s+$/gm, '');

  return md;
}

function stripAllTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&copy;': '©',
    '&reg;': '®', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
    '&lsquo;': '‘', '&rsquo;': '’', '&ldquo;': '“', '&rdquo;': '”',
    '&#x27;': "'",
  };
  return text.replace(/&[#\w]+;/g, (m) => entities[m] || m);
}

function findSafeCutPoint(text: string, maxLen: number): number {
  // Try to cut at paragraph boundary, or at least at a word boundary
  const nearby = text.slice(Math.max(0, maxLen - 200), maxLen);
  const paraBreak = nearby.lastIndexOf('\n\n');
  if (paraBreak !== -1) return maxLen - 200 + paraBreak;
  const lineBreak = nearby.lastIndexOf('\n');
  if (lineBreak !== -1) return maxLen - 200 + lineBreak;
  const space = nearby.lastIndexOf(' ');
  if (space !== -1) return maxLen - 200 + space;
  return maxLen;
}

function normalizeUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    return u.href;
  } catch {
    return null;
  }
}

function evictIfNeeded(): void {
  if (l1Cache.size > MAX_CACHE_SIZE) {
    const oldest = [...l1Cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) { l1Cache.delete(oldest[0]); l2Cache.delete(oldest[0]); }
  }
}
