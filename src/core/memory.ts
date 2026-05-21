// Dual-layer Memory System — project + global cross-project memory
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import { appendFile, readFile } from 'fs/promises';
import { readJson, writeJson, fileExists, ensureDir } from '../utils/fs.js';
import type {
  ProjectMemory, GlobalMemory, ArchitectureRule, DecisionRecord,
  TaskRecord, FeedbackRecord, TechStackMemory,
  PatternMemory, UserPreferences,
  Task, ProjectIdentity, UserInputKind, UserInputMemoryEvent,
  MemoryMetadata, MemoryRiskLevel, MemoryCandidate, MemoryCandidateKind,
  MemoryReviewAction, MemoryReviewStatus,
} from '../types.js';

// ============================================================
// Project Memory
// ============================================================
export async function loadProjectMemory(rootPath: string): Promise<ProjectMemory> {
  const memoryPath = path.join(rootPath, '.icloser', 'memory.json');
  if (await fileExists(memoryPath)) {
    try {
      const memory = normalizeProjectMemory(await readJson(memoryPath) as unknown as ProjectMemory, rootPath);
      // Purge expired TTL entries on every load
      const removed = cleanupStaleMemory(memory);
      if (removed > 0 && memory.memoryCandidates) {
        // Save back the cleaned memory so disk stays in sync
        saveProjectMemory(rootPath, memory).catch(() => {});
      }
      return memory;
    } catch { /* corrupted — start fresh */ }
  }
  return createEmptyProjectMemory(rootPath);
}

export async function saveProjectMemory(rootPath: string, memory: ProjectMemory): Promise<void> {
  const memoryDir = path.join(rootPath, '.icloser');
  await ensureDir(memoryDir);

  // Auto-compress if needed
  if (memory.taskHistory.length > 50) {
    memory = await compressProjectMemory(memory);
  }

  memory.updatedAt = new Date().toISOString(); // set timestamp right before write
  await writeJson(path.join(memoryDir, 'memory.json'), memory);
}

export function createEmptyProjectMemory(rootPath: string): ProjectMemory {
  return {
    projectId: path.basename(rootPath),
    rules: [],
    decisions: [],
    taskHistory: [],
    feedbacks: [],
    inputEvents: [],
    memoryCandidates: [],
    snapshot: {
      modules: '',
      dependencies: '',
      architecture: '',
      timestamp: new Date().toISOString(),
      compressedSize: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProjectMemory(memory: ProjectMemory, rootPath: string): ProjectMemory {
  return {
    ...memory,
    projectId: memory.projectId || path.basename(rootPath),
    rules: memory.rules || [],
    decisions: memory.decisions || [],
    taskHistory: memory.taskHistory || [],
    feedbacks: memory.feedbacks || [],
    inputEvents: memory.inputEvents || [],
    memoryCandidates: memory.memoryCandidates || [],
    snapshot: memory.snapshot || {
      modules: '',
      dependencies: '',
      architecture: '',
      timestamp: new Date().toISOString(),
      compressedSize: 0,
    },
    createdAt: memory.createdAt || new Date().toISOString(),
    updatedAt: memory.updatedAt || new Date().toISOString(),
  };
}

export interface RecordUserInputOptions {
  kind?: UserInputKind;
  taskId?: string;
  sessionId?: string;
  command?: string;
  agentId?: string;
  riskLevel?: MemoryRiskLevel;
}

export async function recordUserInputEvent(
  rootPath: string,
  input: string,
  options: RecordUserInputOptions = {}
): Promise<UserInputMemoryEvent> {
  const now = new Date().toISOString();
  const id = `uie-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`;
  const sanitized = sanitizeUserInput(input, options.kind);
  const kind = options.kind || inferUserInputKind(input);
  const metadata = createMemoryMetadata({
    id: `mem-${id}`,
    eventId: id,
    rootPath,
    now,
    taskId: options.taskId,
    sessionId: options.sessionId,
    agentId: options.agentId,
    riskLevel: options.riskLevel || inferInputRisk(kind, sanitized.redacted),
    redacted: sanitized.redacted,
    redactionReason: sanitized.redactionReason,
  });

  const event: UserInputMemoryEvent = {
    id,
    kind,
    content: sanitized.content,
    originalLength: input.length,
    redacted: sanitized.redacted,
    redactionReason: sanitized.redactionReason,
    rootPath,
    sessionId: options.sessionId,
    taskId: options.taskId,
    command: options.command || extractSlashCommand(input),
    createdAt: now,
    metadata,
  };

  const memoryDir = path.join(rootPath, '.icloser');
  await ensureDir(memoryDir);
  await appendFile(path.join(memoryDir, 'input-events.jsonl'), JSON.stringify(event) + '\n', 'utf-8');

  const memory = await loadProjectMemory(rootPath);
  memory.inputEvents.push(event);
  if (memory.inputEvents.length > 200) {
    memory.inputEvents = memory.inputEvents.slice(-100);
  }
  const candidate = createMemoryCandidateFromInputEvent(event);
  if (candidate && !isDuplicateCandidate(memory.memoryCandidates, candidate)) {
    memory.memoryCandidates.push(candidate);
  }
  await saveProjectMemory(rootPath, memory);

  return event;
}

export async function loadUserInputEvents(rootPath: string): Promise<UserInputMemoryEvent[]> {
  const eventsPath = path.join(rootPath, '.icloser', 'input-events.jsonl');
  if (!(await fileExists(eventsPath))) return [];
  try {
    const content = await readFile(eventsPath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) as UserInputMemoryEvent; } catch { return null; } })
      .filter((e): e is UserInputMemoryEvent => e !== null);
  } catch { return []; }
}

