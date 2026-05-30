import * as path from 'path';
import { fileExists, readFile, writeFile } from '../utils/fs.js';
import { loadProjectMemory, saveProjectMemory } from './memory.js';
import type { ArchitectureRule, MemoryCandidate, ProjectMemory } from '../types.js';
import type { AgentTaskType } from './agent-task-loop.js';
import type { CodeDeliveryResult } from './code-delivery-pipeline.js';
import type { ResultQualityGateReport } from './result-quality-gate.js';

export interface MemoryPreviewItem {
  id: string;
  source: 'rule' | 'candidate' | 'task' | 'decision' | 'feedback';
  title: string;
  detail: string;
  reason: string;
  status?: string;
  riskLevel?: string;
  score: number;
}

export interface MemoryWhyResult extends MemoryPreviewItem {
  content?: string;
  evidence: string[];
  taskId?: string;
  sourceEventIds?: string[];
  updatedAt?: string;
}

export interface TaskMemorySummary {
  ruleCount: number;
  preferenceCount: number;
  relatedHistoryCount: number;
  candidateCount: number;
  conflicts: string[];
  items: MemoryPreviewItem[];
}

export interface PostTaskMemoryInput {
  rootPath: string;
  taskId: string;
  type: AgentTaskType;
  input: string;
  finalResponse: string;
  qualityGate: ResultQualityGateReport;
  codeDelivery: CodeDeliveryResult;
}

const TOKEN_ALIASES: Record<string, string[]> = {
  记忆: ['memory', 'mem', 'remember', 'recall', 'context'],
  工具: ['tool', 'tools', 'executor', 'repl'],
  代码: ['code', 'coding', 'diff', 'patch'],
  测试: ['test', 'tests', 'verify', 'validation'],
  文档: ['doc', 'docs', 'document', 'documentation'],
  发布: ['release', 'publish', 'trust'],
  协作: ['collab', 'collaboration', 'pr', 'issue'],
  安全: ['security', 'safe', 'policy'],
  提交: ['commit', 'git'],
  搜索: ['search', 'web'],
  参数: ['argument', 'parameter', 'param', 'input'],
  校验: ['validate', 'validation', 'verify', 'check', 'finite', 'number', 'nan', 'infinity'],
  验证: ['validate', 'validation', 'verify', 'check'],
  有限: ['finite', 'number', 'nan', 'infinity'],
  数字: ['number', 'numeric', 'finite'],
  函数: ['function', 'method', 'api'],
  公开: ['public', 'api', 'export'],
  注释: ['comment', 'jsdoc', 'documentation'],
};

export function extractMemoryExperienceTokens(text: string): string[] {
  const raw = text.toLowerCase();
  const tokens = new Set<string>();
  for (const token of raw.match(/[a-z0-9_\-.]+|[\u4e00-\u9fff]{1,4}/gi) || []) {
    if (token.length >= 2 || /[\u4e00-\u9fff]/.test(token)) tokens.add(token.toLowerCase());
  }
  for (const [cn, aliases] of Object.entries(TOKEN_ALIASES)) {
    if (raw.includes(cn) || aliases.some(alias => raw.includes(alias))) {
      tokens.add(cn);
      aliases.forEach(alias => tokens.add(alias));
    }
  }
  return [...tokens].slice(0, 80);
}

function scoreText(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (lower.includes(token.toLowerCase())) score += token.length > 2 ? 3 : 1;
  }
  return score;
}

