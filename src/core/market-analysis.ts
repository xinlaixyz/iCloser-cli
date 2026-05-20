// Market Analysis Pipeline — search → fetch → AI analyze → format report
// Integrates web-search, web-fetcher, and tool-loop into a complete flow.

import type { AIProviderAdapter } from '../ai/provider.js';
import { batchSearch } from './web-search.js';
import { fetchMultiple } from './web-fetcher.js';
import { runToolLoop, type ToolLoopProgress } from './tool-loop.js';
import { buildToolDefinitions } from './tool-executor.js';

export type AnalysisTemplate = 'competitive' | 'industry' | 'tech-radar' | 'swot';

export interface MarketAnalysisOptions {
  topic: string;
  template: AnalysisTemplate;
  provider: AIProviderAdapter;
  rootPath: string;
  maxSources?: number;
  onProgress?: (event: AnalysisProgress) => void;
}

export interface AnalysisProgress {
  phase: 'search' | 'fetch' | 'analyze' | 'report' | 'done';
  message: string;
  detail?: string;
  current?: number;
  total?: number;
}

export interface MarketAnalysisReport {
  topic: string;
  template: AnalysisTemplate;
  generatedAt: string;
  content: string;
  sources: { title: string; url: string; siteName?: string }[];
  stats: {
    searchResults: number;
    pagesFetched: number;
    pagesSucceeded: number;
    aiRounds: number;
    durationMs: number;
  };
}

const TEMPLATES: Record<AnalysisTemplate, {
  name: string;
  sections: string[];
  systemPrompt: string;
}> = {
  competitive: {
    name: '竞品分析',
    sections: ['市场概览', '主要玩家', '功能对比', '市场份额', '优劣势分析', '推荐结论'],
    systemPrompt: `你是一位资深市场分析师。你的任务是基于提供的网络调研数据，生成一份专业的竞品分析报告。

报告结构：
1. **市场概览** — 市场的总体规模、增长趋势、主要变化
2. **主要玩家** — 列出 3-5 个关键竞品及其核心定位
3. **功能对比** — 用表格对比各竞品的关键功能
4. **市场份额** — 各竞品的相对市场地位（如数据可获取）
5. **优劣势分析** — 每个竞品的核心优势和劣势
6. **推荐结论** — 基于分析的最终建议

格式要求：
- 使用 Markdown 标题和表格
- 数据来源用 [来源名称](URL) 格式引用
- 如果没有确切数据，标注"估算"或"基于公开信息"
- 保持客观中立，不要偏袒任何一方`,
  },

  industry: {
    name: '行业趋势',
    sections: ['行业现状', '关键趋势', '驱动力', '风险与挑战', '未来展望'],
    systemPrompt: `你是一位行业趋势分析师。你的任务是基于提供的网络调研数据，生成一份行业趋势分析报告。

报告结构：
1. **行业现状** — 当前行业的基本面、规模、成熟度
2. **关键趋势** — 3-5 个正在塑造行业的关键趋势
3. **驱动力** — 推动这些趋势的技术、政策和市场因素
4. **风险与挑战** — 行业面临的主要风险和不确定性
5. **未来展望** — 1-3 年的发展预测和建议

格式要求：
- 使用 Markdown 标题
- 每个趋势用具体案例或数据支撑
- 数据来源用 [来源名称](URL) 格式引用
- 区分确定性结论和推测性判断`,
  },

  'tech-radar': {
    name: '技术雷达',
    sections: ['技术全景', '成熟度评估', '采用建议', '值得关注的新技术'],
    systemPrompt: `你是一位技术选型顾问。你的任务是基于提供的网络调研数据，生成一份技术雷达分析报告。

报告结构：
1. **技术全景** — 该领域的技术生态总览
2. **成熟度评估** — 各项技术的成熟度分级：
   - 🟢 采用 (Adopt) — 成熟可靠，推荐使用
   - 🟡 试验 (Trial) — 有潜力，值得尝试
   - 🟠 评估 (Assess) — 值得关注，等待进一步成熟
   - 🔴 暂缓 (Hold) — 目前不推荐，或仅用于特定场景
3. **采用建议** — 不同场景下的最佳技术选择
4. **值得关注的新技术** — 新兴但尚未成熟的技术

格式要求：
- 使用 Markdown 标题和表格
- 成熟度用颜色标记（Adopt/Trial/Assess/Hold）
- 每项技术给出 1-2 句推荐理由`,
  },

  swot: {
    name: 'SWOT 分析',
    sections: ['优势 Strengths', '劣势 Weaknesses', '机会 Opportunities', '威胁 Threats'],
    systemPrompt: `你是一位战略分析师。你的任务是基于提供的网络调研数据，生成一份 SWOT 分析报告。

报告结构：
1. **优势 (Strengths)** — 内部优势和核心竞争力
2. **劣势 (Weaknesses)** — 内部劣势和需要改进的方面
3. **机会 (Opportunities)** — 外部环境中的机会
4. **威胁 (Threats)** — 外部威胁和竞争压力

格式要求：
- 使用 Markdown 标题
- 优势/劣势聚焦于内部可控因素，机会/威胁聚焦于外部环境因素
- 每一项给出具体依据或数据来源
- 最后给出基于 SWOT 的战略建议`,
  },
};

