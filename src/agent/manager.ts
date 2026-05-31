// Agent Manager — agent creation, lifecycle, communication, real AI execution
import { randomUUID } from 'node:crypto';
import type {
  AgentInstance, AgentType, AgentStatus,
  AgentMessage, ContextPackage, AIConfig, AIPrompt,
  Task,
} from '../types.js';
import { buildToolCapabilitySnapshot } from '../core/tool-registry.js';

// ============================================================
// Agent Store
// ============================================================
const agents = new Map<string, AgentInstance>();
const messageBus = new Map<string, AgentMessage[]>();
const sharedContext = new Map<string, Record<string, unknown>>();

// ============================================================
// Agent Manager
// ============================================================
export class AgentManager {
  private maxConcurrent: number;
  private runningCount: number;
  private aiConfig: AIConfig;
  private abortControllers = new Map<string, AbortController>();

  constructor(aiConfig: AIConfig, maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.runningCount = 0;
    this.aiConfig = aiConfig;
  }

  // Update AI config at runtime (e.g. switch model)
  updateAiConfig(config: Partial<AIConfig>): void {
    this.aiConfig = { ...this.aiConfig, ...config };
  }

  // Create a new agent
  create(options: {
    name: string;
    type: AgentType;
    model?: string;
    context?: ContextPackage;
    tools?: string[];
    parentId?: string;
    sandboxLevel?: 'none' | 'readonly' | 'isolated';
    budget?: { maxTokens: number; maxTime: number };
  }): AgentInstance {
    const id = generateAgentId();
    const agent: AgentInstance = {
      id,
      name: options.name,
      type: options.type,
      status: 'idle',
      context: options.context || {
        projectMeta: '',
        relevantCode: [],
        relevantMemory: '',
        totalTokens: 0,
        budgetUsed: 0,
      },
      tools: options.tools || [],
      model: options.model || this.aiConfig.model,
      parentId: options.parentId,
      childIds: [],
      sandboxLevel: options.sandboxLevel || 'readonly',
      budget: options.budget || { maxTokens: this.aiConfig.maxTokens, maxTime: 600000 },
      createdAt: new Date().toISOString(),
    };

    if (options.parentId) {
      const parent = agents.get(options.parentId);
      if (parent) {
        parent.childIds.push(id);
        agents.set(parent.id, parent);
      }
    }

    agents.set(id, agent);
    return agent;
  }

  // Start an agent — asynchronous, fires real AI call
  async start(agentId: string, task?: string): Promise<boolean> {
    const agent = agents.get(agentId);
    if (!agent || agent.status !== 'idle') return false;

    if (this.runningCount >= this.maxConcurrent) {
      agent.status = 'waiting';
      agents.set(agentId, agent);
      return false;
    }

    agent.status = 'running';
    agent.startedAt = new Date().toISOString();
    this.runningCount++;
    agents.set(agentId, agent);

    // Fire real execution (don't await — runs in background)
    this.runAgent(agentId, task).catch(err => {
      const current = agents.get(agentId);
      if (current && current.status === 'running') {
        current.status = 'failed';
        current.result = { success: false, output: '', artifacts: [], tokensUsed: 0, duration: 0, error: (err as Error).message };
        this.runningCount--;
        agents.set(agentId, current);
        this.processWaitingQueue();
      }
    });

    return true;
  }

  // Pause an agent
  pause(agentId: string): boolean {
    const agent = agents.get(agentId);
    if (!agent || agent.status !== 'running') return false;

    // Try to abort ongoing AI call
    const ctrl = this.abortControllers.get(agentId);
    if (ctrl) { ctrl.abort(); this.abortControllers.delete(agentId); }

    agent.status = 'paused';
    agents.set(agentId, agent);
    this.runningCount--;
    this.processWaitingQueue();
    return true;
  }

