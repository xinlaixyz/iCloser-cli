import { describe, expect, it } from 'vitest';
import { evaluateResultQuality, buildRepairPrompt } from '../src/core/result-quality-gate.js';

describe('result quality gate', () => {
  it('detects missing investment report sections', () => {
    const report = evaluateResultQuality({
      type: 'analysis',
      input: '补齐 iCloser 投资报告和竞品分析',
      finalResponse: [
        '## 公司概况',
        'iCloser 是 Web3 支付入口。',
        '## 市场机会',
        '市场需求存在。',
        '## 核心风险',
        '合规和获客风险较高。',
      ].join('\n'),
      codeDelivery: { status: 'none', changes: [], summary: '' },
      evidenceTargets: ['https://icloser.xyz'],
      toolNames: ['web_fetch'],
    });

    expect(report.status).toBe('fail');
    expect(report.missing).toContain('融资/估值线索');
    expect(report.missing).toContain('竞品分析');
    expect(report.missing).toContain('尽调缺口');
    expect(report.nextAction).toContain('自动补齐缺失字段');
    expect(report.repairPrompt).toContain('不要编造融资');
  });

  it('passes a complete web answer with source and direct answer', () => {
    const report = evaluateResultQuality({
      type: 'web',
      input: '访问 https://icloser.asia/ 告诉我内容',
      finalResponse: [
        '标题：iCloser | 加密钱包、自托管与Web3支付入口',
        '来源：https://icloser.asia/',
        '主要内容：页面介绍 iCloser 的钱包、自托管和 Web3 支付能力。',
        '直接回答：这是 iCloser 的产品官网页面。',
      ].join('\n'),
      codeDelivery: { status: 'none', changes: [], summary: '' },
      evidenceTargets: ['https://icloser.asia/'],
      toolNames: ['web_fetch'],
    });

    expect(report.status).toBe('pass');
    expect(report.missing).toEqual([]);
    expect(report.score).toBeGreaterThanOrEqual(85);
  });

  // MC-09: patch-ready code task must not be penalised for missing prose keywords
  it('credits diff/影响面 automatically when code patch is ready (MC-09)', () => {
    const report = evaluateResultQuality({
      type: 'code',
      input: '修复登录页按钮样式 bug',
      finalResponse: '已生成登录页补丁',   // minimal prose — no "影响面" or "diff" text
      codeDelivery: {
        status: 'patch-ready',
        changes: [{ file: 'src/pages/Login.tsx', content: '// fixed' }],
        summary: 'login style fix',
      },
      toolNames: ['read_file', 'search_code'],
    });

    // patch-ready auto-credits diff/补丁 and 影响面, so score must clear warn threshold
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.status).not.toBe('fail');
    expect(report.present).toContain('diff/补丁');
    expect(report.present).toContain('影响面');
  });

  it('passes a fully described code delivery', () => {
    const report = evaluateResultQuality({
      type: 'code',
      input: '修复 API 路由 bug',
      finalResponse: [
        '## 影响面',
        '修改文件：src/routes/api.ts',
        '## diff / 补丁',
        '- removeRoute("/old")',
        '+ addRoute("/new")',
        '## 风险',
        '兼容旧客户端，需回归测试。',
        '## 验证方式',
        'npm run test',
        '## 下一步',
        '确认 diff 后写入，再运行验证。',
      ].join('\n'),
      codeDelivery: {
        status: 'patch-ready',
        changes: [{ file: 'src/routes/api.ts', content: '// fix' }],
        summary: 'route fix',
      },
      evidenceTargets: ['src/routes/api.ts'],
      toolNames: ['read_file', 'run_command'],
    });

    expect(report.status).toBe('pass');
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.missing).toEqual([]);
  });

  it('flags missing verification for code task without patch', () => {
    const report = evaluateResultQuality({
      type: 'code',
      input: '修复 API 路由',
      finalResponse: '找到了影响面：src/routes/api.ts，风险较低。',
      codeDelivery: { status: 'none', changes: [], summary: '' },
      toolNames: ['read_file'],
    });

    expect(report.missing).toContain('diff/补丁');
    expect(report.missing).toContain('验证方式');
    expect(report.repairPrompt).toContain('影响面');
  });

  it('passes a complete startup task report', () => {
    const report = evaluateResultQuality({
      type: 'startup',
      input: '启动 AgentFI 后端服务',
      finalResponse: [
        '## 环境',
        'JDK 17, Maven 3.8, MySQL 8。',
        '## 启动命令',
        './mvnw spring-boot:run -Dspring-boot.run.profiles=dev',
        '## 运行状态',
        '已启动，监听 :8080',
        '## 失败恢复',
        '如果端口占用：kill $(lsof -t -i:8080)，再重启。',
      ].join('\n'),
      codeDelivery: { status: 'none', changes: [], summary: '' },
      toolNames: ['run_command'],
    });

    expect(report.status).toBe('pass');
    expect(report.missing).toEqual([]);
  });

  it('builds a web repair prompt listing missing fields', () => {
    const prompt = buildRepairPrompt('web', '访问官网告诉我内容', ['标题', '直接回答']);
    expect(prompt).toContain('标题');
    expect(prompt).toContain('直接回答');
    expect(prompt).toContain('网页证据');
  });

  it('builds an investment repair prompt that forbids fabrication', () => {
    const prompt = buildRepairPrompt('analysis', '补齐投资报告和竞品分析', ['竞品分析', '尽调缺口']);
    expect(prompt).toContain('竞品分析');
    expect(prompt).toContain('不要编造融资');
  });
});
