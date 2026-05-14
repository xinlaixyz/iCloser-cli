import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { SkillManager } from '../src/skill/manager.js';

describe('skill manager', () => {
  it('registers local-tools as an enabled builtin skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-skill-'));
    try {
      const manager = new SkillManager(root);
      const skill = manager.get('local-tools');

      expect(skill).toBeTruthy();
      expect(skill?.manifest.type).toBe('builtin');
      expect(skill?.enabled).toBe(true);
      expect(skill?.manifest.triggers).toEqual(expect.arrayContaining(['eslint', 'prettier', 'lint', '开发工具']));
      expect(skill?.systemPrompt).toContain('本地开发工具管理专家');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('matches local-tools for beginner tool setup requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-skill-'));
    try {
      const manager = new SkillManager(root);
      const matches = manager.matchSkills('帮我安装 eslint 并配置 lint 工具');

      expect(matches.map(skill => skill.manifest.name)).toContain('local-tools');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
