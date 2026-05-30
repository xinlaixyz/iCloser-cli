import type { AIProviderAdapter } from '../ai/provider.js';
import type { AIPrompt } from '../types.js';
import { buildToolDefinitions } from './tool-executor.js';
import { runToolLoop, type ToolLoopProgress } from './tool-loop.js';
import { EvidenceStore, summarizeToolEvidence } from './evidence-store.js';
import {
  advanceGoldenPathState,
  createGoldenPathState,
  type GoldenPathState,
} from './golden-path-state.js';
import {
  isCodeDeliveryIntent,
  parseCodeDeliveryOutput,
  evaluateCodeDeliveryReadiness,
  requestCodeDeliveryPatch,
  type CodeDeliveryResult,
  type CodeDeliveryReadiness,
} from './code-delivery-pipeline.js';
import { evaluateResultQuality, type ResultQualityGateReport } from './result-quality-gate.js';
import { proposePostTaskMemoryCandidate } from './memory-experience.js';
import { buildTaskQualityReport, saveTaskQualityReport } from './task-quality-report.js';

export type AgentTaskType = 'web' | 'startup' | 'code' | 'analysis' | 'release' | 'memory' | 'general';

export interface AgentTaskLoopOptions {
  rootPath: string;
  input: string;
  prompt: AIPrompt;
  provider: AIProviderAdapter;
  systemPrompt: string;
  taskId?: string;
  previousEvidence?: string;
  preloadContext?: { codeSnippets?: { file: string; content: string }[]; memory?: string };
  maxRounds?: number;
  tokenBudget?: number;
  onProgress?: (event: ToolLoopProgress) => void;
}

export interface AgentTaskLoopResult {
  taskId: string;
  type: AgentTaskType;
  finalResponse: string;
  success: boolean;
  rounds: number;
  tokensUsed: number;
  evidence: EvidenceStore;
  state: GoldenPathState;
  codeDelivery: CodeDeliveryResult;
  qualityGate: ResultQualityGateReport;
  codeDeliveryReadiness?: CodeDeliveryReadiness;
  memoryCandidateSummary?: string;
  qualityReportPath?: string;
}

export async function runAgentTaskLoop(options: AgentTaskLoopOptions): Promise<AgentTaskLoopResult> {
  const taskId = options.taskId || `agent-${Date.now().toString(36)}`;
  const type = classifyAgentTask(options.input);
  const evidence = await EvidenceStore.load(options.rootPath, taskId);
  let state = createGoldenPathState(taskId, options.input);
  state = advanceGoldenPathState(state, { stage: 'understanding' });

  if (options.previousEvidence) {
    evidence.add({
      taskId,
      kind: 'tool',
      source: 'previous-task',
      status: 'success',
      content: options.previousEvidence,
      summary: options.previousEvidence.slice(0, 900),
    });
  }

  state = advanceGoldenPathState(state, { stage: 'planning', memoryApplied: Boolean(options.preloadContext?.memory) });
  const tools = buildToolDefinitions();
  const task = buildTaskEnvelope(options.input, type, evidence.toProviderContext(), options.previousEvidence);

  state = advanceGoldenPathState(state, { stage: 'tool_running' });
  const loop = await runToolLoop({
    task,
    systemPrompt: options.systemPrompt,
    provider: options.provider,
    tools,
    rootPath: options.rootPath,
    taskId,
    preloadContext: options.preloadContext,
    maxRounds: options.maxRounds ?? defaultRounds(type),
    tokenBudget: options.tokenBudget ?? defaultBudget(type),
    suppressReadSynthesis: type === 'startup' || type === 'code',
    onProgress: options.onProgress,
  });

  for (const call of loop.toolCalls) {
    evidence.add({
      taskId,
      kind: 'tool',
      source: call.name,
      target: String(call.args.path || call.args.file || call.args.url || call.args.query || call.args.pattern || call.args.command || ''),
      status: call.success ? 'success' : 'failure',
      content: call.result,
      summary: summarizeToolEvidence(call.name, call.args, call.result),
      metadata: { round: call.round },
    });
  }

  const evidenceContext = evidence.toProviderContext(10);
  state = advanceGoldenPathState(state, {
    stage: 'evidence_ready',
    evidenceCount: evidence.list().length,
    toolCount: loop.toolCalls.length,
  });

  let finalResponse = loop.finalResponse;
  let codeDelivery = parseCodeDeliveryOutput(finalResponse, options.input);
  if (loop.success && type === 'code' && codeDelivery.status !== 'patch-ready') {
    try {
      state = advanceGoldenPathState(state, { stage: 'generating' });
      codeDelivery = await requestCodeDeliveryPatch(options.provider, options.prompt, evidenceContext);
      if (codeDelivery.status === 'patch-ready') {
        finalResponse = `${loop.finalResponse}\n\n${codeDelivery.summary}`;
      }
    } catch (err) {
      codeDelivery = {
        status: 'invalid',
        changes: [],
        summary: '代码交付补丁生成失败',
        error: (err as Error).message,
      };
    }
  }

  const failed = !loop.success;
  const hasSuccessfulEvidence = evidence.list().some(item => item.status === 'success');
  const commandVerified = loop.toolCalls.some(call => call.name === 'run_command' || call.name === 'git_status');
  const qualityGate = evaluateResultQuality({
    type,
    input: options.input,
    finalResponse,
    codeDelivery,
    evidenceTargets: evidence.list().map(item => item.target || '').filter(Boolean),
    toolNames: loop.toolCalls.map(call => call.name),
  });
  const evidenceTargets = evidence.list().map(item => item.target || '').filter(Boolean);
  const codeDeliveryReadiness = type === 'code'
    ? evaluateCodeDeliveryReadiness({
      codeDelivery,
      toolNames: loop.toolCalls.map(call => call.name),
      verificationReady: commandVerified,
    })
    : undefined;
  state = advanceGoldenPathState(state, {
    stage: failed ? 'failed' : codeDelivery.status === 'patch-ready' ? 'patch_ready' : 'completed',
    status: failed ? 'failed' : 'completed',
    resultReady: Boolean(finalResponse && !failed),
    patchReady: codeDelivery.status === 'patch-ready',
    verificationReady: type === 'code' || type === 'startup' ? commandVerified : hasSuccessfulEvidence,
    failure: failed ? finalResponse : undefined,
    nextAction: codeDelivery.status === 'patch-ready'
      ? '预览 diff 后确认写入，再运行验证'
      : type === 'code' && codeDeliveryReadiness
        ? codeDeliveryReadiness.nextAction
        : failed
        ? '查看失败原因后重试或切换 Provider'
        : undefined,
  });
  let memoryCandidateSummary: string | undefined;
  if (!failed) {
    try {
      const candidate = await proposePostTaskMemoryCandidate({
        rootPath: options.rootPath,
        taskId,
        type,
        input: options.input,
        finalResponse,
        qualityGate,
        codeDelivery,
      });
      memoryCandidateSummary = candidate?.summary;
    } catch {
      // Memory writeback is useful, but it must never block task completion.
    }
  }
  await evidence.save();
  let qualityReportPath: string | undefined;
  try {
    qualityReportPath = await saveTaskQualityReport(options.rootPath, buildTaskQualityReport({
      taskId,
      type,
      input: options.input,
      success: !failed,
      state,
      qualityGate,
      codeDelivery,
      codeDeliveryReadiness,
      evidenceTargets,
      toolCount: loop.toolCalls.length,
    }));
  } catch {
    // Quality report persistence is best-effort; task result remains usable.
  }
  return {
    taskId,
    type,
    finalResponse,
    success: loop.success,
    rounds: loop.rounds,
    tokensUsed: loop.tokensUsed,
    evidence,
    state,
    codeDelivery,
    qualityGate,
    codeDeliveryReadiness,
    memoryCandidateSummary,
    qualityReportPath,
  };
}

