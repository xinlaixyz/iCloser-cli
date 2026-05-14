import { describe, expect, it } from 'vitest';
import { isLoopInterventionInput, renderLoopInterventionNotice, renderReplLoopPanel } from '../src/cli/loop-panel.js';

describe('REPL loop panel', () => {
  it('renders collect context with required tools and fallback labels', () => {
    const text = renderReplLoopPanel('collect-context');

    expect(text).toContain('步骤 1/3');
    expect(text).toContain('收集上下文');
    expect(text).toContain('文件操作');
    expect(text).toContain('搜索');
    expect(text).toContain('网络搜索');
    expect(text).toContain('代码智能');
    expect(text).toContain('收集上下文');
    // All tools available by default (DuckDuckGo + tree-sitter) — no degradation
  });

  it('renders action and verify steps', () => {
    expect(renderReplLoopPanel('take-action')).toContain('执行操作');
    expect(renderReplLoopPanel('take-action')).toContain('执行命令');
    expect(renderReplLoopPanel('verify-result')).toContain('验证结果');
  });

  it('detects user intervention phrases', () => {
    expect(isLoopInterventionInput('换个方法试试')).toBe(true);
    expect(isLoopInterventionInput('先不要执行，只看分析')).toBe(true);
    expect(isLoopInterventionInput('帮我分析项目')).toBe(false);
  });

  it('renders user intervention notice', () => {
    const text = renderLoopInterventionNotice('换个方法试试');

    expect(text).toContain('用户干预');
    expect(text).toContain('回到收集上下文');
  });
});

