import { classifyAgentTask, type AgentTaskType } from './agent-task-loop.js';
import type { CodeDeliveryResult } from './code-delivery-pipeline.js';
import { evaluateResultQuality, type ResultQualityGateReport } from './result-quality-gate.js';

export interface RealTaskRegressionCase {
  id: string;
  title: string;
  input: string;
  expectedType: AgentTaskType;
  finalResponse: string;
  codeDelivery?: CodeDeliveryResult;
  evidenceTargets?: string[];
  toolNames?: string[];
  minQualityScore: number;
}

export interface RealTaskRegressionResult {
  id: string;
  title: string;
  expectedType: AgentTaskType;
  actualType: AgentTaskType;
  typeOk: boolean;
  quality: ResultQualityGateReport;
  pass: boolean;
}

export function getDefaultRealTaskRegressionCases(): RealTaskRegressionCase[] {
  return [
    {
      id: 'web-visit-icloser',
      title: '网页访问：解释 iCloser 官网内容',
      input: '访问 https://icloser.asia/，告诉我内容',
      expectedType: 'web',
      finalResponse: [
        '标题：iCloser | 加密钱包、自托管与Web3支付入口',
        '来源：https://icloser.asia/',
        '主要内容：页面介绍 iCloser 的钱包、自托管和 Web3 支付入口能力。',
        '直接回答：这是 iCloser 产品官网，用于展示钱包、自托管和 Web3 支付服务。',
        '可追问点：可以继续问产品定位、目标用户和商业模式。',
      ].join('\n'),
      evidenceTargets: ['https://icloser.asia/'],
      toolNames: ['web_fetch'],
      minQualityScore: 85,
    },
    {
      id: 'investment-report',
      title: '投资研究：补齐 iCloser 投资报告',
      input: '补齐 iCloser 投资报告和竞品分析',
      expectedType: 'analysis',
      finalResponse: [
        '## 公司概况',
        'iCloser 定位为 Web3 钱包、自托管和支付入口。',
        '## 市场机会',
        'Web3 支付、跨境金融和自托管钱包仍有需求空间。',
        '## 融资/估值线索',
        '公开融资和估值信息需要继续待补证。',
        '## 竞品分析',
        '需要对比 Safe、MetaMask、Ramp 和银行卡类 Web3 支付入口。',
        '## 核心风险',
        '合规、获客、资金通道和安全信任是主要风险。',
        '## 尽调缺口',
        '需要补充真实用户数、收入、牌照、团队背景和资金通道证明。',
        '## 置信度',
        '置信度：中等，公开证据不足部分已标为待补证。',
      ].join('\n'),
      evidenceTargets: ['https://icloser.xyz', 'https://pitchhub.36kr.com/project/2793907771741958'],
      toolNames: ['web_search', 'web_fetch'],
      minQualityScore: 85,
    },
    {
      id: 'web-bugfix',
      title: '代码交付：修复 Web 项目 bug',
      input: '修复 Web 项目登录按钮无响应 bug',
      expectedType: 'code',
      finalResponse: [
        '影响面：涉及 src/pages/Login.tsx 和 src/api/auth.ts。',
        'diff/补丁：已生成登录按钮 onClick 和 API 调用修复补丁。',
        '风险：需要关注旧 token 缓存和移动端点击态。',
        '验证方式：运行 npm run build 和 npm test。',
        '下一步：预览 diff 后写入，再运行验证。',
      ].join('\n'),
      codeDelivery: {
        status: 'patch-ready',
        summary: '修复登录按钮点击链路',
        changes: [{
          file: 'src/pages/Login.tsx',
          operation: 'write',
          content: 'export const Login = () => null;',
          reasoning: '恢复登录按钮点击链路',
        }],
      },
      evidenceTargets: ['src/pages/Login.tsx', 'src/api/auth.ts'],
      toolNames: ['search_code', 'read_file'],
      minQualityScore: 85,
    },
    {
      id: 'project-startup',
      title: '项目启动：识别环境并启动',
      input: '启动项目',
      expectedType: 'startup',
      finalResponse: [
        '环境：检测到 Node/Vite 项目，需要 npm install 后启动。',
        '启动命令：npm run dev。',
        '运行状态：服务监听 localhost:5173。',
        '失败恢复：如果端口被占用，切换端口或结束占用进程后重试。',
      ].join('\n'),
      evidenceTargets: ['package.json', 'npm run dev'],
      toolNames: ['read_file', 'run_command'],
      minQualityScore: 80,
    },
  ];
}

export function runRealTaskRegressionCase(testCase: RealTaskRegressionCase): RealTaskRegressionResult {
  const actualType = classifyAgentTask(testCase.input);
  const quality = evaluateResultQuality({
    type: actualType,
    input: testCase.input,
    finalResponse: testCase.finalResponse,
    codeDelivery: testCase.codeDelivery ?? { status: 'none', changes: [], summary: '' },
    evidenceTargets: testCase.evidenceTargets,
    toolNames: testCase.toolNames,
  });
  const typeOk = actualType === testCase.expectedType;
  return {
    id: testCase.id,
    title: testCase.title,
    expectedType: testCase.expectedType,
    actualType,
    typeOk,
    quality,
    pass: typeOk && quality.score >= testCase.minQualityScore,
  };
}

export function runDefaultRealTaskRegressionSuite(): RealTaskRegressionResult[] {
  return getDefaultRealTaskRegressionCases().map(runRealTaskRegressionCase);
}
