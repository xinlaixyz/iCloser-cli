// Document Generator — detect, generate, quality-check project documentation
import * as path from 'path';
import type { DocTemplate, DocType, DocGenerationResult, DocsContext } from '../types.js';
import type { ProjectIndex } from '../types.js';

// ============================================================
// 9 Standard document templates
// ============================================================
export const DOC_TEMPLATES: DocTemplate[] = [
  { type: 'PRD', filename: 'PRD.md', title: '产品需求文档', description: '产品概述、目标用户、核心功能、版本规划', required: true },
  { type: 'USER_GUIDE', filename: 'USER_GUIDE.md', title: '用户使用手册', description: '快速开始、安装部署、功能介绍、配置说明', required: true },
  { type: 'API', filename: 'API.md', title: 'API 接口文档', description: '接口列表、认证方式、请求/响应示例、错误码', required: false },
  { type: 'ARCHITECTURE', filename: 'ARCHITECTURE.md', title: '架构设计文档', description: '系统架构、技术选型、模块职责、数据流', required: true },
  { type: 'TESTING', filename: 'TESTING.md', title: '测试策略文档', description: '测试框架、分层策略、覆盖率、CI集成', required: false },
  { type: 'DEPLOYMENT', filename: 'DEPLOYMENT.md', title: '部署运维手册', description: '环境要求、部署步骤、配置管理、故障处理', required: false },
  { type: 'CHANGELOG', filename: 'CHANGELOG.md', title: '版本变更记录', description: '版本历史、变更内容、迁移指南', required: false },
  { type: 'FAQ', filename: 'FAQ.md', title: '常见问题', description: '常见使用问题、故障排除、最佳实践', required: false },
  { type: 'CONTRIBUTING', filename: 'CONTRIBUTING.md', title: '贡献指南', description: '开发环境搭建、代码规范、PR流程', required: false },
];

// ============================================================
// D1: Document gap detection
// ============================================================
export async function detectDocGaps(
  rootPath: string,
  index: ProjectIndex,
): Promise<{ existing: DocType[]; missing: DocType[] }> {
  const existing: DocType[] = [];
  const fs = await import('fs/promises');
  const docsDir = path.join(rootPath, 'docs');

  for (const template of DOC_TEMPLATES) {
    const docPath = path.join(rootPath, template.filename);
    const docsPath = path.join(docsDir, template.filename);
    try { await fs.access(docPath); existing.push(template.type); continue; } catch {}
    try { await fs.access(docsPath); existing.push(template.type); continue; } catch {}
  }

  const missing = DOC_TEMPLATES.filter(t => !existing.includes(t.type)).map(t => t.type);
  return { existing, missing };
}

