// Task Pipeline — shared helpers extracted from index.ts
// Contains: compile gate, code gen pipeline, intent detection
import { warn, detail } from '../cli/output.js';

// ── Shared compile gate helper (Gap-1) ──
export async function applyCompileGate(
  changes: { file: string; content: string }[],
  rootPath: string,
  identity: { language: string },
  provider: any,
  label: string,
): Promise<{ file: string; content: string }[]> {
  if (changes.length === 0 || identity.language === 'unknown') return changes;
  try {
    const { enforceCodeQuality } = await import('./code-writer.js');
    const { loadProjectIndex } = await import('./scanner.js');
    const idx = await loadProjectIndex(rootPath);
    const result = await enforceCodeQuality(changes, rootPath, identity, provider, idx || undefined);
    if (!result.passed) warn(`${label} 编译验证失败: ${result.diagnostics.slice(0, 120)}`);
    if (result.fixes > 0) detail(label, `自动修复 ${result.fixes} 轮`);
    return result.changes;
  } catch (err) {
    // P1-15: log the error instead of silent swallowing
    warn(`${label} 编译门禁异常: ${(err as Error).message?.slice(0, 80) || '未知错误'}`);
    return changes;
  }
}

// ── Shared code generation pipeline (Improve-1) ──
export async function runCodeGenerationPipeline(
  desc: string,
  rootPath: string,
  provider: any,
  identity: { language: string },
  contextPkg: any,
  label: string,
): Promise<{ file: string; content: string }[]> {
  const { generateExecutionPlan } = await import('./execution-plan.js');
  const { executeWithPlan } = await import('./execution-engine.js');
  const plan = await generateExecutionPlan(desc, contextPkg, provider);
  detail(label, `${plan.steps.length} 步计划`);
  const mockTask: any = { id: `gen-${Date.now().toString(36)}`, description: desc };
  const result = await executeWithPlan(plan, mockTask, rootPath, provider, contextPkg);
  if (result.decisionPoints.length > 0) detail(label, `${result.decisionPoints.length} 次系统干预`);
  const parsed = (await import('../ai/output-contract.js')).parseAIOutput(result.aiResponse).changes;
  if (parsed.length === 0) return [];
  return applyCompileGate(parsed.map(c => ({ file: c.file, content: c.content })), rootPath, identity, provider, label);
}

// ── Intent analysis ──
export async function getToolStrategy(desc: string, intentCategory?: string): Promise<string> {
  const cat = intentCategory
    || (/做|开发|实现|搭建|建一个|构建|创建|写一个/.test(desc) && /系统|平台|后台|项目|工程|应用/.test(desc) ? 'plan' : '')
    || (/(修复|修|fix|错误|bug|报错|异常|崩溃|失败)/.test(desc) ? 'code_fix' : '')
    || (/(补全|补齐|补完|完成|实现).*(函数|方法|类|接口|代码)/.test(desc) ? 'code_complete' : '')
    || (/(分析|检查|审查|质量|是什么|是否完整|结构|架构)/.test(desc) ? 'analysis' : '')
    || (/(修改|创建|写入|删除|添加|新增|改|写|加)/.test(desc) ? 'code_change' : '')
    || (/(安全|漏洞|注入)/.test(desc) ? 'security_review' : '')
    || (/(启动|停止|运行|测试|构建|部署)/.test(desc) ? 'devops' : '')
    || (/(发布|路线图|风险|估算|周报|阻塞)/.test(desc) ? 'pm' : '')
    || (/(文档|doc|readme)/.test(desc) ? 'doc_gen' : '') || '';
  if (!cat) return '';
  try {
    const { buildStrategyGuidance } = await import('./tool-strategy.js');
    return buildStrategyGuidance(cat as any);
  } catch {
    const strategies: Record<string, string> = {
      plan: '先读 README + package.json → 搜索相关模块 → 生成计划。不直接写代码。',
      analysis: '先读 README → 读依赖文件 → 搜索关键词 → 读源文件。',
      code_change: '先读目标文件 → 搜索引用 → 生成代码 → 验证。先读后写。',
      code_fix: '先读报错文件 → 定位错误行 → 只修改错误行。',
      code_complete: '先读目标文件 → 找未完成代码 → 补全实现。',
      security_review: '搜索密钥/密码 → 读安全文件 → 输出报告。不写文件。',
      devops: '先读构建配置 → 确定命令 → 执行。先确认再执行。',
      pm: '搜索版本/里程碑 → 读任务配置 → 汇总输出。',
      doc_gen: '先读 README + 源码 → 搜索 API → 生成文档。',
    };
    return strategies[cat] || '';
  }
}

