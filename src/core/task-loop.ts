export type TaskLoopStepId = 'collect-context' | 'take-action' | 'verify-result';
export type TaskLoopOwner = 'model' | 'tools' | 'verifier';
export type TaskLoopStatus = 'running' | 'completed' | 'paused' | 'stopped';
export type TaskLoopVerification = 'pass' | 'fail' | 'warn' | 'unknown';
export type TaskLoopInterrupt = 'user-interrupt' | 'new-instruction' | 'try-another-way' | 'safety-stop' | 'max-iterations';
export type TaskLoopIntervention = 'add-context' | 'change-direction' | 'interrupt-task';
export type TaskLoopVerifyBranch = 'complete' | 'continue-loop' | 'ask-user';
export type TaskLoopToolCategoryId = 'file-ops' | 'search' | 'command' | 'web-search' | 'code-intelligence';
export type TaskLoopToolAvailability = 'builtin' | 'external' | 'plugin-required';

export interface TaskLoopToolCategory {
  id: TaskLoopToolCategoryId;
  name: string;
  purpose: string;
  examples: string[];
  availability: TaskLoopToolAvailability;
  safetyRule: string;
  fallback: string;
}

export interface TaskLoopStep {
  id: TaskLoopStepId;
  name: string;
  owner: TaskLoopOwner;
  purpose: string;
  inputs: string[];
  outputs: string[];
  requiredToolCategories: TaskLoopToolCategoryId[];
  userVisibleRule: string;
}

export interface TaskLoopPolicy {
  maxIterations: number;
  verifyEveryAction: boolean;
  interruptible: boolean;
  toolActionsUseLocalCapabilities: boolean;
  modelDoesReasoning: boolean;
  memoryCapturesAllUserInput: boolean;
  userCanInterveneAtAnyStep: boolean;
}

export interface TaskLoopMechanism {
  name: string;
  version: number;
  purpose: string;
  policy: TaskLoopPolicy;
  steps: TaskLoopStep[];
  toolCategories: TaskLoopToolCategory[];
  generatedAt: string;
}

export interface TaskLoopState {
  iteration: number;
  currentStep: TaskLoopStepId;
  status: TaskLoopStatus;
  verification: TaskLoopVerification;
  interruptReason?: TaskLoopInterrupt;
  lastContextSummary?: string;
  lastActionSummary?: string;
  lastVerificationSummary?: string;
  lastIntervention?: TaskLoopIntervention;
  nextBranch?: TaskLoopVerifyBranch;
}

const TOOL_CATEGORIES: TaskLoopToolCategory[] = [
  {
    id: 'file-ops',
    name: '文件操作',
    purpose: '读文件、改代码、新建文件、重命名文件，并在写入后确认磁盘真实存在。',
    examples: ['读取文件', '修改代码', '新建文件', '重命名文件', '写入后校验路径'],
    availability: 'builtin',
    safetyRule: '写入、覆盖、重命名必须限制在项目根目录内；高风险动作进入中文确认面板。',
    fallback: '不可用时停止写入，只输出需要处理的文件清单。',
  },
  {
    id: 'search',
    name: '搜索',
    purpose: '按文件名、目录、符号名或正则表达式快速找代码和配置。',
    examples: ['按文件名查找', '正则搜索', '查错误文本', '查 TODO', '查配置项'],
    availability: 'builtin',
    safetyRule: '只读搜索自动执行，结果必须附路径和摘要，不要求用户自己找文件。',
    fallback: '不可用时降级为项目索引和已知上下文。',
  },
  {
    id: 'command',
    name: '执行命令',
    purpose: '运行 npm、git、测试、构建、lint、启动服务器等本地命令。',
    examples: ['npm run build', 'npm run test', 'git status', '启动服务器', '运行 smoke'],
    availability: 'builtin',
    safetyRule: '系统命令必须展示目的、原因、影响和中文选择；危险命令必须拦截或二次确认。',
    fallback: '不可用时给出无法验证说明，不假装已执行。',
  },
  {
    id: 'web-search',
    name: '网络搜索',
    purpose: '查询官方文档、错误信息、依赖行为、版本变更和外部知识。',
    examples: ['查官方文档', '查错误信息', '查库 API', '查版本兼容性'],
    availability: 'external',
    safetyRule: '优先官方或一手来源；网络结果默认不持久化，沉淀前进入记忆候选。',
    fallback: '网络不可用时使用本地文档、依赖源码、错误输出和已缓存记忆。',
  },
  {
    id: 'code-intelligence',
    name: '代码智能',
    purpose: '使用语言服务查看类型错误、跳转定义、找引用、符号索引和诊断。',
    examples: ['查看类型错误', '跳转定义', '找引用', '列出符号', '语言服务器诊断'],
    availability: 'builtin',
    safetyRule: '代码智能使用内置 tree-sitter AST 解析器（TS/JS/TSX）；不可用时降级。',
    fallback: '降级为正则搜索、项目扫描和编译/类型检查错误分析。',
  },
];