  // Resume an agent
  async resume(agentId: string): Promise<boolean> {
    const agent = agents.get(agentId);
    if (!agent || agent.status !== 'paused') return false;

    if (this.runningCount >= this.maxConcurrent) return false;

    agent.status = 'running';
    this.runningCount++;
    agents.set(agentId, agent);

    this.runAgent(agentId).catch(err => {
      const current = agents.get(agentId);
      if (current && current.status === 'running') {
        current.status = 'failed';
        current.result = { success: false, output: '', artifacts: [], tokensUsed: 0, duration: 0, error: (err as Error).message };
        this.runningCount--;
        agents.set(agentId, current);
        this.processWaitingQueue();
      }
    });

    return true;
  }

  // Stop an agent and all its children
  stop(agentId: string): boolean {
    const agent = agents.get(agentId);
    if (!agent) return false;

    // Abort AI call
    const ctrl = this.abortControllers.get(agentId);
    if (ctrl) { ctrl.abort(); this.abortControllers.delete(agentId); }

    if (agent.status === 'running') this.runningCount--;
    agent.status = 'done';
    agents.set(agentId, agent);

    for (const childId of agent.childIds) this.stop(childId);
    this.processWaitingQueue();
    return true;
  }

  // Get agent status
  get(agentId: string): AgentInstance | undefined {
    return agents.get(agentId);
  }

  // List all agents with optional filters
  list(options?: { status?: AgentStatus; type?: AgentType; parentId?: string }): AgentInstance[] {
    let result = Array.from(agents.values());
    if (options?.status) result = result.filter(a => a.status === options.status);
    if (options?.type) result = result.filter(a => a.type === options.type);
    if (options?.parentId !== undefined) result = result.filter(a => a.parentId === options.parentId);
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Active count (running + waiting)
  activeCount(): number {
    return this.list({ status: 'running' }).length + this.list({ status: 'waiting' }).length;
  }

  // ============================================================
  // Communication
  // ============================================================

  sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): AgentMessage {
    const msg: AgentMessage = { ...message, id: `msg-${Date.now().toString(36)}`, timestamp: new Date().toISOString() };
    const agent = agents.get(message.to);
    if (agent && (agent.status === 'running' || agent.status === 'waiting')) {
      if (!messageBus.has(message.to)) messageBus.set(message.to, []);
      messageBus.get(message.to)!.push(msg);
    }
    return msg;
  }

  getMessages(agentId: string): AgentMessage[] {
    return messageBus.get(agentId) || [];
  }

  broadcast(content: string, type?: AgentType): void {
    const targets = type ? this.list({ type }) : this.list();
    for (const agent of targets) {
      if (agent.status === 'running') {
        this.sendMessage({ from: 'system', to: agent.id, content, type: 'notification' });
      }
    }
  }

  // ============================================================
  // Shared Context
  // ============================================================

  writeContext(key: string, value: Record<string, unknown>): void {
    sharedContext.set(key, value);
  }

  readContext(key: string): Record<string, unknown> | undefined {
    return sharedContext.get(key);
  }

  clearContext(): void {
    sharedContext.clear();
  }

  // ============================================================
  // Agent hierarchy
  // ============================================================

  createChildren(parentId: string, tasks: { description: string; type: AgentType }[]): AgentInstance[] {
    const parent = agents.get(parentId);
    if (!parent) return [];
    return tasks.map(task => this.create({
      name: task.description, type: task.type, parentId,
      model: parent.model, sandboxLevel: parent.sandboxLevel,
    }));
  }

  getTree(agentId: string): Record<string, unknown> {
    const agent = agents.get(agentId);
    if (!agent) return {};
    return {
      id: agent.id, name: agent.name, type: agent.type, status: agent.status,
      result: agent.result ? { success: agent.result.success, tokensUsed: agent.result.tokensUsed, duration: agent.result.duration } : null,
      children: agent.childIds.map(id => this.getTree(id)),
    };
  }

