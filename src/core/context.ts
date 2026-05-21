// Context Compression Manager — Token budget management and smart context assembly
import * as path from 'path';
import { existsSync } from 'fs';
import { readFile, estimateTokens, relativePath } from '../utils/fs.js';
import { loadProjectIndex, saveProjectIndex, scanProject } from './scanner.js';
import { loadProjectMemory, loadGlobalMemory } from './memory.js';
import type {
  ContextPackage, CodeSnippet, ProjectIndex, ProjectMemory,
  Task, ProjectIdentity,
} from '../types.js';

export interface ContextOptions {
  maxTokens: number;
  systemPromptBudget: number;     // ~2K
  projectMetaBudget: number;      // ~1K
  memoryBudget: number;           // ~1-2K
  bufferReserve: number;          // 10%
}

export interface ProjectContextOptions extends Partial<ContextOptions> {
  scanIfMissing?: boolean;
  maxFileSize?: number;
  deep?: boolean;        // Run deep scan (AST, call graph, architecture detection)
  includeTests?: boolean; // Include test files in scan
}

export interface ContextDebugSummary {
  totalTokens: number;
  budgetUsed: number;
  codeSnippetCount: number;
  memoryTokens: number;
  topFiles: Array<{
    file: string;
    relevance: number;
    compression: CodeSnippet['compression'];
    tokens: number;
  }>;
}

const DEFAULT_OPTIONS: ContextOptions = {
  maxTokens: 100000,
  systemPromptBudget: 2000,
  projectMetaBudget: 1000,
  memoryBudget: 2000,
  bufferReserve: 0.1,             // 10% reserved for AI response + tool calls
};

// ============================================================
// Main context assembly
// ============================================================
export async function assembleContext(
  task: Task,
  index: ProjectIndex,
  memory: ProjectMemory,
  identity: ProjectIdentity,
  options: Partial<ContextOptions> = {}
): Promise<ContextPackage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usableBudget = Math.floor(opts.maxTokens * (1 - opts.bufferReserve));

  // 1. Project meta (~1K tokens) — includes README, extension stats, directory overview
  const projectMeta = await assembleProjectMeta(identity, index);

  // 2. Relevant code (remaining budget after meta + memory)
  const codeBudget = Math.max(0, usableBudget - opts.projectMetaBudget - opts.memoryBudget);
  const relevantCode = await assembleRelevantCode(task, index, codeBudget);

  // 3. Relevant memory (~1-2K tokens)
  let relevantMemory = assembleRelevantMemory(task, memory, opts.memoryBudget);

  // 3.4. Global memory injection (S17.4) — user preferences, tech stack patterns
  try {
    const globalMem = await loadGlobalMemory();
    const globalHints = assembleGlobalMemoryHints(globalMem, identity);
    if (globalHints) {
      relevantMemory = relevantMemory ? relevantMemory + '\n\n' + globalHints : globalHints;
    }
  } catch { /* loading global-memory is optional */ }

  // 3.5. Memory Kernel Recall — inject relevant project memories
  try {
    const rootPath = index.rootPath || process.cwd();
    const { getMemoryContextForLLM } = await import('./memory/integration.js');
    const memoryRecall = await getMemoryContextForLLM(rootPath, task.description);
    if (memoryRecall) {
      relevantMemory = relevantMemory ? relevantMemory + '\n\n' + memoryRecall : memoryRecall;
    }
  } catch { /* memory kernel is optional */ }

  // 3.6. AST call graph hints + relevant signatures (S17.6)
  let astHints: string | undefined;
  const taskSymbols = extractSymbolsFromDescription(task.description, index);
  if (taskSymbols.length > 0) {
    const parts: string[] = [];

    // Relevant function/class signatures from module exports
    const relevantExports: { name: string; kind: string; signature: string; file: string }[] = [];
    for (const mod of index.modules) {
      for (const exp of mod.exports) {
        if (taskSymbols.some(s => exp.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(exp.name.toLowerCase()))) {
          relevantExports.push({ name: exp.name, kind: exp.kind, signature: exp.signature, file: mod.path || mod.name });
        }
      }
    }
    if (relevantExports.length > 0) {
      parts.push('相关符号定义：\n' + relevantExports.slice(0, 12).map(e =>
        `- ${e.kind} \`${e.name}\`: ${e.signature.substring(0, 80)} (${e.file})`
      ).join('\n'));
    }

    // Call graph edges
    if (index.callGraph && index.callGraph.length > 0) {
      const relatedEdges = index.callGraph.filter(e =>
        taskSymbols.some(s => e.callee.includes(s) || e.caller.includes(s))
      ).slice(0, 15);
      if (relatedEdges.length > 0) {
        parts.push('相关调用关系：\n' + relatedEdges.map(e =>
          `- ${e.caller} → ${e.callee} (${e.callerFile}:${e.line})`
        ).join('\n'));
      }
    }

    // Auto-6: Impact-aware context — find files that import from matched exports
    if (taskSymbols.length > 0 && index.dependencyGraph.size > 0) {
      const impactFiles = new Set<string>();
      const matchedModules = new Set<string>();
      for (const exp of relevantExports) {
        matchedModules.add(exp.file);
      }
      for (const [mod, deps] of index.dependencyGraph) {
        for (const dep of deps) {
          if (matchedModules.has(dep)) {
            impactFiles.add(mod); // this module imports from a matched module
          }
        }
      }
      if (impactFiles.size > 0) {
        // Limit to 8 impact files, prioritize by module size
        const impactList = [...impactFiles]
          .map(f => ({ file: f, size: index.modules.find(m => (m.path || m.name) === f)?.files.length || 0 }))
          .sort((a, b) => b.size - a.size)
          .slice(0, 8);
        parts.push(`受影响文件 (导入了上述符号的模块):\n${impactList.map(i => `- ${i.file} (${i.size} 文件依赖)`).join('\n')}`);
      }
    }

    if (parts.length > 0) astHints = parts.join('\n\n');
  }

  // 4. External knowledge (web search) — best effort, non-blocking
  let externalKnowledge: string | undefined;
  try {
    const keywords = extractTechKeywords(task.description);
    if (keywords.length > 0) {
      const { searchWeb, isWebSearchAvailable } = await import('./web-search.js');
      if (isWebSearchAvailable()) {
        const results = await searchWeb(keywords.join(' '), { maxResults: 3 });
        if (results.length > 0) {
          externalKnowledge = results.map(r => `[${r.title}](${r.url}): ${r.snippet}`).join('\n');
        }
      }
    }
  } catch { /* web search is optional */ }

  const totalTokens = estimateTokens(projectMeta) +
    relevantCode.reduce((sum, s) => sum + estimateTokens(s.content), 0) +
    estimateTokens(relevantMemory) +
    (astHints ? estimateTokens(astHints) : 0) +
    (externalKnowledge ? estimateTokens(externalKnowledge) : 0);

  return {
    projectMeta,
    relevantCode,
    relevantMemory,
    externalKnowledge,
    totalTokens,
    budgetUsed: Math.round((totalTokens / usableBudget) * 100),
    astHints,
  };
}