const LOOP_STEPS: TaskLoopStep[] = [
  {
    id: 'collect-context',
    name: '收集上下文',
    owner: 'model',
    purpose: '理解当前任务，读取项目事实、错误信息、文件内容、外部知识和历史记忆，决定下一步需要哪些本地能力。',
    inputs: ['用户输入', '当前目录', '项目索引', '相关文件', '错误日志', '短期/任务/长期记忆', '外部知识'],
    outputs: ['上下文摘要', '缺失信息', '候选行动', '风险判断'],
    requiredToolCategories: ['file-ops', 'search', 'web-search', 'code-intelligence'],
    userVisibleRule: '只读收集自动进行，不要求用户提供路径或命令；无法确认时给中文选项。',
  },
  {
    id: 'take-action',
    name: '采取行动',
    owner: 'tools',
    purpose: '使用本地工具真正执行动作，包括编辑文件、运行命令、启动服务、搜索、生成文档或补测试。',
    inputs: ['上下文摘要', '行动计划', '用户确认', '安全策略'],
    outputs: ['文件写入回执', '命令输出', '工具执行结果', '审计事件'],
    requiredToolCategories: ['file-ops', 'search', 'command'],
    userVisibleRule: '写文件、系统命令、高风险动作必须用中文选择面板确认；用户只选下一步。',
  },
  {
    id: 'verify-result',
    name: '验证结果',
    owner: 'verifier',
    purpose: '检查行动是否成功，判断是否完成、继续修复、换方法或回滚。',
    inputs: ['变更列表', '命令输出', 'build/lint/test/smoke 结果', '安全扫描结果', '代码智能诊断'],
    outputs: ['通过/失败/警告', '失败摘要', '下一轮上下文输入', '交付报告'],
    requiredToolCategories: ['file-ops', 'search', 'command', 'code-intelligence'],
    userVisibleRule: '验证失败不把问题丢给用户，系统自动带着错误信息进入下一轮；超过限制才给诊断和回滚选择。',
  },
];

export function buildTaskThinkingLoop(): TaskLoopMechanism {
  return {
    name: 'iCloser Task Thinking Loop',
    version: 1,
    purpose: '像可靠工程师一样循环执行：先收集上下文，再采取行动，最后验证结果；每一步都绑定所需工具能力，失败则带着新证据进入下一轮。',
    policy: {
      maxIterations: 3,
      verifyEveryAction: true,
      interruptible: true,
      toolActionsUseLocalCapabilities: true,
      modelDoesReasoning: true,
      memoryCapturesAllUserInput: true,
      userCanInterveneAtAnyStep: true,
    },
    steps: LOOP_STEPS,
    toolCategories: TOOL_CATEGORIES,
    generatedAt: new Date().toISOString(),
  };
}

export function createTaskLoopState(): TaskLoopState {
  return {
    iteration: 1,
    currentStep: 'collect-context',
    status: 'running',
    verification: 'unknown',
    nextBranch: 'continue-loop',
  };
}