export function sanitizeUserInput(input: string, kind?: UserInputKind): { content: string; redacted: boolean; redactionReason?: string } {
  let redacted = false;
  let content = input;
  const reasons = new Set<string>();

  const apiKeyPatterns = [
    /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bdashscope-[A-Za-z0-9_-]{8,}\b/g,
    /\bqwen-[A-Za-z0-9_-]{8,}\b/g,
  ];

  for (const pattern of apiKeyPatterns) {
    content = content.replace(pattern, value => {
      redacted = true;
      reasons.add('api-key');
      return maskSecret(value);
    });
  }

  if (kind === 'api-key' && !redacted && input.trim()) {
    redacted = true;
    reasons.add('api-key');
    content = maskSecret(input.trim());
  }

  content = content.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, (_match, label: string) => {
    redacted = true;
    reasons.add('secret-like-input');
    return `${label}=<redacted>`;
  });

  return {
    content,
    redacted,
    redactionReason: reasons.size > 0 ? [...reasons].join(',') : undefined,
  };
}

export function createMemoryCandidateFromInputEvent(event: UserInputMemoryEvent): MemoryCandidate | null {
  const content = event.content.trim();
  if (!content || event.redacted || event.kind === 'api-key') {
    return createSensitiveCandidate(event);
  }

  const kind = inferMemoryCandidateKind(event);
  if (kind === 'unknown') return null;

  const riskLevel = classifyMemoryRisk(content, event.kind);
  const suggestedScope = inferSuggestedScope(content, riskLevel);
  const suggestedAction = inferReviewAction(riskLevel, suggestedScope, kind);
  const reviewStatus = inferReviewStatus(suggestedAction);
  const now = new Date().toISOString();
  const id = `mc-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`;
  const summary = compressMemoryCandidate(content, kind);

  return {
    id,
    kind,
    content,
    summary,
    suggestedScope,
    riskLevel,
    reviewStatus,
    suggestedAction,
    reason: explainMemoryReview(kind, riskLevel, suggestedScope, suggestedAction),
    sourceEventIds: [event.id],
    taskId: event.taskId,
    sessionId: event.sessionId,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...event.metadata,
      id: `mem-${id}`,
      scope: suggestedScope === 'global' ? 'long-term' : suggestedScope === 'project' ? 'project' : 'task',
      reviewStatus,
      riskLevel,
      compressionLevel: kind === 'template' ? 'template' : kind === 'rule' ? 'rule' : 'task-summary',
      sourceEventIds: [event.id],
      evidence: [{ type: 'user-input', ref: event.id, summary }],
      updatedAt: now,
    },
  };
}