// ============================================================
// D2: Assemble documentation context from project index
// ============================================================
export async function assembleDocsContext(
  rootPath: string,
  index: ProjectIndex,
): Promise<DocsContext> {
  const allFiles = index.modules.flatMap(m => m.files.map(f => f.replace(/\\/g, '/')));
  const allPaths = allFiles.join(' ').toLowerCase();

  // Features: extract from README + code patterns
  const features: string[] = [];
  try {
    const { readFile } = await import('../utils/fs.js');
    const readme = await readFile([rootPath, 'README.md'].join('/'));
    const featureMatches = readme.matchAll(/[*\-]\s+(.+)/g);
    for (const m of featureMatches) {
      if (!m[1].includes('http') && m[1].length > 5) features.push(m[1].trim().slice(0, 80));
    }
  } catch {}

  // API routes
  const apiRoutes: { method: string; path: string; handler: string }[] = [];
  for (const mod of index.modules) {
    for (const exp of mod.exports) {
      const name = exp.name.toLowerCase();
      if (/handler|route|controller|api|endpoint/.test(name)) {
        apiRoutes.push({ method: name.includes('get') ? 'GET' : name.includes('post') ? 'POST' : 'UNKNOWN', path: `/${mod.name}`, handler: exp.name });
      }
    }
  }

  // Config keys
  const configKeys: string[] = [];
  for (const f of allFiles) {
    if (/config|env|setting/i.test(f)) {
      try {
        const { readFile } = await import('../utils/fs.js');
        const content = await readFile([rootPath, f].join('/'));
        const envMatches = content.matchAll(/([A-Z_]{3,})/g);
        for (const m of envMatches) {
          if (m[1].includes('KEY') || m[1].includes('SECRET') || m[1].includes('CONFIG') || m[1].includes('URL') || m[1].includes('PORT')) {
            if (!configKeys.includes(m[1])) configKeys.push(m[1]);
          }
        }
      } catch {}
    }
  }

  // Deploy info
  const deployInfo = {
    docker: allFiles.some(f => f.toLowerCase().includes('dockerfile')),
    makefile: allFiles.some(f => f.toLowerCase() === 'makefile'),
    envVars: configKeys.slice(0, 10),
  };

  // Tech stack
  const techStack: string[] = [index.identity.language, index.identity.framework, index.identity.database, index.identity.buildSystem].filter(Boolean);

  // Error patterns
  const errorPatterns: string[] = [];
  for (const f of allFiles) {
    if (f.includes('error') || f.includes('Error')) {
      errorPatterns.push(f.split('/').pop() || f);
    }
  }

  return {
    projectName: index.identity.language || 'project',
    description: index.architecturePattern || '',
    techStack,
    features: features.slice(0, 20),
    apiRoutes: apiRoutes.slice(0, 15),
    configKeys,
    deployInfo,
    errorPatterns: errorPatterns.slice(0, 10),
    existingDocs: [],
    missingDocs: [],
  };
}

// ============================================================
// D3/D4: Generate a single document via AI
// ============================================================
export function buildDocGenerationPrompt(
  docType: DocType,
  context: DocsContext,
): { system: string; task: string } {
  const template = DOC_TEMPLATES.find(t => t.type === docType)!;

  const sharedContext = [
    `项目名称: ${context.projectName}`,
    `技术栈: ${context.techStack.join(', ')}`,
    `功能列表: ${context.features.join('; ')}`,
    `API路由: ${context.apiRoutes.map(r => `${r.method} ${r.path}`).join(', ')}`,
    `配置项: ${context.configKeys.slice(0, 5).join(', ')}`,
    `部署: ${context.deployInfo.docker ? 'Docker, ' : ''}${context.deployInfo.makefile ? 'Makefile, ' : ''}`,
  ].join('\n');

  const prompts: Record<DocType, { system: string; task: string }> = {
    PRD: {
      system: '你是产品经理。根据项目信息编写产品需求文档（PRD）。从用户视角描述功能，非技术实现。',
      task: `编写 ${context.projectName} 的产品需求文档 PRD.md。\n${sharedContext}\n\n包含：产品概述、目标用户、核心功能（每个功能一个段落，至少10个）、非功能需求（性能/安全/可用性）、版本规划。至少800字，包含表格。输出 JSON 变更契约。`,
    },
    USER_GUIDE: {
      system: '你是技术文档作者。编写易懂的用户使用手册，面向非技术用户。',
      task: `编写 ${context.projectName} 的用户手册 USER_GUIDE.md。\n${sharedContext}\n\n包含：快速开始（3步内能跑起来）、安装部署、各功能使用方法、配置说明、常见操作。至少800字，含代码示例。输出 JSON 变更契约。`,
    },
    API: {
      system: '你是API文档专家。根据代码中的路由和handler编写API文档。',
      task: `编写 ${context.projectName} 的API文档 API.md。\n${sharedContext}\n\n包含：认证方式、接口列表（请求方法/路径/参数/响应示例）、错误码说明。至少500字，每个接口含curl示例。输出 JSON 变更契约。`,
    },
    ARCHITECTURE: {
      system: '你是系统架构师。根据项目结构编写架构设计文档。',
      task: `编写 ${context.projectName} 的架构文档 ARCHITECTURE.md。\n${sharedContext}\n\n包含：系统架构图（ASCII art）、技术选型理由、模块职责（每个模块一段）、数据流、部署架构。至少800字。输出 JSON 变更契约。`,
    },
    TESTING: {
      system: '你是测试工程师。根据项目结构编写测试策略文档。',
      task: `编写 ${context.projectName} 的测试文档 TESTING.md。\n${sharedContext}\n\n包含：测试框架、分层策略（单元/集成/E2E）、覆盖率目标、运行方式、CI/CD集成。至少500字。输出 JSON 变更契约。`,
    },
    DEPLOYMENT: {
      system: '你是DevOps工程师。编写部署运维文档。',
      task: `编写 ${context.projectName} 的部署文档 DEPLOYMENT.md。\n${sharedContext}\n\n包含：环境要求、部署步骤（详细命令）、配置管理、监控告警、故障处理流程。至少600字。输出 JSON 变更契约。`,
    },
    CHANGELOG: {
      system: '你是发布经理。根据项目信息编写版本变更记录。',
      task: `编写 ${context.projectName} 的变更日志 CHANGELOG.md。\n${sharedContext}\n\n包含：版本历史、各版本新功能/修复/破坏性变更。至少列出3个版本的变更。输出 JSON 变更契约。`,
    },
    FAQ: {
      system: '你是用户支持专家。根据项目信息编写FAQ。',
      task: `编写 ${context.projectName} 的常见问题 FAQ.md。\n${sharedContext}\n\n包含：至少10个常见问题和解答（安装/使用/故障）。问题用##标题，答案包含具体命令或步骤。输出 JSON 变更契约。`,
    },
    CONTRIBUTING: {
      system: '你是开源社区经理。编写贡献指南。',
      task: `编写 ${context.projectName} 的贡献指南 CONTRIBUTING.md。\n${sharedContext}\n\n包含：开发环境搭建、代码规范、提交规范（Conventional Commits）、PR流程、问题反馈。至少500字。输出 JSON 变更契约。`,
    },
  };

  return prompts[docType];
}

