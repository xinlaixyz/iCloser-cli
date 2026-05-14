import { describe, expect, it, beforeEach } from 'vitest';
import { printToolDegradationNotice, resetToolDegradationNotices } from '../src/cli/output.js';

function captureStdout(fn: () => string[]): string {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try { fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('tool fallback messages (S7.4)', () => {
  beforeEach(() => {
    resetToolDegradationNotices();
  });

  it('shows no degradation by default (all tools available)', () => {
    const messages = printToolDegradationNotice();
    expect(messages.length).toBe(0);
  });

  it('shows the S7.4 fallback message for web-search when unavailable', () => {
    const messages = printToolDegradationNotice({ webSearchAvailable: false });
    const web = messages.find(m => m.includes('网络搜索'));
    expect(web).toBe('网络搜索暂不可用，已使用本地文档和项目记忆');
  });

  it('shows the exact S7.4 spec Chinese message for code-intelligence when unavailable', () => {
    const messages = printToolDegradationNotice({ codeIntelligenceAvailable: false });
    const code = messages.find(m => m.includes('代码智能'));
    expect(code).toBe('代码智能暂不可用，已降级为：搜索 + 编译错误分析');
  });

  it('shows command fallback when commandAvailable is false', () => {
    const messages = printToolDegradationNotice({ commandAvailable: false });
    expect(messages.length).toBe(1);
    const cmd = messages.find(m => m.includes('命令执行'));
    expect(cmd).toBe('命令执行未完成，系统不会假装验证通过');
  });

  it('returns empty when all tools are available', () => {
    const messages = printToolDegradationNotice({
      webSearchAvailable: true,
    });
    expect(messages.length).toBe(0);
  });

  it('deduplicates: second call without reset returns empty', () => {
    printToolDegradationNotice();
    const messages = printToolDegradationNotice();
    expect(messages.length).toBe(0);
  });

  it('resetToolDegradationNotices allows messages to appear again', () => {
    printToolDegradationNotice();
    resetToolDegradationNotices();
    const messages = printToolDegradationNotice({ webSearchAvailable: false });
    expect(messages.length).toBe(1);
  });

  it('prints to console only when tools are degraded', () => {
    resetToolDegradationNotices();
    const output = captureStdout(() => printToolDegradationNotice({ webSearchAvailable: false }));
    expect(output).toContain('[!]');
    expect(output).toContain('网络搜索');
  });

  it('resetToolDegradationNotices is exported and callable', () => {
    expect(() => resetToolDegradationNotices()).not.toThrow();
  });
});