function extractTechKeywords(description: string): string[] {
  // Extract library names, error patterns, technology terms
  const patterns = [
    /\b(react|vue|angular|svelte|next\.?js|nuxt|gatsby)\b/gi,
    /\b(node\.?js|deno|bun|express|koa|fastify|nest\.?js)\b/gi,
    /\b(typescript|javascript|python|golang|rust|java|kotlin|swift)\b/gi,
    /\b(postgres|mysql|mongodb|redis|sqlite|prisma|drizzle|typeorm)\b/gi,
    /\b(docker|kubernetes|aws|gcp|azure|vercel|netlify|cloudflare)\b/gi,
    /\b(webpack|vite|esbuild|rollup|turbopack|babel|swc)\b/gi,
    /\b(tailwind|bootstrap|material.?ui|chakra|ant.?design)\b/gi,
    /\b(graphql|rest|grpc|websocket|sse|trpc)\b/gi,
    /\b(TypeError|ReferenceError|SyntaxError|ECONNREFUSED|ENOENT|EACCES)\b/,
    /\b(Cannot find module|cannot resolve|module not found|import error)\b/i,
  ];
  const keywords = new Set<string>();
  for (const pattern of patterns) {
    for (const match of description.matchAll(pattern)) {
      keywords.add(match[0]);
    }
  }
  return [...keywords].slice(0, 3); // max 3 keywords to avoid too many searches
}

export async function assembleContextFromProject(
  rootPath: string,
  task: Task,
  options: ProjectContextOptions = {}
): Promise<ContextPackage> {
  const scanIfMissing = options.scanIfMissing ?? true;
  let index = await loadProjectIndex(rootPath);

  if (!index && scanIfMissing) {
    const result = await scanProject({
      rootPath,
      deep: options.deep ?? false,
      includeTests: options.includeTests ?? false,
      maxFileSize: options.maxFileSize ?? 256 * 1024,
    });
    index = result.index;
    await saveProjectIndex(rootPath, index);
  }

  if (!index) {
    throw new Error('项目索引不存在，请先运行 iCloser scan');
  }

  const memory = await loadProjectMemory(rootPath);
  return assembleContext(task, index, memory, index.identity, options);
}

export function summarizeContextDebug(context: ContextPackage, limit = 10): ContextDebugSummary {
  return {
    totalTokens: context.totalTokens,
    budgetUsed: context.budgetUsed,
    codeSnippetCount: context.relevantCode.length,
    memoryTokens: estimateTokens(context.relevantMemory),
    topFiles: context.relevantCode
      .slice()
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(snippet => ({
        file: snippet.file,
        relevance: snippet.relevance,
        compression: snippet.compression,
        tokens: estimateTokens(snippet.content),
      })),
  };
}

// ============================================================
// Project meta
// ============================================================
async function assembleProjectMeta(identity: ProjectIdentity, index: ProjectIndex): Promise<string> {
  const parts: string[] = [];

  parts.push('# 项目元信息');
  parts.push(`- 语言: ${identity.language}`);
  parts.push(`- 框架: ${identity.framework || '无'}`);
  parts.push(`- 数据库: ${identity.database || '未检测到'}`);
  parts.push(`- 构建系统: ${identity.buildSystem}`);
  parts.push(`- 测试框架: ${identity.testFramework || '未检测到'}`);
  parts.push(`- 运行时: ${identity.runtime}`);
  if (identity.languageVersion !== 'unknown') {
    parts.push(`- 语言版本: ${identity.languageVersion}`);
  }
  parts.push(`- 部署形态: ${identity.deploymentType}`);
  parts.push(`- 架构模式: ${index.architecturePattern}`);

  // P2: File extension distribution
  const extStats = countFileExtensions(index);
  if (extStats) {
    parts.push(`\n## 文件分布`);
    parts.push(extStats);
  }

  // P4: Directory structure overview
  const dirOverview = buildDirectoryOverview(index);
  if (dirOverview) {
    parts.push(`\n## 目录结构`);
    parts.push(dirOverview);
  }

  // B1: File manifest — list key files from each module so AI knows what to explore
  const fileManifest = buildFileManifest(index);
  if (fileManifest) {
    parts.push(`\n## 关键文件清单（可用 read_file 读取）`);
    parts.push(fileManifest);
  }

  // P9: Technology stack details from dependency files
  const techDetails = await extractTechStackDetails(index);
  if (techDetails) {
    parts.push(`\n## 技术栈详情`);
    parts.push(techDetails);
  }

  // P10: Vendor/dependency stats (don't parse, just count)
  const vendorStats = countVendorDeps(index);
  if (vendorStats) {
    parts.push(`\n## 第三方依赖`);
    parts.push(vendorStats);
  }

  // G1: Quantitative project metrics
  const metrics = await collectProjectMetrics(index);
  if (metrics) {
    parts.push(`\n## 量化指标`);
    parts.push(metrics);
  }

  // G2+G3: Engineering health check — CI/lint/test/config/build artifacts
  const health = await checkEngineeringHealth(index);
  if (health) {
    parts.push(`\n## 工程健康检查`);
    parts.push(health);
  }

  // G2: Task/report status from .icloser/tasks
  const taskStatus = await readTaskStatusSummary(index);
  if (taskStatus) {
    parts.push(`\n## 任务/报告状态`);
    parts.push(taskStatus);
  }

  // G6: Inject previous analysis conclusions for incremental improvement
  try {
    const { readFile } = await import('../utils/fs.js');
    const prevReport = await readFile([index.rootPath, '.icloser', 'analysis-report.md'].join('/')).catch(() => '');
    if (prevReport && prevReport.length > 50) {
      const keyLines = prevReport.split('\n')
        .filter(l => l.includes('|') || l.includes('✅') || l.includes('❌') || l.includes('评分') || l.includes('%') || l.includes('阻塞'))
        .slice(0, 15);
      if (keyLines.length > 0) {
        parts.push(`\n## 上次分析结论（增量参考）`);
        parts.push(keyLines.join('\n'));
      }
    }
  } catch { /* no previous analysis */ }

  // PM5: PRD/Roadmap documents — extract feature lists and milestones
  try {
    const pmDocs = ['docs/PRD.md', 'docs/ROADMAP.md', 'ROADMAP.md', 'CHANGELOG.md', 'RELEASE_NOTES.md'];
    for (const doc of pmDocs) {
      try {
        const content = await (await import('../utils/fs.js')).readFile([index.rootPath, doc].join('/'));
        if (content && content.trim()) {
          const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...(已截断)' : content;
          parts.push(`\n## PM 文档: ${doc}\n${truncated}`);
        }
      } catch { /* try next */ }
    }
  } catch { /* no PM docs */ }

  // P3: README content (first 3000 chars)
  try {
    const readmePath = [index.rootPath, 'README.md'].join('/').replace(/\/+/g, '/');
    const { readFile } = await import('../utils/fs.js');
    const readme = await readFile(readmePath);
    if (readme && readme.trim()) {
      const truncated = readme.length > 3000 ? readme.slice(0, 3000) + '\n... (README 过长，已截断)' : readme;
      parts.push(`\n## README.md 内容\n${truncated}`);
    }
  } catch { /* no README */ }

  parts.push(`\n## 代码风格指纹`);
  const style = index.styleFingerprint;
  parts.push(`- 命名: ${style.namingConvention}`);
  parts.push(`- 缩进: ${style.indentStyle} (${style.indentSize})`);
  parts.push(`- 引号: ${style.quoteStyle}`);
  parts.push(`- 分号: ${style.semicolons ? '有' : '无'}`);

  parts.push(`\n## 模块概览 (${index.modules.length} 个模块)`);
  for (const mod of index.modules.slice(0, 15)) {
    parts.push(`- ${mod.name}: ${mod.files.length} 个文件`);
    if (mod.responsibility) parts.push(`  职责: ${mod.responsibility}`);
  }

  if (index.apis.length > 0) {
    parts.push(`\n## API 接口 (${index.apis.length} 个)`);
    for (const api of index.apis.slice(0, 10)) {
      parts.push(`- ${api.method} ${api.path}`);
    }
  }

  if (index.database.tables.length > 0 || index.database.orm) {
    parts.push(`\n## 数据库`);
    if (index.database.orm) parts.push(`- ORM: ${index.database.orm}`);
    for (const table of index.database.tables.slice(0, 10)) {
      parts.push(`- 表: ${table.name} (${table.columns.length} 列)`);
    }
  }

  return parts.join('\n');
}