// ============================================================
// Quality gate: check document meets minimum standards
// ============================================================
export function checkDocumentQuality(content: string): { pass: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  if (content.length < 500) { issues.push('字数不足 500'); score -= 30; }
  if (!/\|.*\|.*\|/.test(content)) { issues.push('缺少表格'); score -= 20; }
  if (!/```/.test(content)) { issues.push('缺少代码示例'); score -= 20; }
  if (/(TODO|TBD|待补充|待完善)/i.test(content)) { issues.push('存在占位符 (TODO/TBD)'); score -= 30; }
  if (!/#{1,3}\s/.test(content)) { issues.push('缺少 Markdown 标题'); score -= 10; }

  return { pass: score >= 60, score: Math.max(0, score), issues };
}

// ============================================================
// DM1: AI incremental edit — modify specific sections only
// ============================================================
export async function editDocumentSection(
  filePath: string,
  prompt: string,
  providerAdapter: { chat: (p: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string }> },
): Promise<{ original: string; modified: string; diff: string }> {
  const { readFile } = await import('../utils/fs.js');
  const original = await readFile(filePath);
  const response = await providerAdapter.chat({
    systemPrompt: '你是文档编辑专家。根据用户指令修改文档。只输出修改后的完整文档内容，保留未修改的章节。不要输出解释。',
    task: `原始文档：\n${original.slice(0, 4000)}\n\n修改指令：${prompt}\n\n输出修改后的完整文档。`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });
  const modified = response.content;
  const diff = generateSimpleDiff(original, modified);
  return { original, modified, diff };
}

// DM1: Simple line diff for terminal display
function generateSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      if (result.length > 0 && !result[result.length - 1].startsWith('...')) result.push('...');
    } else {
      if (i < oldLines.length && oldLines[i].trim()) result.push(`\x1b[31m- ${oldLines[i]}\x1b[0m`);
      if (i < newLines.length && newLines[i].trim()) result.push(`\x1b[32m+ ${newLines[i]}\x1b[0m`);
    }
  }
  return result.join('\n');
}

// DM1: Visual diff display (uses existing diff-renderer if available)
export async function showDocumentDiff(filePath: string, oldContent: string, newContent: string): Promise<string> {
  try {
    const { renderDiff, parseDiff } = await import('../cli/diff-renderer.js');
    const unifiedDiff = `--- ${filePath} (old)\n+++ ${filePath} (new)\n@@ -1,${oldContent.split('\n').length} +1,${newContent.split('\n').length} @@\n${generateSimpleDiff(oldContent, newContent)}`;
    const files = parseDiff(unifiedDiff);
    return renderDiff(files);
  } catch { return generateSimpleDiff(oldContent, newContent); }
}

// ============================================================
// DM2: Version history and rollback
// ============================================================
export async function saveDocSnapshot(rootPath: string, filename: string, content: string): Promise<string> {
  const snapDir = [rootPath, '.icloser', 'docs-snapshots'].join('/');
  const { ensureDir, writeFile } = await import('../utils/fs.js');
  await ensureDir(snapDir);
  const ver = Date.now().toString(36);
  const snapPath = [snapDir, `${filename}.v${ver}`].join('/');
  await writeFile(snapPath, content);
  return `v${ver}`;
}

export async function listDocSnapshots(rootPath: string, filename: string): Promise<string[]> {
  const snapDir = [rootPath, '.icloser', 'docs-snapshots'].join('/');
  try {
    const fs = await import('fs/promises');
    const entries = await fs.readdir(snapDir);
    return entries.filter(e => e.startsWith(filename)).sort().reverse();
  } catch { return []; }
}

export async function loadDocSnapshot(rootPath: string, snapshotName: string): Promise<string> {
  const snapPath = [rootPath, '.icloser', 'docs-snapshots', snapshotName].join('/');
  const { readFile } = await import('../utils/fs.js');
  return readFile(snapPath);
}

// DM2: Section-level management
export function extractDocSections(content: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentBody: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      if (currentHeading) sections.push({ heading: currentHeading, body: currentBody.join('\n') });
      currentHeading = line.replace(/^#+\s*/, '');
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentHeading) sections.push({ heading: currentHeading, body: currentBody.join('\n') });
  return sections;
}

// DM2: Code → document sync
export function detectDocAffectedFiles(index: import('../types.js').ProjectIndex): Record<string, string[]> {
  const affected: Record<string, string[]> = {};
  for (const mod of index.modules) {
    for (const exp of mod.exports) {
      if (/handler|route|api/i.test(exp.name)) {
        if (!affected['API.md']) affected['API.md'] = [];
        affected['API.md'].push(`${mod.name}/${exp.name}`);
      }
    }
  }
  for (const mod of index.modules) {
    if (mod.name !== index.modules[0]?.name) {
      if (!affected['ARCHITECTURE.md']) affected['ARCHITECTURE.md'] = [];
      affected['ARCHITECTURE.md'].push(mod.name);
    }
  }
  return affected;
}

// ============================================================
// DM3: Cross-reference, translate, export, review, search, toc, consistency, templates
// ============================================================

// DM3#5: Cross-reference linking
export function buildDocLinkIndex(rootPath: string, docs: Record<string, string>): Record<string, string[]> {
  const links: Record<string, string[]> = {};
  for (const [file, content] of Object.entries(docs)) {
    links[file] = [];
    for (const [otherFile] of Object.entries(docs)) {
      if (otherFile !== file && content.includes(otherFile.replace('.md', ''))) {
        links[file].push(otherFile);
      }
    }
  }
  return links;
}

// DM3#9: Full-text search across all docs
export function searchDocs(docs: Record<string, string>, query: string): { file: string; line: string }[] {
  const results: { file: string; line: string }[] = [];
  for (const [file, content] of Object.entries(docs)) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        results.push({ file, line: line.trim().slice(0, 120) });
      }
    }
  }
  return results.slice(0, 30);
}

// DM3#11: Table of contents generation
export function generateTOC(content: string): string {
  const headings = content.match(/^#{1,3}\s+.+$/gm);
  if (!headings) return '';
  return headings.map(h => {
    const level = (h.match(/^#+/) || [''])[0].length;
    const title = h.replace(/^#+\s*/, '');
    const indent = '  '.repeat(level - 1);
    const anchor = title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/-+$/g, '');
    return `${indent}- [${title}](#${anchor})`;
  }).join('\n');
}

// DM3#12: Cross-document consistency check
export function checkDocsConsistency(docs: Record<string, string>): { file: string; issue: string }[] {
  const issues: { file: string; issue: string }[] = [];
  // Check PRD features vs API docs
  const prd = docs['PRD.md'] || '';
  const api = docs['API.md'] || '';
  if (prd && api) {
    const prdFeatures = prd.match(/[-*]\s+(.+)/g)?.map(f => f.replace(/^[-*]\s+/, '').trim()).filter(f => f.length > 5) || [];
    for (const feature of prdFeatures.slice(0, 10)) {
      const keyword = feature.slice(0, 4);
      if (!api.includes(keyword)) {
        issues.push({ file: 'API.md', issue: `PRD 提到 "${feature}" 但 API.md 中未找到相关接口` });
      }
    }
  }
  // Check ARCHITECTURE mentions in DEPLOYMENT
  const arch = docs['ARCHITECTURE.md'] || '';
  const deploy = docs['DEPLOYMENT.md'] || '';
  if (arch && deploy) {
    const techs = ['Redis', 'PostgreSQL', 'MySQL', 'MongoDB', 'Docker', 'Kubernetes', 'Nginx'];
    for (const tech of techs) {
      if (arch.includes(tech) && !deploy.includes(tech)) {
        issues.push({ file: 'DEPLOYMENT.md', issue: `ARCHITECTURE.md 提到 ${tech} 但 DEPLOYMENT.md 未说明其部署方式` });
      }
    }
  }
  return issues;
}

// DM3#13: Custom template management
const CUSTOM_TEMPLATES: Record<string, DocTemplate[]> = {};

export function createCustomTemplate(name: string, templates: DocTemplate[]): void {
  CUSTOM_TEMPLATES[name] = templates;
}

export function getCustomTemplates(): string[] {
  return Object.keys(CUSTOM_TEMPLATES);
}

export function getTemplate(name: string): DocTemplate[] | undefined {
  return CUSTOM_TEMPLATES[name];
}

// ============================================================
// D1: ask — AI answers questions from project docs
// ============================================================
export async function askDocs(
  rootPath: string, query: string, _index: ProjectIndex, config: { ai: { provider: string; model: string; apiKey?: string; maxTokens: number; temperature: number } }
): Promise<string> {
  const docs = await loadAllDocs(rootPath);
  const docText = Object.entries(docs).map(([file, content]) => `## ${file}\n${content.substring(0, 3000)}`).join('\n\n');
  const prompt = `你是一个项目文档助手。根据以下项目文档回答用户问题。

项目文档:
${docText.substring(0, 8000)}

用户问题: ${query}

请基于文档内容精准回答。如果文档中没有相关信息，请明确说明。`;
  const { createProvider } = await import('../ai/provider.js');
  const provider = createProvider({
    provider: config.ai.provider as 'mock' | 'claude' | 'deepseek' | 'openai' | 'qwen',
    model: config.ai.model, apiKey: config.ai.apiKey || '',
    maxTokens: config.ai.maxTokens, temperature: config.ai.temperature,
  });
  const response = await provider.chat({ systemPrompt: prompt, context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, task: query, history: '' });
  return `  ${response.content || '无法获取回答'}`;
}

// ============================================================
// D2: summarize — generate document summary
// ============================================================
export async function summarizeDoc(
  content: string, config: { ai: { provider: string; model: string; apiKey?: string; maxTokens: number; temperature: number } }
): Promise<string> {
  const prompt = `请用3-5句话总结以下文档的核心内容，用中文输出。

文档内容:
${content.substring(0, 6000)}`;
  const { createProvider } = await import('../ai/provider.js');
  const provider = createProvider({
    provider: config.ai.provider as 'mock' | 'claude' | 'deepseek' | 'openai' | 'qwen',
    model: config.ai.model, apiKey: config.ai.apiKey || '',
    maxTokens: 500, temperature: 0.3,
  });
  const response = await provider.chat({ systemPrompt: prompt, context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, task: '生成摘要', history: '' });
  return `  ${response.content || '无法生成摘要'}`;
}

// ============================================================
// D8: review — quality review with issues list
// ============================================================
export async function reviewDoc(
  content: string, config: { ai: { provider: string; model: string; apiKey?: string; maxTokens: number; temperature: number } }
): Promise<{ section: string; severity: 'high' | 'medium' | 'low'; description: string; suggestion?: string }[]> {
  const prompt = `审查以下文档的质量。找出：
1. 不明确或模糊的描述
2. 矛盾或冲突的内容
3. 缺失的关键信息
4. 格式和结构问题

对每个问题标注严重程度(high/medium/low)和所在章节。

文档内容:
${content.substring(0, 8000)}

输出格式：每行一个问题，格式为 "严重程度|章节|问题描述|建议"`;
  const { createProvider } = await import('../ai/provider.js');
  const provider = createProvider({
    provider: config.ai.provider as 'mock' | 'claude' | 'deepseek' | 'openai' | 'qwen',
    model: config.ai.model, apiKey: config.ai.apiKey || '',
    maxTokens: 1000, temperature: 0.3,
  });
  const response = await provider.chat({ systemPrompt: prompt, context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, task: '审查文档质量', history: '' });
  const lines = (response.content || '').split('\n').filter(l => l.includes('|'));
  return lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    return {
      severity: (parts[0] || 'low') as 'high' | 'medium' | 'low',
      section: parts[1] || '未知',
      description: parts[2] || line,
      suggestion: parts[3] || undefined,
    };
  });
}

// ============================================================
// D9: rewrite — adapt document for different audience
// ============================================================
export async function rewriteDoc(
  content: string, audience: string, config: { ai: { provider: string; model: string; apiKey?: string; maxTokens: number; temperature: number } }
): Promise<string> {
  const audienceMap: Record<string, string> = {
    beginner: '编程初学者，需要更多解释和示例',
    developer: '有经验的开发者，关注实现细节和 API',
    manager: '技术管理者，关注架构决策和资源需求',
    newbie: '完全新手，需要从基础概念开始解释',
    qa: '测试工程师，关注测试策略和验收标准',
  };
  const audienceDesc = audienceMap[audience] || audience;
  const prompt = `将以下文档改写为适合"${audienceDesc}"阅读的版本。保持原意，调整语言风格和详细程度。

原文档:
${content.substring(0, 6000)}`;
  const { createProvider } = await import('../ai/provider.js');
  const provider = createProvider({
    provider: config.ai.provider as 'mock' | 'claude' | 'deepseek' | 'openai' | 'qwen',
    model: config.ai.model, apiKey: config.ai.apiKey || '',
    maxTokens: 2000, temperature: 0.5,
  });
  const response = await provider.chat({ systemPrompt: prompt, context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, task: `改写文档为${audience}版本`, history: '' });
  return `  ${response.content || '改写失败'}`;
}

// ============================================================
// D7: changelog — generate changelog from git history
// ============================================================
export async function generateChangelog(
  rootPath: string, config: { ai: { provider: string; model: string; apiKey?: string; maxTokens: number; temperature: number } }
): Promise<string> {
  let gitLog = '';
  try {
    const { execSync } = await import('child_process');
    gitLog = execSync('git log --oneline -30', { cwd: rootPath, encoding: 'utf-8', timeout: 5000 });
  } catch { return '  无法读取 git 历史（需在 git 仓库中运行）'; }
  if (!gitLog.trim()) return '  Git 历史为空';
  const prompt = `将以下 git 提交记录整理为结构化的 CHANGELOG。按类型分组(feat/fix/docs/chore)，用中文描述。

Git 历史:
${gitLog}`;
  const { createProvider } = await import('../ai/provider.js');
  const provider = createProvider({
    provider: config.ai.provider as 'mock' | 'claude' | 'deepseek' | 'openai' | 'qwen',
    model: config.ai.model, apiKey: config.ai.apiKey || '',
    maxTokens: 1000, temperature: 0.3,
  });
  const response = await provider.chat({ systemPrompt: prompt, context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, task: '生成 CHANGELOG', history: '' });
  return response.content || '  生成失败';
}

// ============================================================
// readFileContent — read a file from project root
// ============================================================
export async function readFileContent(rootPath: string, file: string): Promise<string> {
  const fs = await import('fs/promises');
  const p = await import('path');
  const fp = p.join(rootPath, file);
  try { return await fs.readFile(fp, 'utf-8'); } catch { throw new Error(`无法读取文件: ${file}`); }
}

async function loadAllDocs(rootPath: string): Promise<Record<string, string>> {
  const docs: Record<string, string> = {};
  const fs = await import('fs/promises');
  const p = await import('path');
  const dirs = ['docs', 'doc'];
  for (const dir of dirs) {
    const dp = p.join(rootPath, dir);
    try {
      const entries = await fs.readdir(dp, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /\.(md|txt)$/i.test(e.name)) {
          docs[`${dir}/${e.name}`] = await fs.readFile(p.join(dp, e.name), 'utf-8');
        }
      }
    } catch { /* dir may not exist */ }
  }
  return docs;
}

// ============================================================
// D1: Document Q&A — ask questions across all docs
// ============================================================
export async function askDocuments(
  docs: Record<string, string>,
  question: string,
  providerAdapter: { chat: (p: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string }> },
): Promise<string> {
  const allContent = Object.entries(docs)
    .map(([file, content]) => `### ${file}\n${content.slice(0, 3000)}`)
    .join('\n\n');
  const resp = await providerAdapter.chat({
    systemPrompt: '你是项目文档专家。基于提供的文档内容回答问题。引用来源文档名和行号。用中文回答，简洁准确。',
    task: `文档内容:\n${allContent.slice(0, 12000)}\n\n问题: ${question}`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });
  return resp.content;
}

// ============================================================
// D2: Document summarization
// ============================================================
export async function summarizeDocument(
  content: string,
  filename: string,
  providerAdapter: { chat: (p: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string }> },
): Promise<string> {
  const resp = await providerAdapter.chat({
    systemPrompt: '你是文档摘要专家。用3-5句话总结文档核心内容，然后列出关键要点（最多5个）。',
    task: `文档: ${filename}\n${content.slice(0, 5000)}`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });
  return resp.content;
}

// ============================================================
// D8: Persona-based rewrite
// ============================================================
export async function rewriteDocument(
  content: string,
  targetPersona: string,
  providerAdapter: { chat: (p: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string }> },
): Promise<string> {
  const personaPrompts: Record<string, string> = {
    beginner: '改写成新手指南。去掉技术术语，加使用示例和截图说明。面向刚接触项目的开发者。',
    architect: '改写成架构师视角。突出设计决策、技术选型理由、模块间关系。',
    manager: '改写成管理层视角。突出进度、风险、资源需求、ROI。去掉代码细节。',
    developer: '改写成开发者视角。突出API用法、代码示例、调试技巧。',
  };
  const instruction = personaPrompts[targetPersona] || `改写成面向${targetPersona}的版本。`;
  const resp = await providerAdapter.chat({
    systemPrompt: `你是文档改写专家。${instruction}只输出改写后的完整文档。`,
    task: content.slice(0, 5000),
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });
  return resp.content;
}

// ============================================================
// D9: Document review — quality audit with line-level comments
// ============================================================
export async function reviewDocument(
  content: string,
  filename: string,
  providerAdapter: { chat: (p: { systemPrompt: string; task: string; context: { projectMeta: string; relevantCode: never[]; relevantMemory: string; totalTokens: number; budgetUsed: number }; history: string }) => Promise<{ content: string }> },
): Promise<string> {
  const resp = await providerAdapter.chat({
    systemPrompt: '你是文档审查专家。检查文档的完整性、准确性、清晰度。标注具体问题（位置+问题+建议）。输出审查报告。',
    task: `审查文档: ${filename}\n\n${content.slice(0, 5000)}\n\n请标注: 1)不清晰的表述 2)缺失的信息 3)矛盾之处 4)格式问题`,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });
  return resp.content;
}
