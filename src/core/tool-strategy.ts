// Tool Strategy Mapper — maps user intent to recommended tool sequence
// Fixes TI1: AI now knows which tools to use for each intent, and in what order
import type { UserIntentCategory } from '../types.js';

export interface ToolStep {
  tool: string;
  description: string;
  /** If empty result, try this fallback tool */
  fallback?: string;
}

export interface ToolStrategy {
  intent: UserIntentCategory;
  /** Ordered tool sequence for this intent */
  steps: ToolStep[];
  /** Guidance injected into system prompt */
  guidance: string;
}

const STRATEGIES: ToolStrategy[] = [
  {
    intent: 'analysis',
    steps: [
      { tool: 'read_file', description: '读取 README.md 了解项目概述', fallback: 'search_code' },
      { tool: 'read_file', description: '读取 package.json/go.mod/pom.xml 了解技术栈', fallback: 'search_code' },
      { tool: 'search_code', description: '搜索 handler|route|api|controller 定位功能入口' },
      { tool: 'read_file', description: '读取关键源文件深入理解架构' },
      { tool: 'code_intel', description: '查询核心符号的引用关系' },
    ],
    guidance: '分析项目时，先读README和依赖文件了解全貌，再搜索定位功能入口，最后深入关键源文件。不要随机读文件。',
  },
  {
    intent: 'code_change',
    steps: [
      { tool: 'read_file', description: '读取 3-5 个现有源文件学习代码风格' },
      { tool: 'code_intel', description: '查询相关符号的定义和引用' },
      { tool: 'read_file', description: '读取要修改的文件的完整内容' },
      { tool: 'search_code', description: '搜索所有引用点以评估影响面' },
    ],
    guidance: '修改代码前，必须先读存量代码学习风格，查询符号引用评估影响面，确认无误后再修改。',
  },
  {
    intent: 'code_fix',
    steps: [
      { tool: 'run_command', description: '运行编译/lint获取错误输出' },
      { tool: 'read_file', description: '读取报错文件的完整内容' },
      { tool: 'code_intel', description: '查询报错符号的类型和引用' },
      { tool: 'search_code', description: '搜索错误消息中的关键词定位根因' },
    ],
    guidance: '修bug时，先复现错误获取输出，再定位根因，不要猜测。修复后重新运行验证。',
  },
  {
    intent: 'code_complete',
    steps: [
      { tool: 'read_file', description: '读取待补全文件的完整内容' },
      { tool: 'code_intel', description: '查询文件中已有符号的完整签名' },
      { tool: 'search_code', description: '搜索项目中相似模式的代码作为参考' },
      { tool: 'read_file', description: '读取 2-3 个相似文件学习模式' },
    ],
    guidance: '补全代码前，先理解待补全的函数签名和上下文，搜索项目中相似实现作为参考。',
  },
  {
    intent: 'plan',
    steps: [
      { tool: 'read_file', description: '读取 README 和架构文档' },
      { tool: 'search_code', description: '搜索与需求相关的现有代码' },
      { tool: 'read_file', description: '读取受影响模块的关键文件' },
      { tool: 'code_intel', description: '查询依赖关系图' },
    ],
    guidance: '制定计划前，先全面了解项目现状、现有代码和依赖关系。确认影响面后再分解任务。',
  },
  {
    intent: 'security_review',
    steps: [
      { tool: 'search_code', description: '搜索 SQL 拼接/密码硬编码/不安全API' },
      { tool: 'read_file', description: '读取敏感操作相关文件（auth/db/input）' },
      { tool: 'code_intel', description: '追踪外部输入的完整数据流' },
    ],
    guidance: '安全审查时，优先搜索已知风险模式（SQL注入、XSS、硬编码密钥），追踪外部输入到敏感操作的完整路径。',
  },
  {
    intent: 'refactor',
    steps: [
      { tool: 'code_intel', description: '查询目标符号的所有引用点' },
      { tool: 'read_file', description: '读取目标文件和所有引用文件' },
      { tool: 'search_code', description: '搜索项目中相似的可复用模式' },
    ],
    guidance: '重构前，必须先查询所有引用点确保不会遗漏。搜索项目中的相似模式，保持重构后风格一致。',
  },
  {
    intent: 'test_gen',
    steps: [
      { tool: 'read_file', description: '读取目标源文件的完整代码' },
      { tool: 'search_code', description: '搜索现有测试文件学习测试模式' },
      { tool: 'read_file', description: '读取 1-2 个现有测试文件' },
      { tool: 'code_intel', description: '查询导出符号的完整签名' },
    ],
    guidance: '生成测试前，必须读源文件和现有测试学习模式。测试文件命名和结构要与项目约定一致。',
  },
  {
    intent: 'doc_gen',
    steps: [
      { tool: 'read_file', description: '读取目标源文件' },
      { tool: 'search_code', description: '搜索现有文档了解文档风格' },
      { tool: 'code_intel', description: '查询导出API的完整签名' },
    ],
    guidance: '生成文档前，先读源码和现有文档，保持文档风格一致。',
  },
  {
    intent: 'devops',
    steps: [
      { tool: 'search_code', description: '搜索 package.json scripts/build.gradle/Makefile' },
      { tool: 'read_file', description: '读取构建配置和脚本' },
      { tool: 'run_command', description: '执行构建/启动/停止命令' },
    ],
    guidance: '执行运维操作前，先了解项目的构建配置和可用脚本。优先使用项目定义的脚本。',
  },
  {
    intent: 'pm',
    steps: [
      { tool: 'run_command', description: 'git log 查看提交历史' },
      { tool: 'search_code', description: '搜索版本号/路线图/变更日志' },
      { tool: 'read_file', description: '读取 CHANGELOG/ROADMAP 等规划文档' },
    ],
    guidance: 'PM分析时，从git历史和现有规划文档获取数据，不要凭记忆猜测。',
  },
  {
    intent: 'question',
    steps: [
      { tool: 'search_code', description: '搜索问题相关代码' },
      { tool: 'read_file', description: '读取相关文件获取上下文' },
      { tool: 'code_intel', description: '查询相关符号的定义' },
    ],
    guidance: '回答问题时，先搜索相关代码，确保答案基于项目实际状态。',
  },
  {
    intent: 'config',
    steps: [
      { tool: 'read_file', description: '读取配置文件（.icloser/config.json）' },
      { tool: 'search_code', description: '搜索配置相关代码' },
    ],
    guidance: '配置操作前，先读取当前配置状态，了解可选值和约束。',
  },
  {
    intent: 'chat',
    steps: [],
    guidance: '闲聊模式，无需工具。直接回答用户问题。',
  },
];

