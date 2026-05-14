import { describe, expect, it } from 'vitest';
import { routeAutopilotIntent } from '../src/core/autopilot-router.js';

describe('autopilot natural language router', () => {
  it('routes whole-project analysis to AI chat (not static autopilot)', () => {
    // P7: Analysis queries now go to AI chat with rich context + tool calling
    const route = routeAutopilotIntent('你分析下项目，并读取 docs 里面的文档');
    expect(route.intent).toBe('none'); // Falls through to AI chat
  });

  it('routes missing documentation requests to confirmed docs write mode', () => {
    const route = routeAutopilotIntent('你补齐所有缺失的功能文档');

    expect(route.intent).toBe('docs');
    expect(route.confidence).toBe('high');
    expect(route.requiresConfirmation).toBe(true);
  });

  it('routes test gap inspection without write confirmation', () => {
    const route = routeAutopilotIntent('检查当前项目测试覆盖缺口');

    expect(route.intent).toBe('tests');
    expect(route.requiresConfirmation).toBe(false);
  });

  it('routes explicit test generation to confirmed write mode', () => {
    const route = routeAutopilotIntent('帮我自动补单测');

    expect(route.intent).toBe('test-write');
    expect(route.requiresConfirmation).toBe(true);
  });

  it('routes execution-chain requests to chain mode', () => {
    const route = routeAutopilotIntent('给软件做个思维链，自动发现问题写入验证回滚');

    expect(route.intent).toBe('chain');
    expect(route.requiresConfirmation).toBe(false);
  });

  it('ignores ordinary feature requests', () => {
    const route = routeAutopilotIntent('帮登录页加手机号验证码登录');

    expect(route.intent).toBe('none');
  });
});