// ============================================================
// File extension distribution (P2)
// ============================================================
function countFileExtensions(index: ProjectIndex): string {
  const counts = new Map<string, number>();
  for (const mod of index.modules) {
    for (const file of mod.files) {
      const ext = file.split('.').pop()?.toLowerCase() || 'other';
      counts.set(ext, (counts.get(ext) || 0) + 1);
    }
  }
  if (counts.size === 0) return '';
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  return `总文件: ${total} | ${sorted.map(([ext, n]) => `.${ext}: ${n}`).join(' | ')}`;
}

// ============================================================
// Directory structure overview (P4)
// ============================================================
function buildDirectoryOverview(index: ProjectIndex): string {
  const dirFiles = new Map<string, number>();
  const rootFiles: string[] = [];

  for (const mod of index.modules) {
    for (const file of mod.files) {
      const parts = file.split('/');
      if (parts.length === 1) {
        rootFiles.push(parts[0]);
      } else {
        const dir = parts.slice(0, 2).join('/');
        dirFiles.set(dir, (dirFiles.get(dir) || 0) + 1);
      }
    }
  }

  const lines: string[] = [];

  // Root-level key files
  const KEY_ROOT_FILES = ['README.md', 'Makefile', 'Dockerfile', 'LICENSE', 'go.mod', 'package.json'];
  const keyRoot = rootFiles.filter(f => KEY_ROOT_FILES.some(k => f.toLowerCase().includes(k.toLowerCase())));
  if (keyRoot.length > 0) {
    lines.push(`根目录关键文件: ${keyRoot.join(', ')}`);
  }

  // Directory tree
  if (dirFiles.size > 0) {
    lines.push('');
    const sorted = [...dirFiles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    for (const [dir, n] of sorted) {
      // Sample a few filenames from this directory
      const sampleFiles: string[] = [];
      for (const mod of index.modules) {
        for (const file of mod.files) {
          if (file.startsWith(dir + '/') || file.startsWith(dir)) {
            const name = file.split('/').pop() || file;
            if (sampleFiles.length < 3 && !sampleFiles.includes(name)) sampleFiles.push(name);
          }
        }
      }
      const sample = sampleFiles.length > 0 ? ` (例: ${sampleFiles.join(', ')})` : '';
      lines.push(`- ${dir}/ (${n} 文件)${sample}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// File manifest for AI exploration (B1)
// ============================================================
function buildFileManifest(index: ProjectIndex): string {
  const lines: string[] = [];
  const totalFiles = index.modules.reduce((s, m) => s + m.files.length, 0);
  lines.push(`共 ${totalFiles} 个文件，${index.modules.length} 个模块。以下为各模块代表性文件：\n`);

  for (const mod of index.modules) {
    // Prioritize: non-test files, entry-point-like names, then alphabetical
    const sourceFiles = mod.files
      .filter(f => !f.match(/(_test\.|\.test\.|\.spec\.|test\/|tests\/|vendor\/)/))
      .sort((a, b) => {
        const aKey = a.match(/(main|app|server|index|config|router|handler|model|api|cmd)\./) ? 0 : 1;
        const bKey = b.match(/(main|app|server|index|config|router|handler|model|api|cmd)\./) ? 0 : 1;
        return aKey - bKey || a.localeCompare(b);
      });

    const MAX_PER_MODULE = 25;
    const shown = sourceFiles.slice(0, MAX_PER_MODULE);
    const suffix = sourceFiles.length > MAX_PER_MODULE ? ` ... 共 ${sourceFiles.length} 个源文件` : '';

    lines.push(`\n### ${mod.name}/ (${mod.files.length} 文件)`);
    for (const f of shown) {
      // Extract just the filename for readability
      const name = f.replace(/\\/g, '/').split('/').pop() || f;
      // Mark key files
      const isKey = /^(main|app|server|index|config|router|handler|Makefile|Dockerfile)\./.test(name);
      const prefix = isKey ? '★ ' : '  ';
      lines.push(`${prefix}${name}`);
    }
    if (suffix) lines.push(suffix);
  }

  return lines.join('\n');
}

// ============================================================
// Tech stack details extraction (P9)
// ============================================================
async function extractTechStackDetails(index: ProjectIndex): Promise<string> {
  const parts: string[] = [];

  // Read go.mod for Go dependencies
  try {
    const { readFile } = await import('../utils/fs.js');
    const goModPaths = ['go.mod', 'platform/go.mod', 'server/go.mod', 'backend/go.mod'];
    for (const p of goModPaths) {
      try {
        const content = await readFile([index.rootPath, p].join('/').replace(/\/+/g, '/'));
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('//') && !l.startsWith('module '));
        const deps = lines.filter(l => !l.startsWith('\t//') && (l.trim().startsWith('github.com') || l.trim().startsWith('go.') || l.trim().startsWith('google.') || l.trim().startsWith('k8s.io')));
        if (deps.length > 0) {
          parts.push(`**Go 模块依赖 (${p}):** ${deps.slice(0, 20).map(d => d.trim().split(' ')[0]).join(', ')}${deps.length > 20 ? ` ... 共 ${deps.length} 个依赖` : ''}`);
        }
        const goVersion = lines.find(l => l.trim().startsWith('go '));
        if (goVersion) parts.push(`Go 版本: ${goVersion.trim()}`);
        break;
      } catch { /* try next path */ }
    }
  } catch { /* optional */ }

  // Read package.json for JS dependencies
  try {
    const { readFile } = await import('../utils/fs.js');
    const pkgPaths = ['package.json', 'ui/package.json', 'frontend/package.json', 'web/package.json', 'client/package.json'];
    for (const p of pkgPaths) {
      try {
        const content = await readFile([index.rootPath, p].join('/').replace(/\/+/g, '/'));
        const pkg = JSON.parse(content);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const keys = Object.keys(deps);
        if (keys.length > 0) {
          const frameworks = keys.filter((k: string) => ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express', 'nest', 'webpack', 'vite', 'tailwind'].some(f => k.includes(f)));
          if (frameworks.length > 0) parts.push(`**前端框架/工具 (${p}):** ${frameworks.join(', ')}`);
          parts.push(`**JS 依赖 (${p}):** ${keys.slice(0, 15).join(', ')}${keys.length > 15 ? ` ... 共 ${keys.length} 个包` : ''}`);
        }
        break;
      } catch { /* try next path */ }
    }
  } catch { /* optional */ }

  // Read requirements.txt for Python
  try {
    const { readFile } = await import('../utils/fs.js');
    const reqPaths = ['requirements.txt', 'python/requirements.txt', 'backend/requirements.txt'];
    for (const p of reqPaths) {
      try {
        const content = await readFile([index.rootPath, p].join('/').replace(/\/+/g, '/'));
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        parts.push(`**Python 依赖 (${p}):** ${lines.slice(0, 15).join(', ')}${lines.length > 15 ? ` ... 共 ${lines.length} 个` : ''}`);
        break;
      } catch { /* try next path */ }
    }
  } catch { /* optional */ }

  return parts.join('\n');
}

// ============================================================
// Vendor dependency stats (P10)
// ============================================================
function countVendorDeps(index: ProjectIndex): string {
  const parts: string[] = [];
  // Count vendor directories
  const vendorModules = index.modules.filter(m => m.name === 'vendor');
  if (vendorModules.length > 0) {
    const totalVendorFiles = vendorModules.reduce((s, m) => s + m.files.length, 0);
    parts.push(`vendor 目录: ${totalVendorFiles} 个文件 (已排除扫描，仅统计)`);
  }
  // Check for node_modules
  for (const mod of index.modules) {
    if (mod.name.includes('node_modules')) {
      parts.push(`node_modules 存在 (${mod.files.length} 顶层文件)`);
      break;
    }
  }
  return parts.join('\n');
}

// ============================================================
// ============================================================
// Quantitative metrics (G1)
// ============================================================
async function collectProjectMetrics(index: ProjectIndex): Promise<string> {
  const parts: string[] = [];
  const totalFiles = index.modules.reduce((s, m) => s + m.files.length, 0);
  const totalExports = index.modules.reduce((s, m) => s + m.exports.length, 0);
  const totalImports = index.modules.reduce((s, m) => s + m.imports.length, 0);
  parts.push(`| 指标 | 数值 |`);
  parts.push(`|------|------|`);
  parts.push(`| 源文件 | ${totalFiles} |`);
  parts.push(`| 模块 | ${index.modules.length} |`);
  parts.push(`| 导出符号 | ${totalExports} |`);
  parts.push(`| 导入引用 | ${totalImports} |`);

  // Count test files
  const testFiles = index.modules.flatMap(m => m.files).filter(f =>
    /(\.test\.|\.spec\.|_test\.|test\/|tests\/|__tests__\/)/i.test(f)
  );
  parts.push(`| 测试文件 | ${testFiles.length} |`);

  // Read package.json for version and scripts
  try {
    const { readFile } = await import('../utils/fs.js');
    const pkgPaths = ['package.json', 'ui/package.json', 'client/package.json'];
    for (const p of pkgPaths) {
      try {
        const content = await readFile([index.rootPath, p].join('/').replace(/\/+/g, '/'));
        const pkg = JSON.parse(content);
        if (pkg.version) parts.push(`| 版本 (${p}) | ${pkg.version} |`);
        if (pkg.scripts) {
          const scriptNames = Object.keys(pkg.scripts);
          parts.push(`| npm scripts | ${scriptNames.length} 个: ${scriptNames.slice(0, 8).join(', ')}${scriptNames.length > 8 ? '...' : ''} |`);
        }
        break;
      } catch { /* try next */ }
    }
  } catch { /* optional */ }

  // Call graph stats
  if (index.callGraph) {
    parts.push(`| 调用图边 | ${index.callGraph.length} |`);
  }

  return parts.join('\n');
}

// ============================================================
// Engineering health check (G2+G3)
// ============================================================
async function checkEngineeringHealth(index: ProjectIndex): Promise<string> {
  const parts: string[] = [];
  const allFiles = index.modules.flatMap(m => m.files.map(f => f.replace(/\\/g, '/')));
  const _allPaths = allFiles.join(' ').toLowerCase();

  // CI/CD
  const hasCI = allFiles.some(f => f.includes('.github/workflows') || f.includes('.gitlab-ci') || f.includes('Jenkinsfile'));
  parts.push(`| CI/CD | ${hasCI ? '✅ 已配置' : '❌ 未配置'} | ${hasCI ? '' : '建议添加 GitHub Actions'} |`);

  // Linter
  const hasLint = allFiles.some(f => /\.eslintrc|eslint\.config|\.prettierrc|prettier\.config/.test(f));
  parts.push(`| Lint/Format | ${hasLint ? '✅ 已配置' : '❌ 未配置'} | ${hasLint ? '' : '建议添加 ESLint + Prettier'} |`);

  // Test framework in package.json
  let hasTestFramework = false;
  try {
    const { readFile } = await import('../utils/fs.js');
    for (const p of ['package.json', 'ui/package.json']) {
      try {
        const pkg = JSON.parse(await readFile([index.rootPath, p].join('/').replace(/\/+/g, '/')));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (Object.keys(deps).some((k: string) => /jest|vitest|mocha|ava|jasmine|pytest|go-test|junit/.test(k))) {
          hasTestFramework = true;
        }
        if (pkg.scripts?.test) hasTestFramework = true;
        break;
      } catch { /* next */ }
    }
  } catch { /* optional */ }
  parts.push(`| 测试框架 | ${hasTestFramework ? '✅ 已配置' : '❌ 未检测到'} | ${hasTestFramework ? '' : '建议添加 vitest/jest'} |`);

  // Build artifacts in repo
  const hasArtifacts = allFiles.some(f => /^(dist|build|release|out)\//.test(f));
  parts.push(`| 构建产物 | ${hasArtifacts ? '⚠️ 存在于仓库中' : '✅ 已排除'} | ${hasArtifacts ? '建议加入 .gitignore' : ''} |`);

  // Git repo
  let isGit = false;
  try {
    const { isGitRepo } = await import('../utils/git.js');
    isGit = await isGitRepo(index.rootPath);
  } catch { /* optional */ }
  parts.push(`| Git 仓库 | ${isGit ? '✅' : '⚠️ 非 Git 仓库'} | ${isGit ? '' : '建议 git init'} |`);

  // TypeScript strictness
  const hasTsconfig = allFiles.some(f => f === 'tsconfig.json');
  if (hasTsconfig) {
    try {
      const { readFile } = await import('../utils/fs.js');
      const tsconfig = JSON.parse(await readFile([index.rootPath, 'tsconfig.json'].join('/').replace(/\/+/g, '/')));
      const strict = tsconfig.compilerOptions?.strict;
      parts.push(`| TypeScript | ${strict ? '✅ strict 模式' : '⚠️ strict 未开启'} | |`);
    } catch { /* optional */ }
  }

  return `| 检查项 | 状态 | 建议 |\n|------|------|------|\n${parts.join('\n')}`;
}

// ============================================================
// Task/report status (G2)
// ============================================================
async function readTaskStatusSummary(index: ProjectIndex): Promise<string> {
  try {
    const taskDir = [index.rootPath, '.icloser', 'tasks'].join('/').replace(/\/+/g, '/');
    const { readFile } = await import('../utils/fs.js');
    const fs = await import('fs/promises');
    const entries = await fs.readdir(taskDir).catch(() => [] as string[]);
    if (entries.length === 0) return '';

    const parts: string[] = [];
    parts.push(`| 任务ID | 描述 | 状态 |`);
    parts.push(`|--------|------|------|`);
    let blocked = 0; let completed = 0; let failed = 0;
    for (const entry of entries.slice(-10)) {
      try {
        const taskJson = JSON.parse(await readFile([taskDir, entry, 'task.json'].join('/')));
        const status = taskJson.status || 'unknown';
        if (status === 'completed') completed++;
        else if (status === 'failed') failed++;
        else if (status === 'blocked') blocked++;
        const desc = (taskJson.description || '').slice(0, 40);
        parts.push(`| ${entry} | ${desc} | ${status} |`);
      } catch { /* skip */ }
    }
    if (blocked > 0) parts.push(`\n⚠️ ${blocked} 个阻塞任务，${failed} 个失败，${completed} 个已完成`);
    return parts.join('\n');
  } catch { return ''; }
}

// Relevant code assembly with compression
// ============================================================
async function assembleRelevantCode(
  task: Task,
  index: ProjectIndex,
  budget: number
): Promise<CodeSnippet[]> {
  // Score files — content is cached inside scored entries so we never read twice
  const scored = await scoreFiles(task.description, index);

  const snippets: CodeSnippet[] = [];
  let usedTokens = 0;

  for (const { file, score, content: cachedContent } of scored) {
    if (usedTokens >= budget) break;

    try {
      // Reuse content captured during scoring; fall back to a fresh read only
      // if the cache entry is somehow absent (should not happen in practice).
      const content = cachedContent ?? await readFile(file);
      const relPath = relativePath(file, index.rootPath);
      const tokens = estimateTokens(content);

      let compression: CodeSnippet['compression'];
      let snippetContent: string;

      if (score >= 0.8 || usedTokens + tokens <= budget) {
        // Full content for high-relevance files
        compression = 'full';
        snippetContent = content;
      } else if (score >= 0.5) {
        // Skeleton: function signatures + key logic
        compression = 'skeleton';
        snippetContent = compressToSkeleton(content);
      } else if (score >= 0.3) {
        // Summary: one-line description + exports
        compression = 'summary';
        snippetContent = compressToSummary(content, relPath);
      } else {
        continue; // Skip low-relevance files
      }

      const snippetTokens = estimateTokens(snippetContent);
      if (usedTokens + snippetTokens > budget) {
        // If full doesn't fit, try skeleton
        if (compression === 'full') {
          snippetContent = compressToSkeleton(content);
          compression = 'skeleton';
        } else {
          continue;
        }
      }

      usedTokens += estimateTokens(snippetContent);
      snippets.push({
        file: relPath,
        content: snippetContent,
        relevance: score,
        compression,
      });
    } catch {
      continue;
    }
  }

  return snippets;
}

// ============================================================
// File scoring
// ============================================================

/**
 * 文件相关性打分规则
 *
 * 根据任务描述对项目文件进行相关性评分（0-1），用于决定哪些文件应注入 AI 上下文。
 * 评分越高，文件与当前任务越相关，越可能以完整内容（full）形式注入。
 *
 * 评分维度及权重：
 *
 * 1. 模块名称匹配（baseScore，最高 0.3 × 关键词数）
 *    - 任务描述中的关键词与模块名匹配，每个关键词 +0.3
 *    - 例如：任务含 "auth"，模块名为 "auth" 或 "authentication" 均匹配
 *
 * 2. 文件名匹配（+0.2/关键词）
 *    - 关键词与文件名（不含路径）匹配
 *    - 例如：任务含 "user"，文件名为 "userService.ts" 匹配
 *
 * 3. 文件路径匹配（+0.1/关键词）
 *    - 关键词与完整文件路径匹配
 *    - 例如：任务含 "api"，路径为 "src/api/routes.ts" 匹配
 *
 * 4. 文件内容关键词频率（+0.02/次，上限 0.3/关键词）
 *    - 关键词在文件内容中出现的次数
 *    - 每个关键词独立计算，上限 0.3 防止高频词过度影响
 *    - 例如："user" 出现 15 次 → +0.3（达到上限）
 *
 * 5. 导出符号匹配（+0.3/精确匹配，+0.15/部分匹配）
 *    - 精确匹配：任务描述直接包含导出符号名（函数/类/接口等）
 *    - 部分匹配：关键词与导出符号名匹配
 *    - 例如：任务含 "getUser"，文件导出 getUser 函数 → +0.3
 *
 * 中文语义扩展：
 * - 自动将中文关键词映射为英文别名（如 "用户" → "user"）
 * - 覆盖常见领域：认证、服务、接口、数据库、配置、测试等
 *
 * 最终得分 = min(累计得分, 1.0)，取 Top 50 个文件返回。
 *
 * 压缩策略（基于得分）：
 * - score >= 0.8: 完整内容（full）
 * - score >= 0.5: 骨架（skeleton）— 保留函数签名、导出、关键逻辑
 * - score >= 0.3: 摘要（summary）— 仅保留导出列表和文件描述
 * - score < 0.3: 跳过
 *
 * @param description - 任务描述文本
 * @param index - 项目索引（包含模块、文件、导出等信息）
 * @returns 按得分降序排列的文件评分列表，最多 50 个
 */
/**
 * Score files for relevance AND cache their content so `assembleRelevantCode`
 * can skip re-reading the same bytes a second time (P2#15 fix).
 *
 * The returned `content` field is populated only for files that were successfully
 * read during scoring; callers must handle the `undefined` case.
 */
async function scoreFiles(
  description: string,
  index: ProjectIndex
): Promise<{ file: string; score: number; content?: string }[]> {
  const lower = description.toLowerCase();
  const keywords = extractSearchKeywords(description);

  // Content read during scoring — shared with the assembly phase (avoid double-read)
  const contentCache = new Map<string, string>();

  const results: { file: string; score: number }[] = [];

  for (const mod of index.modules) {
    let baseScore = 0;

    // Module name match
    for (const kw of keywords) {
      if (mod.name.toLowerCase().includes(kw)) baseScore += 0.3;
    }

    for (const file of mod.files) {
      const fullPath = path.join(index.rootPath, file);
      let score = baseScore;

      // File name match
      const fileName = path.basename(file).toLowerCase();
      for (const kw of keywords) {
        if (fileName.includes(kw)) score += 0.2;
      }

      // File path match
      const filePath = file.toLowerCase();
      for (const kw of keywords) {
        if (filePath.includes(kw)) score += 0.1;
      }

      // Content-based scoring — cache the read so assembly phase can reuse it
      try {
        const content = await readFile(fullPath);
        contentCache.set(fullPath, content);           // ← cache for assembly phase

        const contentLower = content.toLowerCase();
        for (const kw of keywords) {
          const count = (contentLower.match(new RegExp(escapeRegExp(kw), 'g')) || []).length;
          score += Math.min(count * 0.02, 0.3);   // cap at 0.3 per keyword
        }

        // Exports mentioned in description
        for (const exp of mod.exports) {
          if (lower.includes(exp.name.toLowerCase())) {
            score += 0.3;
          }
          for (const kw of keywords) {
            if (exp.name.toLowerCase().includes(kw)) {
              score += 0.15;
            }
          }
        }
      } catch {
        continue;
      }

      if (score > 0) {
        results.push({ file: fullPath, score: Math.min(score, 1) });
      }
    }
  }

  // P5: Boost key entry-point files so they're always included in context
  const KEY_FILES = [
    /\/main\.\w+$/, /\/App\.\w+$/, /\/index\.\w+$/, /\/server\.\w+$/,
    /\/Dockerfile$/, /\/Makefile$/, /\/docker-compose\.ya?ml$/,
    /\/go\.mod$/, /\/package\.json$/, /\/tsconfig\.json$/,
    /\/(app|main|server|index)\.(go|py|rb|rs|java|kt|tsx?|jsx?)$/,
  ];
  const KEY_DIRS = ['cmd/', 'pkg/', 'internal/', 'src/', 'app/', 'lib/'];
  for (const r of results) {
    const fn = r.file.replace(/\\/g, '/').split('/').pop() || '';
    const dirPath = r.file.replace(/\\/g, '/');
    if (KEY_FILES.some(p => p.test(dirPath))) r.score = Math.max(r.score, 0.9);
    else if (KEY_DIRS.some(d => dirPath.includes(d)) && fn.match(/^(main|app|server|index|handler|router|config|db|model)\.\w+$/)) r.score = Math.max(r.score, 0.6);
  }

  // Attach cached content to each result entry before returning
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(r => ({ ...r, content: contentCache.get(r.file) }));
}

function extractSearchKeywords(description: string): string[] {
  const lower = description.toLowerCase();
  const keywords = new Set<string>();

  for (const token of lower.split(/[\s,，。；;:：/\\()[\]{}"'`<>|!?！？、-]+/)) {
    addKeyword(keywords, token);
    for (const part of splitIdentifier(token)) {
      addKeyword(keywords, part);
    }
  }

  const chineseAliases: Array<[RegExp, string[]]> = [
    // Auth & Identity
    [/用户|账号|账户|会员|登录|登陆|鉴权|权限|认证/g, ['user', 'account', 'member', 'auth', 'login', 'permission', 'session', 'jwt', 'token', 'oauth']],
    // Business logic
    [/支付|交易|转账|汇款|订单|结算|账单/g, ['payment', 'transaction', 'transfer', 'order', 'billing', 'invoice']],
    [/钱包|余额|资金|充值|提现/g, ['wallet', 'balance', 'fund', 'deposit', 'withdraw']],
    [/风控|风险|限额|审批/g, ['risk', 'limit', 'approval', 'kyc', 'compliance']],
    [/代理|agent|bot|自动化|编排/g, ['agent', 'bot', 'orchestration', 'automation']],
    // Infrastructure
    [/服务|业务|后端|中间件/g, ['service', 'backend', 'server', 'middleware']],
    [/接口|路由|控制器|端点|endpoint/g, ['api', 'route', 'router', 'controller', 'handler', 'endpoint']],
    [/校验|验证|检查|审计/g, ['validate', 'validation', 'verify', 'check', 'audit']],
    [/配置|设置|环境/g, ['config', 'setting', 'env', 'environment']],
    [/数据库|表|字段|模型|实体|仓储/g, ['database', 'db', 'model', 'schema', 'entity', 'repository', 'dao']],
    [/测试|用例|单元|集成|验收/g, ['test', 'spec', 'unit', 'integration', 'e2e', 'acceptance']],
    [/记忆|规则|约束|偏好/g, ['memory', 'rule', 'constraint', 'preference']],
    [/任务|队列|调度|执行|编排/g, ['task', 'queue', 'schedule', 'execution', 'pipeline']],
    [/上下文|压缩|预算/g, ['context', 'compress', 'compression', 'budget']],
    [/扫描|索引|识别|检测|发现/g, ['scan', 'scanner', 'index', 'detect', 'discovery']],
    [/安全|敏感|危险|漏洞|注入/g, ['security', 'sensitive', 'dangerous', 'vulnerability', 'injection']],
    [/报告|变更|差异|diff|回执/g, ['report', 'diff', 'change', 'receipt']],
    // Frontend & UI
    [/前端|界面|页面|组件|UI|视图|面板/g, ['frontend', 'ui', 'view', 'component', 'page', 'panel', 'layout']],
    [/样式|CSS|布局|响应式/g, ['style', 'css', 'layout', 'responsive']],
    // DevOps & Infrastructure
    [/部署|构建|发布|上线|CI|CD/g, ['deploy', 'build', 'release', 'ci', 'cd', 'pipeline', 'github', 'actions']],
    [/Docker|容器|镜像|k8s|编排/g, ['docker', 'container', 'image', 'kubernetes', 'k8s', 'compose']],
    [/监控|日志|报警|追踪/g, ['monitor', 'log', 'alert', 'trace', 'observability']],
    // Blockchain/Web3
    [/合约|智能合约|solidity|abi|签名/g, ['contract', 'solidity', 'abi', 'signature', 'ecdsa']],
    [/链上|区块链|预测市场|oracle/g, ['chain', 'blockchain', 'prediction', 'market', 'oracle']],
    // General
    [/文档|readme|指南|说明/g, ['doc', 'readme', 'guide', 'documentation']],
    [/启动|运行|开始|dev|start|serve/g, ['start', 'run', 'dev', 'serve', 'launch']],
    [/分析|检查|审查|review|扫描/g, ['analysis', 'review', 'scan', 'inspect']],
    [/修复|修|fix|bug|错误/g, ['fix', 'bug', 'error', 'repair', 'patch']],
    [/重构|整理|优化|清理/g, ['refactor', 'clean', 'optimize', 'restructure']],
    [/补全|补齐|补|生成|创建/g, ['complete', 'generate', 'create', 'scaffold']],
  ];

  for (const [pattern, aliases] of chineseAliases) {
    if (pattern.test(description)) {
      for (const alias of aliases) addKeyword(keywords, alias);
    }
  }

  return Array.from(keywords).slice(0, 40);
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-.]+|\s+/)
    .filter(Boolean);
}

function addKeyword(keywords: Set<string>, value: string): void {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 2) return;
  if (/^\d+$/.test(normalized)) return;
  keywords.add(normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Compression methods
// ============================================================
function compressToSkeleton(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipBlock = false;
  let blockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Always include: imports, exports, function signatures, class declarations, interface declarations
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export ') ||
      trimmed.startsWith('function ') ||
      trimmed.startsWith('async function ') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('enum ') ||
      trimmed.startsWith('const ') ||
      trimmed.match(/^\s*(public|private|protected|static|async)?\s*\w+\s*\(/) ||
      trimmed.match(/^\s*(GET|POST|PUT|DELETE|PATCH)\s/) ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      result.push(line);
      skipBlock = false;
      continue;
    }

    // Track block depth for body skipping
    const openBraces = (trimmed.match(/{/g) || []).length;
    const closeBraces = (trimmed.match(/}/g) || []).length;
    blockDepth += openBraces - closeBraces;

    if (skipBlock) {
      if (blockDepth <= 0) {
        result.push('  // ... (body omitted)');
        skipBlock = false;
      }
      continue;
    }

    // Start skipping after function/class declaration
    if (trimmed.endsWith('{') && (
      trimmed.includes('function') || trimmed.includes('class') ||
      trimmed.includes('if') || trimmed.includes('for') || trimmed.includes('while')
    )) {
      result.push(line);
      skipBlock = true;
      blockDepth = 1;
      continue;
    }

    // Skip empty lines in skeleton mode
    if (trimmed === '') continue;

    result.push(line);
  }

  return result.join('\n');
}

function compressToSummary(content: string, filePath: string): string {
  const lines = content.split('\n');
  const exports: string[] = [];
  const imports: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ')) {
      imports.push(trimmed.substring(0, 80));
    }
    if (trimmed.startsWith('export ')) {
      exports.push(trimmed.substring(0, 80));
    }
  }

  const linesOfCode = lines.length;
  const description = guessFileResponsibility(content, filePath);

  return [
    `// ${filePath}`,
    `// ${description} (${linesOfCode} lines)`,
    imports.length > 0 ? `// imports: ${imports.length}` : '',
    exports.length > 0 ? `// exports: ${exports.slice(0, 10).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function guessFileResponsibility(content: string, filePath: string): string {
  const lower = content.toLowerCase();
  const fileName = path.basename(filePath);

  if (fileName.includes('model') || fileName.includes('entity') || fileName.includes('schema')) return '数据模型定义';
  if (fileName.includes('service')) return '业务逻辑服务';
  if (fileName.includes('controller') || fileName.includes('handler') || fileName.includes('route')) return '请求处理和路由';
  if (fileName.includes('repository') || fileName.includes('dao')) return '数据访问层';
  if (fileName.includes('util') || fileName.includes('helper')) return '工具函数';
  if (fileName.includes('config')) return '配置文件';
  if (fileName.includes('test') || fileName.includes('spec')) return '测试文件';
  if (fileName.includes('component') || fileName.includes('view')) return 'UI 组件';
  if (lower.includes('class ')) return '类定义';
  if (lower.includes('function ')) return '函数/工具集';

  return '源码文件';
}

// ============================================================
// Global memory hints (S17.4)
// ============================================================
function assembleGlobalMemoryHints(
  globalMem: import('../types.js').GlobalMemory,
  identity: ProjectIdentity
): string {
  const parts: string[] = [];
  parts.push('⚠️ 以下为历史记忆，仅供参考。如果没有相关信息，请如实说"无历史记录"，不要编造。');

  // User preferences
  const prefs = globalMem.preferences;
  if (prefs) {
    const styleHints: string[] = [];
    if (prefs.codeStyle?.namingConvention) styleHints.push(`命名: ${prefs.codeStyle.namingConvention}`);
    if (prefs.codeStyle?.indentStyle) styleHints.push(`缩进: ${prefs.codeStyle.indentStyle} (${prefs.codeStyle.indentSize || 2})`);
    if (prefs.codeStyle?.quoteStyle) styleHints.push(`引号: ${prefs.codeStyle.quoteStyle}`);
    if (styleHints.length > 0) parts.push('## 用户代码风格偏好\n' + styleHints.map(s => `- ${s}`).join('\n'));

    if (prefs.techPreferences?.length > 0) {
      parts.push('\n## 用户技术偏好\n- ' + prefs.techPreferences.slice(0, 5).join('\n- '));
    }
    if (prefs.commentLanguage) {
      parts.push(`\n注释语言偏好: ${prefs.commentLanguage === 'chinese' ? '中文' : '英文'}`);
    }
  }

  // Tech stack best practices matching current project
  const lang = identity.language;
  const framework = identity.framework;
  const relevantTechKeys = [lang, framework].filter(Boolean) as string[];
  for (const key of relevantTechKeys) {
    const normalizedKey = key.toLowerCase();
    for (const [techKey, techMem] of globalMem.techStacks) {
      if (techKey.includes(normalizedKey) || normalizedKey.includes(techKey)) {
        if (techMem.bestPractices.length > 0) {
          parts.push(`\n## ${key} 最佳实践\n` + techMem.bestPractices.slice(0, 5).map(bp => `- ${bp}`).join('\n'));
        }
        if (techMem.commonPatterns.length > 0) {
          parts.push(`\n## ${key} 常用模式\n` + techMem.commonPatterns.slice(0, 4).map(p => `- ${p}`).join('\n'));
        }
        break;
      }
    }
  }

  // Known pitfalls relevant to current tech
  const relevantPitfalls = globalMem.pitfalls
    .filter(p => relevantTechKeys.some(k => p.tech.toLowerCase().includes(k.toLowerCase())))
    .slice(0, 3);
  if (relevantPitfalls.length > 0) {
    parts.push('\n## 已知踩坑记录\n' + relevantPitfalls.map(p =>
      `- [${p.severity}] ${p.description}${p.resolution ? ` — 解决: ${p.resolution}` : ''}`
    ).join('\n'));
  }

  return parts.join('\n');
}

