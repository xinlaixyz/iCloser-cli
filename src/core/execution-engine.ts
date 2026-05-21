// B2: System-Driven Execution Engine
// The SYSTEM controls the execution loop. AI is a reasoning engine consulted at decision points.
// Key difference from old loop: AI doesn't call tools directly — system plans, system executes.

import { randomUUID } from 'node:crypto';
import type {
  ExecutionPlan, PlanStep, StepResult, ExecutionState,
  ContextPackage, Task,
} from '../types.js';

const MAX_EXECUTION_ROUNDS = 6;
const MAX_DECISION_POINTS = 4;
const MAX_CONSECUTIVE_EMPTY = 2;

/** Main entry: system-driven task execution */
export async function executeWithPlan(
  plan: ExecutionPlan,
  task: Task,
  rootPath: string,
  provider: any, // AIProviderAdapter
  contextPkg: ContextPackage,
): Promise<{
  success: boolean;
  aiResponse: string;
  executionState: ExecutionState;
  decisionPoints: string[];
}> {
  const decisionLog: string[] = [];
  const state: ExecutionState = {
    plan,
    completedSteps: [],
    pendingSteps: [...plan.steps],
    collectedFiles: new Map(),
    collectedSymbols: new Map(),
    infoGathered: { filesRead: new Set(), patternsSearched: new Set(), symbolsQueried: new Set() },
    decisionPoints: 0,
    phase: 'executing',
  };

  let roundsWithoutProgress = 0;
  let consecutiveEmpty = 0;
  let estimatedTokensUsed = 0;
  const TOKEN_BUDGET = contextPkg.totalTokens || 24000;
  const TOKEN_WARN_THRESHOLD = TOKEN_BUDGET * 0.7;

  for (let round = 0; round < MAX_EXECUTION_ROUNDS && state.phase !== 'complete'; round++) {
    // Auto-11: Token budget monitoring — warn when approaching limit
    if (estimatedTokensUsed > TOKEN_WARN_THRESHOLD && state.phase === 'executing') {
      decisionLog.push(`Round ${round}: Token 预算 ${Math.round(estimatedTokensUsed / TOKEN_BUDGET * 100)}%，触发提前合成`);
      state.phase = 'synthesizing';
    }
    if (state.pendingSteps.length === 0 && state.phase === 'executing') {
      state.phase = 'synthesizing';
    }

    // ── Decision Point: Should we re-plan? ──
    if (shouldReplan(state, roundsWithoutProgress, consecutiveEmpty)) {
      state.decisionPoints++;
      decisionLog.push(`Round ${round}: 触发重新规划 — 连续 ${consecutiveEmpty} 次空结果`);
      const newPlan = await replanFromState(state, provider);
      if (newPlan && newPlan.steps.length > 0) {
        plan = newPlan;
        state.plan = newPlan;
        state.pendingSteps = [...newPlan.steps];
        consecutiveEmpty = 0;
        roundsWithoutProgress = 0;
      }
    }

    // ── Decision Point: Have we gathered enough? ──
    if (state.phase === 'executing' && hasEnoughInfo(state)) {
      state.phase = 'synthesizing';
      decisionLog.push(`Round ${round}: 信息充足，进入合成阶段`);
    }

    // ── Synthesis phase: ask AI to produce final output ──
    if (state.phase === 'synthesizing') {
      const { buildExecutionSummary } = await import('./execution-plan.js');
      const summary = buildExecutionSummary(state);

      const synthResponse = await provider.chat({
        systemPrompt: '你已完成项目探索。基于探索结果生成最终输出。只输出 JSON 变更契约。不要再调用工具。',
        task: summary,
        context: contextPkg,
        history: '',
      });

      // Auto-1: Self-review phase — AI reviews own output before returning
      let finalResponse = synthResponse.content;
      for (let reviewRound = 0; reviewRound < 2; reviewRound++) {
        const reviewResult = await selfReview(finalResponse, state.plan.taskDescription, contextPkg, provider);
        if (!reviewResult.hasIssues) break;
        decisionLog.push(`Review ${reviewRound + 1}: 发现 ${reviewResult.issues.length} 个问题 — 已修复`);
        finalResponse = reviewResult.fixedOutput;
      }

      state.phase = 'complete';
      return {
        success: true,
        aiResponse: finalResponse,
        executionState: state,
        decisionPoints: decisionLog,
      };
    }

    // ── Execute next step(s) — parallelize independent read_file steps ──
    if (state.pendingSteps.length === 0) continue;

    // Auto-10: Parallel read_file steps (all read, no dependencies between them)
    const parallelBatch: PlanStep[] = [];
    if (state.pendingSteps[0].tool === 'read_file') {
      while (state.pendingSteps.length > 0 && state.pendingSteps[0].tool === 'read_file') {
        parallelBatch.push(state.pendingSteps.shift()!);
      }
    }
    if (parallelBatch.length === 0) {
      parallelBatch.push(state.pendingSteps.shift()!);
    }

    const batchResults = parallelBatch.length > 1
      ? await Promise.all(parallelBatch.map(s => executeStep(s, rootPath, state, task.id)))
      : [await executeStep(parallelBatch[0], rootPath, state, task.id)];

    for (let bi = 0; bi < batchResults.length; bi++) {
      const stepResult = batchResults[bi];
      state.completedSteps.push(stepResult);
      updateGatheredInfo(state, parallelBatch[bi], stepResult);

      if (!stepResult.success || stepResult.emptyResult) {
        consecutiveEmpty++;
        roundsWithoutProgress++;
        if (stepResult.emptyResult && parallelBatch[bi].fallback) {
          decisionLog.push(`Round ${round}: Step ${parallelBatch[bi].seq} 空结果，切换到后备方案`);
          state.pendingSteps.unshift(parallelBatch[bi].fallback!);
          consecutiveEmpty = 0;
        }
      } else {
        consecutiveEmpty = 0;
        roundsWithoutProgress = 0;
      }
    }
    if (parallelBatch.length > 1) {
      decisionLog.push(`Round ${round}: 并行读取 ${parallelBatch.length} 个文件`);
    }
    // Auto-11: Track cumulative token estimate (rough: 4 chars ≈ 1 token)
    estimatedTokensUsed += batchResults.reduce((sum, r) => sum + Math.round(r.output.length / 4), 0);
  }

  // Max rounds reached — force synthesis
  const { buildExecutionSummary } = await import('./execution-plan.js');
  const summary = buildExecutionSummary(state);
  try {
    const forcedResponse = await provider.chat({
      systemPrompt: '已达到最大探索轮次。基于已有信息合成最终输出。只输出 JSON 变更契约。不要继续探索。',
      task: summary,
      context: contextPkg,
      history: '',
    });
    // Auto-1: Also self-review forced synthesis
    let finalForced = forcedResponse.content;
    try {
      const reviewResult = await selfReview(finalForced, state.plan.taskDescription, contextPkg, provider);
      if (reviewResult.hasIssues) {
        decisionLog.push(`Force review: ${reviewResult.issues.length} 个问题已修复`);
        finalForced = reviewResult.fixedOutput;
      }
    } catch { /* review best-effort */ }
    state.phase = 'complete';
    return {
      success: true,
      aiResponse: finalForced,
      executionState: state,
      decisionPoints: decisionLog,
    };
  } catch {
    return {
      success: false,
      aiResponse: '',
      executionState: state,
      decisionPoints: decisionLog,
    };
  }
}

