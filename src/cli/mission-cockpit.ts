import { C, B, termWidth } from './theme.js';
import type { AgentTaskType } from '../core/agent-task-loop.js';
import type { GoldenPathState } from '../core/golden-path-state.js';
import type { CodeDeliveryReadiness, CodeDeliveryResult } from '../core/code-delivery-pipeline.js';
import type { ResultQualityGateReport } from '../core/result-quality-gate.js';
import { summarizeSourceCredibility } from '../core/source-credibility.js';

export interface MissionStartOptions {
  input: string;
  type: AgentTaskType;
  provider: string;
  model: string;
  memoryApplied: boolean;
  memoryDigest?: string;
  workspace: string;
}

export interface MissionResultOptions {
  state: GoldenPathState;
  type?: AgentTaskType;
  finalResponse: string;
  codeDelivery: CodeDeliveryResult;
  toolNames: string[];
  evidenceTargets?: string[];
  qualityGate?: ResultQualityGateReport;
  codeDeliveryReadiness?: CodeDeliveryReadiness;
  memoryCandidateSummary?: string;
  rounds: number;
  tokensUsed: number;
}

export interface MissionScore {
  total: number;
  level: 'excellent' | 'good' | 'needs-work' | 'failed';
  reasons: string[];
}

export function renderMissionStart(options: MissionStartOptions): string {
  const profile = missionProfile(options.type, options.input);
  const lines = [
    `${C.accentBold('任务驾驶舱')} ${C.dim('AI 会按工程闭环推进，不懂代码也能跟着看')}`,
    '',
    row('任务', trimOneLine(options.input, 70), C.bright),
    row('类型', profile.label, C.primary),
    row('目标', profile.goal, C.bright),
    row('AI', `${options.provider} / ${options.model}`, C.primary),
    row('记忆', options.memoryApplied ? '已注入项目规则和相关历史' : '本轮未匹配到强相关记忆', options.memoryApplied ? C.success : C.dim),
    ...(options.memoryDigest ? options.memoryDigest.split('\n').slice(1, 6).map(line => C.dim(`        ${line.trim()}`)) : []),
    row('目录', options.workspace, C.dim),
    row('预算', profile.budget, C.dim),
    '',
    C.dim('执行顺序') + '  ' + profile.steps.join(C.dim('  →  ')),
    C.dim('确认点') + '    ' + profile.confirmation,
  ];
  return box(lines);
}