export function advanceTaskLoop(
  state: TaskLoopState,
  options: { verification?: TaskLoopVerification; interrupt?: TaskLoopInterrupt; intervention?: TaskLoopIntervention; maxIterations?: number } = {}
): TaskLoopState {
  if (options.intervention) {
    return applyUserIntervention(state, options.intervention);
  }

  if (options.interrupt) {
    return {
      ...state,
      status: options.interrupt === 'safety-stop' || options.interrupt === 'max-iterations' ? 'stopped' : 'paused',
      interruptReason: options.interrupt,
      nextBranch: options.interrupt === 'safety-stop' || options.interrupt === 'max-iterations' ? 'ask-user' : 'continue-loop',
    };
  }

  if (state.status !== 'running') return state;

  if (state.currentStep === 'collect-context') {
    return { ...state, currentStep: 'take-action' };
  }

  if (state.currentStep === 'take-action') {
    return { ...state, currentStep: 'verify-result' };
  }

  const verification = options.verification || state.verification;
  if (verification === 'pass') {
    return { ...state, verification, status: 'completed', nextBranch: 'complete' };
  }

  const maxIterations = options.maxIterations ?? buildTaskThinkingLoop().policy.maxIterations;
  if (state.iteration >= maxIterations) {
    return {
      ...state,
      verification,
      status: 'stopped',
      interruptReason: 'max-iterations',
      nextBranch: 'ask-user',
    };
  }

  return {
    ...state,
    iteration: state.iteration + 1,
    currentStep: 'collect-context',
    verification,
    nextBranch: 'continue-loop',
  };
}

export function applyUserIntervention(state: TaskLoopState, intervention: TaskLoopIntervention): TaskLoopState {
  if (intervention === 'interrupt-task') {
    return {
      ...state,
      status: 'stopped',
      interruptReason: 'user-interrupt',
      lastIntervention: intervention,
      nextBranch: 'ask-user',
    };
  }

  return {
    ...state,
    status: 'running',
    currentStep: 'collect-context',
    interruptReason: intervention === 'change-direction' ? 'new-instruction' : 'user-interrupt',
    lastIntervention: intervention,
    nextBranch: 'continue-loop',
  };
}

export function renderTaskThinkingLoop(mechanism = buildTaskThinkingLoop()): string {
  const lines: string[] = [];
  lines.push('iCloser 三步任务循环');
  lines.push('');
  lines.push(mechanism.purpose);
  lines.push('');
  lines.push('模型与工具分工：');
  lines.push('- 模型：负责理解目标、推理风险、决定下一步策略。');
  lines.push('- 工具：负责真正动手，例如读文件、写文件、运行命令、搜索、验证。');
  lines.push('- 验证器：负责判断结果是否成功，并把失败证据送回下一轮。');
  lines.push('- 用户干预：可在任意阶段补充信息、调整方向或中断任务。');
  lines.push('');
  lines.push('五大工具能力：');
  mechanism.toolCategories.forEach((category, index) => {
    lines.push(`${index + 1}. ${category.name}：${category.purpose}`);
  });
  lines.push('');
  lines.push('循环 × 工具矩阵：');
  mechanism.steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.name} -> ${step.requiredToolCategories.map(id => toolName(id, mechanism)).join(' / ')}`);
  });
  lines.push('');
  lines.push('流程分支：');
  lines.push('用户输入 Prompt -> 收集上下文 -> 采取行动 -> 验证结果');
  lines.push('验证通过 -> 任务结束；需要继续 -> 回到收集上下文；用户干预 -> 重新收集或停止。');
  lines.push('');
  lines.push('循环步骤：');
  mechanism.steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.name}`);
    lines.push(`   负责：${formatOwner(step.owner)}`);
    lines.push(`   目标：${step.purpose}`);
    lines.push(`   工具：${step.requiredToolCategories.map(id => toolName(id, mechanism)).join('、')}`);
    lines.push(`   用户规则：${step.userVisibleRule}`);
  });
  lines.push('');
  lines.push(`最大自动循环：${mechanism.policy.maxIterations} 轮`);
  lines.push(`每次行动后必须验证：${mechanism.policy.verifyEveryAction ? '是' : '否'}`);
  lines.push(`用户可随时打断/换方法：${mechanism.policy.interruptible ? '是' : '否'}`);
  lines.push(`用户可在任意阶段干预：${mechanism.policy.userCanInterveneAtAnyStep ? '是' : '否'}`);
  lines.push(`所有用户输入进入记忆：${mechanism.policy.memoryCapturesAllUserInput ? '是' : '否'}`);
  return lines.join('\n');
}

function toolName(id: TaskLoopToolCategoryId, mechanism: TaskLoopMechanism): string {
  return mechanism.toolCategories.find(category => category.id === id)?.name || id;
}

function formatOwner(owner: TaskLoopOwner): string {
  if (owner === 'model') return '模型（思考和推理）';
  if (owner === 'tools') return '工具（本地执行能力）';
  return '验证器（检查结果）';
}