/** Execute a single plan step */
async function executeStep(
  step: PlanStep,
  rootPath: string,
  state: ExecutionState,
  taskId: string,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const { executeToolCall } = await import('./tool-executor.js');
    const result = await executeToolCall(step.tool, step.args, rootPath, taskId);
    const emptyResult = result.includes('未找到') || result.includes('未匹配') || result.includes('0 条');

    // Store results in state for later steps
    if (step.tool === 'read_file' && !emptyResult) {
      state.collectedFiles.set(step.args.path as string, result);
    }

    return {
      seq: step.seq,
      tool: step.tool,
      success: !result.startsWith('错误') && !result.startsWith('命令执行失败') && !result.startsWith('工具执行异常'),
      output: result,
      emptyResult,
      duration: Date.now() - start,
    };
  } catch (e) {
    return {
      seq: step.seq,
      tool: step.tool,
      success: false,
      output: '',
      emptyResult: true,
      errorMessage: (e as Error).message,
      duration: Date.now() - start,
    };
  }
}

/** Update the infoGathered tracking after each step */
function updateGatheredInfo(state: ExecutionState, step: PlanStep, _result: StepResult): void {
  if (step.tool === 'read_file') {
    state.infoGathered.filesRead.add(step.args.path as string);
  }
  if (step.tool === 'search_code' && step.args.pattern) {
    state.infoGathered.patternsSearched.add(step.args.pattern as string);
  }
  if (step.tool === 'code_intel' && step.args.symbol) {
    state.infoGathered.symbolsQueried.add(step.args.symbol as string);
  }
}

