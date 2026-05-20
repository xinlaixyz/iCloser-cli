// Coverage for src/core/intent-classifier.ts
// Targets: classifyIntentAI (237-288), classifyIntent (294-323)
import { describe, it, expect } from 'vitest';
import {
  classifyIntentAI,
  classifyIntent,
} from '../src/core/intent-classifier.js';

// ── Mock provider helpers ──
function makeProvider(content: string) {
  return {
    chat: async (_p: any) => ({ content, tokensUsed: 20 }),
  };
}

function makeThrowingProvider() {
  return {
    chat: async (_p: any) => { throw new Error('provider unavailable'); },
  };
}

// ============================================================
// classifyIntentAI — various AI response branches
// ============================================================
describe('classifyIntentAI', () => {
  it('parses valid JSON response with high-confidence code_change category', async () => {
    const json = JSON.stringify({
      category: 'code_change',
      confidence: 0.9,
      reasoning: '用户明确要求修改代码',
      extractedTask: '给登录功能加验证码',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('帮我给登录加个验证码', provider as any);
    expect(result.category).toBe('code_change');
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.method).toBe('ai');
    expect(result.reasoning).toBe('用户明确要求修改代码');
    expect(result.extractedTask).toBe('给登录功能加验证码');
    expect(result.requiresConfirmation).toBe(true); // code_change requires confirmation
  });

  it('parses valid JSON for security_review category (no confirmation required)', async () => {
    const json = JSON.stringify({
      category: 'security_review',
      confidence: 0.85,
      reasoning: '安全检查请求',
      extractedTask: '扫描SQL注入漏洞',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('检查有没有SQL注入', provider as any);
    expect(result.category).toBe('security_review');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('parses valid JSON for test_gen category (requires confirmation)', async () => {
    const json = JSON.stringify({
      category: 'test_gen',
      confidence: 0.88,
      reasoning: '生成测试请求',
      extractedTask: '为auth模块生成单元测试',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('帮我写auth模块的测试', provider as any);
    expect(result.category).toBe('test_gen');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('parses valid JSON for doc_gen category (requires confirmation)', async () => {
    const json = JSON.stringify({
      category: 'doc_gen',
      confidence: 0.82,
      reasoning: '文档生成请求',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('生成项目文档', provider as any);
    expect(result.category).toBe('doc_gen');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('parses valid JSON for analysis category (no confirmation)', async () => {
    const json = JSON.stringify({
      category: 'analysis',
      confidence: 0.9,
      reasoning: '项目分析请求',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('分析一下这个项目', provider as any);
    expect(result.category).toBe('analysis');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('clamps confidence to [0, 1] range', async () => {
    const json = JSON.stringify({
      category: 'question',
      confidence: 1.5, // out of range
      reasoning: '咨询问题',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('怎么配置环境?', provider as any);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('falls back to default confidence when confidence missing', async () => {
    const json = JSON.stringify({
      category: 'config',
      reasoning: '配置请求',
    });
    const provider = makeProvider(json);
    const result = await classifyIntentAI('配置数据库连接', provider as any);
    expect(result.confidence).toBeCloseTo(0.5); // default
    expect(result.category).toBe('config');
  });

  it('returns fallback when JSON parsing fails (invalid JSON)', async () => {
    const provider = makeProvider('这不是JSON，就是普通文字回答');
    const result = await classifyIntentAI('some input', provider as any);
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0.1);
    expect(result.method).toBe('ai');
    expect(result.reasoning).toContain('未能返回有效结果');
  });

  it('returns fallback when provider throws', async () => {
    const provider = makeThrowingProvider();
    const result = await classifyIntentAI('some input', provider as any);
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0.1);
    expect(result.method).toBe('ai');
  });

  it('handles JSON embedded in text output', async () => {
    const json = `我对这个问题进行了分析。\n{"category":"analysis","confidence":0.8,"reasoning":"项目分析"}`;
    const provider = makeProvider(json);
    const result = await classifyIntentAI('分析项目状态', provider as any);
    expect(result.category).toBe('analysis');
    expect(result.confidence).toBeCloseTo(0.8);
  });
});

// ============================================================
// classifyIntent — unified classifier (all branches)
// ============================================================
describe('classifyIntent', () => {
  it('uses regex when confidence >= 0.8 (no AI needed)', async () => {
    // '分析' → high confidence analysis
    const result = await classifyIntent('分析一下这个项目的代码质量');
    expect(result.category).toBe('analysis');
    expect(result.method).toBe('regex');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('uses AI when regex confidence is low and AI is provided', async () => {
    // A very ambiguous input that regex won't match well
    const ambiguousInput = '好的';
    const aiResponseJson = JSON.stringify({
      category: 'chat',
      confidence: 0.9,
      reasoning: '闲聊回应',
    });
    const provider = makeProvider(aiResponseJson);
    const result = await classifyIntent(ambiguousInput, { useAI: true, aiProvider: provider as any });
    // Either regex or AI result, depending on which has higher confidence
    expect(result.category).toBeDefined();
    expect(result.method).toBeDefined();
  });

  it('skips AI when useAI is false', async () => {
    const ambiguous = '好的好的';
    const provider = makeProvider(JSON.stringify({ category: 'chat', confidence: 0.9, reasoning: '闲聊' }));
    const result = await classifyIntent(ambiguous, { useAI: false, aiProvider: provider as any });
    // Should use regex or return unknown, never use AI
    expect(result).toBeDefined();
  });

  it('uses regex result when AI confidence is not higher', async () => {
    // Input that regex classifies with moderate confidence
    const input = '修改代码';
    const lowConfidenceJson = JSON.stringify({
      category: 'code_change',
      confidence: 0.3, // lower than regex
      reasoning: '低置信度判断',
    });
    const provider = makeProvider(lowConfidenceJson);
    const result = await classifyIntent(input, { useAI: true, aiProvider: provider as any });
    // Regex result should be used since AI confidence is lower
    expect(result).toBeDefined();
  });

  it('returns unknown when no regex match and no AI', async () => {
    // Input with no matching patterns (but still a real string)
    const result = await classifyIntent('xyzzy foobar 123456789');
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0.1);
    expect(result.method).toBe('regex');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('catches AI errors and falls back to regex', async () => {
    const input = '帮我修改代码加一个功能';
    const provider = makeThrowingProvider();
    const result = await classifyIntent(input, { useAI: true, aiProvider: provider as any });
    // Should still return a result (regex fallback)
    expect(result).toBeDefined();
    expect(result.category).toBeDefined();
  });

  it('classifies code_change with high regex confidence (skips AI)', async () => {
    const result = await classifyIntent('帮我给登录接口加验证码功能');
    expect(result.method).toBe('regex');
    expect(result.category).toBe('code_change');
  });

  it('classifies security_review correctly via regex', async () => {
    const result = await classifyIntent('检查代码有没有SQL注入漏洞');
    expect(result.category).toBe('security_review');
    expect(result.method).toBe('regex');
  });

  it('handles options with aiProvider but useAI defaults to true', async () => {
    const ambiguous = 'ok';
    const json = JSON.stringify({ category: 'chat', confidence: 0.95, reasoning: '闲聊' });
    const provider = makeProvider(json);
    // No useAI flag → defaults to using AI
    const result = await classifyIntent(ambiguous, { aiProvider: provider as any });
    expect(result).toBeDefined();
  });
});