// ============================================================
// Memory assembly
// ============================================================
function assembleRelevantMemory(
  task: Task,
  memory: ProjectMemory,
  budget: number
): string {
  const parts: string[] = [];

  // Architecture rules
  if (memory.rules.length > 0) {
    parts.push('## 项目架构约束');
    for (const rule of memory.rules.slice(0, 10)) {
      parts.push(`- [${rule.scope}] ${rule.description}`);
    }
  }

  // Recent decisions
  const recentDecisions = memory.decisions.slice(-5);
  if (recentDecisions.length > 0) {
    parts.push('\n## 近期决策记录');
    for (const dec of recentDecisions) {
      parts.push(`- ${dec.decision.substring(0, 100)}`);
    }
  }

  // Related task history
  const relatedTasks = memory.taskHistory
    .filter(t => task.description.toLowerCase().split(/\s+/).some(
      kw => t.description.toLowerCase().includes(kw)
    ))
    .slice(0, 5);

  if (relatedTasks.length > 0) {
    parts.push('\n## 相关历史任务');
    for (const t of relatedTasks) {
      parts.push(`- [${t.status}] ${t.description.substring(0, 100)}`);
    }
  }

  const approvedCandidates = memory.memoryCandidates
    .filter(candidate =>
      candidate.reviewStatus === 'approved' &&
      candidate.kind !== 'sensitive' &&
      candidate.suggestedScope !== 'task-only'
    )
    .filter(candidate => isMemoryCandidateRelevant(task.description, candidate.summary, candidate.content))
    .slice(0, 8);  // Get extra for verification attrition

  // Gate-2: Verify memory factual accuracy before injection
  const verifiedCandidates = approvedCandidates.filter(candidate => {
    if (!candidate.content) return true; // no content to verify, allow through
    return verifyMemoryFactualAccuracy(candidate.summary + ' ' + candidate.content);
  }).slice(0, 5);

  // Exclude stale candidates that failed verification (don't mutate during read)
  const staleCount = approvedCandidates.length - verifiedCandidates.length;
  if (staleCount > 0) {
    // Candidates excluded: stale entries are cleaned up by cleanupStaleMemory on next pass
  }

  if (verifiedCandidates.length > 0) {
    parts.push('\n## 已确认可复用记忆');
    for (const candidate of verifiedCandidates) {
      const label = candidate.kind === 'template' ? '模板' :
        candidate.kind === 'preference' ? '偏好' :
        candidate.kind === 'rule' ? '规则' :
        candidate.kind === 'fact' ? '事实' : '记忆';
      parts.push(`- [${label}/${candidate.riskLevel}] ${candidate.summary} [来源: 已验证]`);
    }
  }

  // Active feedback
  const activeFeedback = memory.feedbacks.filter(f => f.decayFactor > 0.5);
  if (activeFeedback.length > 0) {
    parts.push('\n## 用户反馈');
    for (const fb of activeFeedback.slice(0, 3)) {
      parts.push(`- ${fb.content}`);
    }
  }

  // M2: Enforce token budget — truncate if exceeds (rough: 4 chars ≈ 1 token)
  let result = parts.join('\n');
  if (budget > 0 && result.length > budget * 4) {
    result = result.slice(0, budget * 4);
  }
  return result;
}