export function classifyAgentTask(input: string): AgentTaskType {
  if (/https?:\/\//i.test(input)) return 'web';
  if (/(转成|转换|改成|迁移|复刻|还原).*(H5|h5|网页|web|HTML|html)|(?:Android|安卓|移动端|App|APP).*(H5|h5|网页|web|HTML|html)/i.test(input)) return 'code';
  if (/(启动|运行|跑起来|打开|start|launch|serve|android|gradle|adb)/i.test(input)) return 'startup';
  if (isCodeDeliveryIntent(input)) return 'code';
  if (/(发布|release|打包|checksum|版本)/i.test(input)) return 'release';
  if (/(记忆|规则|偏好|AGENTS|CLAUDE)/i.test(input)) return 'memory';
  if (/(分析|检查|审查|review|项目结构|质量|扫描|投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input)) return 'analysis';
  return 'general';
}

function buildTaskEnvelope(input: string, type: AgentTaskType, evidenceContext: string, previousEvidence?: string): string {
  return [
    input,
    `\n[任务类型] ${type}`,
    previousEvidence ? `\n[上一任务证据]\n${previousEvidence}` : '',
    evidenceContext ? `\n[结构化证据摘要]\n${evidenceContext}` : '',
    type === 'code'
      ? '\n[代码交付要求] 必须先用工具定位影响面并读取关键文件；最终需要能产出 diff/patch，不能只给建议。'
      : '',
    type === 'startup'
      ? '\n[启动要求] 不要停在说明；必须检查构建配置、SDK/环境、启动命令，并尽可能执行或给出明确失败恢复。'
      : '',
    type === 'web'
      ? '\n[网页访问结果模板] 最终回答必须包含：标题、来源、主要内容、直接回答、可追问点。不要只说“让我访问看看”。'
      : '',
    type === 'analysis' && /(投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input)
      ? '\n[投资/市场研究模板] 最终回答必须包含：公司概况、市场机会、融资/估值线索、竞品、核心风险、尽调缺口、置信度。缺少证据时明确标为“待补证”。'
      : '',
    type === 'analysis' && !/(投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input)
      ? '\n[项目分析模板] 最终回答必须包含：现状、关键问题、风险等级、优化路径、下一步验收。'
      : '',
    type === 'release'
      ? '\n[发布验收模板] 最终回答必须包含：质量门禁、测试结果、风险、发布物、阻塞项、下一步。'
      : '',
    type === 'memory'
      ? '\n[记忆任务模板] 最终回答必须包含：召回规则、冲突点、候选新增规则、是否需要写回。'
      : '',
    type === 'code' && /(H5|h5|网页|web|HTML|html|Android|安卓|移动端|App|APP)/i.test(input)
      ? '\n[H5交付要求] 如果用户要求把移动端/Android需求转成H5网页，必须产出可运行网页文件、样式、交互说明，并给出浏览器验证方式。'
      : '',
  ].filter(Boolean).join('\n');
}

function defaultRounds(type: AgentTaskType): number {
  return type === 'startup' || type === 'analysis' || type === 'code' ? 6 : 4;
}

function defaultBudget(type: AgentTaskType): number {
  return type === 'analysis' ? 120000 : type === 'code' ? 90000 : 80000;
}
