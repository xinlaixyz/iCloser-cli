import { mkdir, mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { createTask, addFileChange, addReasoning, setVerifyResult, updateTaskStatus } from '../src/core/task-engine.js';
import { loadProjectMemory, recordTask, saveProjectMemory } from '../src/core/memory.js';
import { runGateCheck } from '../src/gate/checker.js';
import { generateReasoningFile, generateTaskReport, generateVerifyLog } from '../src/report/generator.js';
import { writeFile } from '../src/utils/fs.js';
import type { ProjectIdentity, VerifyResult } from '../src/types.js';

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

const passingVerifyResult: VerifyResult = {
  overall: 'pass',
  totalTests: 2,
  passedTests: 2,
  duration: 1234,
  attempts: 1,
  stages: [
    { stage: 'compile', status: 'pass', output: 'tsc passed', duration: 500 },
    { stage: 'unit-test', status: 'pass', output: '2 tests passed', duration: 734 },
  ],
};

function attachCompletedTaskData(taskId: string) {
  addFileChange(taskId, {
    file: 'src/hello.ts',
    intent: '添加离线验收标记',
    reasoning: '用于验证 gate 和 report 的离线闭环',
    added: 1,
    removed: 0,
  });
  addReasoning(taskId, {
    file: 'src/hello.ts',
    intent: '添加离线验收标记',
    reasoning: '修改单个低风险文件，不影响外部接口',
    impact: { directlyAffected: ['src/hello.ts'], indirectlyAffected: [], notAffected: ['package.json'] },
    riskLevel: 'low',
  });
  setVerifyResult(taskId, passingVerifyResult);
  updateTaskStatus(taskId, 'completed');
}

describe('report and gate', () => {
  it('blocks delivery when verification has not run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-gate-'));
    try {
      const config = defaultConfig(root, identity);
      const task = createTask('修改 src/hello.ts 添加离线验收标记');
      task.plan = {
        affectedFiles: ['src/hello.ts'],
        dependencies: [],
        estimatedImpact: 'low',
        lockedFiles: ['src/hello.ts'],
        subGoals: [{ id: 'g1', description: '修改目标文件', files: ['src/hello.ts'], status: 'done' }],
      };
      addFileChange(task.id, {
        file: 'src/hello.ts',
        intent: '添加离线验收标记',
        reasoning: '测试未验证门禁',
        added: 1,
        removed: 0,
      });

      const gate = await runGateCheck(root, task, config);

      expect(gate.passed).toBe(false);
      expect(gate.blocking.some(c => c.category === 'test' && c.status === 'pending')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires generated report artifacts before passing delivery gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-gate-'));
    try {
      const config = defaultConfig(root, identity);
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = "world";\n');

      const task = createTask('修改 src/hello.ts 添加离线验收标记');
      task.plan = {
        affectedFiles: ['src/hello.ts'],
        dependencies: [],
        estimatedImpact: 'low',
        lockedFiles: ['src/hello.ts'],
        subGoals: [{ id: 'g1', description: '修改目标文件', files: ['src/hello.ts'], status: 'done' }],
      };
      attachCompletedTaskData(task.id);

      const missingArtifacts = await runGateCheck(root, task, config);
      expect(missingArtifacts.passed).toBe(false);
      expect(missingArtifacts.blocking.some(c => c.category === 'report')).toBe(true);

      await generateTaskReport(root, task, config);
      await generateReasoningFile(root, task);
      await generateVerifyLog(root, task);

      const ready = await runGateCheck(root, task, config);
      expect(ready.passed).toBe(true);
      expect(ready.checks.find(c => c.category === 'report')?.status).toBe('pass');
      expect(ready.prDescription).toContain('离线验收标记');
      expect(ready.commitMessage).toContain(`Task: ${task.id}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes task memory candidates and proposed template in task report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-report-memory-'));
    try {
      const config = defaultConfig(root, identity);
      const task = createTask('创建 docs/PRD.md 产品需求文档');
      task.plan = {
        affectedFiles: ['docs/PRD.md'],
        dependencies: [],
        estimatedImpact: 'low',
        lockedFiles: ['docs/PRD.md'],
        subGoals: [{ id: 'g1', description: '生成 PRD 文档', files: ['docs/PRD.md'], status: 'done' }],
      };
      addFileChange(task.id, {
        file: 'docs/PRD.md',
        intent: '生成产品需求文档',
        reasoning: '根据项目结构沉淀初版 PRD',
        added: 80,
        removed: 0,
      });
      addReasoning(task.id, {
        file: 'docs/PRD.md',
        intent: '生成产品需求文档',
        reasoning: '文档变更低风险，可复用为文档生成模板',
        impact: { directlyAffected: ['docs/PRD.md'], indirectlyAffected: [], notAffected: [] },
        riskLevel: 'low',
      });
      setVerifyResult(task.id, passingVerifyResult);
      updateTaskStatus(task.id, 'completed');

      let memory = await loadProjectMemory(root);
      memory = await recordTask(memory, task, identity);
      await saveProjectMemory(root, memory);

      const report = await generateTaskReport(root, task, config);

      expect(report).toContain('## 任务记忆候选');
      expect(report).toContain('模板');
      expect(report).toContain('待确认');
      expect(report).toContain('流程模板：创建 docs/PRD.md 产品需求文档');
      expect(report).toContain('ic mem review');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes command, exit code, stdout and stderr into verify.log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-report-'));
    try {
      const task = createTask('记录验证日志细节');
      task.verifyResult = {
        overall: 'fail',
        totalTests: 0,
        passedTests: 0,
        duration: 25,
        attempts: 1,
        stages: [{
          stage: 'compile',
          status: 'fail',
          output: '编译失败',
          duration: 25,
          command: 'npm run -s build',
          exitCode: 2,
          stdout: 'stdout line',
          stderr: 'stderr line',
          errorDetails: 'exitCode: 2\n\nstderr:\nstderr line',
        }],
      };

      const logPath = await generateVerifyLog(root, task);
      const log = await readFile(logPath, 'utf-8');

      expect(log).toContain('命令: npm run -s build');
      expect(log).toContain('退出码: 2');
      expect(log).toContain('--- stdout ---');
      expect(log).toContain('stdout line');
      expect(log).toContain('--- stderr ---');
      expect(log).toContain('stderr line');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks gate when changed file contains hardcoded secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-gate-security-'));
    try {
      const config = defaultConfig(root, identity);
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src', 'config.ts'),
        'export const apiKey = "sk-1234567890abcdefghijklmnop";\n',
      );

      const task = createTask('添加配置');
      task.plan = {
        affectedFiles: ['src/config.ts'],
        dependencies: [],
        estimatedImpact: 'low',
        lockedFiles: ['src/config.ts'],
        subGoals: [{ id: 'g1', description: '修改配置', files: ['src/config.ts'], status: 'done' }],
      };
      addFileChange(task.id, {
        file: 'src/config.ts',
        intent: '添加配置',
        reasoning: '测试安全门禁',
        added: 1,
        removed: 0,
      });
      addReasoning(task.id, {
        file: 'src/config.ts',
        intent: '添加配置',
        reasoning: '测试安全门禁',
        impact: { directlyAffected: ['src/config.ts'], indirectlyAffected: [], notAffected: [] },
        riskLevel: 'low',
      });
      setVerifyResult(task.id, passingVerifyResult);
      updateTaskStatus(task.id, 'completed');
      await generateTaskReport(root, task, config);
      await generateReasoningFile(root, task);
      await generateVerifyLog(root, task);

      const gate = await runGateCheck(root, task, config);

      expect(gate.passed).toBe(false);
      expect(gate.blocking.some(c => c.category === 'security')).toBe(true);
      const suggestion = gate.blocking.find(c => c.category === 'security')?.suggestion || '';
      expect(suggestion).toContain('src/config.ts:1 [secret-openai-key/high]');
      expect(suggestion).toContain('疑似硬编码密钥');
      expect(suggestion).toContain('sk-***');
      expect(suggestion).not.toContain('1234567890abcdefghijklmnop');

      const securityCheck = gate.blocking.find(c => c.category === 'security');
      const issues = securityCheck?.metadata?.issues as Array<{ ruleId: string; line: number; evidence: string }> | undefined;
      expect(issues?.[0]).toMatchObject({
        ruleId: 'secret-openai-key',
        line: 1,
      });
      expect(issues?.[0].evidence).toContain('sk-***');

      task.gateResult = gate;
      const report = await generateTaskReport(root, task, config);
      expect(report).toContain('安全问题');
      expect(report).toContain('`src/config.ts:1` [secret-openai-key/high]');
      expect(report).toContain('sk-***');
      expect(report).not.toContain('1234567890abcdefghijklmnop');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