export function classifyMemoryRisk(content: string, kind: UserInputKind = 'unknown'): MemoryRiskLevel {
  const normalized = content.toLowerCase();
  if (
    /数据库|schema|migration|支付|权限|安全|部署|生产|prod|密钥|token|api key|password|secret|delete|drop table|git push|force/.test(normalized)
  ) {
    return 'high';
  }
  if (/偏好|默认|中文|英文|报告|术语|语气|风格/.test(content) && !/全局|所有项目|每个项目|跨项目/.test(content)) {
    return 'low';
  }
  if (
    kind === 'rule' ||
    /全局|所有项目|以后都|永远|必须|禁止|不要|不能|规则|约束/.test(content)
  ) {
    return 'medium';
  }
  return 'low';
}

export function compressMemoryCandidate(content: string, kind: MemoryCandidateKind): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .replace(/^(请|麻烦|帮我|你以后|以后|记住|规则是|约束是)[，,\s]*/g, '')
    .trim();
  const capped = normalized.length > 120 ? normalized.substring(0, 117) + '...' : normalized;
  if (kind === 'preference') return `偏好：${capped}`;
  if (kind === 'rule') return `规则：${capped}`;
  if (kind === 'template') return `流程模板：${capped}`;
  if (kind === 'fact') return `事实：${capped}`;
  return capped;
}

function createSensitiveCandidate(event: UserInputMemoryEvent): MemoryCandidate | null {
  if (!event.redacted) return null;
  const now = new Date().toISOString();
  const id = `mc-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`;
  return {
    id,
    kind: 'sensitive',
    content: event.content,
    summary: '敏感输入已脱敏，仅保留审计摘要',
    suggestedScope: 'task-only',
    riskLevel: 'high',
    reviewStatus: 'archived',
    suggestedAction: 'ignore',
    reason: '敏感内容不进入长期记忆，只保留脱敏审计。',
    sourceEventIds: [event.id],
    taskId: event.taskId,
    sessionId: event.sessionId,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...event.metadata,
      id: `mem-${id}`,
      scope: 'task',
      reviewStatus: 'archived',
      riskLevel: 'high',
      compressionLevel: 'task-summary',
      evidence: [{ type: 'user-input', ref: event.id, summary: 'sensitive redacted input' }],
      updatedAt: now,
    },
  };
}

function inferMemoryCandidateKind(event: UserInputMemoryEvent): MemoryCandidateKind {
  const content = event.content;
  if (event.redacted) return 'sensitive';
  if (/流程|步骤|模板|每次|新增.*时|创建.*时/.test(content)) return 'template';
  if (/偏好|喜欢|默认|尽量|少用|多用|中文|英文/.test(content)) return 'preference';
  if (event.kind === 'rule' || /记住|以后|规则|约束|必须|禁止|不要|不能|永远/.test(content)) return 'rule';
  if (/这是|当前项目|项目里|事实/.test(content)) return 'fact';
  return 'unknown';
}

function inferSuggestedScope(content: string, risk: MemoryRiskLevel): 'project' | 'global' | 'task-only' {
  if (risk === 'high') return /全局|所有项目|跨项目/.test(content) ? 'global' : 'project';
  if (/全局|所有项目|每个项目|跨项目/.test(content)) return 'global';
  if (/只本次|这次|临时/.test(content)) return 'task-only';
  return 'project';
}

function inferReviewAction(
  risk: MemoryRiskLevel,
  scope: 'project' | 'global' | 'task-only',
  kind: MemoryCandidateKind
): MemoryReviewAction {
  if (kind === 'sensitive') return 'ignore';
  if (scope === 'task-only') return 'auto-archive';
  if (risk === 'low' && scope === 'project') return 'auto-approve-project';
  if (risk === 'high') return 'ask-now';
  return 'batch-candidate';
}

function inferReviewStatus(action: MemoryReviewAction): MemoryReviewStatus {
  if (action === 'auto-archive') return 'archived';
  if (action === 'auto-approve-project') return 'approved';
  if (action === 'ignore') return 'archived';
  return 'proposed';
}

