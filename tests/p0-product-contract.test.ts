import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { renderGoldenPathState, createGoldenPathState, advanceGoldenPathState } from '../src/core/golden-path-state.js';
import { runToolLoop } from '../src/core/tool-loop.js';
import type { ToolDefinition } from '../src/ai/provider.js';
import {
  isVagueFollowup,
  synthesizeToolAnswerIfNeeded,
} from '../src/cli/repl.js';
import { stripAnsi } from '../src/cli/tool-display.js';

describe('P0 product acceptance contract', () => {
  it('REPL tool tasks render the five-stage golden path panel', () => {
    const state = advanceGoldenPathState(createGoldenPathState('p0', '访问网页'), {
      stage: 'completed',
      status: 'completed',
      evidenceCount: 1,
      toolCount: 1,
      resultReady: true,
      verificationReady: true,
      memoryApplied: true,
    });

    const panel = stripAnsi(renderGoldenPathState(state));
    for (const label of ['理解需求', '调用工具', '形成结论', '验证证据', '沉淀记忆']) {
      expect(panel).toContain(label);
    }
  });

  it('tool results enter the next AI synthesis prompt history', async () => {
    const tools: ToolDefinition[] = [{
      name: 'unknown_contract_tool',
      description: 'contract tool',
      parameters: { type: 'object', properties: {}, required: [] },
    }];
    const provider = {
      name: 'mock',
      supportsStreaming: false,
      supportsToolUse: true,
      defaultModel: 'mock',
      availableModels: ['mock'],
      chat: vi.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ name: 'unknown_contract_tool', arguments: {} }],
          tokensUsed: 1,
        })
        .mockResolvedValueOnce({ content: '基于工具结果回答。', tokensUsed: 1 }),
      chatStream: vi.fn(),
    };

    await runToolLoop({
      task: '验证工具证据进入上下文',
      systemPrompt: '你是测试助手',
      provider: provider as any,
      tools,
      rootPath: 'D:/temp/Codex/AgentCode',
      maxRounds: 2,
    });

    const secondPrompt = provider.chat.mock.calls[1][0];
    expect(secondPrompt.history).toContain('unknown_contract_tool');
    expect(secondPrompt.history).toContain('tool');
  });

  it('vague follow-up questions reuse previous web evidence instead of local project context', () => {
    expect(isVagueFollowup('具体是什么呀')).toBe(true);
    expect(isVagueFollowup('详细点')).toBe(true);

    const evidence = '### web_fetch\nURL: https://icloser.asia/\n标题: iCloser | 加密钱包、自托管与Web3支付入口\n来源: icloser.asia\n\nWeb3 支付入口。';
    const answer = synthesizeToolAnswerIfNeeded('具体是什么呀', '让我查看项目代码。', evidence);
    expect(answer).toContain('iCloser | 加密钱包、自托管与Web3支付入口');
    expect(answer).toContain('不是当前本地代码项目');
  });

  it('capability map records the P0 acceptance standard and update rule', () => {
    const map = readFileSync(new URL('../doc/archive/CAPABILITY_MAP.md', import.meta.url), 'utf-8');
    expect(map).toContain('REPL 工具任务必须展示五阶段黄金路径面板');
    expect(map).toContain('工具结果必须进入 AI 合成上下文');
    expect(map).toContain('追问必须复用上一轮工具证据');
    expect(map).toContain('每新增一个大功能，都必须同步更新这份能力地图');
  });
});