/** Check if the system should trigger re-planning */
function shouldReplan(state: ExecutionState, noProgress: number, emptyCount: number): boolean {
  if (state.decisionPoints >= MAX_DECISION_POINTS) return false;
  if (state.pendingSteps.length === 0) return false;
  // Trigger if consecutive empty results exceed threshold
  if (emptyCount >= MAX_CONSECUTIVE_EMPTY) return true;
  // Trigger if no progress for 3+ rounds
  if (noProgress >= 3) return true;
  return false;
}

/** Ask AI to generate a revised plan based on current state */
async function replanFromState(state: ExecutionState, provider: any): Promise<ExecutionPlan | null> {
  const completedSummary = state.completedSteps
    .map(s => `Step ${s.seq}: ${s.tool} — ${s.success ? (s.emptyResult ? '空结果' : '成功') : '失败'}`)
    .join('\n');

  const replanPrompt = [
    '当前探索遇到困难。基于已完成步骤重新规划。',
    '已完成:',
    completedSummary,
    '',
    '请输出新的执行计划（JSON格式，只包含尚未完成的步骤）。',
    '如果有步骤反复返回空结果，换一种方式获取信息。',
  ].join('\n');

  try {
    const response = await provider.chat({
      systemPrompt: '你是任务规划专家。重新规划剩余步骤。只输出JSON。',
      task: replanPrompt,
      context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      history: '',
    });
    return JSON.parse((response.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
  } catch { return null; }
}

/** Check if enough information has been gathered to start synthesis */
function hasEnoughInfo(state: ExecutionState): boolean {
  if (state.completedSteps.length === 0) return false;
  // If all infoRequirements are met, we have enough
  const allFilesRead = state.plan.infoRequirements.filesToRead.every(
    f => state.infoGathered.filesRead.has(f)
  );
  const allPatternsSearched = state.plan.infoRequirements.patternsToSearch.every(
    p => state.infoGathered.patternsSearched.has(p)
  );
  const allSymbolsQueried = state.plan.infoRequirements.symbolsToQuery.every(
    s => state.infoGathered.symbolsQueried.has(s)
  );
  return allFilesRead && allPatternsSearched && allSymbolsQueried;
}

// ── Auto-1: Self-review — AI evaluates its own output ──

interface ReviewResult { hasIssues: boolean; issues: string[]; fixedOutput: string; }

async function selfReview(
  output: string,
  taskDescription: string,
  contextPkg: ContextPackage,
  provider: any,
): Promise<ReviewResult> {
  try {
    const reviewResp = await provider.chat({
      systemPrompt: `你是代码审查专家。审查以下 AI 生成的代码变更，检查:\n1. 完整性 — 是否完整实现了任务需求\n2. 正确性 — 代码逻辑是否正确\n3. 一致性 — 风格是否与项目一致\n4. 安全性 — 是否有明显的安全漏洞\n\n如果发现问题，输出修复后的完整 JSON 变更契约。如果没有问题，输出: {"review":"pass"}`,
      task: `## 原始任务\n${taskDescription}\n\n## AI 生成的变更\n${output}\n\n请审查上述变更。如果无问题输出{"review":"pass"}，如果有问题输出修复后的完整变更契约。`,
      context: contextPkg,
      history: '',
    });

    const content = reviewResp.content || '';
    const json = (() => { try { return JSON.parse((content.match(/\{[\s\S]*\}/)?.[0] || '{}')); } catch { return {}; } })();

    if (json.review === 'pass') {
      return { hasIssues: false, issues: [], fixedOutput: output };
    }
    if (json.changes && json.changes.length > 0) {
      return {
        hasIssues: true,
        issues: json.summary ? [json.summary] : ['AI 审查发现问题并修复'],
        fixedOutput: content,
      };
    }
    return { hasIssues: false, issues: [], fixedOutput: output };
  } catch {
    return { hasIssues: false, issues: [], fixedOutput: output };
  }
}

// ── B3: Unified Execution Bus ──

export interface BusAgent {
  id: string;
  name: string;
  task: string;
  context: ContextPackage;
  state: ExecutionState | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  result?: string;
}

/** Unified bus for both simple tasks and multi-agent orchestration */
export class ExecutionBus {
  private agents: Map<string, BusAgent> = new Map();
  private sharedContext: Map<string, string> = new Map(); // shared file cache
  private maxParallel: number;

  constructor(maxParallel = 4) {
    this.maxParallel = maxParallel;
  }

  createAgent(task: string, context: ContextPackage): BusAgent {
    const agent: BusAgent = {
      id: `agent-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`,
      name: task.slice(0, 40),
      task,
      context,
      state: null,
      status: 'pending',
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async executeAgent(agent: BusAgent, rootPath: string, provider: any): Promise<BusAgent> {
    agent.status = 'running';
    try {
      const { generateExecutionPlan } = await import('./execution-plan.js');
      const plan = await generateExecutionPlan(agent.task, agent.context, provider);
      agent.state = {
        plan,
        completedSteps: [],
        pendingSteps: [...plan.steps],
        collectedFiles: new Map(),
        collectedSymbols: new Map(),
        infoGathered: { filesRead: new Set(), patternsSearched: new Set(), symbolsQueried: new Set() },
        decisionPoints: 0,
        phase: 'executing',
      };

      const taskId = agent.id;
      const mockTask: any = { id: taskId, description: agent.task };
      const result = await executeWithPlan(plan, mockTask, rootPath, provider, agent.context);
      agent.status = result.success ? 'complete' : 'failed';
      agent.result = result.aiResponse;
      agent.state = result.executionState;
    } catch (e) {
      agent.status = 'failed';
      agent.result = (e as Error).message;
    }
    return agent;
  }

  /** Execute multiple agents in parallel, sharing collected file cache */
  async executeParallel(
    agents: BusAgent[],
    rootPath: string,
    provider: any,
  ): Promise<BusAgent[]> {
    const batches: BusAgent[][] = [];
    for (let i = 0; i < agents.length; i += this.maxParallel) {
      batches.push(agents.slice(i, i + this.maxParallel));
    }
    const results: BusAgent[] = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(a => this.executeAgent(a, rootPath, provider))
      );
      // Share collected files between agents
      for (const agent of batchResults) {
        if (agent.state?.collectedFiles) {
          for (const [file, content] of agent.state.collectedFiles) {
            if (!this.sharedContext.has(file)) {
              this.sharedContext.set(file, content);
            }
          }
        }
      }
      results.push(...batchResults);
    }
    return results;
  }

  getSharedFiles(): Map<string, string> { return this.sharedContext; }
  getAgent(id: string): BusAgent | undefined { return this.agents.get(id); }
  getAllAgents(): BusAgent[] { return [...this.agents.values()]; }
}
