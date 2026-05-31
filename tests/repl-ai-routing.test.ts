import { describe, expect, it } from 'vitest';
import {
  buildToolEvidenceSummary,
  buildPostWriteVerificationPlan,
  getNaturalLanguageLocalFallback,
  isVagueFollowup,
  isPendingFileContinuation,
  limitResultLinesForDisplay,
  renderPostWriteVerificationPlan,
  renderAgentStageLine,
  renderGoldenPathPanel,
  synthesizeToolAnswerIfNeeded,
} from '../src/cli/repl.js';
import { stripAnsi } from '../src/cli/tool-display.js';

describe('REPL natural language AI routing', () => {
  it('routes natural language start/restart/stop through AI when tool-capable provider is active', () => {
    const ai = { provider: 'claude' as const, supportsToolUse: true };
    expect(getNaturalLanguageLocalFallback('启动项目', ai)).toBeNull();
    expect(getNaturalLanguageLocalFallback('启动起来', ai)).toBeNull();
    expect(getNaturalLanguageLocalFallback('重启项目', ai)).toBeNull();
    expect(getNaturalLanguageLocalFallback('停止项目', ai)).toBeNull();
    expect(getNaturalLanguageLocalFallback('查看运行状态', ai)).toBeNull();
  });

  it('uses local fallback for devops intents only when AI tools are unavailable', () => {
    const ai = { provider: 'mock' as const, supportsToolUse: false };
    expect(getNaturalLanguageLocalFallback('启动项目', ai)).toBe('start-project');
    expect(getNaturalLanguageLocalFallback('启动起来', ai)).toBe('start-project');
    expect(getNaturalLanguageLocalFallback('重启项目', ai)).toBe('restart-project');
    expect(getNaturalLanguageLocalFallback('停止项目', ai)).toBe('stop-project');
    expect(getNaturalLanguageLocalFallback('查看运行状态', ai)).toBe('running-status');
  });

  it('does not turn a vague do-it phrase into start unless there was a recent start intent', () => {
    const ai = { provider: 'mock' as const, supportsToolUse: false };
    expect(getNaturalLanguageLocalFallback('开始吧', ai)).toBeNull();
    expect(getNaturalLanguageLocalFallback('开始吧', { ...ai, hasRecentStartIntent: true })).toBe('start-project');
  });

  it('routes natural language code-intel through AI when tools are available', () => {
    expect(getNaturalLanguageLocalFallback('谁调用了 scanProject', {
      provider: 'openai',
      supportsToolUse: true,
    })).toBeNull();
    expect(getNaturalLanguageLocalFallback('谁调用了 scanProject', {
      provider: 'mock',
      supportsToolUse: false,
    })).toBe('code-intel');
  });

  it('detects vague follow-up questions that should reuse previous tool evidence', () => {
    expect(isVagueFollowup('具体是什么呀')).toBe(true);
    expect(isVagueFollowup('详细点')).toBe(true);
    expect(isVagueFollowup('启动项目')).toBe(false);
  });

  it('keeps pending code delivery alive when user says continue', () => {
    expect(isPendingFileContinuation('继续')).toBe(true);
    expect(isPendingFileContinuation('继续任务')).toBe(true);
    expect(isPendingFileContinuation('预览 diff')).toBe(true);
    expect(isPendingFileContinuation('重新分析项目')).toBe(false);
  });

  it('folds long tool results so REPL does not flood beginners', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    const full = limitResultLinesForDisplay(lines, 'full');
    const brief = limitResultLinesForDisplay(lines, 'brief');
    expect(full.visible).toHaveLength(28);
    expect(full.hidden).toBe(32);
    expect(brief.visible).toHaveLength(18);
    expect(brief.hidden).toBe(42);
  });

  it('suggests verification immediately after writing generated files', () => {
    const plan = buildPostWriteVerificationPlan([{ path: 'login.html' }]);
    expect(plan.checks.join(' ')).toContain('浏览器');
    expect(plan.nextActions).toContain('/verify 运行项目验证');

    const rendered = renderPostWriteVerificationPlan(plan);
    expect(rendered).toContain('建议验证');
    expect(rendered).toContain('验证失败');
  });

  it('stores web_fetch evidence and synthesizes an answer when AI returns process chatter', () => {
    const evidence = buildToolEvidenceSummary([{
      name: 'web_fetch',
      args: { url: 'https://icloser.asia/' },
      result: '标题: icloser | 加密钱包、自托管与Web3支付入口\n来源: icloser.asia\n\nWeb3 支付入口，自托管钱包。',
      success: true,
    }]);
    expect(evidence).toContain('web_fetch');
    expect(evidence).toContain('icloser | 加密钱包、自托管与Web3支付入口');

    const answer = synthesizeToolAnswerIfNeeded('告诉我内容', '让我访问这个网址看看内容。', evidence);
    expect(answer).toContain('标题：icloser | 加密钱包、自托管与Web3支付入口');
    expect(answer).toContain('不是当前本地代码项目');
  });

  it('renders the five-stage golden path panel for tool tasks', () => {
    const line = stripAnsi(renderAgentStageLine('understand', 'active'));
    expect(line).toContain('理解需求');
    expect(line).toContain('进行中');

    const panel = stripAnsi(renderGoldenPathPanel({
      input: '访问网页并告诉我内容',
      toolCalls: [{
        name: 'web_fetch',
        args: { url: 'https://icloser.asia/' },
        result: '标题: icloser',
        success: true,
      }],
      finalResponse: '这是 icloser 页面。',
      success: true,
      rounds: 2,
    }));
    expect(panel).toContain('Golden Path');
    expect(panel).toContain('理解需求');
    expect(panel).toContain('调用工具');
    expect(panel).toContain('形成结论');
    expect(panel).toContain('验证证据');
    expect(panel).toContain('沉淀记忆');
    expect(panel).toContain('web_fetch');
  });

  it('marks golden path conclusion as failed when the provider call fails after tools', () => {
    const panel = stripAnsi(renderGoldenPathPanel({
      input: '修改代码',
      toolCalls: [{
        name: 'search_code',
        args: { pattern: 'TradGPT' },
        result: '15 条结果',
        success: true,
      }],
      finalResponse: 'AI 调用失败: deepseek API 调用失败: 400 Failed to parse the request body as JSON',
      success: false,
      rounds: 2,
    }));
    expect(panel).toContain('形成结论');
    expect(panel).toContain('失败');
    expect(panel).toContain('未完全确认');
  });
});