const UNKNOWN_STRATEGY: ToolStrategy = {
  intent: 'unknown',
  steps: [
    { tool: 'read_file', description: '读取 README.md 了解项目' },
    { tool: 'search_code', description: '搜索相关关键词定位代码' },
  ],
  guidance: '意图不明确时，从项目概述开始逐步缩小范围。先读README，再搜索定位。',
};

const strategyMap = new Map<UserIntentCategory, ToolStrategy>();
for (const s of STRATEGIES) {
  strategyMap.set(s.intent, s);
}

/** Get the recommended tool strategy for a given intent */
export function getStrategyForIntent(intent: UserIntentCategory): ToolStrategy {
  return strategyMap.get(intent) || UNKNOWN_STRATEGY;
}

/** Build guidance text for injection into system prompt */
export function buildStrategyGuidance(intent: UserIntentCategory): string {
  const strategy = getStrategyForIntent(intent);
  if (!strategy.steps.length) return strategy.guidance;

  const stepLines = strategy.steps.map((s, i) =>
    `${i + 1}. ${s.tool} — ${s.description}${s.fallback ? ` (空结果后备: ${s.fallback})` : ''}`
  ).join('\n');

  return `${strategy.guidance}\n推荐工具顺序:\n${stepLines}`;
}

/** All available strategies */
export function getAllStrategies(): ToolStrategy[] {
  return [...STRATEGIES, UNKNOWN_STRATEGY];
}
