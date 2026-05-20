// B1: Execution Plan Generator — AI analyzes task + context → structured tool plan
// System drives the plan; AI only decides WHAT, system decides HOW and WHEN.
import type { ExecutionPlan, PlanStep, ContextPackage } from '../types.js';

// #5: Clarify vague tasks — detect ambiguity and ask questions
export async function clarifyVagueTask(
  taskDescription: string,
  provider: any,
): Promise<{ isVague: boolean; questions: string[]; refinedTask?: string }> {
  // Fast heuristic: if task has specific file paths or function names, it's not vague
  const hasFilePath = /(?:src|lib|app|tests?|docs?)\/[\w./-]+\.\w{1,6}/.test(taskDescription);
  const hasFunction = /(?:function|method|class|interface|component|module|middleware|route|controller|service|model|schema)\s+\w+/i.test(taskDescription);
  const hasSpecificAction = /(?:修改|修复|fix|添加|删除|重构|优化|更新|替换|移动|重命名)\s+[\w./-]+/.test(taskDescription);

  if (hasFilePath || hasFunction || hasSpecificAction) {
    return { isVague: false, questions: [] };
  }

  // Task might be vague — ask AI to generate clarifying questions
  try {
    const resp = await provider.chat({
      systemPrompt: '你是需求分析师。用户给出了模糊的开发任务。生成 2-3 个澄清问题，帮用户细化需求。输出 JSON: {"questions": ["问题1", "问题2", "问题3"]}',
      task: `用户任务: "${taskDescription}"\n\n请输出澄清问题。`,
      context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      history: '',
    });
    const json = JSON.parse((resp?.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    if (json.questions && json.questions.length > 0) {
      return { isVague: true, questions: json.questions };
    }
  } catch { /* fall through */ }
  return { isVague: false, questions: [] };
}

/** Ask AI to generate a structured execution plan instead of directly calling tools */
export async function generateExecutionPlan(
  taskDescription: string,
  context: ContextPackage,
  provider: any, // AIProviderAdapter
  intentCategory?: string,
): Promise<ExecutionPlan> {
  const intent = intentCategory || 'unknown';

  const planPrompt = [
    '你是任务规划专家。分析以下任务和项目上下文，生成一个结构化的工具执行计划。',
    '',
    '## 当前任务',
    taskDescription,
    '',
    '## 项目上下文',
    context.projectMeta || '(无项目元信息)',
    context.relevantCode.length > 0
      ? '相关代码 (已注入上下文, 无需再读取):\n' + context.relevantCode.map(c => `- ${c.file} (${c.content.split('\\n').length} 行)`).join('\n')
      : '(无相关代码 — 需要先从 README 或 package.json 开始探索)',
    context.relevantMemory ? '项目记忆:\n' + context.relevantMemory.slice(0, 1000) : '',
    '',
    '## 规划步骤',
    '1. 先列出你计划修改/创建的具体文件路径',
    '2. 确定每个文件需要的上下文信息',
    '3. 按依赖顺序排列步骤（先读被依赖的文件）',
    '4. 为每个步骤指定明确的文件路径参数',
    '',
    '## 可用工具',
    '- read_file(path): 读取完整文件内容，最可靠。path 必须是具体文件路径',
    '- search_code(pattern, path?): 正则搜索代码。只在不知道确切文件时使用',
    '- code_intel(file, symbol?): 查询符号定义/引用。需要已知的文件路径',
    '- run_command(command): 执行命令。用于编译验证，不用于探索',
    '- web_search(query): 搜索网络文档。仅在需要外部知识时使用',
    '',
    '## 规划原则',
    '1. 上下文已注入的文件无需再 read_file — 直接进入分析和生成',
    '2. search_code 只在不知道确切文件路径时使用，有具体路径就用 read_file',
    '3. 每个步骤的 args 必须包含完整的文件路径（如 src/auth/login.ts）',
    '4. 如果任务要求修改代码，最后一步必须明确列出要修改的文件',
    '5. 信息收集够了之后必须有一个"合成"步骤生成最终输出',
    '6. 总步骤数控制在 3-5 步，不是越多越好',
    '',
    '## 输出格式（只输出 JSON，无其他文字）',
    JSON.stringify({
      planId: 'PLAN-{timestamp}',
      taskDescription,
      steps: [
        {
          seq: 1,
          tool: 'read_file',
          args: { path: 'src/auth.ts' },
          why: '理解现有认证逻辑',
          expectedOutcome: '获取 login/logout/register 函数的签名和实现',
          fallback: { seq: 1, tool: 'search_code', args: { pattern: 'login|logout|register' }, why: '搜索认证相关代码', expectedOutcome: '定位认证函数位置' },
        },
        {
          seq: 2,
          tool: 'code_intel',
          args: { file: 'src/auth.ts', symbol: 'validateToken' },
          why: '了解 token 验证的完整签名',
          expectedOutcome: '获取 validateToken 的参数类型和返回值',
        },
        {
          seq: 3,
          tool: 'search_code',
          args: { pattern: 'router\\.(use|get|post)' },
          why: '找到所有路由注册点，了解中间件插入位置',
          expectedOutcome: '定位到路由定义文件',
        },
      ],
      expectedOutput: '基于现有认证架构，生成新增中间件的代码（JSON 变更契约）',
      infoRequirements: {
        filesToRead: ['src/auth.ts', 'src/router.ts'],
        patternsToSearch: ['middleware', 'router.use'],
        symbolsToQuery: ['validateToken'],
      },
      estimatedSteps: 3,
      createdAt: new Date().toISOString(),
    }, null, 2),
  ].join('\n');

  try {
    const response = await provider.chat({
      systemPrompt: `你是任务规划专家。分析任务和上下文，输出结构化的工具执行计划。意图: ${intent}`,
      task: planPrompt,
      context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
      history: '',
    });

    const json = JSON.parse((response?.content?.match(/\{[\s\S]*\}/)?.[0] || '{}'));
    if (!json.steps || json.steps.length === 0) {
      // AI didn't produce a valid plan — fall back to default exploration plan
      return buildDefaultPlan(taskDescription, context);
    }
    return json as ExecutionPlan;
  } catch {
    return buildDefaultPlan(taskDescription, context);
  }
}

const BUILD_FILES: Record<string, string> = {
  typescript: 'package.json', javascript: 'package.json',
  go: 'go.mod', rust: 'Cargo.toml', python: 'pyproject.toml',
  java: 'pom.xml', kotlin: 'build.gradle.kts', csharp: '*.csproj',
};

function pickBuildFile(meta: string): string {
  for (const [lang, file] of Object.entries(BUILD_FILES)) {
    if (meta.toLowerCase().includes(lang)) return file;
  }
  return 'package.json'; // default
}

/** Default plan when AI plan generation fails */
function buildDefaultPlan(taskDescription: string, context: ContextPackage): ExecutionPlan {
  const steps: PlanStep[] = [];
  let seq = 0;

  const isCode = /(修改|创建|新增|添加|fix|修复|补全|写|改|加|生成|实现)/.test(taskDescription);
  const isAnalysis = /(分析|检查|审查|质量)/.test(taskDescription);
  const buildFile = pickBuildFile(context.projectMeta);

  if (isAnalysis) {
    steps.push({ seq: ++seq, tool: 'read_file', args: { path: 'README.md' }, why: '了解项目概述', expectedOutcome: '获取项目简介和技术栈' });
    steps.push({ seq: ++seq, tool: 'read_file', args: { path: buildFile }, why: '了解依赖和脚本', expectedOutcome: '获取技术栈详情', fallback: { seq, tool: 'search_code', args: { pattern: '\\b(import|require|from|package|module)\\b' }, why: '搜索导入语句', expectedOutcome: '推断技术栈' } });
    steps.push({ seq: ++seq, tool: 'search_code', args: { pattern: 'export|module\\.exports|func |class |def ' }, why: '了解模块导出', expectedOutcome: '了解代码组织结构' });
  } else if (isCode) {
    const primaryFile = context.relevantCode[0]?.file || 'README.md';
    steps.push({ seq: ++seq, tool: 'read_file', args: { path: primaryFile }, why: '学习现有代码风格', expectedOutcome: '了解命名/缩进/引号习惯' });
    steps.push({ seq: ++seq, tool: 'search_code', args: { pattern: taskDescription.split(/\s+/).slice(0, 3).join('|') }, why: '搜索相关代码', expectedOutcome: '定位需要修改的文件' });
    steps.push({ seq: ++seq, tool: 'read_file', args: { path: primaryFile }, why: '读取目标文件', expectedOutcome: '获取完整内容' });
  } else {
    steps.push({ seq: ++seq, tool: 'read_file', args: { path: 'README.md' }, why: '了解项目', expectedOutcome: '获取项目概览' });
    steps.push({ seq: ++seq, tool: 'search_code', args: { pattern: taskDescription.slice(0, 20) }, why: '搜索相关代码', expectedOutcome: '定位相关内容' });
  }

  return {
    planId: `PLAN-${Date.now().toString(36)}`,
    taskDescription,
    steps,
    expectedOutput: isCode ? '生成代码变更（JSON 契约）' : '输出分析结果',
    infoRequirements: { filesToRead: [], patternsToSearch: [], symbolsToQuery: [] },
    estimatedSteps: steps.length,
    createdAt: new Date().toISOString(),
  };
}

/** Build a structured summary of completed steps for AI synthesis */
export function buildExecutionSummary(state: import('../types.js').ExecutionState): string {
  const parts: string[] = [];

  parts.push(`## 任务: ${state.plan.taskDescription}`);
  parts.push(`## 预期输出: ${state.plan.expectedOutput}`);
  parts.push('');

  parts.push('## 已完成的探索步骤');
  for (const step of state.completedSteps) {
    const icon = step.success ? (step.emptyResult ? '⚠️' : '✓') : '✗';
    const summary = step.output.length > 100 ? step.output.slice(0, 100) + '...' : step.output;
    parts.push(`- ${icon} Step ${step.seq}: ${step.tool} — ${summary}`);
  }

  if (state.decisionPoints > 0) {
    parts.push(`\n系统干预: ${state.decisionPoints} 次决策点触发`);
  }

  // What's still missing
  const missingFiles = state.plan.infoRequirements.filesToRead.filter(
    f => !state.infoGathered.filesRead.has(f)
  );
  const missingPatterns = state.plan.infoRequirements.patternsToSearch.filter(
    p => !state.infoGathered.patternsSearched.has(p)
  );
  if (missingFiles.length > 0 || missingPatterns.length > 0) {
    parts.push('\n## 仍缺失的信息');
    if (missingFiles.length > 0) parts.push(`- 文件: ${missingFiles.join(', ')}`);
    if (missingPatterns.length > 0) parts.push(`- 搜索: ${missingPatterns.join(', ')}`);
  } else {
    parts.push('\n✅ 信息收集完成，可以合成输出。');
  }

  parts.push('\n请基于以上探索结果，输出 JSON 变更契约（不要再调用工具）。');

  return parts.join('\n');
}
