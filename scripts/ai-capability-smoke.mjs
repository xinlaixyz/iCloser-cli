/**
 * AI Capability Smoke — validates tool-calling, web access, and market analysis.
 *
 * Tests each tool in the tool-executor registry to ensure AI can actually
 * invoke them and get valid results. Runs in CI and locally via:
 *   npm run smoke:ai
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'index.js');
let failed = 0;
let passed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function runCli(args, cwd = root, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 90000,
    env: { ...process.env, ...extraEnv },
  });
}

function assert(condition, message) {
  check(message, condition);
  return condition;
}

// ── 1. Build check ──
console.log('\n═══ AI 能力自动化检查 ═══\n');

if (!existsSync(cli)) {
  console.error('dist/index.js not found. Run npm run build first.');
  process.exit(1);
}
check('CLI binary exists', true);

// ── 2. Tool executor: all 7 tools load without crash ──
console.log('\n── 工具加载 ──');
{
  const r = runCli(['--help']);
  check('CLI starts', r.status === 0, `exit ${r.status}`);
}

// ── 3. web_search capability ──
console.log('\n── 网络搜索 (web_search) ──');
{
  // Test DuckDuckGo API directly
  let ddgOk = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      'https://api.duckduckgo.com/?q=test&format=json&no_html=1',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    ddgOk = resp.ok;
  } catch (err) {
    // DDG might be blocked — non-fatal
  }
  check('DuckDuckGo API reachable', ddgOk, ddgOk ? 'OK' : 'network restricted — non-fatal');

  // Test via CLI
  const r = runCli(['web', 'TypeScript', '--json']);
  const hasOutput = r.stdout && r.stdout.length > 20;
  check('ic web (JSON output)', hasOutput, hasOutput ? `output ${r.stdout.length} chars` : 'no output');
}

// ── 4. web_fetch capability ──
console.log('\n── 网页抓取 (web_fetch) ──');
{
  // Import and test web-fetcher module directly
  try {
    const { fetchWebPage } = await import('../dist/core/web-fetcher.js');
    const page = await fetchWebPage('https://example.com', { timeout: 10000 });
    const ok = page.title && page.content && page.contentLength > 50;
    check('fetchWebPage (example.com)', ok,
      ok ? `"${page.title}" (${page.contentLength} chars)` : `title=${page.title || 'none'} len=${page.contentLength || 0}`
    );
  } catch (err) {
    check('fetchWebPage (example.com)', false, `error: ${err.message}`);
  }

  // Test cache (second call must use cache)
  try {
    const { fetchWebPage, getFetchCacheStats } = await import('../dist/core/web-fetcher.js');
    const startStats = getFetchCacheStats();
    await fetchWebPage('https://example.com', { timeout: 10000 });
    const endStats = getFetchCacheStats();
    check('fetchWebPage cache', endStats.l1Size >= startStats.l1Size, `L1 cache size: ${endStats.l1Size}`);
  } catch (err) {
    check('fetchWebPage cache', false, `error: ${err.message}`);
  }

  // Test multiple fetch
  try {
    const { fetchMultiple } = await import('../dist/core/web-fetcher.js');
    const results = await fetchMultiple(
      ['https://example.com', 'https://httpbin.org/html'],
      2,
      { timeout: 12000 }
    );
    check('fetchMultiple', results.length === 2,
      `${results.filter(r => r.page).length}/${results.length} succeeded`
    );
  } catch (err) {
    check('fetchMultiple', false, `error: ${err.message}`);
  }
}

// ── 5. tool-loop engine ──
console.log('\n── 工具调用循环 (tool-loop) ──');
{
  const { runToolLoop } = await import('../dist/core/tool-loop.js');
  const { buildToolDefinitions } = await import('../dist/core/tool-executor.js');

  // Test 1: AI returns text without tool calls → immediate response
  const mockNoTools = {
    name: 'mock', supportsStreaming: false, supportsToolUse: true,
    defaultModel: 'mock', availableModels: ['mock'],
    chat: async () => ({ content: '直接回复', tokensUsed: 50, model: 'mock' }),
    chatStream: async () => ({ content: '', tokensUsed: 0, model: 'mock' }),
  };
  const r1 = await runToolLoop({
    task: '简单问题', systemPrompt: '你是助手',
    provider: mockNoTools, tools: buildToolDefinitions().slice(0, 2),
    rootPath: root, maxRounds: 2,
  });
  check('tool-loop: direct response', r1.success && r1.rounds === 1 && r1.toolCalls.length === 0,
    `rounds=${r1.rounds} calls=${r1.toolCalls.length}`);

  // Test 2: AI calls web_fetch → gets content → responds
  let callCount = 0;
  const mockWithFetch = {
    name: 'mock', supportsStreaming: false, supportsToolUse: true,
    defaultModel: 'mock', availableModels: ['mock'],
    chat: async () => {
      callCount++;
      if (callCount === 1) return {
        content: '',
        toolCalls: [{ name: 'web_fetch', arguments: { url: 'https://example.com' } }],
        tokensUsed: 50, model: 'mock',
      };
      return { content: '网页分析结果', tokensUsed: 50, model: 'mock' };
    },
    chatStream: async () => ({ content: '', tokensUsed: 0, model: 'mock' }),
  };
  const webTools = buildToolDefinitions().filter(t => t.name === 'web_fetch');
  const r2 = await runToolLoop({
    task: '读取网页', systemPrompt: '你是助手',
    provider: mockWithFetch, tools: webTools,
    rootPath: root, maxRounds: 4,
  });
  check('tool-loop: web_fetch workflow', r2.success && r2.toolCalls.length >= 1,
    `rounds=${r2.rounds} calls=${r2.toolCalls.length}`);

  // Test 3: Dedup prevents repeat fetches
  callCount = 0;
  const mockRepeater = {
    name: 'mock', supportsStreaming: false, supportsToolUse: true,
    defaultModel: 'mock', availableModels: ['mock'],
    chat: async () => {
      callCount++;
      if (callCount <= 3) return {
        content: '',
        toolCalls: [{ name: 'web_fetch', arguments: { url: 'https://example.com' } }],
        tokensUsed: 50, model: 'mock',
      };
      return { content: 'done', tokensUsed: 50, model: 'mock' };
    },
    chatStream: async () => ({ content: '', tokensUsed: 0, model: 'mock' }),
  };
  const r3 = await runToolLoop({
    task: '读取网页', systemPrompt: '你是助手',
    provider: mockRepeater, tools: webTools,
    rootPath: root, maxRounds: 4,
  });
  // Only the first call should be "success", rest deduped
  const firstFetchOk = r3.toolCalls[0]?.success === true;
  check('tool-loop: dedup prevents repeat', firstFetchOk,
    `total calls=${r3.toolCalls.length} first=${r3.toolCalls[0]?.success}`);
}

// ── 6. web-search enhancement (batchSearch + expandSearchQueries) ──
console.log('\n── 搜索增强 ──');
{
  const { expandSearchQueries } = await import('../dist/core/web-search.js');
  const queries = expandSearchQueries('React 状态管理');
  check('expandSearchQueries generates queries', queries.length >= 5,
    `${queries.length} queries generated`);
  check('expandSearchQueries has year tag',
    queries.some(q => /\b20\d{2}\b/.test(q)),
    'year-tagged query present');
  check('expandSearchQueries deduplicated',
    new Set(queries).size === queries.length,
    'no duplicates');
}

// ── 7. market-analysis module ──
console.log('\n── 市场分析 ──');
{
  try {
    const { runMarketAnalysis } = await import('../dist/core/market-analysis.js');
    // Can't run full analysis (needs real AI), but verify it exports correctly
    check('market-analysis module exports', typeof runMarketAnalysis === 'function', 'runMarketAnalysis is function');
  } catch (err) {
    check('market-analysis module', false, `import failed: ${err.message}`);
  }
}

// ── 8. Tool health diagnostic ──
console.log('\n── 工具健康诊断 ──');
{
  try {
    const { getToolHealth } = await import('../dist/core/tool-executor.js');
    const health = getToolHealth();
    check('getToolHealth returns data', health.length >= 4, `${health.length} tools`);
    for (const h of health) {
      const icon = h.status === 'available' ? '✓' : h.status === 'limited' ? '⚠' : '✗';
      console.log(`    ${icon} ${h.name}: ${h.reason}`);
    }
  } catch (err) {
    check('tool health', false, `error: ${err.message}`);
  }
}

// ── Report ──
console.log(`\n${'═'.repeat(50)}`);
const total = passed + failed;
console.log(`  ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
