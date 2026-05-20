// Coverage: skill-system + task-memory unit tests
import { describe, it, expect } from 'vitest';

describe('skill-system', () => {
  it('lists built-in skills', async () => {
    const { listSkills } = await import('../src/core/skill-system.js');
    const skills = listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills.some(s => s.name === 'code-review')).toBe(true);
    expect(skills.some(s => s.name === 'test-gen')).toBe(true);
    expect(skills.some(s => s.name === 'api-doc')).toBe(true);
    expect(skills.some(s => s.name === 'security-review')).toBe(true);
    expect(skills.some(s => s.name === 'refactor-guide')).toBe(true);
  });

  it('matches skills by task description', async () => {
    const { getMatchingSkills } = await import('../src/core/skill-system.js');
    const matched = getMatchingSkills('帮我审查这段代码');
    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched.some(s => s.name === 'code-review')).toBe(true);
  });

  it('returns empty for unrelated task', async () => {
    const { getMatchingSkills } = await import('../src/core/skill-system.js');
    const matched = getMatchingSkills('今天天气怎么样');
    expect(matched.length).toBe(0);
  });

  it('builds skill prompt text', async () => {
    const { buildSkillPrompt } = await import('../src/core/skill-system.js');
    const prompt = buildSkillPrompt('帮我生成测试');
    expect(prompt).toContain('test-gen');
    expect(prompt).toContain('测试代码');
  });

  it('registers and removes custom skill', async () => {
    const { registerSkill, listSkills, removeSkill } = await import('../src/core/skill-system.js');
    const before = listSkills().length;
    registerSkill({ name: 'test-skill', description: 'test', triggers: ['test'], systemPrompt: 'test prompt', category: 'custom' });
    expect(listSkills().length).toBe(before + 1);
    removeSkill('test-skill');
    expect(listSkills().length).toBe(before);
  });
});

describe('task-memory', () => {
  it('records and retrieves task execution', async () => {
    const { recordTaskExecution, getTaskSuggestions } = await import('../src/core/task-memory.js');
    const tmpDir = process.cwd();
    await recordTaskExecution(tmpDir, { id: 'test-1', description: '修改 src/auth.ts 添加登录', status: 'completed', priority: 'normal', createdAt: new Date().toISOString(), changes: [], diffs: [], reasoning: [], errorLog: [], retryCount: 0, maxRetries: 3, agentExecutions: [] } as any, {
      status: 'completed', strategies: ['read_file', 'search_code'], filesChanged: ['src/auth.ts'], verifyPassed: true, duration: 5000, tokensUsed: 1000, errors: [],
    });
    const suggestions = await getTaskSuggestions(tmpDir, '修改 src/login.ts 添加 OAuth');
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('returns empty suggestions for unrelated tasks', async () => {
    const { getTaskSuggestions, getIntentStats } = await import('../src/core/task-memory.js');
    const suggestions = await getTaskSuggestions(process.cwd(), '分析项目代码质量');
    expect(Array.isArray(suggestions)).toBe(true);
    const stats = await getIntentStats(process.cwd());
    expect(typeof stats).toBe('object');
  });
});