export function isAnalysisOnlyTask(desc: string): boolean {
  return /(分析|检查|review|扫描|质量|代码质量|是什么|是否完整|当前目录|整个目录|整个项目)/i.test(desc) &&
    !/(修改|创建|写入|生成文件|新增|删除|修复|改成|更新|update|write|create|delete|fix|改|写)/i.test(desc);
}

// ── C5: Shared gen/code command handlers (eliminates ~100 lines of duplication in index.ts) ──

export async function runGenNew(
  rootPath: string, desc: string, config: any, provider: any, isMock: boolean, options?: { withTests?: boolean; verify?: boolean },
): Promise<{ file: string; content: string }[]> {
  const withTests = options?.withTests ?? false;
  const verify = options?.verify ?? false;
  let styleConstraint = '';
  let codePatterns = '';
  let index: any = null;
  if (!isMock) {
    try {
      index = await (await import('./scanner.js')).loadProjectIndex(rootPath);
      if (index?.styleFingerprint) {
        const { buildStyleConstraints } = await import('./code-writer.js');
        styleConstraint = buildStyleConstraints(index.styleFingerprint);
      }
      if (index) {
        const { readCodePatterns } = await import('./code-writer.js');
        codePatterns = await readCodePatterns(rootPath, index);
      }
    } catch { /* best-effort */ }
  }

  // T4: Verify mode — generate + compile/lint + fix loop up to 3 rounds
  if (verify && !isMock && index) {
    const { generateWithVerifyLoop } = await import('./code-writer.js');
    const result = await generateWithVerifyLoop(desc, rootPath, index, provider);
    return result.source.map((c: { file: string; content: string }) => ({ file: c.file, content: c.content }));
  }

  const ctxPkg = {
    projectMeta: codePatterns ? `现有代码模式:\n${codePatterns.slice(0, 2000)}` : '',
    relevantCode: [], relevantMemory: styleConstraint, totalTokens: 0, budgetUsed: 0,
  };
  const changes = isMock
    ? (await import('../ai/output-contract.js')).parseAIOutput((await provider.chat({
        systemPrompt: '你是代码生成专家。只输出JSON变更契约。',
        task: desc + (codePatterns ? '\n\n现有代码模式参考:\n' + codePatterns.slice(0, 2000) : ''),
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
      })).content).changes
    : await runCodeGenerationPipeline(desc, rootPath, provider, (config as any).project.identity, ctxPkg, 'gen new');
  return changes.map(c => ({ file: c.file, content: c.content }));
}

export async function runGenFix(
  rootPath: string, config: any, provider: any,
): Promise<{ file: string; content: string }[]> {
  const { info } = await import('../cli/output.js');
  const tasks = await (await import('./task-engine.js')).listTasks(rootPath);
  const last = tasks.find(t => t.status === 'failed');
  if (!last?.verifyResult?.errorSummary) { info('无失败验证记录'); return []; }
  const { parseErrorOutput } = await import('./code-writer.js');
  const errors = parseErrorOutput(last.verifyResult.errorSummary);
  const errContext = errors.length > 0
    ? '错误位置:\n' + errors.map(e => `  ${e.file}:${e.line} - ${e.message}`).join('\n') : '';
  const resp = await provider.chat({
    systemPrompt: '你是代码修复专家。只输出JSON变更契约。仅修复指定的错误，不改无关代码。',
    task: '错误摘要: ' + last.verifyResult.errorSummary.slice(0, 2000) + '\n' + errContext,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
  });
  const fixChanges = (await import('../ai/output-contract.js')).parseAIOutput(resp.content).changes;
  return applyCompileGate(fixChanges, rootPath, (config as any).project.identity, provider, 'gen fix');
}

export async function runGenComplete(
  rootPath: string, filePath: string, config: any, provider: any,
): Promise<{ file: string; content: string }[]> {
  const { info, fail } = await import('../cli/output.js');
  const { readFile, fileExists } = await import('../utils/fs.js');
  if (!(await fileExists(filePath))) { fail('文件不存在: ' + filePath); return []; }
  const content = await readFile(filePath);
  const { findIncompleteCode } = await import('./code-writer.js');
  const incomplete = findIncompleteCode(content);
  if (incomplete.length === 0) { info('未发现未完成代码'); return []; }
  const resp = await provider.chat({
    systemPrompt: '你是代码补全专家。只输出JSON变更契约。补全所有TODO/空函数体，匹配现有代码风格。',
    task: '补全文件: ' + filePath + '\n未完成代码:\n' + incomplete.map(i => `L${i.line}: ${i.signature}`).join('\n') + '\n\n现有文件内容:\n' + content.slice(0, 3000),
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
  });
  const completeChanges = (await import('../ai/output-contract.js')).parseAIOutput(resp.content).changes;
  return applyCompileGate(completeChanges, rootPath, (config as any).project.identity, provider, 'gen complete');
}