export function renderMissionResult(options: MissionResultOptions): string {
  const type = options.type ?? 'general';
  const status = options.state.status === 'completed'
    ? C.success('完成')
    : options.state.status === 'failed'
      ? C.error('失败')
      : options.state.status === 'blocked'
        ? C.warn('阻塞')
        : C.primary('进行中');
  const deliverySummary = summarizeDelivery(type, options.finalResponse, options.codeDelivery);
  const verificationSummary = summarizeVerification(type, options.state);
  const evidence = [
    `${options.state.evidenceCount} 条证据`,
    `${options.state.toolCount} 次工具`,
    `${options.rounds} 轮 AI`,
    `${options.tokensUsed || 0} tokens`,
  ].join(' · ');
  const toolLine = options.toolNames.length > 0
    ? options.toolNames.slice(0, 6).join(', ') + (options.toolNames.length > 6 ? ` +${options.toolNames.length - 6}` : '')
    : '本轮未调用外部工具';
  const sourceLine = summarizeEvidenceTargets(options.evidenceTargets ?? []);
  const sourceCredibility = summarizeSourceCredibility(options.evidenceTargets ?? []);
  const answerSize = options.finalResponse.trim()
    ? `${options.finalResponse.trim().split(/\n/).length} 行回答`
    : '无最终回答';
  const score = evaluateMissionScore({
    type,
    state: options.state,
    finalResponse: options.finalResponse,
    codeDelivery: options.codeDelivery,
    toolNames: options.toolNames,
    evidenceTargets: options.evidenceTargets ?? [],
  });
  const recovery = options.state.failure ? summarizeFailure(options.state.failure, type, options.state.evidenceCount) : undefined;
  const guide = beginnerNextAction({
    type,
    state: options.state,
    qualityGate: options.qualityGate,
    codeDeliveryReadiness: options.codeDeliveryReadiness,
  });

  const lines = [
    `${C.accentBold('任务结果')} ${status}`,
    '',
    stageLine('理解', true, '已识别用户目标'),
    stageLine('取证', options.state.toolCount > 0, toolLine),
    stageLine('交付', options.state.resultReady || options.state.patchReady, deliverySummary),
    stageLine('验证', options.state.verificationReady, verificationSummary),
    stageLine('记忆', options.state.memoryApplied, options.state.memoryApplied ? '已使用任务记忆' : '无强相关记忆'),
    '',
    row('证据', evidence, C.dim),
    row('来源', sourceLine, sourceLine === '暂无可展示来源' ? C.dim : C.bright),
    row('来源等级', sourceCredibility, sourceCredibility === '暂无来源等级' ? C.dim : C.primary),
    row('模板', resultTemplateName(type, options.state.input), C.primary),
    options.qualityGate ? row('质量', formatQualityGate(options.qualityGate), options.qualityGate.score >= 85 ? C.success : options.qualityGate.score >= 70 ? C.warn : C.error) : '',
    options.qualityGate?.missing.length ? row('缺口', options.qualityGate.missing.slice(0, 4).join('、'), C.warn) : '',
    options.qualityGate?.repairPrompt ? row('补齐指令', options.qualityGate.repairPrompt, C.warn) : '',
    options.codeDeliveryReadiness ? row('代码', formatCodeReadiness(options.codeDeliveryReadiness), options.codeDeliveryReadiness.status === 'ready' ? C.success : options.codeDeliveryReadiness.status === 'needs-review' ? C.warn : C.error) : '',
    options.memoryCandidateSummary ? row('候选记忆', options.memoryCandidateSummary, C.success) : '',
    row('回答', answerSize, C.dim),
    row('评分', formatMissionScore(score), score.total >= 85 ? C.success : score.total >= 75 ? C.primary : C.warn),
    score.reasons.length > 0 ? row('扣分', score.reasons.slice(0, 2).join('；'), C.warn) : '',
    row('向导', guide, C.bright),
    options.state.nextAction ? row('下一步', options.state.nextAction, C.warn) : '',
    recovery ? row('失败', recovery.summary, C.warn) : '',
    recovery ? row('关键', recovery.error, C.warn) : '',
    recovery ? row('恢复', recovery.action, C.success) : '',
  ].filter(Boolean);
  return box(lines);
}

function beginnerNextAction(options: {
  type: AgentTaskType;
  state: GoldenPathState;
  qualityGate?: ResultQualityGateReport;
  codeDeliveryReadiness?: CodeDeliveryReadiness;
}): string {
  if (options.state.status === 'failed') return '先看“恢复”动作；不用懂代码，按推荐命令或换模型重试';
  if (options.qualityGate && options.qualityGate.missing.length > 0) {
    return `回复“补齐缺口”，AI 会补：${options.qualityGate.missing.slice(0, 3).join('、')}`;
  }
  if (options.type === 'code') {
    if (options.codeDeliveryReadiness?.status === 'ready') return '输入 d 看 diff，确认无误后输入 y 写入，再运行验证';
    return '回复“继续补齐代码交付”，AI 会补影响面、补丁或验证命令';
  }
  if (options.type === 'web') return '可以追问“详细点”或“提炼成报告”，AI 会复用这轮网页证据';
  if (options.type === 'analysis') return '可以追问“补成完整报告”或“列出投资风险”，AI 会按模板继续补证';
  if (options.type === 'startup') return '如果未启动成功，回复“继续启动”，AI 会按失败恢复路径继续';
  if (options.type === 'memory') return '如认可候选记忆，运行 ic mem candidates 后 approve 写回';
  if (options.type === 'release') return '先处理阻塞项，再运行 release report 复查门禁';
  return '可以回复“继续”，AI 会基于本轮证据推进下一步';
}

function formatQualityGate(report: ResultQualityGateReport): string {
  const status = report.status === 'pass' ? '通过' : report.status === 'warn' ? '需补齐' : '不通过';
  return `${report.score}/100 · ${status}`;
}

