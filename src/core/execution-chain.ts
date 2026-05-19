// Execution Chain — configuration-driven pipeline definition.
// Design: this module defines the 12-stage chain topology, stage metadata,
// and default policies. Runtime execution is handled by execution-engine.ts
// which reads these definitions and orchestrates the actual flow.
// This separation allows chain topology changes without touching runtime code.

export type ExecutionChainStageId =
  | 'understand'
  | 'inspect'
  | 'plan'
  | 'confirm'
  | 'execute'
  | 'verify'
  | 'repair'
  | 'rollback'
  | 'report'
  | 'remember';

export type ExecutionChainActor = 'system' | 'ai' | 'user' | 'verifier';
export type ExecutionChainRisk = 'none' | 'low' | 'medium' | 'high';

export interface ExecutionChainStage {
  id: ExecutionChainStageId;
  name: string;
  actor: ExecutionChainActor;
  goal: string;
  input: string[];
  output: string[];
  autoRun: boolean;
  requiresUserChoice: boolean;
  risk: ExecutionChainRisk;
  failurePolicy: string;
}

export interface ExecutionChainPolicy {
  maxRepairAttempts: number;
  writeRequiresChoice: boolean;
  commandRequiresChoice: boolean;
  rollbackOnUnsafeFailure: boolean;
  memoryCompression: 'automatic-after-task' | 'manual-only';
}

export interface ExecutionChain {
  name: string;
  version: number;
  purpose: string;
  policy: ExecutionChainPolicy;
  stages: ExecutionChainStage[];
  generatedAt: string;
}

