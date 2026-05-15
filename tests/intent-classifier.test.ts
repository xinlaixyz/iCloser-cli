import { describe, expect, it } from 'vitest';
import { classifyIntentRegex } from '../src/core/intent-classifier.js';

describe('Intent classifier — regex phase', () => {
  it('classifies project analysis queries', () => {
    const tests = [
      '分析这个项目是什么',
      '检查一下代码质量',
      '这个项目完整吗',
      'analyze the project',
      '技术栈是什么',
    ];
    for (const input of tests) {
      const result = classifyIntentRegex(input);
      expect(result?.category).toBe('analysis');
    }
  });

  it('classifies code change requests', () => {
    const tests = [
      '帮我给登录加个验证码',
      '修改用户模块的接口',
      '添加一个健康检查接口',
      '删除旧的配置文件',
      '加个缓存层',
      'implement user auth',
    ];
    for (const input of tests) {
      const result = classifyIntentRegex(input);
      expect(result?.category).toBe('code_change');
    }
  });

  it('classifies code fix requests', () => {
    const tests = [
      'fix the login bug',
      '修复这个报错',
      '帮我解决崩溃问题',
      'resolve the crash issue',
    ];
    for (const input of tests) {
      const result = classifyIntentRegex(input);
      expect(result?.category).toBe('code_fix');
    }
  });

  it('classifies security review queries', () => {
    const result = classifyIntentRegex('检查代码有没有SQL注入漏洞');
    expect(result?.category).toBe('security_review');
    const result2 = classifyIntentRegex('帮我做安全审查');
    expect(result2?.category).toBe('security_review');
  });

  it('classifies refactoring requests', () => {
    const result = classifyIntentRegex('这个函数太长了，帮我拆分一下');
    expect(result?.category).toBe('refactor');
    const result2 = classifyIntentRegex('重构用户模块，太乱了');
    expect(result2?.category).toBe('refactor');
  });

  it('classifies test generation requests', () => {
    const result = classifyIntentRegex('给这个模块补一下单元测试');
    expect(result?.category).toBe('test_gen');
  });

  it('classifies documentation requests', () => {
    const result = classifyIntentRegex('帮我生成API文档');
    expect(result?.category).toBe('doc_gen');
  });

  it('classifies questions', () => {
    const tests = ['怎么使用这个工具', '什么是依赖注入', '为什么要用Redis'];
    for (const input of tests) {
      const result = classifyIntentRegex(input);
      expect(result?.category).toBe('question');
    }
  });

  it('classifies config requests', () => {
    const result = classifyIntentRegex('切换到claude模型');
    expect(result?.category).toBe('config');
  });

  it('classifies chat/greetings', () => {
    const result = classifyIntentRegex('你好');
    expect(result?.category).toBe('chat');
  });

  it('returns null for truly ambiguous input', () => {
    const result = classifyIntentRegex('');
    expect(result).toBeNull();
    const result2 = classifyIntentRegex('嗯');
    expect(result2?.category).toBe('chat');
  });

  it('extracts task from conversational input', () => {
    const result = classifyIntentRegex('请帮我给用户表加个邮箱字段');
    expect(result?.category).toBe('code_change');
    expect(result?.extractedTask).toBe('给用户表加个邮箱字段');
  });

  it('marks code_change as requiring confirmation', () => {
    const result = classifyIntentRegex('修改登录接口');
    expect(result?.requiresConfirmation).toBe(true);
  });

  it('does not require confirmation for analysis', () => {
    const result = classifyIntentRegex('分析项目完成度');
    expect(result?.requiresConfirmation).toBe(false);
  });

  it('has confidence >= 0.8 for regex matches', () => {
    const result = classifyIntentRegex('帮我写个导出CSV的功能');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