function formatCodeReadiness(readiness: CodeDeliveryReadiness): string {
  const status = readiness.status === 'ready' ? '可写入' : readiness.status === 'needs-review' ? '待补证' : '阻塞';
  return `${readiness.score}/100 · ${status}${readiness.missing.length ? ` · 缺 ${readiness.missing.slice(0, 3).join('、')}` : ''}`;
}

export function evaluateMissionScore(options: {
  type: AgentTaskType;
  state: GoldenPathState;
  finalResponse: string;
  codeDelivery: CodeDeliveryResult;
  toolNames: string[];
  evidenceTargets: string[];
}): MissionScore {
  let total = 15; // task was accepted and classified
  const reasons: string[] = [];

  if (options.toolNames.length > 0 || options.state.toolCount > 0) total += 15;
  else reasons.push('缺少工具取证');

  const hasSources = options.evidenceTargets.length > 0;
  const hasEvidence = options.state.evidenceCount > 0;
  if (hasEvidence && (hasSources || options.type === 'code' || options.type === 'startup')) total += 20;
  else if (hasEvidence) {
    total += 12;
    reasons.push('证据来源不够清晰');
  } else reasons.push('缺少结构化证据');

  const answerLines = options.finalResponse.trim().split(/\n/).filter(Boolean).length;
  if (answerLines >= minimumAnswerLines(options.type)) total += 20;
  else {
    total += Math.min(12, answerLines * 3);
    reasons.push('最终回答偏短');
  }

  if (options.state.verificationReady) total += 15;
  else reasons.push(options.type === 'code' || options.type === 'startup' ? '缺少命令验证' : '缺少证据核对');

  if (options.state.status === 'failed') {
    if (options.state.nextAction || options.state.failure) total += 6;
    reasons.push('任务失败，需要恢复');
  } else total += 10;

  if (options.state.memoryApplied) total += 5;
  else reasons.push('未使用相关记忆');

  if (options.type === 'code' && options.codeDelivery.status === 'patch-ready') total = Math.min(100, total + 5);
  const capped = Math.max(0, Math.min(100, Math.round(total)));
  return {
    total: capped,
    level: capped >= 90 ? 'excellent' : capped >= 80 ? 'good' : capped >= 70 ? 'needs-work' : 'failed',
    reasons: capped >= 75 ? reasons.slice(0, 2) : reasons.slice(0, 4),
  };
}

