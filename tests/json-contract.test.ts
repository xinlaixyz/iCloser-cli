import { describe, expect, it } from 'vitest';
import {
  JSON_CONTRACT_VERSION,
  jsonEnvelope,
  serializeGateResult,
  serializeConfig,
  serializeSecurityRules,
  serializeTask,
  serializeTaskList,
} from '../src/cli/json.js';
import type { GateResult, ICloserConfig, SecurityRuleDefinition, Task } from '../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-123',
    description: 'update docs',
    status: 'completed',
    priority: 'normal',
    createdAt: '2026-05-12T10:00:00.000Z',
    startedAt: '2026-05-12T10:01:00.000Z',
    completedAt: '2026-05-12T10:02:00.000Z',
    changes: [{ file: 'README.md', intent: 'docs', reasoning: 'requested', added: 2, removed: 0 }],
    diffs: [],
    reasoning: [],
    errorLog: [],
    retryCount: 0,
    maxRetries: 3,
    verifyResult: {
      overall: 'pass',
      stages: [{
        stage: 'compile',
        status: 'pass',
        output: 'ok',
        duration: 100,
        command: 'npm run build',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      }],
      totalTests: 1,
      passedTests: 1,
      duration: 100,
      attempts: 1,
    },
    ...overrides,
  };
}

describe('json contract envelope', () => {
  it('wraps payloads with a stable contract version and kind', () => {
    const out = jsonEnvelope('task', { id: 'task-123' });
    expect(out).toEqual({
      version: JSON_CONTRACT_VERSION,
      kind: 'task',
      data: { id: 'task-123' },
    });
  });
});

describe('serializeTask', () => {
  it('returns stable task fields with formatted verify and gate summaries', () => {
    const task = makeTask({
      gateResult: {
        passed: true,
        checks: [{ name: '安全门禁', category: 'security', status: 'pass', detail: '无告警' }],
        blocking: [],
        suggestions: [],
      },
    });

    const out = serializeTask(task);
    expect(out).toMatchObject({
      id: 'task-123',
      description: 'update docs',
      status: 'completed',
      priority: 'normal',
      retryCount: 0,
      maxRetries: 3,
      reportPath: null,
    });
    expect(out.verify?.overall).toBe('pass');
    expect(out.verify?.stages[0]).toMatchObject({
      stage: 'compile',
      command: 'npm run build',
      exitCode: 0,
    });
    expect(out.gate?.passed).toBe(true);
    expect(out.gate?.security?.status).toBe('pass');
  });

  it('serializes task lists without changing order', () => {
    const out = serializeTaskList([
      makeTask({ id: 'task-a' }),
      makeTask({ id: 'task-b' }),
    ]);
    expect(out.tasks.map(t => t.id)).toEqual(['task-a', 'task-b']);
  });
});

describe('serializeGateResult', () => {
  it('includes structured security issues in the stable gate payload', () => {
    const result: GateResult = {
      passed: false,
      checks: [{
        name: '安全门禁',
        category: 'security',
        status: 'fail',
        detail: '1 个告警',
        metadata: {
          issues: [{
            file: 'src/auth.ts',
            line: 12,
            severity: 'high',
            category: 'sql-injection',
            ruleId: 'sql-string-concat',
            evidence: 'SELECT ' + 'id',
            message: '使用参数化查询',
          }],
        },
      }],
      blocking: [{ name: '安全门禁', category: 'security', status: 'fail', detail: '1 个告警' }],
      suggestions: [],
      commitMessage: 'fix: task',
    };

    const out = serializeGateResult(result);
    expect(out.passed).toBe(false);
    expect(out.blockingCount).toBe(1);
    expect(out.commitMessage).toBe('fix: task');
    expect(out.prDescription).toBeNull();
    expect(out.security?.structuredIssues[0]).toMatchObject({
      file: 'src/auth.ts',
      line: 12,
      ruleId: 'sql-string-concat',
      severity: 'high',
    });
  });
});

describe('serializeSecurityRules', () => {
  it('marks disabled rules while preserving registry metadata', () => {
    const rules: SecurityRuleDefinition[] = [{
      ruleId: 'secret-openai-key',
      category: 'secret',
      severity: 'high',
      name: 'OpenAI API Key',
      description: '检测疑似 OpenAI API Key 硬编码',
      enabledByDefault: true,
    }];

    const out = serializeSecurityRules(rules, ['secret-openai-key']);
    expect(out.disabledRules).toEqual(['secret-openai-key']);
    expect(out.rules[0]).toMatchObject({
      ruleId: 'secret-openai-key',
      category: 'secret',
      severity: 'high',
      enabled: false,
    });
  });
});

describe('serializeConfig', () => {
  it('returns a public config summary without exposing apiKey', () => {
    const config: ICloserConfig = {
      version: '0.1.0',
      project: {
        name: 'demo',
        rootPath: '/tmp/demo',
        identity: {
          language: 'typescript',
          framework: 'unknown',
          database: 'unknown',
          buildSystem: 'npm',
          testFramework: 'vitest',
          runtime: 'node',
          deploymentType: 'unknown',
          packageManager: 'npm',
          languageVersion: '5.0',
        },
      },
      ai: {
        provider: 'mock',
        model: 'mock-offline',
        apiKey: 'secret',
        maxTokens: 1000,
        temperature: 0,
      },
      execution: {
        defaultMode: 'preview',
        maxRetries: 3,
        maxParallelTasks: 3,
        verifyStages: ['compile', 'lint'],
      },
      security: {
        sensitiveFiles: ['.env'],
        dangerousCommands: ['rm -rf /'],
        disabledRules: ['secret-openai-key'],
        allowGitPush: false,
      },
      skills: {
        enabled: ['project-index'],
        autoGenerated: true,
      },
      memory: {
        maxProjectMemory: 1024,
        maxGlobalMemory: 2048,
        autoCompressThreshold: 50,
      },
    };

    const out = serializeConfig(config);
    expect(out.project.name).toBe('demo');
    expect(out.ai.provider).toBe('mock');
    expect(out.ai.ready).toBe(true);
    expect(out.security.disabledRuleCount).toBe(1);
    expect(JSON.stringify(out)).not.toContain('"apiKey":"secret"');
    expect(JSON.stringify(out)).not.toContain('apiKey');
  });
});