  // Orchestrate: decompose task → create children → run parallel → aggregate
  async orchestrate(description: string): Promise<{ success: boolean; summary: string; childResults: { agentName: string; success: boolean; output: string }[] }> {
    const orch = this.create({ name: `编排: ${description.slice(0, 50)}`, type: 'orchestrator' });
    const started = await this.start(orch.id, `将以下任务拆解为 2-4 个可并行执行的子任务，每个子任务一句话描述。\n\n任务：${description}\n\n只输出子任务列表，每行一个。不要输出其他内容。`);
    if (!started) return { success: false, summary: '编排 Agent 未能启动（已达并发上限）', childResults: [] };

    // Poll for decomposition result
    await this.waitForAgent(orch.id, 60000);
    const orchResult = orch.result;
    if (!orchResult?.success || !orchResult.output) {
      return { success: false, summary: '任务拆解失败: ' + (orchResult?.error || '无输出'), childResults: [] };
    }

    // Parse subtask descriptions
    const childTasks = orchResult.output
      .split('\n')
      .map(line => line.replace(/^[\d.\-\s*•]+/, '').trim())
      .filter(line => line.length > 5)
      .slice(0, 4)
      .map(desc => ({ description: desc, type: 'task' as AgentType }));

    if (childTasks.length === 0) {
      return { success: false, summary: '未能从编排输出中解析子任务', childResults: [] };
    }

    // Create and start children
    const children = this.createChildren(orch.id, childTasks);

    // Cross-agent file locking: prevent children from stepping on each other
    let _lockTimer: ReturnType<typeof setTimeout> | null = null;
    let _relFL: ((t: Task) => void) | null = null;
    let _orchTask: Task | null = null;
    try {
      const { acquireFileLocks, releaseFileLocks: relFL } = await import('../core/task-engine.js');
      _relFL = relFL;
      const allFiles = childTasks.map(t => t.description.match(/(?:src|lib|app)\/[\w/.-]+\.\w+/g) || []).flat();
      if (allFiles.length > 0) {
        _orchTask = createOrchTask(orch.id, orch.name, allFiles);
        acquireFileLocks(_orchTask);
        _lockTimer = setTimeout(() => { try { _relFL?.(_orchTask!); } catch { /* best-effort */ } }, 180000);
      }
    } catch { /* file locks are best-effort */ }

    const _startResults = await Promise.all(children.map(c => this.start(c.id, c.name)));

    // Wait for all children
    await Promise.all(children.map(c => this.waitForAgent(c.id, 120000)));
    // Release locks early if all children completed
    if (_lockTimer) { clearTimeout(_lockTimer); try { if (_orchTask) _relFL?.(_orchTask); } catch { /* best-effort */ } }

    // Collect results
    const childResults = children.map(c => {
      const agent = this.get(c.id);
      return {
        agentName: c.name,
        success: agent?.result?.success ?? false,
        output: agent?.result?.output?.slice(0, 200) || (agent?.result?.error || '无结果'),
      };
    });

    const allOk = childResults.every(r => r.success);
    return {
      success: allOk,
      summary: allOk
        ? `${children.length} 个子 Agent 全部完成`
        : `${childResults.filter(r => r.success).length}/${children.length} 个子 Agent 成功`,
      childResults,
    };
  }