export async function runMarketAnalysis(options: MarketAnalysisOptions): Promise<MarketAnalysisReport> {
  const startTime = Date.now();
  const maxSources = options.maxSources ?? 15;
  const template = TEMPLATES[options.template];

  // Phase 1: Search
  options.onProgress?.({ phase: 'search', message: '搜索相关信息...', current: 0, total: 3 });
  const searchResults = await batchSearch(options.topic, maxSources);
  options.onProgress?.({ phase: 'search', message: `找到 ${searchResults.length} 条相关结果`, current: 1, total: 3 });

  if (searchResults.length === 0) {
    return {
      topic: options.topic,
      template: options.template,
      generatedAt: new Date().toISOString(),
      content: `## ${template.name}: ${options.topic}\n\n未找到相关搜索结果。请尝试:\n- 使用更具体的关键词\n- 检查网络连接\n- 稍后重试`,
      sources: [],
      stats: { searchResults: 0, pagesFetched: 0, pagesSucceeded: 0, aiRounds: 0, durationMs: Date.now() - startTime },
    };
  }

  // Phase 2: Fetch top pages
  options.onProgress?.({ phase: 'fetch', message: '抓取网页全文...', current: 1, total: 3 });
  const topUrls = searchResults.slice(0, 10).map(r => r.url);
  const fetchResults = await fetchMultiple(topUrls, 4, { timeout: 10000, maxContentLength: 30000 });
  const succeeded = fetchResults.filter(r => r.page).map(r => r.page!);

  options.onProgress?.({
    phase: 'fetch',
    message: `成功抓取 ${succeeded.length}/${fetchResults.length} 个页面`,
    current: 2,
    total: 3,
    detail: succeeded.map(p => p.siteName || p.url).join(', '),
  });

  // Build context for AI
  const searchContext = searchResults
    .map((r, i) => `[${i + 1}] **${r.title}**\n  URL: ${r.url}\n  摘要: ${r.snippet}`)
    .join('\n\n');

  const searchedUrls = new Set(searchResults.map(r => r.url));
  const fetchedUrls = new Set(succeeded.map(p => p.url));

  // Build page context — smarter allocation across sources
  const maxPageContext = 60000; // P1-6: raised from 40000
  const perPageCap = Math.floor(maxPageContext / Math.max(1, succeeded.length));
  const pageBlocks: string[] = [];
  let pageTotal = 0;
  for (let i = 0; i < succeeded.length && pageTotal < maxPageContext; i++) {
    const p = succeeded[i];
    const block = `---\n## 来源 ${i + 1}: ${p.title}\n网站: ${p.siteName || '未知'}\nURL: ${p.url}\n${p.publishedAt ? `发布时间: ${p.publishedAt}\n` : ''}\n${p.content.slice(0, perPageCap)}`;
    pageBlocks.push(block);
    pageTotal += block.length;
  }
  const pageContext = pageBlocks.join('\n\n');

  // P0-3: tell AI what has been searched/fetched so it doesn't repeat
  const searchUrlList = [...searchedUrls].map(u => `- ${u}`).join('\n');
  const fetchedUrlList = [...fetchedUrls].map(u => `- ${u}`).join('\n');

  const taskPrompt = [
    `## 分析主题: ${options.topic}`,
    `## 分析类型: ${template.name}`,
    `## 报告应包含的章节: ${template.sections.map((s, i) => `${i + 1}. ${s}`).join(', ')}`,
    ``,
    `## 搜索结果 (${searchResults.length} 条)`,
    searchContext,
    ``,
    `## 网页全文 (${pageBlocks.length} 个来源)`,
    pageContext,
    ``,
    `> ⚠️ 以下 URL 已经搜索过，请勿重复搜索：`,
    searchUrlList,
    `> ⚠️ 以下 URL 已经抓取全文，请勿重复抓取：`,
    fetchedUrlList,
    ``,
    `请基于以上信息生成「${options.topic}」的${template.name}报告。`,
    `报告必须包含所有指定章节。用 Markdown 格式。所有数据引用必须标注来源 URL。`,
  ].join('\n');

  // Phase 3: AI analysis via tool-loop (AI can do additional searches)
  options.onProgress?.({ phase: 'analyze', message: 'AI 正在分析数据...', current: 2, total: 3 });

  const tools = buildToolDefinitions();
  const loopResult = await runToolLoop({
    task: taskPrompt,
    systemPrompt: template.systemPrompt,
    provider: options.provider,
    tools,
    rootPath: options.rootPath,
    maxRounds: 6,
    onProgress: (e: ToolLoopProgress) => {
      if (e.phase === 'tool_call') {
        options.onProgress?.({
          phase: 'analyze',
          message: `AI 调用工具: ${e.toolName}`,
          current: 2,
          total: 3,
          detail: e.toolArgs ? JSON.stringify(e.toolArgs).slice(0, 100) : undefined,
        });
      }
    },
  });

  // Phase 4: Format final report
  options.onProgress?.({ phase: 'report', message: '生成报告...', current: 3, total: 3 });

  const sources = [
    ...succeeded.map(p => ({ title: p.title, url: p.url, siteName: p.siteName })),
    ...searchResults.slice(succeeded.length).map(r => ({ title: r.title, url: r.url })),
  ];

  const reportHeader = [
    `# ${template.name}报告: ${options.topic}`,
    `> 生成时间: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} | 数据来源: ${sources.length} 个`,
    '',
  ].join('\n');

  const reportSources = [
    '\n\n---\n\n## 数据来源\n',
    ...sources.map((s: any, i: number) => `${i + 1}. [${s.title}](${s.url})${s.siteName ? ` — ${s.siteName}` : ''}`),
  ].join('\n');

  options.onProgress?.({ phase: 'done', message: '分析完成', current: 3, total: 3 });

  return {
    topic: options.topic,
    template: options.template,
    generatedAt: new Date().toISOString(),
    content: reportHeader + loopResult.finalResponse + reportSources,
    sources,
    stats: {
      searchResults: searchResults.length,
      pagesFetched: fetchResults.length,
      pagesSucceeded: succeeded.length,
      aiRounds: loopResult.rounds,
      durationMs: Date.now() - startTime,
    },
  };
}
