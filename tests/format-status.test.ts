import { describe, expect, it } from 'vitest';
import {
  formatVerificationSummary,
  formatStageLine,
  formatPlannedCommands,
  formatGateSummary,
  hasVerifyInfo,
  hasSecurityBlocking,
} from '../src/cli/format.js';
import type { VerifyResult, StageResult, GateResult, VerifyStage } from '../src/types.js';

function makeStage(overrides: Partial<StageResult> = {}): StageResult {
  return {
    stage: 'compile',
    status: 'pass',
    output: 'OK',
    duration: 1200,
    command: 'npx tsc --noEmit',
    exitCode: 0,
    stdout: 'ok\n',
    stderr: '',
    ...overrides,
  };
}

function makeVerifyResult(stages: StageResult[], overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    stages,
    overall: 'pass',
    totalTests: 3,
    passedTests: 3,
    duration: 5000,
    attempts: 1,
    ...overrides,
  };
}

describe('formatVerificationSummary', () => {
  it('extracts stage name, status, duration, exitCode, command', () => {
    const vr = makeVerifyResult([
      makeStage({ stage: 'compile', status: 'pass', duration: 1200, exitCode: 0, command: 'npx tsc --noEmit' }),
    ]);
    const summary = formatVerificationSummary(vr);
    expect(summary.overall).toBe('pass');
    expect(summary.totalTests).toBe(3);
    expect(summary.attempts).toBe(1);

    const s = summary.stages[0];
    expect(s.stage).toBe('compile');
    expect(s.status).toBe('pass');
    expect(s.duration).toBe(1200);
    expect(s.exitCode).toBe(0);
    expect(s.command).toBe('npx tsc --noEmit');
    expect(s.errors).toEqual([]);
  });

  it('captures failed stage stderr as error lines', () => {
    const vr = makeVerifyResult([
      makeStage({
        stage: 'lint',
        status: 'fail',
        exitCode: 1,
        command: 'npx eslint .',
        stderr: 'error: unused variable\n  at line 42\nwarning: missing semicolon',
      }),
    ], { overall: 'fail' });
    const summary = formatVerificationSummary(vr);
    expect(summary.overall).toBe('fail');
    const s = summary.stages[0];
    expect(s.status).toBe('fail');
    expect(s.exitCode).toBe(1);
    expect(s.errors.length).toBe(2);
    expect(s.errors[0]).toContain('unused variable');
  });

  it('falls back to errorDetails when stderr is empty', () => {
    const vr = makeVerifyResult([
      makeStage({
        stage: 'unit-test',
        status: 'fail',
        exitCode: 2,
        stderr: '',
        errorDetails: '2 tests failed: login.test.ts',
      }),
    ]);
    const s = formatVerificationSummary(vr).stages[0];
    expect(s.errors.length).toBe(1);
    expect(s.errors[0]).toContain('login.test.ts');
  });

  it('handles multiple stages with mixed statuses', () => {
    const vr = makeVerifyResult([
      makeStage({ stage: 'compile', status: 'pass', exitCode: 0 }),
      makeStage({ stage: 'lint', status: 'fail', exitCode: 1, stderr: 'lint error' }),
      makeStage({ stage: 'unit-test', status: 'skipped', exitCode: null, command: '' }),
    ], { overall: 'fail' });
    const summary = formatVerificationSummary(vr);
    expect(summary.stages.length).toBe(3);
    expect(summary.stages[0].status).toBe('pass');
    expect(summary.stages[1].status).toBe('fail');
    expect(summary.stages[2].status).toBe('skipped');
  });

  it('limits error lines to 5', () => {
    const longStderr = Array.from({ length: 10 }, (_, i) => `error line ${i}`).join('\n');
    const s = formatStageLine(makeStage({ status: 'fail', stderr: longStderr }));
    expect(s.errors.length).toBeLessThanOrEqual(5);
  });
});

describe('formatPlannedCommands', () => {
  it('maps stages to resolved commands', () => {
    const stages: VerifyStage[] = ['compile', 'lint', 'unit-test'];
    const resolved = new Map<string, string | null>([
      ['compile', 'npm run -s build'],
      ['lint', 'npx eslint .'],
      ['unit-test', null],
    ]);
    const planned = formatPlannedCommands(stages, resolved);
    expect(planned).toHaveLength(3);
    expect(planned[0].command).toBe('npm run -s build');
    expect(planned[1].command).toBe('npx eslint .');
    expect(planned[2].command).toBeNull();
  });

  it('returns null commands for unresolved stages', () => {
    const stages: VerifyStage[] = ['compile', 'e2e'];
    const resolved = new Map<string, string | null>([['compile', 'tsc']]);
    const planned = formatPlannedCommands(stages, resolved);
    expect(planned[0].command).toBe('tsc');
    expect(planned[1].command).toBeNull();
  });
});