  // Wait for an agent to reach a terminal state
  async waitForAgent(agentId: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const agent = this.get(agentId);
      if (!agent || agent.status === 'done' || agent.status === 'failed') return;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // ============================================================
  // Execution — real AI provider calls
  // ============================================================

  private async runAgent(agentId: string, taskOverride?: string): Promise<void> {
    const agent = agents.get(agentId);
    if (!agent) return;

    const startTime = Date.now();
    const abortController = new AbortController();
    this.abortControllers.set(agentId, abortController);

    try {
      const { createProvider } = await import('../ai/provider.js');
      const provider = createProvider({
        ...this.aiConfig,
        model: agent.model || this.aiConfig.model,
        maxTokens: agent.budget.maxTokens,
      });

      // Build prompt from agent context
      const systemPrompt = buildAgentSystemPrompt(agent);
      const task = taskOverride || agent.name;
      const history = this.getMessages(agentId)
        .map(m => `${m.from}: ${m.content}`)
        .join('\n');

      const prompt: AIPrompt = {
        systemPrompt,
        context: agent.context,
        task,
        history,
      };

      const response = await provider.chat(prompt);
      const duration = Date.now() - startTime;

      agent.result = {
        success: true,
        output: response.content,
        artifacts: response.structuredOutput?.changes?.map(c => c.file) || [],
        tokensUsed: response.tokensUsed,
        duration,
      };
      agent.status = 'done';
      agent.completedAt = new Date().toISOString();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('aborted') || msg.includes('AbortError')) {
        // Paused or stopped — leave status as-is
        this.abortControllers.delete(agentId);
        return;
      }
      agent.status = 'failed';
      agent.result = {
        success: false,
        output: '',
        artifacts: [],
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: msg,
      };
    } finally {
      this.abortControllers.delete(agentId);
      if (agent.status !== 'paused') {
        this.runningCount = Math.max(0, this.runningCount - 1);
      }
      agents.set(agentId, agent);
      this.processWaitingQueue();
    }
  }

  private processWaitingQueue(): void {
    const waiting = this.list({ status: 'waiting' });
    for (const agent of waiting) {
      if (this.runningCount < this.maxConcurrent) {
        agent.status = 'running';
        this.runningCount++;
        agents.set(agent.id, agent);
        this.runAgent(agent.id).catch(err => {
          const current = agents.get(agent.id);
          if (current && current.status === 'running') {
            current.status = 'failed';
            current.result = { success: false, output: '', artifacts: [], tokensUsed: 0, duration: 0, error: (err as Error).message };
            this.runningCount--;
            agents.set(agent.id, current);
            this.processWaitingQueue();
          }
        });
      }
    }
  }
}

// ============================================================
// Helpers
// ============================================================
function generateAgentId(): string {
  return `agent-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`;
}

function createOrchTask(orchId: string, name: string, affectedFiles: string[]): Task {
  return {
    id: `orch-${orchId}`,
    description: name,
    status: 'running',
    priority: 'normal',
    createdAt: new Date().toISOString(),
    changes: [],
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 1,
    agentExecutions: [],
    plan: { subGoals: [], affectedFiles, estimatedImpact: 'low', dependencies: [], lockedFiles: [] },
  };
}