function isMemoryCandidateRelevant(taskDescription: string, summary: string, content: string): boolean {
  const taskTokens = extractMemoryMatchTokens(taskDescription);
  const memoryText = `${summary} ${content}`.toLowerCase();
  if (taskTokens.length === 0) return true;
  // M2: Require at least 2 token overlap to filter out weakly-relevant memories
  const overlapCount = taskTokens.filter(token => memoryText.includes(token)).length;
  return overlapCount >= 2;
}

/** @internal — exported for unit tests; not part of public API. */
export function extractMemoryMatchTokens(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();

  // Latin tokens: split, filter short ones, also split camelCase/snake_case identifiers
  for (const token of normalized.split(/[^a-z0-9_./-]+/)) {
    const t = token.trim();
    if (t.length >= 3) tokens.add(t);
    for (const part of splitIdentifier(t)) {
      if (part.length >= 3) tokens.add(part);
    }
  }

  // Chinese → English alias expansion (same 20 groups as extractSearchKeywords)
  // NOTE: no /g flag here — .test() does not need it and /g causes lastIndex drift
  const chineseAliases: Array<[RegExp, string[]]> = [
    [/用户|账号|账户|会员|登录|登陆|鉴权|权限|认证/, ['user', 'account', 'member', 'auth', 'login', 'permission', 'session', 'jwt', 'token', 'oauth']],
    [/支付|交易|转账|汇款|订单|结算|账单/, ['payment', 'transaction', 'transfer', 'order', 'billing', 'invoice']],
    [/钱包|余额|资金|充值|提现/, ['wallet', 'balance', 'fund', 'deposit', 'withdraw']],
    [/风控|风险|限额|审批/, ['risk', 'limit', 'approval', 'kyc', 'compliance']],
    [/代理|自动化|编排/, ['agent', 'bot', 'orchestration', 'automation']],
    [/服务|业务|后端|中间件/, ['service', 'backend', 'server', 'middleware']],
    [/接口|路由|控制器|端点/, ['api', 'route', 'router', 'controller', 'handler', 'endpoint']],
    [/校验|验证|检查|审计/, ['validate', 'validation', 'verify', 'check', 'audit']],
    [/配置|设置|环境/, ['config', 'setting', 'env', 'environment']],
    [/数据库|字段|模型|实体|仓储/, ['database', 'db', 'model', 'schema', 'entity', 'repository', 'dao']],
    [/测试|用例|单元|集成|验收/, ['test', 'spec', 'unit', 'integration', 'e2e', 'acceptance']],
    [/记忆|规则|约束|偏好/, ['memory', 'rule', 'constraint', 'preference']],
    [/任务|队列|调度|执行/, ['task', 'queue', 'schedule', 'execution', 'pipeline']],
    [/上下文|压缩|预算/, ['context', 'compress', 'compression', 'budget']],
    [/扫描|索引|识别|检测|发现/, ['scan', 'scanner', 'index', 'detect', 'discovery']],
    [/安全|敏感|危险|漏洞|注入/, ['security', 'sensitive', 'dangerous', 'vulnerability', 'injection']],
    [/报告|变更|差异|回执/, ['report', 'diff', 'change', 'receipt']],
    [/前端|界面|页面|组件|视图|面板/, ['frontend', 'ui', 'view', 'component', 'page', 'panel', 'layout']],
    [/样式|布局|响应式/, ['style', 'css', 'layout', 'responsive']],
    [/部署|构建|发布|上线/, ['deploy', 'build', 'release', 'ci', 'cd', 'pipeline']],
    [/容器|镜像/, ['docker', 'container', 'image', 'kubernetes', 'k8s']],
    [/监控|日志|报警|追踪/, ['monitor', 'log', 'alert', 'trace', 'observability']],
    [/合约|智能合约|签名/, ['contract', 'solidity', 'abi', 'signature', 'ecdsa']],
    [/区块链|预测市场/, ['chain', 'blockchain', 'prediction', 'market', 'oracle']],
    [/文档|指南|说明/, ['doc', 'readme', 'guide', 'documentation']],
    [/启动|运行|开始/, ['start', 'run', 'dev', 'serve', 'launch']],
    [/分析|审查/, ['analysis', 'review', 'scan', 'inspect']],
    [/修复|错误/, ['fix', 'bug', 'error', 'repair', 'patch']],
    [/重构|整理|优化|清理/, ['refactor', 'clean', 'optimize', 'restructure']],
    [/补全|生成|创建/, ['complete', 'generate', 'create', 'scaffold']],
  ];

  for (const [pattern, aliases] of chineseAliases) {
    if (pattern.test(text)) {
      for (const alias of aliases) tokens.add(alias);
    }
  }

  return [...tokens].slice(0, 20);
}