function explainMemoryReview(
  kind: MemoryCandidateKind,
  risk: MemoryRiskLevel,
  scope: 'project' | 'global' | 'task-only',
  action: MemoryReviewAction
): string {
  if (action === 'auto-approve-project') return '低风险项目内偏好/规则，系统自动保存到当前项目，并保留可追溯来源。';
  if (action === 'batch-candidate') return `${scope === 'global' ? '全局' : '项目'}候选记忆，适合稍后批量确认。`;
  if (action === 'ask-now') return `${risk} 风险 ${kind}，涉及可能影响较大的规则，需要用简单选择题确认。`;
  if (action === 'ignore') return '敏感或不适合沉淀的输入，只保留脱敏审计。';
  return '仅归档到本次任务，不进入长期记忆。';
}

function isDuplicateCandidate(existing: MemoryCandidate[], next: MemoryCandidate): boolean {
  const key = normalizeCandidateText(next.summary);
  return existing.some(candidate => normalizeCandidateText(candidate.summary) === key);
}

function normalizeCandidateText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[，。,.]/g, '');
}

function compressTaskTemplateSummary(description: string, files: string[]): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  const target = files.length > 0 ? `（${files.slice(0, 3).join(', ')}${files.length > 3 ? ' 等' : ''}）` : '';
  const capped = normalized.length > 80 ? normalized.substring(0, 77) + '...' : normalized;
  return `流程模板：${capped}${target}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function createMemoryMetadata(args: {
  id: string;
  eventId: string;
  rootPath: string;
  now: string;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  riskLevel: MemoryRiskLevel;
  redacted: boolean;
  redactionReason?: string;
}): MemoryMetadata {
  return {
    id: args.id,
    scope: args.taskId ? 'task' : 'short-term',
    source: 'user',
    taskId: args.taskId,
    sessionId: args.sessionId,
    agentId: args.agentId || 'human',
    rawInputRef: args.eventId,
    createdAt: args.now,
    updatedAt: args.now,
    reviewStatus: 'draft',
    version: 1,
    evidence: [{ type: 'user-input', ref: args.eventId, summary: path.basename(args.rootPath) }],
    riskLevel: args.riskLevel,
    compressionLevel: 'raw',
    sourceEventIds: [args.eventId],
    redacted: args.redacted,
    redactionReason: args.redactionReason,
  };
}

function inferUserInputKind(input: string): UserInputKind {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';
  if (trimmed.startsWith('/')) return 'slash-command';
  if (/^(y|yes|ok|确认|同意|保存|全部|all|[0-9,\s和与及+\-&]+)$/i.test(trimmed)) return 'approval';
  if (/^(n|no|取消|拒绝|不要|不保存)$/i.test(trimmed)) return 'rejection';
  if (/记住|以后|规则|约束|偏好/.test(trimmed)) return 'rule';
  return 'chat';
}

function inferInputRisk(kind: UserInputKind, redacted: boolean): MemoryRiskLevel {
  if (redacted || kind === 'api-key') return 'high';
  if (kind === 'rule' || kind === 'approval' || kind === 'rejection') return 'medium';
  return 'low';
}

function extractSlashCommand(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return undefined;
  return trimmed.split(/\s+/)[0];
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '<redacted>';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export async function addRule(
  memory: ProjectMemory,
  description: string,
  scope = '*',
  permanent = false
): Promise<ProjectMemory> {
  const rule: ArchitectureRule = {
    id: `rule-${Date.now().toString(36)}`,
    description,
    scope,
    createdAt: new Date().toISOString(),
    permanent,
  };
  memory.rules.push(rule);

  // Also sync to global memory if permanent
  if (permanent) {
    const globalMem = await loadGlobalMemory();
    const techStack = 'general';
    if (!globalMem.techStacks.has(techStack)) {
      globalMem.techStacks.set(techStack, {
        tech: techStack,
        bestPractices: [],
        commonPatterns: [],
        preferredLibraries: [],
        accumulatedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
    }
    globalMem.techStacks.get(techStack)!.bestPractices.push(description);
    await saveGlobalMemory(globalMem);
  }

  return memory;
}

export async function removeRule(memory: ProjectMemory, ruleId: string): Promise<ProjectMemory> {
  memory.rules = memory.rules.filter(r => r.id !== ruleId);
  return memory;
}

export async function recordTask(
  memory: ProjectMemory,
  task: Task,
  identity: ProjectIdentity
): Promise<ProjectMemory> {
  const compressed = compressTaskRecord(task);

  const record: TaskRecord = {
    taskId: task.id,
    description: task.description,
    status: task.status,
    summary: compressed,
    diffDigest: (task.diffs || []).join('\n').substring(0, 500),
    timestamp: new Date().toISOString(),
  };

  memory.taskHistory.push(record);

  const templateCandidate = createTaskTemplateCandidate(task);
  if (templateCandidate && !isDuplicateCandidate(memory.memoryCandidates, templateCandidate)) {
    memory.memoryCandidates.push(templateCandidate);
  }

  // Update snapshot
  memory.snapshot = {
    modules: `${task.changes.length} files modified`,
    dependencies: `Language: ${identity.language}, Framework: ${identity.framework}`,
    architecture: identity.framework || 'unknown',
    timestamp: new Date().toISOString(),
    compressedSize: 0,
  };

  // Extract patterns for global memory
  await updateGlobalPatterns(memory, identity);

  return memory;
}

export function createTaskTemplateCandidate(task: Task): MemoryCandidate | null {
  if (task.status !== 'completed' || task.changes.length === 0) return null;

  const files = task.changes.map(change => change.file);
  const summary = compressTaskTemplateSummary(task.description, files);
  const now = new Date().toISOString();
  const riskLevel = task.reasoning.some(reasoning => reasoning.riskLevel === 'high')
    ? 'high'
    : task.reasoning.some(reasoning => reasoning.riskLevel === 'medium')
      ? 'medium'
      : 'low';

  return {
    id: `mem-${hashString(`template:${task.id}:${summary}`)}`,
    kind: 'template',
    content: [
      `任务：${task.description}`,
      `变更文件：${files.join(', ')}`,
      task.verifyResult ? `验证结果：${task.verifyResult.overall}` : '',
    ].filter(Boolean).join('\n'),
    summary,
    suggestedScope: 'project',
    riskLevel,
    reviewStatus: 'proposed',
    suggestedAction: riskLevel === 'high' ? 'ask-now' : 'batch-candidate',
    reason: '任务已完成，可作为同类任务的可复用执行模板，默认等待确认。',
    sourceEventIds: [],
    taskId: task.id,
    createdAt: now,
    updatedAt: now,
    metadata: {
      id: `meta-${hashString(`template:${task.id}:${summary}`)}`,
      scope: 'task',
      source: 'agent',
      taskId: task.id,
      createdAt: now,
      updatedAt: now,
      reviewStatus: 'proposed',
      version: 1,
      evidence: [
        { type: 'summary', ref: task.id, summary: task.description },
        ...files.slice(0, 5).map(file => ({ type: 'file' as const, ref: file })),
      ],
      riskLevel,
      compressionLevel: 'template',
      sourceEventIds: [],
      redacted: false,
    },
  };
}

export async function recordDecision(
  memory: ProjectMemory,
  taskId: string,
  context: string,
  decision: string,
  alternatives: string[]
): Promise<ProjectMemory> {
  const record: DecisionRecord = {
    id: `dec-${Date.now().toString(36)}`,
    taskId,
    context,
    decision,
    alternatives,
    timestamp: new Date().toISOString(),
  };
  memory.decisions.push(record);
  return memory;
}

export async function recordFeedback(
  memory: ProjectMemory,
  content: string,
  source: string
): Promise<ProjectMemory> {
  const feedback: FeedbackRecord = {
    content,
    source,
    timestamp: new Date().toISOString(),
    decayFactor: 1.0,
  };

  // Decay old feedback
  for (const fb of memory.feedbacks) {
    fb.decayFactor *= 0.8;
  }
  // Remove heavily decayed
  memory.feedbacks = memory.feedbacks.filter(fb => fb.decayFactor > 0.1);
  memory.feedbacks.push(feedback);

  return memory;
}

export async function searchMemory(
  memory: ProjectMemory,
  query: string
): Promise<(ArchitectureRule | DecisionRecord | TaskRecord | FeedbackRecord)[]> {
  const results: (ArchitectureRule | DecisionRecord | TaskRecord | FeedbackRecord)[] = [];
  const q = query.toLowerCase();

  for (const rule of memory.rules) {
    if (rule.description.toLowerCase().includes(q)) results.push(rule);
  }
  for (const dec of memory.decisions) {
    if (dec.decision.toLowerCase().includes(q) || dec.context.toLowerCase().includes(q)) results.push(dec);
  }
  for (const task of memory.taskHistory) {
    if (task.description.toLowerCase().includes(q) || task.summary.toLowerCase().includes(q)) results.push(task);
  }
  for (const fb of memory.feedbacks) {
    if (fb.content.toLowerCase().includes(q)) results.push(fb);
  }

  return results;
}

export async function compressProjectMemory(memory: ProjectMemory): Promise<ProjectMemory> {
  // M5: Compress at 50 (was 100) — keep memory lean
  if (memory.taskHistory.length > 50) {
    const recent = memory.taskHistory.slice(-25);
    const old = memory.taskHistory.slice(0, -25);

    // Compress old tasks into a single summary record
    const oldSummary = old.map(t => `${t.description} (${t.status})`).join('; ');
    const compressedRecord: TaskRecord = {
      taskId: 'compressed-history',
      description: '历史任务压缩记录',
      status: 'completed',
      summary: oldSummary.substring(0, 500),
      diffDigest: '',
      timestamp: new Date().toISOString(),
    };

    memory.taskHistory = [compressedRecord, ...recent];
  }

  // M5: Cleanup stale memoryCandidates — remove rejected and oldest pending beyond 100
  if (memory.memoryCandidates.length > 100) {
    memory.memoryCandidates = memory.memoryCandidates
      .filter(c => c.reviewStatus !== 'rejected')
      .slice(-50);
  }

  return memory;
}

// ============================================================
// Global Memory (Cross-Project)
// ============================================================
function getGlobalMemoryPath(): string {
  const globalRoot = process.env.ICLOSER_HOME || path.join(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.icloser'
  );
  const globalDir = path.join(globalRoot, 'global-memory');
  return path.join(globalDir, 'memory.json');
}

export async function loadGlobalMemory(): Promise<GlobalMemory> {
  const memPath = getGlobalMemoryPath();
  try {
    if (await fileExists(memPath)) {
      const raw = await readJson(memPath) as unknown as Record<string, unknown>;
      // Convert plain objects back to Maps
      const globalMem = raw as unknown as GlobalMemory;
      globalMem.techStacks = new Map(Object.entries((raw.techStacks as Record<string, unknown>) || {})) as Map<string, TechStackMemory>;
      globalMem.patterns = new Map(Object.entries((raw.patterns as Record<string, unknown>) || {})) as Map<string, PatternMemory>;
      return globalMem;
    }
  } catch {
    // Global memory is useful context, but it must not block normal task execution.
  }
  return createEmptyGlobalMemory();
}

export async function saveGlobalMemory(memory: GlobalMemory): Promise<void> {
  const memPath = getGlobalMemoryPath();
  await ensureDir(path.dirname(memPath));
  // Convert Maps to plain objects for JSON
  const serializable = {
    ...memory,
    techStacks: Object.fromEntries(memory.techStacks),
    patterns: Object.fromEntries(memory.patterns),
  };
  try {
    await writeJson(memPath, serializable);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM') throw e;
  }
}

export function createEmptyGlobalMemory(): GlobalMemory {
  return {
    techStacks: new Map(),
    patterns: new Map(),
    preferences: {
      codeStyle: {},
      techPreferences: [],
      commentLanguage: 'chinese',
      autoExecute: false,
      maxParallelTasks: 3,
      preferredAI: 'claude',
    },
    pitfalls: [],
    skillHistory: [],
  };
}

async function updateGlobalPatterns(
  projectMemory: ProjectMemory,
  identity: ProjectIdentity
): Promise<void> {
  // After every 10 tasks, check for cross-project patterns
  if (projectMemory.taskHistory.length % 10 !== 0) return;

  const globalMem = await loadGlobalMemory();
  const techKey = `${identity.language}-${identity.framework}-${identity.database}`;

  if (!globalMem.techStacks.has(techKey)) {
    globalMem.techStacks.set(techKey, {
      tech: techKey,
      bestPractices: [],
      commonPatterns: [],
      preferredLibraries: [],
      accumulatedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    });
  }

  const techMem = globalMem.techStacks.get(techKey)!;

  // Extract common patterns from recent tasks
  const recentTasks = projectMemory.taskHistory.slice(-10);
  const patterns = extractPatternsFromTasks(recentTasks);
  for (const pattern of patterns) {
    if (!techMem.commonPatterns.includes(pattern)) {
      techMem.commonPatterns.push(pattern);
    }
  }

  // Extract preferred libraries from successful tasks
  const successfulTasks = recentTasks.filter(t => t.status === 'completed');
  if (successfulTasks.length > 5) {
    const libs = extractLibrariesFromTasks(successfulTasks);
    for (const lib of libs) {
      if (!techMem.preferredLibraries.includes(lib)) {
        techMem.preferredLibraries.push(lib);
      }
    }
  }

  techMem.lastUpdated = new Date().toISOString();
  await saveGlobalMemory(globalMem);
}

export async function addPitfall(
  description: string,
  tech: string,
  severity: 'low' | 'medium' | 'high'
): Promise<void> {
  const globalMem = await loadGlobalMemory();
  globalMem.pitfalls.push({
    description,
    tech,
    severity,
    encounteredAt: new Date().toISOString(),
  });
  await saveGlobalMemory(globalMem);
}

// M6: Auto-promote approved preference candidates to UserPreferences
// (TODO: wire this into the memory lifecycle — currently unused)

// M7: Auto-capture task errors as pitfalls for future reference
export async function recordTaskError(taskDescription: string, errorMessage: string, tech?: string): Promise<void> {
  const severity = errorMessage.length > 500 ? 'high' : errorMessage.includes('crash') || errorMessage.includes('panic') ? 'high' : 'medium';
  const desc = `任务失败: ${taskDescription.slice(0, 80)} — ${errorMessage.slice(0, 200)}`;
  await addPitfall(desc, tech || 'general', severity);
}

// TTL constants (hours)
const MEMORY_TTL: Record<string, number> = {
  'short-term': 24,
  'task': 24 * 7,        // 7 days
  'project': 24 * 30,    // 30 days
  'global': 24 * 90,     // 90 days
  default: 24 * 30,
};

// Set TTL when creating a new memory candidate
export function setMemoryTTL(candidate: { suggestedScope?: string; createdAt: string; expiresAt?: string }): void {
  const scope = candidate.suggestedScope || 'project';
  const ttlHours = MEMORY_TTL[scope] || MEMORY_TTL.default;
  const created = new Date(candidate.createdAt);
  candidate.expiresAt = new Date(created.getTime() + ttlHours * 3600 * 1000).toISOString();
}

// Cleanup stale memory entries that have passed their TTL
export function cleanupStaleMemory(memory: ProjectMemory): number {
  const now = new Date();
  const before = memory.memoryCandidates.length;

  memory.memoryCandidates = memory.memoryCandidates.filter(c => {
    if (!c.expiresAt) return true; // No TTL set, keep
    return new Date(c.expiresAt) > now;
  });

  // Decay: items not accessed in 30 days get archived
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const toArchive = memory.memoryCandidates.filter(c =>
    c.reviewStatus === 'approved' &&
    c.lastAccessedAt &&
    new Date(c.lastAccessedAt) < thirtyDaysAgo
  );
  for (const c of toArchive) {
    c.reviewStatus = 'archived'; // Demote to archived — needs re-review
    c.reason = (c.reason || '') + ' [30天未访问，自动降级]';
  }

  // Cleanup decisions older than 90 days
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  memory.decisions = memory.decisions.filter(d => new Date(d.timestamp) > ninetyDaysAgo);

  return before - memory.memoryCandidates.length;
}

async function _recordSkillUsage(skillName: string, success: boolean): Promise<void> {
  const globalMem = await loadGlobalMemory();
  const existing = globalMem.skillHistory.find(s => s.skillName === skillName);

  if (existing) {
    existing.usageCount++;
    existing.lastUsed = new Date().toISOString();
    existing.effectiveness = (existing.effectiveness * 0.7 + (success ? 10 : 0) * 0.3);
  } else {
    globalMem.skillHistory.push({
      skillName,
      usageCount: 1,
      lastUsed: new Date().toISOString(),
      effectiveness: success ? 7 : 3,
    });
  }

  await saveGlobalMemory(globalMem);
}

async function _updateUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const globalMem = await loadGlobalMemory();
  Object.assign(globalMem.preferences, prefs);
  await saveGlobalMemory(globalMem);
}

async function _getRelevantGlobalMemory(
  identity: ProjectIdentity,
  taskDescription: string
): Promise<string> {
  const globalMem = await loadGlobalMemory();
  const techKey = `${identity.language}-${identity.framework}-${identity.database}`;

  const parts: string[] = [];

  // Tech stack relevant memory
  const techMem = globalMem.techStacks.get(techKey);
  if (techMem) {
    parts.push(`## 技术栈经验 (${techKey})`);
    if (techMem.bestPractices.length > 0) {
      parts.push('### 最佳实践\n' + techMem.bestPractices.map(b => `- ${b}`).join('\n'));
    }
    if (techMem.commonPatterns.length > 0) {
      parts.push('### 常用模式\n' + techMem.commonPatterns.slice(0, 5).map(p => `- ${p}`).join('\n'));
    }
  }

  // Related patterns
  for (const [name, pattern] of globalMem.patterns) {
    if (taskDescription.toLowerCase().includes(name.toLowerCase())) {
      parts.push(`### 相关模式: ${name}`);
      parts.push(pattern.description);
      if (pattern.examples.length > 0) {
        parts.push('示例:\n' + pattern.examples.slice(0, 2).join('\n'));
      }
    }
  }

  // Related pitfalls
  const relevantPitfalls = globalMem.pitfalls.filter(p =>
    taskDescription.toLowerCase().includes(p.tech.toLowerCase()) ||
    p.tech === techKey
  );
  if (relevantPitfalls.length > 0) {
    parts.push('## 历史踩坑记录');
    parts.push(relevantPitfalls.slice(0, 3).map(p => `- [${p.severity}] ${p.description} (${p.tech})`).join('\n'));
  }

  // User preferences
  const pref = globalMem.preferences;
  parts.push('## 用户偏好');
  parts.push(`- 注释语言: ${pref.commentLanguage}`);
  parts.push(`- 默认 AI: ${pref.preferredAI}`);
  parts.push(`- 最大并行: ${pref.maxParallelTasks}`);

  return parts.join('\n\n');
}