function buildAgentSystemPrompt(agent: AgentInstance): string {
  const template = DEFAULT_TEMPLATES.find(t => t.type === agent.type);
  const base = template?.systemPrompt || '你是 icloser Agent，负责执行分配给你的任务。';
  const toolSection = buildToolCapabilitySection();
  return [
    base,
    `你的角色：${agent.type}`,
    `沙箱级别：${agent.sandboxLevel}`,
    toolSection,
    agent.context.projectMeta ? `项目信息：${agent.context.projectMeta.substring(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

function buildToolCapabilitySection(): string {
  try {
    const snapshot = buildToolCapabilitySnapshot();
    const lines = ['## 可用工具能力'];
    for (const cap of snapshot.capabilities) {
      const statusMark = cap.status === 'available' ? '✓' : cap.status === 'limited' ? '⚠' : '✗';
      lines.push(`- ${statusMark} ${cap.name}：${cap.purpose}`);
      if (cap.status !== 'available') lines.push(`  降级方案：${cap.fallback}`);
    }
    return lines.join('\n');
  } catch {
    return '可用工具：无法获取工具列表';
  }
}

// ============================================================
// Agent templates
// ============================================================
export interface AgentTemplate {
  name: string;
  type: AgentType;
  systemPrompt: string;
  defaultTools: string[];
  defaultModel: string;
}

export const DEFAULT_TEMPLATES: AgentTemplate[] = [
  {
    name: 'Code Reviewer',
    type: 'review',
    systemPrompt: '你是代码审查专家。检查代码风格一致性、潜在 bug、安全漏洞、性能问题。',
    defaultTools: ['review-diff', 'check-style', 'detect-bugs'],
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    name: 'Test Runner',
    type: 'verify',
    systemPrompt: '你是测试验证专家。运行测试套件，分析失败原因，提出修复建议。',
    defaultTools: ['run-tests', 'analyze-failures', 'suggest-fixes'],
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    name: 'Code Explorer',
    type: 'explore',
    systemPrompt: '你是代码探索专家。高效搜索和理解代码库，回答关于项目结构的问题。',
    defaultTools: ['search-code', 'read-files', 'analyze-dependencies'],
    defaultModel: 'claude-haiku-4-5-20251001',
  },
  {
    name: 'Task Executor',
    type: 'task',
    systemPrompt: '你是任务执行专家。根据任务描述和项目上下文，生成符合 AI 输出协议的代码变更。',
    defaultTools: ['read-file', 'write-file', 'search-code'],
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    name: 'Orchestrator',
    type: 'orchestrator',
    systemPrompt: '你是任务编排专家。将复杂任务拆解为子任务，分配给合适的 Agent 并行执行，汇总结果验证整体目标。',
    defaultTools: ['decompose-task', 'delegate', 'aggregate-results'],
    defaultModel: 'claude-sonnet-4-6',
  },
];

// ============================================================
// Agent Sandbox (S14)
// ============================================================
export type SandboxLevel = 'none' | 'readonly' | 'isolated';

export interface SandboxCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkSandboxWrite(filePath: string, level: SandboxLevel, projectRoot: string): SandboxCheckResult {
  if (level === 'none') return { allowed: true };

  const normalized = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/');

  // readonly: no writes allowed
  if (level === 'readonly') {
    return { allowed: false, reason: `Agent 处于 readonly 沙箱模式，禁止写入文件: ${filePath}` };
  }

  // isolated: only allow writes within project root
  if (level === 'isolated') {
    const resolved = normalized.startsWith('/') ? normalized : `${normalizedRoot}/${normalized}`;
    // Resolve .. and . to check path traversal
    const segments = resolved.split('/');
    const stack: string[] = [];
    for (const seg of segments) {
      if (seg === '..') stack.pop();
      else if (seg !== '.' && seg !== '') stack.push(seg);
    }
    const safe = stack.join('/');

    if (!safe.startsWith(normalizedRoot.replace(/\\/g, '/').split('/').filter(Boolean).join('/'))) {
      return { allowed: false, reason: `Agent 处于 isolated 沙箱模式，禁止访问项目外路径: ${filePath}` };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

export function filterSandboxedFiles(files: { path: string; content: string }[], level: SandboxLevel, projectRoot: string): { allowed: { path: string; content: string }[]; blocked: { path: string; reason: string }[] } {
  const allowed: { path: string; content: string }[] = [];
  const blocked: { path: string; reason: string }[] = [];

  for (const file of files) {
    const check = checkSandboxWrite(file.path, level, projectRoot);
    if (check.allowed) allowed.push(file);
    else blocked.push({ path: file.path, reason: check.reason! });
  }

  return { allowed, blocked };
}

// Process isolation: run agent in child process when sandboxLevel='isolated'
import { fork } from 'child_process';
import * as path from 'path';

export async function runAgentIsolated(
  agentId: string, task: string, rootPath: string, timeout = 120000
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise(resolve => {
    const worker = fork(path.join(rootPath, 'dist', 'index.js'), ['t', task, '--go'], {
      cwd: rootPath, stdio: 'pipe', timeout,
      env: { ...process.env, ICLOSER_AGENT_MODE: '1', ICLOSER_AGENT_ID: agentId },
    });
    let output = '';
    worker.stdout?.on('data', d => output += d.toString());
    worker.stderr?.on('data', d => output += d.toString());
    worker.on('exit', code => resolve({ success: code === 0, output: output.slice(-5000) }));
    worker.on('error', err => resolve({ success: false, output: '', error: err.message }));
    setTimeout(() => { worker.kill(); resolve({ success: false, output, error: 'timeout' }); }, timeout);
  });
}