export function missionProfile(type: AgentTaskType, input = ''): {
  label: string;
  goal: string;
  steps: string[];
  confirmation: string;
  budget: string;
} {
  if (type === 'analysis' && /(投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input)) {
    return {
      label: '投资 / 市场研究',
      goal: '围绕公司、市场、融资、竞品和风险做证据化分析',
      steps: ['明确研究问题', '搜索公开资料', '抓取关键来源', '归纳投资判断', '列出尽调缺口'],
      confirmation: '只读公开资料和本地证据，不会写文件',
      budget: '每轮最多 8 次工具 · web_search ≤5 · 证据压缩后合成',
    };
  }
  if (type === 'code' && /(H5|h5|网页|web|HTML|html|Android|安卓|移动端|App|APP)/i.test(input)) {
    return {
      label: '代码交付 / H5 页面',
      goal: '把需求变成可运行网页，并给出 diff 与验证方式',
      steps: ['理解需求', '读取关键文件', '生成补丁', '等待确认写入', '运行验证'],
      confirmation: '真正写文件前会进入 /diff /write 确认，不会静默改项目',
      budget: '先定位影响面 · 关键文件去重读取 · 生成补丁后再验证',
    };
  }
  if (type === 'code') {
    return {
      label: '代码交付',
      goal: '定位影响面，生成可审查补丁，并推动验证',
      steps: ['理解需求', '搜索代码', '读取文件', '生成补丁', '验证'],
      confirmation: '写入前展示产物，失败时给出修复或回滚路径',
      budget: '搜索优先 · 文件读取去重 · 补丁和验证分阶段展示',
    };
  }
  if (type === 'web') {
    return {
      label: '网页访问',
      goal: '访问网页并直接回答用户问的内容',
      steps: ['抓取页面', '提取标题正文', '总结结论'],
      confirmation: '只读网页，不修改本地文件',
      budget: '优先抓取目标 URL · 追问复用上一轮网页证据',
    };
  }
  if (type === 'startup') {
    return {
      label: '项目启动',
      goal: '识别启动命令、环境缺口，并尽量把项目跑起来',
      steps: ['检查配置', '识别脚本', '执行启动', '失败恢复'],
      confirmation: '涉及系统命令时会展示执行状态和失败原因',
      budget: '先读构建配置 · 再执行命令 · 后台进程记录 PID',
    };
  }
  if (type === 'analysis') {
    return {
      label: '项目分析',
      goal: '读项目结构、找风险、给出可执行优化路径',
      steps: ['扫描结构', '读取关键文件', '归纳问题', '给出路径'],
      confirmation: '默认只读，不会写文件',
      budget: '扫描优先 · 关键文件抽样 · 结论必须带证据',
    };
  }
  if (type === 'release') {
    return {
      label: '发布验收',
      goal: '汇总质量门禁、测试、风险和发布可信度',
      steps: ['检查变更', '运行验证', '汇总门禁', '输出报告'],
      confirmation: '发布/提交前需要用户确认',
      budget: '按质量门禁收敛 · 测试/风险/发布物分块汇总',
    };
  }
  if (type === 'memory') {
    return {
      label: '长期记忆',
      goal: '读取、解释或沉淀项目规则和偏好',
      steps: ['召回记忆', '检查冲突', '给出建议', '候选写回'],
      confirmation: '写回 AGENTS.md 或规则前需要确认',
      budget: '只召回相关记忆 · 冲突提示 · 写回前确认',
    };
  }
  return {
    label: '通用工程助手',
    goal: '先弄清楚问题，再选择合适工具完成任务',
    steps: ['理解需求', '选择工具', '形成结论'],
    confirmation: '涉及写入、提交或系统命令时会提示确认',
    budget: '按任务类型选择工具 · 失败时进入恢复路径',
  };
}

function summarizeEvidenceTargets(targets: string[]): string {
  const normalized = targets
    .map(target => target.trim())
    .filter(Boolean)
    .map(target => {
      try {
        const url = new URL(target);
        return url.hostname.replace(/^www\./, '');
      } catch {
        return target.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
      }
    })
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 0) return '暂无可展示来源';
  return unique.slice(0, 5).join(', ') + (unique.length > 5 ? ` +${unique.length - 5}` : '');
}

function resultTemplateName(type: AgentTaskType, input: string): string {
  if (type === 'analysis' && /(投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input)) {
    return '投资研究：公司/市场/融资/竞品/风险/尽调/置信度';
  }
  if (type === 'web') return '网页访问：标题/来源/主要内容/直接回答/可追问点';
  if (type === 'code') return '代码交付：影响面/diff/风险/验证/下一步';
  if (type === 'startup') return '项目启动：环境/命令/状态/失败恢复';
  if (type === 'release') return '发布验收：门禁/测试/风险/发布物/阻塞项';
  if (type === 'memory') return '长期记忆：召回/冲突/候选规则/写回确认';
  return '通用任务：目标/证据/结论/下一步';
}

function minimumAnswerLines(type: AgentTaskType): number {
  if (type === 'analysis') return 6;
  if (type === 'code') return 3;
  if (type === 'startup') return 3;
  if (type === 'web') return 3;
  return 2;
}

function formatMissionScore(score: MissionScore): string {
  const label = score.level === 'excellent' ? '优秀'
    : score.level === 'good' ? '良好'
      : score.level === 'needs-work' ? '需加强'
        : '失败';
  return `${score.total}/100 · ${label}`;
}