function compact(text: string, limit = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 3)}...` : oneLine;
}

function candidateToPreview(candidate: MemoryCandidate, tokens: string[]): MemoryPreviewItem | null {
  if (candidate.reviewStatus === 'archived' || candidate.suggestedScope === 'task-only') return null;
  const text = `${candidate.summary}\n${candidate.content}\n${candidate.reason}`;
  const score = scoreText(text, tokens) + (candidate.reviewStatus === 'approved' ? 4 : 0);
  if (tokens.length > 0 && score === 0) return null;
  return {
    id: candidate.id,
    source: 'candidate',
    title: candidate.summary,
    detail: compact(candidate.content || candidate.reason),
    reason: candidate.reason || '由历史输入或已完成任务自动整理。',
    status: candidate.reviewStatus,
    riskLevel: candidate.riskLevel,
    score,
  };
}

function ruleToPreview(rule: ArchitectureRule, tokens: string[]): MemoryPreviewItem | null {
  const score = scoreText(`${rule.description}\n${rule.scope}`, tokens) + 3;
  if (tokens.length > 0 && score === 3) return null;
  return {
    id: rule.id,
    source: 'rule',
    title: rule.description,
    detail: `scope: ${rule.scope}`,
    reason: rule.permanent ? '项目长期规则，执行任务前必须纳入约束。' : '项目规则与当前任务相关。',
    status: rule.permanent ? 'permanent' : 'active',
    score,
  };
}

export async function getTaskMemoryPreview(
  rootPath: string,
  query: string,
  limit = 5,
): Promise<MemoryPreviewItem[]> {
  const memory = await loadProjectMemory(rootPath);
  const tokens = extractMemoryExperienceTokens(query);
  const items: MemoryPreviewItem[] = [];

  for (const rule of memory.rules) {
    const item = ruleToPreview(rule, tokens);
    if (item) items.push(item);
  }
  for (const candidate of memory.memoryCandidates || []) {
    const item = candidateToPreview(candidate, tokens);
    if (item) items.push(item);
  }
  for (const task of memory.taskHistory || []) {
    const score = scoreText(`${task.description}\n${task.summary}\n${task.diffDigest}`, tokens);
    if (score > 0) {
      items.push({
        id: task.taskId,
        source: 'task',
        title: task.description,
        detail: compact(task.summary || task.diffDigest),
        reason: '历史任务与当前描述命中相同关键词，可复用经验和风险判断。',
        status: task.status,
        score,
      });
    }
  }
  for (const decision of memory.decisions || []) {
    const score = scoreText(`${decision.context}\n${decision.decision}`, tokens);
    if (score > 0) {
      items.push({
        id: decision.id,
        source: 'decision',
        title: decision.decision,
        detail: compact(decision.context),
        reason: '历史架构决策与当前任务相关。',
        status: 'recorded',
        score,
      });
    }
  }

  return items
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function buildTaskMemorySummary(rootPath: string, query: string, limit = 5): Promise<TaskMemorySummary> {
  const memory = await loadProjectMemory(rootPath);
  const items = await getTaskMemoryPreview(rootPath, query, limit);
  try {
    const { getMemoryRuntime } = await import('./memory/integration.js');
    const runtime = await getMemoryRuntime(rootPath);
    const recalled = await runtime.recall.recall(query);
    const existingIds = new Set(items.map(item => item.id));
    for (const r of recalled) {
      if (items.length >= limit) break;
      if (existingIds.has(r.source)) continue;
      if (r.type !== 'semantic') continue;
      const raw = r.raw as { path?: string; content?: string; confidence?: number; tags?: string[] };
      items.push({
        id: r.source,
        source: 'rule',
        title: raw.content || r.content,
        detail: raw.path ? `path: ${raw.path}` : compact(r.content),
        reason: raw.tags?.includes('manifest')
          ? '由 AGENTS/CLAUDE/Copilot 等项目记忆文件导入，任务执行前应纳入约束。'
          : 'Memory Kernel 语义规则与当前任务相关。',
        status: raw.tags?.includes('manifest') ? 'manifest' : 'semantic',
        score: Math.round((r.score || raw.confidence || 0.5) * 100),
      });
    }
  } catch {
    // Memory Kernel is optional; legacy project memory summary still works.
  }
  const ruleConflicts = detectMemoryConflicts(memory);
  const taskConflicts = detectTaskMemoryConflicts(query, memory);
  const conflicts = [...new Set([...ruleConflicts, ...taskConflicts])];
  return {
    ruleCount: memory.rules.length,
    preferenceCount: (memory.memoryCandidates || []).filter(c => c.kind === 'preference' && c.reviewStatus === 'approved').length,
    relatedHistoryCount: items.filter(item => item.source === 'task' || item.source === 'decision').length,
    candidateCount: (memory.memoryCandidates || []).filter(c => c.reviewStatus === 'proposed').length,
    conflicts,
    items,
  };
}

export async function explainMemoryUse(rootPath: string, selectorOrQuery: string): Promise<MemoryWhyResult | null> {
  const memory: ProjectMemory = await loadProjectMemory(rootPath);
  const selector = selectorOrQuery.trim();
  const candidates = memory.memoryCandidates || [];
  const directCandidate = candidates.find(c => c.id === selector || c.id.startsWith(selector));
  if (directCandidate) {
    return {
      id: directCandidate.id,
      source: 'candidate',
      title: directCandidate.summary,
      detail: compact(directCandidate.content || directCandidate.reason),
      content: directCandidate.content,
      reason: directCandidate.reason,
      status: directCandidate.reviewStatus,
      riskLevel: directCandidate.riskLevel,
      score: 999,
      evidence: directCandidate.sourceEventIds.length
        ? directCandidate.sourceEventIds.map(id => `来源输入事件: ${id}`)
        : ['来源: 任务/输入自动归纳'],
      taskId: directCandidate.taskId,
      sourceEventIds: directCandidate.sourceEventIds,
      updatedAt: directCandidate.updatedAt,
    };
  }

  const directRule = memory.rules.find(r => r.id === selector || r.id.startsWith(selector));
  if (directRule) {
    return {
      id: directRule.id,
      source: 'rule',
      title: directRule.description,
      detail: `scope: ${directRule.scope}`,
      reason: directRule.permanent ? '项目长期规则，默认参与所有相关任务。' : '项目规则命中当前查询。',
      status: directRule.permanent ? 'permanent' : 'active',
      score: 999,
      evidence: [`scope: ${directRule.scope}`, `createdAt: ${directRule.createdAt}`],
      updatedAt: directRule.createdAt,
    };
  }

  const [match] = await getTaskMemoryPreview(rootPath, selector, 1);
  if (!match) return null;
  return {
    ...match,
    evidence: [
      `匹配查询: ${selector}`,
      `匹配分数: ${match.score}`,
      `来源类型: ${match.source}`,
    ],
  };
}

export function renderTaskMemoryPreview(items: MemoryPreviewItem[]): string {
  if (items.length === 0) return '';
  const lines = ['本次采用记忆'];
  for (const item of items) {
    const status = item.status ? ` | ${item.status}` : '';
    lines.push(`  - [${item.source}] ${item.title}${status}`);
    lines.push(`    ${item.reason}`);
  }
  return lines.join('\n');
}

export function renderTaskMemorySummary(summary: TaskMemorySummary): string {
  const hasMemory = summary.ruleCount > 0 || summary.preferenceCount > 0 || summary.relatedHistoryCount > 0 || summary.items.length > 0 || summary.conflicts.length > 0;
  if (!hasMemory) return '';
  const lines = [
    '本次采用记忆',
    `  项目规则    ${summary.ruleCount} 条`,
    `  用户偏好    ${summary.preferenceCount} 条`,
    `  相关历史    ${summary.relatedHistoryCount} 项`,
  ];
  if (summary.candidateCount > 0) lines.push(`  待确认候选  ${summary.candidateCount} 条`);
  if (summary.conflicts.length > 0) {
    lines.push('  ⚠ 冲突提示');
    for (const conflict of summary.conflicts.slice(0, 3)) lines.push(`    ‼ ${conflict}`);
    if (summary.conflicts.length > 3) lines.push(`    ... 还有 ${summary.conflicts.length - 3} 条冲突`);
  }
  if (summary.items.length > 0) {
    lines.push('  命中摘要');
    for (const item of summary.items.slice(0, 3)) lines.push(`    - [${item.source}] ${item.title}`);
  }
  return lines.join('\n');
}

export function detectMemoryConflicts(memory: ProjectMemory): string[] {
  const activeTexts = [
    ...memory.rules.map(rule => rule.description),
    ...(memory.memoryCandidates || [])
      .filter(c => c.reviewStatus === 'approved')
      .map(c => `${c.summary} ${c.content}`),
  ];
  const conflicts: string[] = [];
  const pairs: Array<[RegExp, RegExp, string]> = [
    [/必须|总是|always|must/i, /不要|禁止|never|avoid|不得/i, '同时存在”必须/总是”和”不要/禁止”类规则，请确认优先级。'],
    [/中文|Chinese/i, /英文|English/i, '同时存在中文与英文输出偏好，请明确默认语言。'],
    [/自动提交|auto.*commit/i, /不.*提交|不要.*commit|never.*commit/i, '提交策略冲突：自动提交与禁止提交同时出现。'],
    [/全量测试|npm test|full test/i, /跳过测试|skip test|no test/i, '测试策略冲突：全量测试与跳过测试同时出现。'],
  ];
  for (const [positive, negative, message] of pairs) {
    if (activeTexts.some(text => positive.test(text)) && activeTexts.some(text => negative.test(text))) {
      conflicts.push(message);
    }
  }
  return [...new Set(conflicts)];
}

export async function proposePostTaskMemoryCandidate(input: PostTaskMemoryInput): Promise<MemoryCandidate | null> {
  if (input.qualityGate.score < 85 || input.qualityGate.status !== 'pass') return null;
  const memory = await loadProjectMemory(input.rootPath);
  const now = new Date().toISOString();
  const changedFiles = input.codeDelivery.changes.map(change => change.file);
  const summary = postTaskMemorySummary(input.type, input.input, changedFiles);
  const content = [
    `任务：${input.input}`,
    `类型：${input.type}`,
    `质量：${input.qualityGate.score}/100`,
    input.qualityGate.present.length ? `覆盖字段：${input.qualityGate.present.join('、')}` : '',
    changedFiles.length ? `变更文件：${changedFiles.join(', ')}` : '',
    `复用建议：同类任务优先按该模板补齐字段并给出验证/下一步。`,
  ].filter(Boolean).join('\n');
  const candidate: MemoryCandidate = {
    id: `mem-${hashMemoryText(`post-task:${input.taskId}:${summary}`)}`,
    kind: input.type === 'code' ? 'template' : input.type === 'memory' ? 'rule' : 'fact',
    content,
    summary,
    suggestedScope: 'project',
    riskLevel: input.type === 'code' ? 'medium' : 'low',
    reviewStatus: 'proposed',
    suggestedAction: input.type === 'code' ? 'batch-candidate' : 'auto-approve-project',
    reason: '任务质量门通过，可作为同类任务的可复用经验，等待用户确认或后续批量写回。',
    sourceEventIds: [],
    taskId: input.taskId,
    createdAt: now,
    updatedAt: now,
    metadata: {
      id: `meta-${hashMemoryText(`post-task:${input.taskId}:${summary}`)}`,
      scope: 'task',
      source: 'agent',
      taskId: input.taskId,
      createdAt: now,
      updatedAt: now,
      reviewStatus: 'proposed',
      version: 1,
      evidence: [
        { type: 'summary', ref: input.taskId, summary: input.input },
        ...changedFiles.slice(0, 5).map(file => ({ type: 'file' as const, ref: file })),
      ],
      riskLevel: input.type === 'code' ? 'medium' : 'low',
      compressionLevel: input.type === 'code' ? 'template' : 'task-summary',
      sourceEventIds: [],
      redacted: false,
    },
  };
  const key = normalizeMemorySummary(candidate.summary);
  if ((memory.memoryCandidates || []).some(existing => normalizeMemorySummary(existing.summary) === key)) return null;
  memory.memoryCandidates.push(candidate);
  await saveProjectMemory(input.rootPath, memory);
  return candidate;
}

function postTaskMemorySummary(type: AgentTaskType, input: string, files: string[]): string {
  const label = type === 'code' ? '代码交付模板'
    : type === 'analysis' ? '分析报告模板'
      : type === 'web' ? '网页访问模板'
        : type === 'startup' ? '项目启动模板'
          : '任务经验';
  const target = files.length ? `（${files.slice(0, 3).join(', ')}${files.length > 3 ? ' 等' : ''}）` : '';
  return `${label}：${compact(input, 80)}${target}`;
}

function hashMemoryText(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function normalizeMemorySummary(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[，。,.]/g, '');
}

/**
 * ADV-01: Detect conflicts between a new task query and existing project rules.
 * Returns warning strings when the task description contradicts a stored rule.
 */
export function detectTaskMemoryConflicts(query: string, memory: ProjectMemory): string[] {
  const rules = [
    ...memory.rules.map(r => ({ text: r.description, source: 'rule', permanent: r.permanent })),
    ...(memory.memoryCandidates || [])
      .filter(c => c.reviewStatus === 'approved')
      .map(c => ({ text: `${c.summary} ${c.content}`, source: 'candidate', permanent: false })),
  ];
  const conflicts: string[] = [];
  const q = query.toLowerCase();

  const conflictPairs: Array<{ rulePattern: RegExp; taskPattern: RegExp; message: string }> = [
    { rulePattern: /不要.*改.*API|禁止.*改.*接口|不要.*修改.*接口|do not.*change.*api/i, taskPattern: /重构|refactor|改.*接口|change.*api|修改.*API/i, message: '规则要求不要修改 API，但当前任务涉及 API 修改。' },
    { rulePattern: /TypeScript|typescript|\.ts/i, taskPattern: /JavaScript|\.js[^x]|plain.*js/i, message: '规则要求使用 TypeScript，但任务可能涉及纯 JavaScript 文件。' },
    { rulePattern: /vitest/i, taskPattern: /jest[^.]|mocha|jasmine/i, message: '规则要求使用 vitest，但任务提到了其他测试框架。' },
    { rulePattern: /JSDoc|jsdoc/i, taskPattern: /不要.*注释|skip.*comment|no.*doc/i, message: '规则要求 JSDoc 注释，但任务似乎倾向于跳过文档。' },
    { rulePattern: /不要.*新增.*依赖|禁止.*新增.*dep|no.*new.*dep/i, taskPattern: /安装|install|npm install|添加.*依赖|add.*dep/i, message: '规则禁止新增依赖，但任务可能引入新包。' },
    { rulePattern: /prettier/i, taskPattern: /eslint.*fix|standard.*js|不同的格式/i, message: '规则要求 prettier 格式化，但任务涉及其他格式化工具。' },
    { rulePattern: /不要.*push|禁止.*push|never.*push/i, taskPattern: /推送|push.*remote|发布/i, message: '规则禁止推送，但任务可能涉及远程操作。' },
    { rulePattern: /SQLite|sqlite/i, taskPattern: /PostgreSQL|MySQL|MongoDB|postgres/i, message: '规则指定 SQLite 存储，但任务涉及其他数据库。' },
  ];

  for (const { rulePattern, taskPattern, message } of conflictPairs) {
    const hasRule = rules.some(r => rulePattern.test(r.text));
    const taskMatches = taskPattern.test(q);
    if (hasRule && taskMatches) {
      const matchedRule = rules.find(r => rulePattern.test(r.text));
      const source = matchedRule?.permanent ? '长期规则' : '已批准候选';
      conflicts.push(`${message}（${source}：${matchedRule?.text?.slice(0, 60) || '...'}）`);
    }
  }

  // Also detect direct negation: rule says “do X”, task says “don't do X” or vice versa
  const negationPairs: Array<[RegExp, RegExp, string]> = [
    [/不.*提交|不要.*commit|no commit/i, /自动提交|auto commit|直接提交/i, '提交策略：规则禁止自动提交，但任务提到直接提交。'],
    [/不.*删除|保留|keep|preserve/i, /删除|移除|remove|delete/i, '文件保留策略：规则要求保留，但任务涉及删除。'],
  ];
  for (const [ruleNeg, taskPos, msg] of negationPairs) {
    if (rules.some(r => ruleNeg.test(r.text)) && taskPos.test(q)) {
      conflicts.push(msg);
    }
  }

  return [...new Set(conflicts)];
}

export async function addProjectMemoryRule(rootPath: string, description: string, scope = '*'): Promise<ArchitectureRule> {
  const memory = await loadProjectMemory(rootPath);
  const now = new Date().toISOString();
  const normalized = description.trim();
  const existing = memory.rules.find(rule => rule.description.trim().toLowerCase() === normalized.toLowerCase());
  if (existing) return existing;
  const rule: ArchitectureRule = {
    id: `rule-${Date.now().toString(36)}`,
    description: normalized,
    scope,
    createdAt: now,
    permanent: true,
  };
  memory.rules.push(rule);
  await saveProjectMemory(rootPath, memory);
  await ensureAgentMemoryManifest(rootPath, 'AGENTS.md', { force: true });
  return rule;
}

export async function deleteProjectMemoryRule(rootPath: string, selector: string): Promise<ArchitectureRule | null> {
  const memory = await loadProjectMemory(rootPath);
  const target = selector.trim();
  const index = memory.rules.findIndex(rule =>
    rule.id === target ||
    rule.id.startsWith(target) ||
    rule.description.toLowerCase().includes(target.toLowerCase())
  );
  if (index < 0) return null;
  const [removed] = memory.rules.splice(index, 1);
  await saveProjectMemory(rootPath, memory);
  await ensureAgentMemoryManifest(rootPath, 'AGENTS.md', { force: true });
  return removed;
}

export async function ensureAgentMemoryManifest(rootPath: string, fileName = 'AGENTS.md', opts?: { force?: boolean }): Promise<{ path: string; created: boolean; content: string }> {
  const safeName = path.basename(fileName || 'AGENTS.md');
  const manifestPath = path.join(rootPath, safeName);
  const existed = await fileExists(manifestPath);
  if (existed && !opts?.force) {
    return { path: manifestPath, created: false, content: await readFile(manifestPath, { rootPath }) };
  }
  const memory = await loadProjectMemory(rootPath);
  const rules = memory.rules.slice(0, 20).map(rule => `- ${rule.description} (${rule.scope})`).join('\n') || '- 暂无固定规则。';
  const candidates = (memory.memoryCandidates || [])
    .filter(c => c.reviewStatus === 'approved')
    .slice(-20)
    .map(c => `- ${c.summary}`)
    .join('\n') || '- 暂无已批准候选。';
  const content = [
    `# ${memory.projectId} Agent Memory`,
    '',
    '## Project Positioning',
    '- This project aims to be a local engineering executor plus a Claude Code alternative with long-term memory.',
    '',
    '## Persistent Rules',
    rules,
    '',
    '## Approved Memory',
    candidates,
    '',
    '## Operating Expectations',
    '- Show which memories are used before executing code tasks.',
    '- Explain why a memory was recalled when asked.',
    '- Keep verification, PR drafts, and release trust reports attached to the task history.',
    '',
  ].join('\n');
  await writeFile(manifestPath, content, rootPath);
  return { path: manifestPath, created: true, content };
}