function extractSymbolsFromDescription(description: string, index: import('../types.js').ProjectIndex): string[] {
  const symbols: string[] = [];
  const words = description.split(/[\s,，。、；;：:]+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9_]/g, '').trim();
    if (clean.length < 3) continue;
    // Match against exports in project index
    for (const mod of index.modules) {
      for (const exp of mod.exports) {
        if (exp.name.toLowerCase() === clean.toLowerCase() || exp.name.toLowerCase().includes(clean.toLowerCase())) {
          symbols.push(exp.name);
        }
      }
    }
  }
  return [...new Set(symbols)].slice(0, 8);
}

// Gate-2: Verify memory factual accuracy before injection
// Checks if memory mentions files/symbols that no longer exist in the project
function verifyMemoryFactualAccuracy(memoryText: string): boolean {
  // Extract potential file paths from memory text
  const filePattern = /\b([\w./-]+\.[\w]{1,6})\b/g;
  const mentionedFiles: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(memoryText)) !== null) {
    const fp = match[1];
    if (/\.(ts|tsx|js|jsx|go|py|java|kt|swift|rs|vue|css|json|yaml|yml|toml|md)$/i.test(fp) && !fp.startsWith('http')) {
      mentionedFiles.push(fp);
    }
  }

  // Check if mentioned files still exist (best-effort, sync)
  if (mentionedFiles.length > 0) {
    try {
      // existsSync imported at top of file
      let staleFileCount = 0;
      for (const fp of mentionedFiles) {
        if (!fp.includes('/') && !fp.includes('\\')) continue; // skip bare filenames
        if (!existsSync(fp)) staleFileCount++;
      }
      // Gap-5: reject if ANY file with a path is missing (was: only if ALL missing AND ≥2)
      if (staleFileCount > 0) {
        return false; // At least one referenced file no longer exists — memory is stale
      }
    } catch { /* fs access failed, allow through */ }
  }

  // Check for hallucination indicators in memory text
  const hallucinationMarkers = [
    /你此前要求我/,           // "you asked me to..." — fabricating user requests
    /根据.*记忆.*你/,          // "according to memory, you..."
    /我们上次/,                // "last time we..." — vague reference
    /上一轮/,                  // "previous round" — crossing boundaries
    /you asked me to/i,        // English: fabricating user requests
    /as per your (request|instruction)/i,  // English: fabricated authority
    /last time we/i,           // English: vague reference
    /in the previous (conversation|session)/i, // English: boundary crossing
    /according to (my|our) (memory|records)/i, // English: memory attribution
    /i recall (you|us) /i,     // English: fabricated recall
    /based on our (previous|earlier|last)/i, // English: vague history
  ];
  for (const marker of hallucinationMarkers) {
    if (marker.test(memoryText)) {
      return false;
    }
  }

  return true;
}