function summarizeFailure(failure: string, type: AgentTaskType, evidenceCount: number): { summary: string; error: string; action: string } {
  const clean = failure.replace(/\s+/g, ' ').trim();
  const firstLine = failure.split(/\n/).map(line => line.trim()).find(Boolean) || clean || '任务失败';
  const lower = clean.toLowerCase();
  let action = '保留已有证据，缩小任务范围后重试';
  if (/timeout|超时/.test(lower)) {
    action = evidenceCount > 0
      ? '用已有证据生成兜底版；必要时切换 deepseek-v4-flash 后重试'
      : '切换 deepseek-v4-flash，降低搜索数量后重试';
  } else if (/json|parse|request body|hex escape/.test(lower)) {
    action = '压缩工具证据并重试；避免把原始长文本直接塞入 Provider history';
  } else if (/git|not a git|fatal/.test(lower)) {
    action = '按非 git 目录路径处理，跳过 git 命令或先初始化仓库';
  } else if (/api|key|unauthorized|401|403/.test(lower)) {
    action = '检查 Provider/API Key/model/base_url 是否匹配，再运行 provider test';
  } else if (type === 'code') {
    action = '查看 diff/影响面，先生成最小补丁，再运行验证命令';
  }
  // MC-07: show enough context to drive recovery — never truncate the key error
  const errorLines = failure.split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 6).join(' | ');
  return {
    summary: firstLine.slice(0, 200),
    error: errorLines.slice(0, 500) || clean.slice(0, 500),
    action,
  };
}

function summarizeDelivery(type: AgentTaskType, finalResponse: string, result: CodeDeliveryResult): string {
  if (type === 'code' || result.status === 'patch-ready' || result.status === 'invalid') return summarizeCodeDelivery(result);
  const lines = finalResponse.trim().split(/\n/).filter(line => line.trim()).length;
  if (lines > 0) return `已生成 ${lines} 行结果`;
  if (type === 'web') return '等待网页内容总结';
  if (type === 'analysis') return '等待分析结论';
  if (type === 'release') return '等待发布验收报告';
  if (type === 'memory') return '等待记忆处理结果';
  return '等待最终回答';
}

function summarizeVerification(type: AgentTaskType, state: GoldenPathState): string {
  if (state.verificationReady) {
    if (type === 'code' || type === 'startup') return '已有命令/Git/运行证据';
    return `已基于 ${state.evidenceCount} 条证据核对`;
  }
  if (type === 'code' || state.patchReady) return '等待写入后验证';
  if (type === 'startup') return '等待启动/命令证据';
  if (type === 'web' || type === 'analysis') return '缺少外部或工具证据';
  return '本轮暂无验证证据';
}

function summarizeCodeDelivery(result: CodeDeliveryResult): string {
  if (result.status === 'patch-ready') {
    const files = result.changes.map(change => change.file);
    return `补丁已生成：${files.slice(0, 4).join(', ')}${files.length > 4 ? ` +${files.length - 4}` : ''}`;
  }
  if (result.status === 'invalid') return result.error ? `补丁生成异常：${result.error}` : '补丁未通过结构化校验';
  if (result.status === 'none') return '本轮没有代码补丁';
  return result.summary || result.status;
}

function stageLine(label: string, ok: boolean, detail: string): string {
  const icon = ok ? C.success('●') : C.dim('○');
  const state = ok ? C.success('完成') : C.dim('待完成');
  return `${icon} ${C.bright(label.padEnd(4))} ${state}  ${C.dim(detail)}`;
}

function row(label: string, value: string, color: (s: string) => string): string {
  return `${C.dim(label.padEnd(6))}${color(value)}`;
}

function box(lines: string[]): string {
  const width = Math.max(70, Math.min(termWidth() - 4, 104));
  const fit = (s: string) => displayWidth(s) > width - 4 ? stripAnsi(s).slice(0, width - 7) + '...' : s;
  const out = [`  ${C.dim(B.tl + B.h.repeat(width - 2) + B.tr)}`];
  for (const raw of lines) {
    const line = fit(raw);
    out.push(`  ${C.dim(B.v)} ${line}${' '.repeat(Math.max(0, width - 4 - displayWidth(line)))} ${C.dim(B.v)}`);
  }
  out.push(`  ${C.dim(B.bl + B.h.repeat(width - 2) + B.br)}`);
  return out.join('\n') + '\n';
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function displayWidth(text: string): number {
  const clean = stripAnsi(text);
  const wide = clean.match(/[一-鿿㐀-䶿豈-﫿　-〿＀-￯぀-ヿ가-힯⺀-⿟]/g)?.length ?? 0;
  return clean.length + wide;
}

function trimOneLine(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}