describe('formatGateSummary', () => {
  function makeGateCheck(overrides: Partial<GateResult['checks'][0]> = {}): GateResult['checks'][0] {
    return {
      name: '安全门禁',
      category: 'security',
      status: 'pass',
      detail: '无告警',
      ...overrides,
    };
  }

  it('reports passed security gate', () => {
    const gr: GateResult = {
      passed: true,
      checks: [makeGateCheck({ status: 'pass', detail: '无告警' })],
      blocking: [],
      suggestions: [],
    };
    const summary = formatGateSummary(gr);
    expect(summary.passed).toBe(true);
    expect(summary.blockingCount).toBe(0);
    expect(summary.security!.status).toBe('pass');
    expect(summary.security!.issues).toEqual([]);
  });

  it('reports failed security gate with issues', () => {
    const gr: GateResult = {
      passed: false,
      checks: [
        makeGateCheck({
          status: 'fail',
          detail: '2 个告警',
          suggestion: 'src/config.ts — 危险命令\nsrc/auth.ts — SQL 拼接',
          metadata: {
            issues: [
              { ruleId: 'danger-rm-rf-root', file: 'src/config.ts', line: 1 },
              { ruleId: 'sql-string-concat', file: 'src/auth.ts', line: 2 },
            ],
          },
        }),
      ],
      blocking: [
        { name: '安全门禁', category: 'security', status: 'fail', detail: '2 个告警', suggestion: 'danger' },
      ],
      suggestions: [],
    };
    const summary = formatGateSummary(gr);
    expect(summary.passed).toBe(false);
    expect(summary.blockingCount).toBe(1);
    expect(summary.security!.status).toBe('fail');
    expect(summary.security!.issues.length).toBe(2);
    expect(summary.security!.issues[0]).toContain('src/config.ts');
    expect(summary.security!.structuredIssues.length).toBe(2);
    expect(summary.security!.structuredIssues[0]).toMatchObject({ ruleId: 'danger-rm-rf-root' });
    expect(summary.security!.structuredIssues[0].file).toBe('src/config.ts');
  });

  it('returns null security when no security check exists', () => {
    const gr: GateResult = {
      passed: true,
      checks: [{ name: '测试门禁', category: 'test', status: 'pass', detail: 'OK' }],
      blocking: [],
      suggestions: [],
    };
    const summary = formatGateSummary(gr);
    expect(summary.security).toBeNull();
  });
});

describe('helpers', () => {
  it('hasVerifyInfo true when stages exist', () => {
    const vr = makeVerifyResult([makeStage()]);
    expect(hasVerifyInfo(vr)).toBe(true);
  });

  it('hasVerifyInfo false when no stages', () => {
    const vr = makeVerifyResult([]);
    expect(hasVerifyInfo(vr)).toBe(false);
  });

  it('hasSecurityBlocking true when security check fails', () => {
    const gr: GateResult = {
      passed: false,
      checks: [{ name: '安全门禁', category: 'security', status: 'fail', detail: 'alert' }],
      blocking: [{ name: '安全门禁', category: 'security', status: 'fail', detail: 'alert' }],
      suggestions: [],
    };
    expect(hasSecurityBlocking(gr)).toBe(true);
  });

  it('hasSecurityBlocking false when security passes', () => {
    const gr: GateResult = {
      passed: true,
      checks: [{ name: '安全门禁', category: 'security', status: 'pass', detail: '无告警' }],
      blocking: [],
      suggestions: [],
    };
    expect(hasSecurityBlocking(gr)).toBe(false);
  });
});

// Security rules display format tests
import {
  disableSecurityRule,
  enableSecurityRule,
  defaultConfig,
} from '../src/config.js';

