import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { createTask } from '../src/core/task-engine.js';
import { resolveVerificationCommand, runVerification } from '../src/core/verifier.js';
import type { ProjectIdentity } from '../src/types.js';

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

describe('verifier', () => {
  it('prefers package.json scripts for compile and unit-test stages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        scripts: {
          build: 'node -e "console.log(\'build ok\')"',
          test: 'node -e "console.log(\'Tests  2 passed (2)\')"',
        },
      }));

      const result = await runVerification(root, identity, createTask('验证 scripts 优先'), {
        stages: ['compile', 'unit-test'],
        maxRetries: 1,
        timeout: 20000,
      });

      expect(result.overall).toBe('pass');
      expect(result.totalTests).toBe(2);
      expect(result.passedTests).toBe(2);
      expect(result.stages[0].output).toContain('npm run build');
      expect(result.stages[1].output).toContain('npm run test');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails fast on a failing project script and skips following stages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        scripts: {
          build: 'node -e "console.error(\'build failed\'); process.exit(2)"',
          test: 'node -e "console.log(\'should not run\')"',
        },
      }));

      const result = await runVerification(root, identity, createTask('验证失败脚本'), {
        stages: ['compile', 'unit-test'],
        maxRetries: 1,
        timeout: 20000,
      });

      const failStage = result.stages.find(s => s.status === 'fail');
      expect(result.overall).toBe('fail');
      expect(failStage).toBeDefined();
      expect(failStage!.command).toBe('npm run -s build');
      expect(failStage!.exitCode).toBe(2);
      expect(failStage!.stderr).toContain('build failed');
      expect(failStage!.errorDetails).toContain('build failed');
      expect(result.stages.some(s => s.status === 'skipped')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds beginner dependency guidance when project scripts miss local tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        scripts: {
          build: 'node -e "console.error(\'tsc is not recognized as an internal or external command\'); process.exit(1)"',
        },
      }));

      const result = await runVerification(root, identity, createTask('验证缺少依赖提示'), {
        stages: ['compile'],
        maxRetries: 1,
        timeout: 20000,
      });

      const failStage = result.stages.find(s => s.status === 'fail');
      expect(result.overall).toBe('fail');
      expect(failStage).toBeDefined();
      expect(failStage!.errorDetails || '').toContain('新手提示');
      expect(failStage!.errorDetails || '').toContain('npm install');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds non-watch args for vitest scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        scripts: { test: 'vitest --coverage' },
      }));

      const command = await resolveVerificationCommand(root, identity, 'unit-test');

      expect(command?.command).toBe('npm run -s test -- --run');
      expect(command?.label).toContain('npm run test --run');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back from interactive e2e scripts to built-in CI commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({
        scripts: { 'test:e2e': 'cypress open' },
      }));

      const command = await resolveVerificationCommand(root, identity, 'e2e');

      expect(command?.command).toContain('cypress run');
      expect(command?.label).toContain('normalized from npm run test:e2e');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips TypeScript fallback compile when tsc is not installed locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({ scripts: {} }));
      await writeProjectFile(root, 'tsconfig.json', JSON.stringify({
        compilerOptions: { target: 'ES2022' },
      }));

      const command = await resolveVerificationCommand(root, identity, 'compile');

      expect(command).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips JavaScript lint fallback when eslint is not installed locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-verifier-'));
    const jsIdentity: ProjectIdentity = { ...identity, language: 'javascript', testFramework: 'unknown' };
    try {
      await writeProjectFile(root, 'package.json', JSON.stringify({ scripts: {} }));
      await writeProjectFile(root, 'eslint.config.js', 'export default [];');

      const command = await resolveVerificationCommand(root, jsIdentity, 'lint');

      expect(command).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
