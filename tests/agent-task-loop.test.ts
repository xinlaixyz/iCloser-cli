import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../src/ai/provider.js';
import { EvidenceStore, summarizeToolEvidence } from '../src/core/evidence-store.js';
import { createGoldenPathState, renderGoldenPathState, advanceGoldenPathState } from '../src/core/golden-path-state.js';
import { evaluateCodeDeliveryReadiness, parseCodeDeliveryOutput } from '../src/core/code-delivery-pipeline.js';
import { classifyAgentTask, runAgentTaskLoop } from '../src/core/agent-task-loop.js';

function mockProvider(responses: Array<{ content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }>) {
  let idx = 0;
  return {
    name: 'mock-tools',
    supportsStreaming: false,
    supportsToolUse: true,
    defaultModel: 'mock',
    availableModels: ['mock'],
    chat: vi.fn(async (_prompt: unknown, _tools?: ToolDefinition[]) => {
      const response = responses[idx] || responses[responses.length - 1];
      idx++;
      return { ...response, tokensUsed: 10, model: 'mock' };
    }),
    chatStream: vi.fn(),
  };
}

function timeoutAfterToolProvider() {
  let idx = 0;
  return {
    name: 'mock-timeout',
    supportsStreaming: false,
    supportsToolUse: true,
    defaultModel: 'mock',
    availableModels: ['mock'],
    chat: vi.fn(async () => {
      idx++;
      if (idx === 1) {
        return {
          content: '',
          toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }],
          tokensUsed: 10,
          model: 'mock',
        };
      }
      throw new Error('deepseek API 请求超时');
    }),
    chatStream: vi.fn(),
  };
}

describe('agent task loop rebuild', () => {
  it('summarizes evidence before feeding provider context', () => {
    const raw = 'D:\\temp\\Codex\\x\n'.repeat(100) + '标题: icloser\n正文内容';
    const summary = summarizeToolEvidence('web_fetch', { url: 'https://icloser.asia/' }, raw);
    expect(summary.length).toBeLessThan(1000);
    expect(summary).not.toContain('\\');
  });

  it('renders failed golden path from state instead of pretending completion', () => {
    const state = advanceGoldenPathState(createGoldenPathState('t1', '继续任务'), {
      stage: 'failed',
      status: 'failed',
      toolCount: 2,
      evidenceCount: 2,
      failure: 'Provider 400',
    });
    const panel = renderGoldenPathState(state);
    expect(panel).toContain('形成结论');
    expect(panel).toContain('失败');
    expect(panel).toContain('Provider 400');
  });

  it('parses code delivery patch output', () => {
    const output = JSON.stringify({
      summary: '改名',
      changes: [{ file: 'index.html', operation: 'write', content: '<html>AgentFI</html>', reasoning: 'rename' }],
    });
    const result = parseCodeDeliveryOutput(output, 'TradGPT 改名 AgentFI');
    expect(result.status).toBe('patch-ready');
    expect(result.changes[0].file).toBe('index.html');
  });

  it('blocks code delivery readiness when patch or verification is missing', () => {
    const readiness = evaluateCodeDeliveryReadiness({
      codeDelivery: { status: 'invalid', changes: [], summary: '只给建议，没有补丁' },
      toolNames: ['search_code'],
      verificationReady: false,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.missing).toContain('可执行补丁');
    expect(readiness.missing).toContain('验证命令');
    expect(readiness.nextAction).toContain('补齐');
  });

  it('treats Android/App to H5 conversion as code delivery intent', async () => {
    const { isCodeDeliveryIntent } = await import('../src/core/code-delivery-pipeline.js');
    expect(isCodeDeliveryIntent('把 Android App 登录页转成 H5 网页')).toBe(true);
    expect(isCodeDeliveryIntent('转换成 HTML 页面')).toBe(true);
  });

  it('classifies the required sample tasks', () => {
    expect(classifyAgentTask('访问 https://icloser.asia/')).toBe('web');
    expect(classifyAgentTask('把 Android 需求转成 H5 网页')).toBe('code');
    expect(classifyAgentTask('修复 Web 项目 bug')).toBe('code');
    expect(classifyAgentTask('补齐 icloser 投资报告和竞品分析')).toBe('analysis');
  });

  it('runs the unified task loop and persists structured evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'icloser-agent-loop-'));
    try {
      const provider = mockProvider([
        { content: '', toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] },
        { content: '基于证据的最终结论。' },
      ]);
      const result = await runAgentTaskLoop({
        rootPath: root,
        input: '分析项目',
        systemPrompt: '你是测试助手',
        provider: provider as any,
        prompt: {
          systemPrompt: '你是测试助手',
          task: '分析项目',
          history: '',
          context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        },
        maxRounds: 3,
      });
      expect(result.success).toBe(true);
      expect(result.evidence.list().length).toBeGreaterThan(0);
      expect(result.qualityReportPath).toBeTruthy();
      expect(existsSync(result.qualityReportPath!)).toBe(true);
      const loaded = await EvidenceStore.load(root, result.taskId);
      expect(loaded.list().length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns an evidence fallback report when final AI synthesis times out after successful tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'icloser-agent-timeout-'));
    try {
      const result = await runAgentTaskLoop({
        rootPath: root,
        input: '你的投资报告分析太少了，请补充投资分析',
        systemPrompt: '你是测试助手',
        provider: timeoutAfterToolProvider() as any,
        prompt: {
          systemPrompt: '你是测试助手',
          task: '你的投资报告分析太少了，请补充投资分析',
          history: '',
          context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        },
        maxRounds: 1,
      });
      expect(result.success).toBe(true);
      expect(result.finalResponse).toContain('投资分析报告');
      expect(result.finalResponse).toContain('证据兜底版');
      expect(result.finalResponse).toContain('需要补充的关键材料');
      expect(result.state.status).toBe('completed');
      expect(result.qualityGate.required).toContain('竞品分析');
      expect(result.qualityGate.missing.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
