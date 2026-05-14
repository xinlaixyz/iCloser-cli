import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { defaultConfig, disableSecurityRule } from '../src/config.js';
import { createTask, addFileChange } from '../src/core/task-engine.js';
import {
  getSecurityIssuesFromGateCheck,
  getSecurityRuleDefinition,
  getSecurityRuleDefinitions,
  scanTaskSecurity,
} from '../src/core/security.js';
import type { GateCheck, ProjectIdentity } from '../src/types.js';

const identity: ProjectIdentity = {
  language: 'typescript',
  framework: 'unknown',
  database: 'unknown',
  buildSystem: 'npm',
  testFramework: 'vitest',
  runtime: 'node',
  deploymentType: 'unknown',
  packageManager: 'npm',
  languageVersion: 'unknown',
};

async function writeProjectFile(root: string, file: string, content: string) {
  const full = join(root, file);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

describe('security scan', () => {
  it('exposes a complete unique security rule registry', () => {
    const rules = getSecurityRuleDefinitions();
    const ids = rules.map(rule => rule.ruleId);

    expect(rules.length).toBeGreaterThanOrEqual(13);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('secret-openai-key');
    expect(ids).toContain('sql-string-concat');
    expect(ids).toContain('path-traversal-change');
    expect(rules.every(rule => rule.enabledByDefault)).toBe(true);
  });

  it('detects hardcoded secrets in changed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-security-'));
    try {
      await writeProjectFile(root, 'src/config.ts', [
        'export const apiKey = "sk-1234567890abcdefghijklmnop";',
      ].join('\n'));

      const task = createTask('添加配置');
      addFileChange(task.id, {
        file: 'src/config.ts',
        intent: '添加配置',
        reasoning: '测试安全扫描',
        added: 1,
        removed: 0,
      });

      const issues = await scanTaskSecurity(root, task, defaultConfig(root, identity));
      const secretIssue = issues.find(issue => issue.category === 'secret' && issue.severity === 'high');

      expect(secretIssue).toBeTruthy();
      expect(secretIssue?.ruleId).toBe('secret-openai-key');
      expect(secretIssue?.severity).toBe(getSecurityRuleDefinition('secret-openai-key')?.severity);
      expect(secretIssue?.line).toBe(1);
      expect(secretIssue?.evidence).toContain('sk-***');
      expect(secretIssue?.evidence).not.toContain('1234567890abcdefghijklmnop');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects SQL string concatenation risks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-security-'));
    try {
      await writeProjectFile(root, 'src/user-repo.ts', [
        'export function findUser(db: any, userId: string) {',
        '  return db.query("select * from users where id = " + userId);',
        '}',
      ].join('\n'));

      const task = createTask('添加用户查询');
      addFileChange(task.id, {
        file: 'src/user-repo.ts',
        intent: '添加用户查询',
        reasoning: '测试 SQL 拼接扫描',
        added: 3,
        removed: 0,
      });

      const issues = await scanTaskSecurity(root, task, defaultConfig(root, identity));
      const sqlIssue = issues.find(issue => issue.category === 'sql-injection');

      expect(sqlIssue).toBeTruthy();
      expect(sqlIssue?.ruleId).toBe('sql-string-concat');
      expect(sqlIssue?.line).toBe(2);
      expect(sqlIssue?.evidence).toContain('select * from users');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects changed paths escaping the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-security-'));
    try {
      const task = createTask('尝试修改外部文件');
      addFileChange(task.id, {
        file: '../outside.txt',
        intent: '修改外部文件',
        reasoning: '测试路径逃逸',
        added: 1,
        removed: 0,
      });

      const issues = await scanTaskSecurity(root, task, defaultConfig(root, identity));

      expect(issues).toContainEqual(expect.objectContaining({
        category: 'sensitive-file',
        ruleId: 'path-traversal-change',
        severity: 'high',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not report dangerous command examples inside dangerousCommands config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-security-'));
    try {
      await writeProjectFile(root, 'src/config.ts', [
        'export const security = {',
        '  dangerousCommands: [',
        '    "rm -rf /",',
        '    "git push --force",',
        '    "DROP TABLE",',
        '  ],',
        '};',
      ].join('\n'));

      const task = createTask('更新安全配置');
      addFileChange(task.id, {
        file: 'src/config.ts',
        intent: '更新危险命令配置',
        reasoning: '配置数组中的危险命令样例用于拦截规则，不是待执行命令',
        added: 7,
        removed: 0,
      });

      const issues = await scanTaskSecurity(root, task, defaultConfig(root, identity));

      expect(issues.filter(issue => issue.category === 'dangerous-command')).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('extracts typed security issues from gate metadata', () => {
    const check: GateCheck = {
      name: '安全门禁',
      category: 'security',
      status: 'fail',
      detail: '1 个告警',
      metadata: {
        issues: [{
          file: 'src/config.ts',
          severity: 'high',
          category: 'secret',
          ruleId: 'secret-openai-key',
          line: 1,
          evidence: 'sk-***',
          message: '疑似硬编码密钥',
        }],
      },
    };

    const issues = getSecurityIssuesFromGateCheck(check);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('secret-openai-key');
    expect(issues[0].line).toBe(1);
  });

  it('respects disabled security rule ids from project config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-security-'));
    try {
      await writeProjectFile(root, 'src/config.ts', [
        'export const apiKey = "sk-1234567890abcdefghijklmnop";',
        'export const password = "super-secret-password";',
      ].join('\n'));

      const task = createTask('添加配置');
      addFileChange(task.id, {
        file: 'src/config.ts',
        intent: '添加配置',
        reasoning: '测试禁用规则',
        added: 2,
        removed: 0,
      });

      const config = disableSecurityRule(defaultConfig(root, identity), 'secret-openai-key');
      const issues = await scanTaskSecurity(root, task, config);

      expect(issues.some(issue => issue.ruleId === 'secret-openai-key')).toBe(false);
      expect(issues.some(issue => issue.ruleId === 'secret-hardcoded-credential')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