// ============================================================
// Helpers
// ============================================================
function compressTaskRecord(task: Task): string {
  const parts: string[] = [];

  parts.push(task.description.substring(0, 100));
  if (task.changes.length > 0) {
    parts.push(`修改 ${task.changes.length} 个文件`);
  }
  if (task.verifyResult) {
    parts.push(`验证: ${task.verifyResult.overall}`);
  }
  if (task.retryCount > 0) {
    parts.push(`重试 ${task.retryCount} 次`);
  }

  return parts.join(' | ').substring(0, 500);
}

function extractPatternsFromTasks(tasks: TaskRecord[]): string[] {
  const patterns: string[] = [];
  const descriptions = tasks.map(t => t.description.toLowerCase());

  // Simple pattern detection
  if (descriptions.filter(d => d.includes('auth') || d.includes('登录')).length >= 3) {
    patterns.push('认证/授权模式：项目中多次涉及身份认证相关修改');
  }
  if (descriptions.filter(d => d.includes('api') || d.includes('接口')).length >= 3) {
    patterns.push('API 扩展模式：项目中频繁扩展 API 接口');
  }
  if (descriptions.filter(d => d.includes('ui') || d.includes('样式')).length >= 3) {
    patterns.push('UI 迭代模式：持续进行界面和样式调整');
  }

  return patterns;
}

function extractLibrariesFromTasks(_tasks: TaskRecord[]): string[] {
  // In real implementation, this would parse task records for library names
  return [];
}
