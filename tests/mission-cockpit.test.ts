import { describe, expect, it } from 'vitest';
import { evaluateMissionScore, renderMissionResult, renderMissionStart } from '../src/cli/mission-cockpit.js';
import { createGoldenPathState, advanceGoldenPathState } from '../src/core/golden-path-state.js';
import { stripAnsi } from '../src/cli/tool-display.js';

describe('Mission Cockpit REPL experience', () => {
  it('renders a beginner-readable H5 delivery start panel', () => {
    const text = stripAnsi(renderMissionStart({
      input: '把 Android App 登录页转成 H5 网页',
      type: 'code',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      memoryApplied: true,
      memoryDigest: '本次采用记忆\n  项目规则    2 条\n  相关历史    1 项',
      workspace: 'D:/temp/Codex/AgentFI',
    }));

    expect(text).toContain('任务驾驶舱');
    expect(text).toContain('代码交付 / H5 页面');
    expect(text).toContain('可运行网页');
    expect(text).toContain('项目规则');
    expect(text).toContain('写文件前');
  });

  it('renders result status, patch files and next action', () => {
    const state = advanceGoldenPathState(createGoldenPathState('t1', '生成登录页'), {
      status: 'completed',
      stage: 'patch_ready',
      evidenceCount: 2,
      toolCount: 2,
      resultReady: true,
      patchReady: true,
      verificationReady: false,
      memoryApplied: true,
      nextAction: '预览 diff 后确认写入，再运行验证',
    });

    const text = stripAnsi(renderMissionResult({
      state,
      finalResponse: '已生成登录页补丁',
      codeDelivery: {
        status: 'patch-ready',
        summary: 'login.html ready',
        changes: [{ file: 'login.html', content: '<html></html>' }],
      },
      toolNames: ['read_file', 'search_code'],
      codeDeliveryReadiness: {
        score: 78,
        status: 'needs-review',
        missing: ['验证命令'],
        nextAction: '补齐 验证命令 后再交付',
      },
      rounds: 2,
      tokensUsed: 123,
    }));

    expect(text).toContain('任务结果');
    expect(text).toContain('完成');
    expect(text).toContain('login.html');
    expect(text).toContain('预览 diff');
    expect(text).toContain('代码');
    expect(text).toContain('验证命令');
  });

  it('uses a research profile for investment report analysis', () => {
    const text = stripAnsi(renderMissionStart({
      input: '你的投资报告分析太少了',
      type: 'analysis',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      memoryApplied: true,
      workspace: 'D:/temp/Codex',
    }));

    expect(text).toContain('投资 / 市场研究');
    expect(text).toContain('融资');
    expect(text).toContain('竞品');
    expect(text).toContain('尽调缺口');
    expect(text).toContain('web_search ≤5');
    expect(text).toContain('证据压缩');
    expect(text).not.toContain('读项目结构');
  });

  it('does not describe non-code analysis delivery as missing code patch', () => {
    const state = advanceGoldenPathState(createGoldenPathState('t2', '投资报告分析'), {
      status: 'completed',
      stage: 'completed',
      evidenceCount: 20,
      toolCount: 20,
      resultReady: true,
      verificationReady: true,
      memoryApplied: true,
    });

    const text = stripAnsi(renderMissionResult({
      state,
      type: 'analysis',
      finalResponse: '## 投资分析\n\n### 风险\n\n- 缺少财务指标',
      codeDelivery: { status: 'none', changes: [], summary: '' },
      toolNames: ['web_search', 'web_fetch'],
      evidenceTargets: [
        'https://pitchhub.36kr.com/project/2793907771741958',
        'https://icloser.xyz',
        'icloser 公司 融资 投资 估值',
      ],
      qualityGate: {
        score: 58,
        status: 'fail',
        template: '投资/市场研究质量门',
        required: ['公司概况', '市场机会', '融资/估值线索', '竞品分析', '核心风险', '尽调缺口', '置信度'],
        present: ['核心风险'],
        missing: ['公司概况', '市场机会', '竞品分析', '尽调缺口'],
        nextAction: '自动补齐缺失字段：公司概况、市场机会、竞品分析、尽调缺口',
        repairPrompt: '请基于已有证据补齐投资研究缺口：公司概况、市场机会、竞品分析、尽调缺口。缺少公开证据的字段必须标注“待补证”，不要编造融资、估值或用户数据。',
      },
      rounds: 7,
      tokensUsed: 45296,
    }));

    expect(text).toContain('已生成');
    expect(text).toContain('已基于 20 条证据核对');
    expect(text).toContain('pitchhub.36kr.com');
    expect(text).toContain('icloser.xyz');
    expect(text).toContain('来源等级');
    expect(text).toContain('官方');
    expect(text).toContain('投资研究');
    expect(text).toContain('质量');
    expect(text).toContain('缺口');
    expect(text).toContain('补齐指令');
    expect(text).toContain('竞品分析');
    expect(text).toContain('向导');
    expect(text).toContain('补齐缺口');
    expect(text).toContain('评分');
    expect(text).not.toContain('本轮没有代码补丁');
    expect(text).not.toContain('等待写入后验证');
  });

  it('renders actionable failure recovery instead of truncating the only failure line', () => {
    const state = advanceGoldenPathState(createGoldenPathState('t3', '你的投资报告分析太少了'), {
      status: 'failed',
      stage: 'failed',
      evidenceCount: 12,
      toolCount: 12,
      resultReady: false,
      verificationReady: false,
      memoryApplied: true,
      failure: '分析超时:\ndeepseek API 请求超时\n恢复建议：1. 检查网络延迟\n2. 简化任务或减少上下文大小\n3. 稍后重试',
      nextAction: '查看失败原因后重试或切换 Provider',
    });

    const text = stripAnsi(renderMissionResult({
      state,
      type: 'analysis',
      finalResponse: '',
      codeDelivery: { status: 'none', changes: [], summary: '' },
      toolNames: ['web_search', 'web_fetch'],
      evidenceTargets: ['https://icloser.xyz'],
      rounds: 7,
      tokensUsed: 45296,
    }));

    expect(text).toContain('失败');
    expect(text).toContain('关键');
    expect(text).toContain('恢复');
    expect(text).toContain('兜底版');
    expect(text).toContain('deepseek-v4-flash');
  });

  it('scores a task and reports deduction reasons when quality is below target', () => {
    const state = advanceGoldenPathState(createGoldenPathState('t4', '分析投资报告'), {
      status: 'completed',
      stage: 'completed',
      evidenceCount: 0,
      toolCount: 0,
      resultReady: true,
      verificationReady: false,
      memoryApplied: false,
    });

    const score = evaluateMissionScore({
      type: 'analysis',
      state,
      finalResponse: '结论太短',
      codeDelivery: { status: 'none', changes: [], summary: '' },
      toolNames: [],
      evidenceTargets: [],
    });

    expect(score.total).toBeLessThan(75);
    expect(score.reasons.join('；')).toContain('缺少工具取证');
    expect(score.reasons.join('；')).toContain('最终回答偏短');
  });
});
