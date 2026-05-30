import type { AIProviderAdapter } from '../ai/provider.js';
import type { AIPrompt } from '../types.js';
import { parseAIOutput, type AIFileChange } from '../ai/output-contract.js';

export interface CodeDeliveryResult {
  status: 'none' | 'patch-ready' | 'invalid';
  changes: AIFileChange[];
  summary: string;
  error?: string;
}

export interface CodeDeliveryReadiness {
  score: number;
  status: 'ready' | 'needs-review' | 'blocked';
  missing: string[];
  nextAction: string;
}

export function isCodeDeliveryIntent(input: string): boolean {
  return /(修改|修复|新增|创建|更名|改名|替换|更新|版本号|转成|转换|迁移|复刻|还原|H5|h5|网页|HTML|html|bug|fix|rename|change|update|create|add|convert|migrate)/i.test(input);
}

export function parseCodeDeliveryOutput(output: string, input: string): CodeDeliveryResult {
  if (!isCodeDeliveryIntent(input)) {
    return { status: 'none', changes: [], summary: '不是代码交付任务' };
  }
  try {
    const parsed = parseAIOutput(output);
    return {
      status: parsed.changes.length > 0 ? 'patch-ready' : 'invalid',
      changes: parsed.changes,
      summary: parsed.summary || '已生成代码变更',
    };
  } catch (err) {
    return {
      status: 'invalid',
      changes: [],
      summary: '代码任务未产出可执行变更',
      error: (err as Error).message,
    };
  }
}

export async function requestCodeDeliveryPatch(
  provider: AIProviderAdapter,
  prompt: AIPrompt,
  evidenceContext: string
): Promise<CodeDeliveryResult> {
  const patchPrompt: AIPrompt = {
    ...prompt,
    systemPrompt: [
      '你是 iCloser Code Delivery Pipeline。',
      '你只能输出严格 JSON 代码块，不能输出解释。',
      'JSON 结构：{"summary":"...","changes":[{"file":"相对路径","operation":"write","content":"完整文件内容","reasoning":"..."}]}',
      'content 必须是完整文件内容，不能省略，不能用占位符。',
      '只修改和用户需求直接相关的文件。',
      'summary 必须包含：影响面、核心变更、风险、验证命令、下一步。',
      '如果证据不足，先输出 changes 为空并在 summary 说明缺少哪些文件证据。',
    ].join('\n'),
    task: `${prompt.task}\n\n## 已验证证据\n${evidenceContext}`,
    history: '',
  };
  const response = await provider.chat(patchPrompt, undefined);
  return parseCodeDeliveryOutput(response.content, prompt.task);
}

export function evaluateCodeDeliveryReadiness(input: {
  codeDelivery: CodeDeliveryResult;
  toolNames: string[];
  verificationReady: boolean;
}): CodeDeliveryReadiness {
  const missing: string[] = [];
  if (input.codeDelivery.status !== 'patch-ready') missing.push('可执行补丁');
  if (input.codeDelivery.changes.length === 0) missing.push('变更文件');
  if (!input.toolNames.some(name => name === 'search_code' || name === 'read_file' || name === 'get_project_overview')) {
    missing.push('影响面证据');
  }
  if (!input.verificationReady) missing.push('验证命令');

  const score = Math.max(0, 100 - missing.length * 22);
  return {
    score,
    status: missing.length === 0 ? 'ready' : missing.length <= 2 ? 'needs-review' : 'blocked',
    missing,
    nextAction: missing.length === 0
      ? '预览 diff 后写入，并运行验证命令'
      : `补齐 ${missing.slice(0, 3).join('、')} 后再交付`,
  };
}
