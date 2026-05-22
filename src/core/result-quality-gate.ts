import type { AgentTaskType } from './agent-task-loop.js';
import type { CodeDeliveryResult } from './code-delivery-pipeline.js';

export interface ResultQualityField {
  id: string;
  label: string;
  patterns: RegExp[];
}

export interface ResultQualityGateInput {
  type: AgentTaskType;
  input: string;
  finalResponse: string;
  codeDelivery: CodeDeliveryResult;
  evidenceTargets?: string[];
  toolNames?: string[];
}

export interface ResultQualityGateReport {
  score: number;
  status: 'pass' | 'warn' | 'fail';
  template: string;
  required: string[];
  present: string[];
  missing: string[];
  nextAction?: string;
  repairPrompt?: string;
}

export function evaluateResultQuality(input: ResultQualityGateInput): ResultQualityGateReport {
  const fields = requiredFieldsForTask(input.type, input.input);
  const text = normalizeResultText(input.finalResponse);
  // MC-09: when a code patch is ready it IS the diff/影响面 evidence — auto-credit those fields
  // so a correct patch doesn't get penalised just because the AI omitted magic keywords in prose
  const patchAutoCredit = new Set<string>();
  if (input.type === 'code' && input.codeDelivery.status === 'patch-ready') {
    patchAutoCredit.add('diff/补丁');
    if (input.codeDelivery.changes.length > 0) patchAutoCredit.add('影响面');
  }
  const present = fields
    .filter(field => patchAutoCredit.has(field.label) || field.patterns.some(pattern => pattern.test(text)))
    .map(field => field.label);
  const missing = fields
    .filter(field => !present.includes(field.label))
    .map(field => field.label);

  const evidenceBonus = input.evidenceTargets?.length ? 8 : input.toolNames?.length ? 4 : 0;
  const codeBonus = input.type === 'code' && input.codeDelivery.status === 'patch-ready' ? 10 : 0;
  const base = fields.length === 0 ? 80 : Math.round((present.length / fields.length) * 82);
  const raw = Math.min(100, base + evidenceBonus + codeBonus);
  // MC-09: a delivered patch is the primary artefact of a code task — floor at warn (70) so a
  // correct patch with minimal prose doesn't wrongly land in 'fail' territory
  const patchFloor = input.type === 'code' && input.codeDelivery.status === 'patch-ready' ? 70 : 0;
  const score = Math.max(patchFloor, Math.max(0, raw));

  return {
    score,
    status: score >= 85 ? 'pass' : score >= 70 ? 'warn' : 'fail',
    template: templateName(input.type, input.input),
    required: fields.map(field => field.label),
    present,
    missing,
    nextAction: missing.length > 0 ? `自动补齐缺失字段：${missing.slice(0, 4).join('、')}` : undefined,
    repairPrompt: missing.length > 0 ? buildRepairPrompt(input.type, input.input, missing) : undefined,
  };
}

export function buildRepairPrompt(type: AgentTaskType, input: string, missing: string[]): string {
  const fields = missing.slice(0, 6).join('、');
  if (type === 'analysis' && isInvestmentResearch(input)) {
    return `请基于已有证据补齐投资研究缺口：${fields}。缺少公开证据的字段必须标注“待补证”，不要编造融资、估值或用户数据。`;
  }
  if (type === 'web') return `请基于上一轮网页证据补齐：${fields}。优先引用标题、来源和正文摘要。`;
  if (type === 'code') return `请补齐代码交付缺口：${fields}。必须说明影响面、补丁/diff、风险、验证命令和下一步。`;
  if (type === 'startup') return `请补齐项目启动缺口：${fields}。必须给出环境、启动命令、运行状态和失败恢复路径。`;
  if (type === 'memory') return `请补齐记忆任务缺口：${fields}。必须说明召回规则、冲突点和候选写回动作。`;
  return `请基于已有证据补齐结果缺口：${fields}。`;
}