const STAGES: ExecutionChainStage[] = [
  {
    id: 'understand',
    name: '理解用户目标',
    actor: 'ai',
    goal: '把自然语言转换为任务类型、风险等级和可执行目标，不要求用户补工程细节。',
    input: ['用户原始输入', '当前工作目录', '项目记忆', '最近会话'],
    output: ['任务意图', '风险初判', '是否需要本地工具'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'none',
    failurePolicy: '无法理解时给出 2-3 个中文选项，不让用户写命令。',
  },
  {
    id: 'inspect',
    name: '自动检查项目',
    actor: 'system',
    goal: '读取项目结构、依赖、脚本、索引、文档、测试和错误日志，形成事实上下文。',
    input: ['文件树', 'package.json / 构建文件', '.icloser/index.json', 'docs/'],
    output: ['项目画像', '缺口列表', '可运行命令候选'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'none',
    failurePolicy: '读取失败时降级为浅扫描，并在报告中标注缺失依据。',
  },
  {
    id: 'plan',
    name: '生成小步计划',
    actor: 'ai',
    goal: '把大目标拆成可验证的小步骤，每一步都有文件范围、验证命令和回滚策略。',
    input: ['用户目标', '项目画像', '缺口列表'],
    output: ['执行计划', '候选文件', '验证策略'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'low',
    failurePolicy: '计划不完整时自动重新规划一次；仍失败则只输出分析，不执行。',
  },
  {
    id: 'confirm',
    name: '中文选择确认',
    actor: 'user',
    goal: '所有写文件、系统命令、高风险动作都用中文选择面板确认，用户只选数字。',
    input: ['执行计划', 'diff 预览', '命令原因和影响'],
    output: ['执行 / 查看差异 / 取消 / 允许并记住'],
    autoRun: false,
    requiresUserChoice: true,
    risk: 'medium',
    failurePolicy: '用户输入无效时停留在确认面板，不把数字当成聊天。',
  },
  {
    id: 'execute',
    name: '执行最小变更',
    actor: 'system',
    goal: '一次只做当前计划允许的最小写入或命令操作，写入后立即磁盘确认。',
    input: ['用户确认', '文件变更契约', '系统操作契约'],
    output: ['写入回执', '命令输出', '变更列表'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'medium',
    failurePolicy: '写入失败不继续后续步骤；保留错误和原始内容。',
  },
  {
    id: 'verify',
    name: '自动验证',
    actor: 'verifier',
    goal: '自动运行 build、lint、test、smoke 或项目识别出的验证命令。',
    input: ['变更列表', '项目验证配置', '测试计划'],
    output: ['验证结果', '失败摘要', '下一轮修复输入'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'low',
    failurePolicy: '失败时进入 repair；无法验证时标记为 warn，不假装成功。',
  },
  {
    id: 'repair',
    name: '失败自动修复',
    actor: 'ai',
    goal: '基于错误摘要生成最小修复，不扩大范围，最多重试固定次数。',
    input: ['失败命令', 'stderr/stdout 摘要', '本轮 diff'],
    output: ['修复变更', '重试计数'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'medium',
    failurePolicy: '超过重试次数或出现安全风险时停止并建议回滚。',
  },
  {
    id: 'rollback',
    name: '安全回滚',
    actor: 'system',
    goal: '当验证持续失败、触发安全规则或用户取消时，能恢复到变更前状态。支持 --auto 自动回滚。',
    input: ['写入前快照', '任务 diff', '失败原因', '文件 receipts'],
    output: ['回滚结果', '保留诊断报告', 'Memory 回滚事件', 'Audit 记录'],
    autoRun: false,
    requiresUserChoice: true,
    risk: 'high',
    failurePolicy: '高风险回滚必须确认；只回滚本任务写入的文件。\n'
      + '设置 execution.autoRollbackOnFailure: true 可在验证失败时自动回滚，免用户交互。\n'
      + '回滚事件广播到 memory/audit/task-engine。',
  },
  {
    id: 'report',
    name: '交付报告',
    actor: 'system',
    goal: '用中文告诉用户做了什么、文件在哪里、验证是否通过、下一步是什么。',
    input: ['变更列表', '验证结果', '审计事件'],
    output: ['任务报告', '文件路径', '可复制命令'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'none',
    failurePolicy: '报告生成失败不影响代码，但必须在终端给出最小交付摘要。',
  },
  {
    id: 'remember',
    name: '记忆压缩与沉淀',
    actor: 'system',
    goal: '记录所有用户输入、执行事实、失败经验，自动压缩短期记忆，候选长期记忆等待审核。',
    input: ['用户输入事件', '任务日志', '报告', '审计事件'],
    output: ['短期记忆', '任务记忆', '长期记忆候选'],
    autoRun: true,
    requiresUserChoice: false,
    risk: 'low',
    failurePolicy: '记忆写入失败不阻断交付，但要写入审计 warning。',
  },
];

export function buildExecutionChain(): ExecutionChain {
  return {
    name: 'iCloser Autonomous Execution Chain',
    version: 1,
    purpose: '让 Agent Shell 自动找问题、自动小步执行、自动验证、失败修复、必要时回滚，并始终让零知识用户只做关键选择。',
    policy: {
      maxRepairAttempts: 2,
      writeRequiresChoice: true,
      commandRequiresChoice: true,
      rollbackOnUnsafeFailure: true,
      memoryCompression: 'automatic-after-task',
    },
    stages: STAGES,
    generatedAt: new Date().toISOString(),
  };
}

export function renderExecutionChain(chain = buildExecutionChain()): string {
  const lines: string[] = [];
  lines.push('iCloser 自动执行链');
  lines.push('');
  lines.push(chain.purpose);
  lines.push('');
  lines.push('核心规则：');
  lines.push(`- 写文件必须选择确认：${chain.policy.writeRequiresChoice ? '是' : '否'}`);
  lines.push(`- 系统命令必须选择确认：${chain.policy.commandRequiresChoice ? '是' : '否'}`);
  lines.push(`- 自动修复最多重试：${chain.policy.maxRepairAttempts} 次`);
  lines.push(`- 任务后自动压缩记忆：${chain.policy.memoryCompression === 'automatic-after-task' ? '是' : '否'}`);
  lines.push('');
  lines.push('执行顺序：');
  chain.stages.forEach((stage, index) => {
    const choice = stage.requiresUserChoice ? '需用户选择' : '自动';
    lines.push(`${index + 1}. ${stage.name} [${choice}]`);
    lines.push(`   目标：${stage.goal}`);
    lines.push(`   失败处理：${stage.failurePolicy}`);
  });
  return lines.join('\n');
}
