// Unit tests for src/core/market-analysis.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMarketAnalysis } from '../src/core/market-analysis.js';
import type { MarketAnalysisOptions } from '../src/core/market-analysis.js';

vi.mock('../src/core/web-search.js', () => ({
  batchSearch: vi.fn(),
}));

vi.mock('../src/core/web-fetcher.js', () => ({
  fetchMultiple: vi.fn(),
}));

vi.mock('../src/core/tool-executor.js', () => ({
  buildToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/core/tool-loop.js', () => ({
  runToolLoop: vi.fn().mockResolvedValue({ finalResponse: 'AI report content', rounds: 2 }),
}));

import { batchSearch } from '../src/core/web-search.js';
import { fetchMultiple } from '../src/core/web-fetcher.js';

const mockSearch = vi.mocked(batchSearch);
const mockFetch = vi.mocked(fetchMultiple);

const FAKE_PROVIDER: any = { name: 'mock', chat: async () => ({ content: '', tokensUsed: 0 }) };

function makeOpts(overrides: Partial<MarketAnalysisOptions> = {}): MarketAnalysisOptions {
  return {
    topic: 'blockchain wallets',
    template: 'competitive',
    provider: FAKE_PROVIDER,
    rootPath: process.cwd(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch.mockResolvedValue([]);
  mockFetch.mockResolvedValue([]);
});

describe('runMarketAnalysis', () => {
  it('returns a report with expected shape', async () => {
    const result = await runMarketAnalysis(makeOpts());
    expect(result).toHaveProperty('topic', 'blockchain wallets');
    expect(result).toHaveProperty('template', 'competitive');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('sources');
    expect(result).toHaveProperty('stats');
  });

  it('returns early report when no search results found', async () => {
    mockSearch.mockResolvedValue([]);
    const result = await runMarketAnalysis(makeOpts());
    expect(result.content).toContain('未找到相关搜索结果');
    expect(result.stats.searchResults).toBe(0);
    expect(result.stats.pagesFetched).toBe(0);
    expect(result.sources).toHaveLength(0);
  });

  it('proceeds to fetch and AI analysis when search results exist', async () => {
    mockSearch.mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com', snippet: 'About wallets' },
      { title: 'Result 2', url: 'https://example2.com', snippet: 'More about wallets' },
    ]);
    mockFetch.mockResolvedValue([
      { page: { title: 'Example', url: 'https://example.com', content: 'Full content here', siteName: 'Example', publishedAt: '2026-01-01' } },
      { page: null },
    ]);

    const result = await runMarketAnalysis(makeOpts());
    expect(result.stats.searchResults).toBe(2);
    expect(result.stats.pagesFetched).toBe(2);
    expect(result.stats.pagesSucceeded).toBe(1);
    expect(result.stats.aiRounds).toBe(2);
    expect(result.content).toContain('AI report content');
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it('calls onProgress callbacks for each phase', async () => {
    mockSearch.mockResolvedValue([
      { title: 'R1', url: 'https://e.com', snippet: 'snippet' },
    ]);
    mockFetch.mockResolvedValue([
      { page: { title: 'E', url: 'https://e.com', content: 'text', siteName: 'E', publishedAt: null } },
    ]);

    const phases: string[] = [];
    await runMarketAnalysis(makeOpts({
      onProgress: (e) => phases.push(e.phase),
    }));

    expect(phases).toContain('search');
    expect(phases).toContain('fetch');
    expect(phases).toContain('analyze');
    expect(phases).toContain('report');
    expect(phases).toContain('done');
  });

  it('uses maxSources option to limit searches', async () => {
    mockSearch.mockResolvedValue([]);
    await runMarketAnalysis(makeOpts({ maxSources: 5 }));
    expect(mockSearch).toHaveBeenCalledWith('blockchain wallets', 5);
  });

  it('defaults maxSources to 15 when not specified', async () => {
    mockSearch.mockResolvedValue([]);
    await runMarketAnalysis(makeOpts());
    expect(mockSearch).toHaveBeenCalledWith('blockchain wallets', 15);
  });

  it('works with industry template', async () => {
    mockSearch.mockResolvedValue([]);
    const result = await runMarketAnalysis(makeOpts({ template: 'industry', topic: 'DeFi' }));
    expect(result.template).toBe('industry');
    expect(result.topic).toBe('DeFi');
  });

  it('works with tech-radar template', async () => {
    mockSearch.mockResolvedValue([]);
    const result = await runMarketAnalysis(makeOpts({ template: 'tech-radar', topic: 'Rust' }));
    expect(result.template).toBe('tech-radar');
  });

  it('works with swot template', async () => {
    mockSearch.mockResolvedValue([]);
    const result = await runMarketAnalysis(makeOpts({ template: 'swot', topic: 'OpenAI' }));
    expect(result.template).toBe('swot');
  });

  it('handles all fetches failing (succeeded empty)', async () => {
    mockSearch.mockResolvedValue([
      { title: 'R1', url: 'https://e.com', snippet: 'x' },
    ]);
    mockFetch.mockResolvedValue([
      { page: null },
    ]);

    const result = await runMarketAnalysis(makeOpts());
    expect(result.stats.pagesSucceeded).toBe(0);
    expect(result.content).toContain('AI report content');
  });

  it('includes sources from both fetched pages and remaining search results', async () => {
    const search = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i}`, url: `https://site${i}.com`, snippet: `snippet ${i}`,
    }));
    mockSearch.mockResolvedValue(search);
    mockFetch.mockResolvedValue([
      { page: { title: 'Site 0', url: 'https://site0.com', content: 'text', siteName: 'Site0', publishedAt: null } },
    ]);

    const result = await runMarketAnalysis(makeOpts());
    // 1 succeeded + 4 remaining search results
    expect(result.sources.length).toBe(5);
  });

  it('handles many search results (>10) — only fetches top 10', async () => {
    const search = Array.from({ length: 15 }, (_, i) => ({
      title: `R${i}`, url: `https://s${i}.com`, snippet: `s${i}`,
    }));
    mockSearch.mockResolvedValue(search);
    mockFetch.mockResolvedValue([]);

    await runMarketAnalysis(makeOpts());
    // fetchMultiple called with first 10 URLs
    expect(mockFetch).toHaveBeenCalledWith(
      expect.arrayContaining(['https://s0.com']),
      4,
      expect.any(Object),
    );
    const fetchCallArg = vi.mocked(mockFetch).mock.calls[0][0];
    expect(fetchCallArg).toHaveLength(10);
  });
});