export function requiredFieldsForTask(type: AgentTaskType, input = ''): ResultQualityField[] {
  if (type === 'web') {
    return [
      field('title', '标题', /标题|title/i),
      field('source', '来源', /来源|source|https?:\/\//i),
      field('main', '主要内容', /主要内容|正文|摘要|内容|summary/i),
      field('answer', '直接回答', /直接回答|结论|所以|这是|回答/i),
    ];
  }
  if (type === 'analysis' && isInvestmentResearch(input)) {
    return [
      field('company', '公司概况', /公司概况|项目概况|主体|业务|产品/i),
      field('market', '市场机会', /市场|机会|赛道|需求|规模/i),
      field('funding', '融资/估值线索', /融资|估值|投资|资金|轮次|valuation|funding/i),
      field('competitor', '竞品分析', /竞品|竞争|对手|替代|benchmark|competitor/i),
      field('risk', '核心风险', /风险|不确定|合规|依赖|短板/i),
      field('diligence', '尽调缺口', /尽调|待补证|缺口|需要补充|待确认/i),
      field('confidence', '置信度', /置信度|可信度|confidence|证据等级/i),
    ];
  }
  if (type === 'analysis') {
    return [
      field('status', '现状', /现状|当前|概况/i),
      field('issues', '关键问题', /问题|缺陷|风险|短板/i),
      field('path', '优化路径', /优化|路径|建议|下一步/i),
      field('acceptance', '验收标准', /验收|验证|标准|测试/i),
    ];
  }
  if (type === 'code') {
    return [
      field('impact', '影响面', /影响面|涉及|修改文件|文件/i),
      field('diff', 'diff/补丁', /diff|补丁|patch|变更|修改/i),
      field('risk', '风险', /风险|注意|回归|兼容/i),
      field('verify', '验证方式', /验证|测试|npm|tsc|vitest|build/i),
      field('next', '下一步', /下一步|继续|写入|确认/i),
    ];
  }
  if (type === 'startup') {
    return [
      field('env', '环境', /环境|SDK|依赖|Node|Gradle|Android|端口/i),
      field('command', '启动命令', /命令|command|npm|pnpm|gradle|adb|启动/i),
      field('status', '运行状态', /运行状态|已启动|失败|前台|localhost|端口/i),
      field('recovery', '失败恢复', /恢复|失败原因|修复|重试|缺失/i),
    ];
  }
  if (type === 'release') {
    return [
      field('gate', '质量门禁', /门禁|gate|质量/i),
      field('tests', '测试结果', /测试|test|通过|失败/i),
      field('risk', '风险', /风险|阻塞|注意/i),
      field('artifact', '发布物', /发布物|包|checksum|版本/i),
    ];
  }
  if (type === 'memory') {
    return [
      field('recall', '召回规则', /召回|规则|记忆/i),
      field('conflict', '冲突点', /冲突|重复|覆盖|一致/i),
      field('candidate', '候选规则', /候选|新增|写回|AGENTS/i),
    ];
  }
  return [
    field('goal', '目标', /目标|需求|任务/i),
    field('evidence', '证据', /证据|来源|工具|文件/i),
    field('next', '下一步', /下一步|建议|继续/i),
  ];
}

function field(id: string, label: string, ...patterns: RegExp[]): ResultQualityField {
  return { id, label, patterns };
}

function templateName(type: AgentTaskType, input: string): string {
  if (type === 'analysis' && isInvestmentResearch(input)) return '投资/市场研究质量门';
  if (type === 'web') return '网页访问质量门';
  if (type === 'code') return '代码交付质量门';
  if (type === 'startup') return '项目启动质量门';
  if (type === 'release') return '发布验收质量门';
  if (type === 'memory') return '长期记忆质量门';
  return '通用任务质量门';
}

function isInvestmentResearch(input: string): boolean {
  return /(投资|融资|估值|市场|商业|竞品|尽调|investment|valuation|funding|market|competitor)/i.test(input);
}

function normalizeResultText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