describe('security rules config', () => {
  // Build a minimal config for testing
  function makeTestConfig(): ReturnType<typeof defaultConfig> {
    return {
      version: '0.1.0',
      project: { name: 'test', rootPath: '/tmp/test', identity: { language: 'typescript', framework: 'unknown', database: 'unknown', buildSystem: 'npm', testFramework: 'vitest', runtime: 'Node.js', deploymentType: 'unknown', packageManager: 'npm', languageVersion: '5.0' } },
      ai: { provider: 'mock', model: 'mock-offline', maxTokens: 10000, temperature: 0.3 },
      execution: { defaultMode: 'preview', maxRetries: 3, maxParallelTasks: 3, verifyStages: ['compile', 'lint'] },
      security: { sensitiveFiles: [], dangerousCommands: [], allowGitPush: false, disabledRules: [] },
      skills: { enabled: [], autoGenerated: false },
      memory: { maxProjectMemory: 10240, maxGlobalMemory: 51200, autoCompressThreshold: 50 },
    };
  }

  it('disableSecurityRule adds rule to disabledRules', () => {
    const config = makeTestConfig();
    disableSecurityRule(config, 'secret-openai-key');
    expect(config.security.disabledRules).toContain('secret-openai-key');
    expect(config.security.disabledRules).toHaveLength(1);
  });

  it('disableSecurityRule does not duplicate', () => {
    const config = makeTestConfig();
    disableSecurityRule(config, 'secret-openai-key');
    disableSecurityRule(config, 'secret-openai-key');
    expect(config.security.disabledRules).toHaveLength(1);
  });

  it('enableSecurityRule removes rule from disabledRules', () => {
    const config = makeTestConfig();
    disableSecurityRule(config, 'secret-openai-key');
    disableSecurityRule(config, 'danger-rm-rf-root');
    enableSecurityRule(config, 'secret-openai-key');
    expect(config.security.disabledRules).toContain('danger-rm-rf-root');
    expect(config.security.disabledRules).not.toContain('secret-openai-key');
    expect(config.security.disabledRules).toHaveLength(1);
  });

  it('enableSecurityRule on non-disabled rule is no-op', () => {
    const config = makeTestConfig();
    enableSecurityRule(config, 'nonexistent-rule');
    expect(config.security.disabledRules).toHaveLength(0);
  });
});

describe('formatGateSummary structured issues', () => {
  it('returns structuredIssues from metadata', () => {
    const gr: GateResult = {
      passed: false,
      checks: [{
        name: '安全门禁',
        category: 'security',
        status: 'fail',
        detail: '3 个告警',
        suggestion: 'old-format',
        metadata: {
          issues: [
            { file: 'src/auth.ts', line: 42, severity: 'high' as const, category: 'sql-injection' as const, ruleId: 'sql-string-concat', evidence: 'query = "SELECT * FROM users WHERE id=" + id', message: '使用参数化查询避免 SQL 注入' },
            { file: 'src/config.ts', line: 10, severity: 'medium' as const, category: 'secret' as const, ruleId: 'secret-openai-key', evidence: 'sk-...abc123', message: '硬编码 API Key' },
          ],
        },
      }],
      blocking: [{ name: '安全门禁', category: 'security', status: 'fail', detail: '3 个告警' }],
      suggestions: [],
    };
    const gs = formatGateSummary(gr);
    expect(gs.security).not.toBeNull();
    expect(gs.security!.structuredIssues).toHaveLength(2);
    expect(gs.security!.structuredIssues[0]).toMatchObject({
      file: 'src/auth.ts',
      line: 42,
      severity: 'high',
      ruleId: 'sql-string-concat',
    });
    // Evidence should be included
    expect(gs.security!.structuredIssues[0].evidence).toContain('SELECT');
    // Message should be included
    expect(gs.security!.structuredIssues[1].message).toContain('API Key');
  });

  it('falls back to suggestion text when no structured issues', () => {
    const gr: GateResult = {
      passed: false,
      checks: [{
        name: '安全门禁',
        category: 'security',
        status: 'fail',
        detail: '2 个告警',
        suggestion: 'src/auth.ts — SQL 拼接\nsrc/config.ts — 硬编码密钥',
      }],
      blocking: [{ name: '安全门禁', category: 'security', status: 'fail', detail: '2 个告警' }],
      suggestions: [],
    };
    const gs = formatGateSummary(gr);
    expect(gs.security!.structuredIssues).toHaveLength(0);
    expect(gs.security!.issues).toHaveLength(2);
    expect(gs.security!.issues[0]).toContain('src/auth.ts');
  });
});

// Security rule registry validation
import { getSecurityRuleDefinitions, getSecurityRuleDefinition } from '../src/core/security.js';

describe('security rule registry', () => {
  it('getSecurityRuleDefinitions returns all rules', () => {
    const rules = getSecurityRuleDefinitions();
    expect(rules.length).toBeGreaterThanOrEqual(13);
    for (const r of rules) {
      expect(r.ruleId).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(r.severity).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(typeof r.enabledByDefault).toBe('boolean');
    }
  });

  it('getSecurityRuleDefinition finds known rules', () => {
    expect(getSecurityRuleDefinition('secret-openai-key')).toBeDefined();
    expect(getSecurityRuleDefinition('danger-rm-rf-root')!.severity).toBe('high');
    expect(getSecurityRuleDefinition('sql-string-concat')!.category).toBe('sql-injection');
  });

  it('getSecurityRuleDefinition returns undefined for unknown rule', () => {
    expect(getSecurityRuleDefinition('nonexistent-rule')).toBeUndefined();
  });

  it('validate unknown ruleId is rejected', () => {
    const knownRules = new Set(getSecurityRuleDefinitions().map(r => r.ruleId));
    expect(knownRules.has('secret-openai-key')).toBe(true);
    expect(knownRules.has('made-up-fake-rule')).toBe(false);
  });
});
