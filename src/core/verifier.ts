// Verification Engine — compile, lint, test with auto-repair loop
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  VerifyResult, VerifyStage, StageResult, ProjectIdentity, Task,
} from '../types.js';
import { fileExists, readJson, readFile } from '../utils/fs.js';

export interface VerifyOptions {
  stages: VerifyStage[];
  maxRetries: number;
  timeout: number;       // ms per stage
  onProgress?: (stage: VerifyStage, status: 'running' | 'pass' | 'fail' | 'skipped', detail?: string, durationMs?: number) => void;
}

// ============================================================
// Main verification pipeline
// ============================================================
export async function runVerification(
  rootPath: string,
  identity: ProjectIdentity,
  task: Task,
  options: VerifyOptions
): Promise<VerifyResult> {
  const startTime = Date.now();
  const stageResults: StageResult[] = [];
  let attempts = 0;
  let allPassed = false;

  for (attempts = 1; attempts <= options.maxRetries; attempts++) {
    stageResults.length = 0;
    allPassed = true;

    // T9: Parallelize compile + lint (independent stages that can run concurrently)
    const stages = options.stages;
    let idx = 0;

    while (idx < stages.length) {
      const stage = stages[idx];

      // Parallel group: compile + lint can run together
      const canParallelize = stage === 'compile' && stages[idx + 1] === 'lint';
      if (canParallelize) {
        options.onProgress?.('compile', 'running', '并行执行 compile + lint', undefined);
        options.onProgress?.('lint', 'running', undefined, undefined);
        const [compileResult, lintResult] = await Promise.all([
          runStage(rootPath, identity, 'compile', options.timeout, options.onProgress),
          runStage(rootPath, identity, 'lint', options.timeout, options.onProgress),
        ]);
        idx += 2;

        const parallelResults = [compileResult, lintResult];
        const failed = parallelResults.filter(r => r.status === 'fail');

        if (failed.length > 0) {
          allPassed = false;
          if (attempts === options.maxRetries) {
            stageResults.push(...parallelResults);
            for (let i = idx; i < stages.length; i++) {
              stageResults.push({ stage: stages[i], status: 'skipped', output: '前序阶段失败，跳过', duration: 0 });
            }
            idx = stages.length;
            break;
          }

          // Try to repair each failed stage
          for (const result of failed) {
            const repaired = await attemptStageRepair(rootPath, identity, result.stage as VerifyStage, result, options.timeout, options.onProgress);
            if (!repaired) {
              stageResults.push(...parallelResults.filter(r => r.stage !== result.stage));
              stageResults.push(result);
              for (let i = idx; i < stages.length; i++) {
                stageResults.push({ stage: stages[i], status: 'skipped', output: '前序阶段失败，跳过', duration: 0 });
              }
              idx = stages.length;
              break;
            }
          }

          if (idx < stages.length) {
            stageResults.push(...parallelResults);
          }
        } else {
          stageResults.push(compileResult, lintResult);
        }
        continue;
      }

      // Serial stage execution
      const result = await runStage(rootPath, identity, stage, options.timeout, options.onProgress);
      idx++;

      if (result.status === 'fail') {
        allPassed = false;

        if (attempts === options.maxRetries) {
          stageResults.push(result);
          for (let i = idx; i < stages.length; i++) {
            stageResults.push({ stage: stages[i], status: 'skipped', output: '前序阶段失败，跳过', duration: 0 });
          }
          break;
        }

        const repaired = await attemptStageRepair(rootPath, identity, stage, result, options.timeout, options.onProgress);
        stageResults.push(result);
        if (!repaired) break;
        allPassed = true;
      } else {
        stageResults.push(result);
      }
    }

    if (allPassed) break;
  }

  const totalTests = countTotalTests(stageResults);
  const passedTests = countPassedTests(stageResults);

  // S19: Collect test coverage from standard coverage output
  let coverage: import('../types.js').CoverageResult | undefined;
  try {
    coverage = await collectCoverage(rootPath, identity);
  } catch { /* coverage is optional */ }

  return {
    stages: stageResults,
    overall: allPassed ? 'pass' : 'fail',
    totalTests,
    passedTests,
    coverage,
    duration: Date.now() - startTime,
    attempts,
    errorSummary: !allPassed
      ? stageResults.filter(s => s.status === 'fail').map(s => `${s.stage}: ${s.errorDetails}`).join('; ')
      : undefined,
  };
}

// ============================================================
// Auto-repair logic (shared across serial and parallel execution)
// ============================================================
async function attemptStageRepair(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage,
  result: StageResult,
  timeout: number,
  onProgress?: (stage: VerifyStage, status: 'running' | 'pass' | 'fail' | 'skipped', detail?: string, durationMs?: number) => void,
): Promise<boolean> {
  let repairAttempts = 0;
  while (repairAttempts < 2) {
    repairAttempts++;
    try {
      const errorText = result.output + (result.errorDetails || result.stderr || '');
      const { parseErrorOutput } = await import('./code-writer.js');
      const errors = parseErrorOutput(errorText);
      if (errors.length === 0) break;

      const fileContents: Record<string, string> = {};
      const reads = errors.slice(0, 3).map(async (e) => {
        try { fileContents[e.file] = await readFile(path.join(rootPath, e.file)); } catch { /* best-effort */ }
      });
      await Promise.all(reads);
      if (Object.keys(fileContents).length === 0) break;

      const { loadConfig } = await import('../config.js');
      const config = await loadConfig(rootPath);
      if (!config || config.ai.provider === 'mock') break;

      const { createProvider } = await import('../ai/provider.js');
      const ai = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
      const filesBlock = Object.entries(fileContents).map(([f, c]) => `### ${f}\n${c.slice(0, 2000)}`).join('\n\n');

      const resp = await ai.chat({
        systemPrompt: '你是代码修复专家。输出JSON变更契约。只修改报错行，不改任何无关代码。',
        task: `修复${stage}阶段错误:\n${errorText.slice(0, 2000)}\n\n错误位置:\n${errors.map(e => `  ${e.file}:${e.line} - ${e.message}`).join('\n')}\n\n${filesBlock}`,
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
      });

      const j = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
      const changes = j.changes || [];
      if (changes.length === 0) break;

      const { writeFile, ensureDir } = await import('../utils/fs.js');
      for (const c of changes) {
        if (c.file && c.content) {
          const fp = path.join(rootPath, c.file);
          await ensureDir(path.dirname(fp));
          await writeFile(fp, c.content);
        }
      }

      const retryResult = await runStage(rootPath, identity, stage, timeout, onProgress);
      if (retryResult.status !== 'fail') {
        result.status = retryResult.status;
        result.output = retryResult.output;
        result.errorDetails = retryResult.errorDetails;
        return true;
      }
      result.output += `\n[修复尝试${repairAttempts}失败]`;
    } catch (repairErr) {
      result.output += `\n[修复异常: ${(repairErr as Error).message.slice(0, 100)}]`;
      return false;
    }
  }
  return false;
}

// ============================================================
// Stage execution
// ============================================================
async function runStage(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage,
  timeout: number,
  onProgress?: (stage: VerifyStage, status: 'running' | 'pass' | 'fail' | 'skipped', detail?: string, durationMs?: number) => void,
): Promise<StageResult> {
  const startTime = Date.now();
  onProgress?.(stage, 'running', undefined);

  let result: StageResult;
  switch (stage) {
    case 'compile':
      result = await runCompile(rootPath, identity, timeout, startTime); break;
    case 'lint':
      result = await runLint(rootPath, identity, timeout, startTime); break;
    case 'unit-test':
      result = await runUnitTest(rootPath, identity, timeout, startTime); break;
    case 'integration-test':
      result = await runIntegrationTest(rootPath, identity, timeout, startTime); break;
    case 'e2e':
      result = await runE2E(rootPath, identity, timeout, startTime); break;
    case 'coverage':
      result = await runCoverageStage(rootPath, identity, timeout, startTime); break;
    default:
      result = { stage, status: 'skipped', output: '未知验证阶段', duration: 0 };
  }

  const detail = result.status === 'pass' ? result.output : result.errorDetails?.slice(0, 80) || result.output;
  onProgress?.(stage, result.status === 'fail' ? 'fail' : result.status === 'skipped' ? 'skipped' : 'pass', detail, result.duration);
  return result;
}

// ============================================================
// Compile check
// ============================================================
async function runCompile(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  let resolved: ResolvedCommand | null = null;
  try {
    resolved = await resolveStageCommand(rootPath, identity, 'compile');
    if (!resolved) {
      return {
        stage: 'compile',
        status: 'skipped',
        output: `${identity.language} 项目无需编译检查`,
        duration: Date.now() - startTime,
      };
    }

    const stdout = execSync(resolved.command, {
      cwd: rootPath,
      timeout,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return {
      stage: 'compile',
      status: 'pass',
      output: `${resolved.label} 通过`,
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout,
    };
  } catch (err) {
    const error = normalizeExecError(err);
    return {
      stage: 'compile',
      status: 'fail',
      output: '编译失败',
      duration: Date.now() - startTime,
      command: resolved?.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

// ============================================================
// Lint check
// ============================================================
async function runLint(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  let resolved: ResolvedCommand | null = null;
  try {
    resolved = await resolveStageCommand(rootPath, identity, 'lint');
    if (!resolved) {
      return {
        stage: 'lint',
        status: 'skipped',
        output: '无 lint 配置',
        duration: Date.now() - startTime,
      };
    }

    const stdout = execSync(resolved.command, {
      cwd: rootPath,
      timeout,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return {
      stage: 'lint',
      status: 'pass',
      output: `${resolved.label} 通过`,
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout,
    };
  } catch (err) {
    const error = normalizeExecError(err);
    return {
      stage: 'lint',
      status: 'fail',
      output: 'Lint 检查发现问题',
      duration: Date.now() - startTime,
      command: resolved?.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

// ============================================================
// Unit test
// ============================================================
async function runUnitTest(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  let resolved: ResolvedCommand | null = null;
  try {
    resolved = await resolveStageCommand(rootPath, identity, 'unit-test');
    if (!resolved) {
      return {
        stage: 'unit-test',
        status: 'skipped',
        output: '无测试配置',
        duration: Date.now() - startTime,
      };
    }

    const stdout = execSync(resolved.command, {
      cwd: rootPath,
      timeout: Math.max(timeout, 120000),
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    // Parse test counts
    const { total, passed } = parseTestOutput(stdout, identity.language);

    return {
      stage: 'unit-test',
      status: 'pass',
      output: `${passed}/${total} 通过 (${resolved.label})`,
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout,
    };
  } catch (err) {
    const error = normalizeExecError(err);
    return {
      stage: 'unit-test',
      status: 'fail',
      output: '单元测试失败',
      duration: Date.now() - startTime,
      command: resolved?.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

async function runIntegrationTest(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  let resolved: ResolvedCommand | null = null;
  try {
    resolved = await resolveStageCommand(rootPath, identity, 'integration-test');
    if (!resolved) {
      return {
        stage: 'integration-test',
        status: 'skipped',
        output: '无集成测试配置',
        duration: Date.now() - startTime,
      };
    }

    const stdout = execSync(resolved.command, {
      cwd: rootPath,
      timeout: Math.max(timeout, 180000),
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return {
      stage: 'integration-test',
      status: 'pass',
      output: `${resolved.label} 通过`,
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout,
    };
  } catch (err) {
    const error = normalizeExecError(err);
    return {
      stage: 'integration-test',
      status: 'fail',
      output: '集成测试失败',
      duration: Date.now() - startTime,
      command: resolved?.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

async function runE2E(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  let resolved: ResolvedCommand | null = null;
  try {
    resolved = await resolveStageCommand(rootPath, identity, 'e2e');
    if (!resolved) {
      return {
        stage: 'e2e',
        status: 'skipped',
        output: '无 E2E 测试配置',
        duration: Date.now() - startTime,
      };
    }

    const stdout = execSync(resolved.command, {
      cwd: rootPath,
      timeout: Math.max(timeout, 300000),
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return {
      stage: 'e2e',
      status: 'pass',
      output: `${resolved.label} 通过`,
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout,
    };
  } catch (err) {
    const error = normalizeExecError(err);
    return {
      stage: 'e2e',
      status: 'fail',
      output: 'E2E 测试失败',
      duration: Date.now() - startTime,
      command: resolved?.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

// ============================================================
// Command resolution by language
// ============================================================
interface ResolvedCommand {
  command: string;
  label: string;
}

interface NormalizedExecError {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
}

function normalizeExecError(err: unknown): NormalizedExecError {
  const error = err as {
    status?: number;
    signal?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
    message?: string;
  };

  return {
    exitCode: typeof error.status === 'number' ? error.status : null,
    stdout: bufferToString(error.stdout),
    stderr: bufferToString(error.stderr),
    message: error.message || String(err),
  };
}

function bufferToString(value: string | Buffer | undefined): string {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf-8') : value;
}

function formatExecError(error: NormalizedExecError): string {
  const sections: string[] = [];
  if (error.exitCode !== null) sections.push(`exitCode: ${error.exitCode}`);
  if (error.stdout.trim()) sections.push(`stdout:\n${error.stdout.trimEnd()}`);
  if (error.stderr.trim()) sections.push(`stderr:\n${error.stderr.trimEnd()}`);
  const suggestion = formatBeginnerSuggestion(error);
  if (suggestion) sections.push(`新手提示:\n${suggestion}`);
  if (sections.length === 0) sections.push(error.message);
  return sections.join('\n\n');
}

function formatBeginnerSuggestion(error: NormalizedExecError): string | null {
  const text = `${error.stdout}\n${error.stderr}\n${error.message}`.toLowerCase();
  if (
    text.includes('is not recognized as an internal or external command') ||
    text.includes('command not found') ||
    text.includes('not found')
  ) {
    if (text.includes('tsc') || text.includes('eslint') || text.includes('vitest') || text.includes('jest')) {
      return '项目依赖可能还没安装。请先在项目目录运行 npm install，然后重新执行 ic t 或 ic verify。';
    }
    if (text.includes('go ')) return 'Go 工具链未安装或不在 PATH 中。请从 https://go.dev/dl/ 下载安装 Go，然后将 go/bin 加入 PATH。';
    if (text.includes('python') || text.includes('pytest')) return 'Python 未安装或不在 PATH 中。请从 https://python.org 下载安装，并确保 pip 可用。';
    if (text.includes('java') || text.includes('mvn') || text.includes('gradle')) return 'JDK/Maven/Gradle 未安装或不在 PATH 中。请安装 JDK 17+ 并配置 JAVA_HOME。';
    return '命令未找到。请检查对应工具是否已安装并加入 PATH 环境变量。';
  }
  if (text.includes('cannot find module') || text.includes('module not found')) {
    return '项目依赖可能缺失。请先运行 npm install；如果仍失败，检查 package.json 是否缺少对应依赖。';
  }
  if (text.includes('analysis-only')) return null; // Analysis tasks don't need verification
  return null;
}

async function resolveStageCommand(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage
): Promise<ResolvedCommand | null> {
  const scriptCommand = await resolvePackageScript(rootPath, identity, stage);
  if (scriptCommand) return scriptCommand;

  const fallback = getFallbackCommand(identity.language, stage, rootPath);
  if (!fallback) return null;
  return { command: fallback, label: `(fallback) ${fallback}` };
}

export async function resolveVerificationCommand(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage
): Promise<ResolvedCommand | null> {
  return resolveStageCommand(rootPath, identity, stage);
}

async function resolvePackageScript(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage
): Promise<ResolvedCommand | null> {
  if (!['typescript', 'javascript'].includes(identity.language)) return null;

  const packageJsonPath = path.join(rootPath, 'package.json');
  if (!(await fileExists(packageJsonPath))) return null;

  const packageJson = await readJson(packageJsonPath) as {
    scripts?: Record<string, string>;
    packageManager?: string;
  };
  const scripts = packageJson.scripts || {};
  const scriptName = pickScriptName(stage, scripts);
  if (!scriptName) return null;

  const runner = pickPackageRunner(rootPath, identity.packageManager || packageJson.packageManager);
  return normalizeScriptCommand(runner, scriptName, scripts[scriptName], identity, stage);
}

function pickScriptName(stage: VerifyStage, scripts: Record<string, string>): string | null {
  const candidates: Record<VerifyStage, string[]> = {
    compile: ['typecheck', 'type-check', 'check-types', 'build', 'compile'],
    lint: ['lint', 'eslint'],
    'unit-test': ['test:unit', 'unit-test', 'test'],
    'integration-test': ['test:integration', 'integration-test', 'test:it'],
    e2e: ['test:e2e', 'e2e', 'test:e2e:ci'],
    coverage: ['test:coverage', 'coverage'],
  };

  for (const name of candidates[stage]) {
    if (scripts[name]) return name;
  }
  return null;
}

function pickPackageRunner(rootPath: string, packageManager?: string): string {
  const normalized = (packageManager || '').toLowerCase();
  if (normalized.startsWith('pnpm')) return 'pnpm';
  if (normalized.startsWith('yarn')) return 'yarn';
  if (normalized.startsWith('npm')) return 'npm';

  if (existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(rootPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function normalizeScriptCommand(
  runner: string,
  scriptName: string,
  scriptContent: string,
  _identity: ProjectIdentity,
  _stage: VerifyStage
): ResolvedCommand {
  const lower = scriptContent.toLowerCase();
  const extraArgs: string[] = [];

  if (/\bvitest\b/.test(lower) && !/\b(run|watch|dev)\b/.test(lower) && !lower.includes('--run')) {
    extraArgs.push('--run');
  }

  if (/\bjest\b/.test(lower) && !lower.includes('--runinband')) {
    extraArgs.push('--runInBand');
  }

  if (/\bcypress\s+open\b/.test(lower)) {
    const command = `${NPX} --no-install cypress run`;
    return { command, label: `${command} (normalized from ${runner} run ${scriptName})` };
  }

  if (/\bplaywright\s+(open|ui|codegen)\b/.test(lower)) {
    const command = `${NPX} --no-install playwright test`;
    return { command, label: `${command} (normalized from ${runner} run ${scriptName})` };
  }

  return {
    command: buildRunScriptCommand(runner, scriptName, extraArgs),
    label: `${runner} run ${scriptName}${extraArgs.length > 0 ? ` ${extraArgs.join(' ')}` : ''}`,
  };
}

function buildRunScriptCommand(runner: string, scriptName: string, extraArgs: string[]): string {
  const base = runner === 'yarn'
    ? `yarn run -s ${scriptName}`
    : `${runner} run -s ${scriptName}`;
  if (extraArgs.length === 0) return base;
  return `${base} -- ${extraArgs.join(' ')}`;
}

function getFallbackCommand(language: string, stage: VerifyStage, rootPath?: string): string | null {
  let cmd: string | null = null;
  switch (stage) {
    case 'compile': cmd = getCompileCommand(language); break;
    case 'lint': cmd = getLintCommand(language); break;
    case 'unit-test': cmd = getUnitTestCommand(language); break;
    case 'integration-test': cmd = getIntegrationTestCommand(language); break;
    case 'e2e': cmd = getE2ECommand(language); break;
    case 'coverage': cmd = getCoverageCommand(language); break;
  }
  if (!cmd) return null;

  // For JS/TS npx fallbacks, skip if tooling is not locally available
  if (['typescript', 'javascript'].includes(language) && rootPath) {
    if (!hasLocalToolForStage(rootPath, stage)) return null;
  }
  return cmd;
}

// Check if required tooling exists locally for a fallback stage
function hasLocalToolForStage(rootPath: string, stage: VerifyStage): boolean {
  const binDir = path.join(rootPath, 'node_modules', '.bin');
  switch (stage) {
    case 'compile': {
      // Fallback commands use npx --no-install, so require a local binary.
      // A config file alone is not enough and can leave empty projects stuck.
      return existsSync(path.join(binDir, 'tsc')) ||
        existsSync(path.join(binDir, 'tsc.cmd'));
    }
    case 'lint': {
      return existsSync(path.join(binDir, 'eslint')) ||
        existsSync(path.join(binDir, 'eslint.cmd'));
    }
    case 'unit-test': {
      return existsSync(path.join(binDir, 'vitest')) ||
        existsSync(path.join(binDir, 'vitest.cmd')) ||
        existsSync(path.join(binDir, 'jest')) ||
        existsSync(path.join(binDir, 'jest.cmd'));
    }
    case 'e2e': {
      return existsSync(path.join(binDir, 'playwright')) ||
        existsSync(path.join(binDir, 'playwright.cmd')) ||
        existsSync(path.join(binDir, 'cypress')) ||
        existsSync(path.join(binDir, 'cypress.cmd'));
    }
    case 'coverage': {
      return existsSync(path.join(binDir, 'c8')) ||
        existsSync(path.join(binDir, 'c8.cmd')) ||
        existsSync(path.join(binDir, 'nyc')) ||
        existsSync(path.join(binDir, 'nyc.cmd'));
    }
    case 'integration-test':
      // Same check as unit-test for now
      return hasLocalToolForStage(rootPath, 'unit-test');
    default:
      return true; // non-JS/TS tools are assumed available
  }
}

function getCompileCommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install tsc --noEmit`,
    go: 'go build ./...',
    rust: 'cargo check',
    java: 'javac -version',
    csharp: 'dotnet build --no-restore',
  };
  return commands[language] || null;
}

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function getLintCommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install eslint . --max-warnings 0`,
    javascript: `${NPX} --no-install eslint .`,
    go: 'go vet ./...',
    rust: 'cargo clippy -- -D warnings',
    python: process.platform === 'win32' ? 'python -m flake8 .' : 'flake8 .',
  };
  return commands[language] || null;
}

function getUnitTestCommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install vitest run`,
    javascript: `${NPX} --no-install jest`,
    go: 'go test ./...',
    rust: 'cargo test',
    python: process.platform === 'win32' ? 'python -m pytest' : 'pytest',
    java: process.platform === 'win32' ? 'mvn.cmd test' : 'mvn test',
  };
  return commands[language] || null;
}

function getIntegrationTestCommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install vitest run --config vitest.integration.config.ts`,
    go: 'go test -tags=integration ./...',
    python: 'python -m pytest -m integration',
  };
  return commands[language] || null;
}

function getE2ECommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install playwright test`,
    javascript: `${NPX} --no-install cypress run`,
  };
  return commands[language] || null;
}

function getCoverageCommand(language: string): string | null {
  const commands: Record<string, string> = {
    typescript: `${NPX} --no-install c8 vitest run --coverage 2>&1`,
    javascript: `${NPX} --no-install c8 jest --coverage 2>&1`,
    go: 'go test -coverprofile=coverage.out ./... 2>&1 && go tool cover -func=coverage.out 2>&1',
    python: 'python -m pytest --cov=. --cov-report=term 2>&1',
    rust: 'cargo tarpaulin --out text 2>&1',
  };
  return commands[language] || null;
}

// P0-5: safe number parser — never returns NaN
function safeInt(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}
function safeFloat(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Parse coverage output from common tools (c8/nyc/istanbul text format)
function parseCoverageOutput(output: string): import('../types.js').CoverageSummary | null {
  // Try c8/nyc/istanbul text table format: "Lines: XX.XX% (X/Y)"
  const linesMatch = output.match(/Lines\s*:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/i);
  const branchesMatch = output.match(/Branches\s*:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/i);
  const funcsMatch = output.match(/Functions\s*:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/i);
  const stmtsMatch = output.match(/Statements\s*:\s*([\d.]+)%\s*\((\d+)\/(\d+)\)/i);

  // Go cover format: "total: (statements) XX.X%"
  const goMatch = output.match(/total:\s*\(statements\)\s*([\d.]+)%/i);

  // Python pytest-cov format: "TOTAL XX XX X XX%"
  const pyMatch = output.match(/TOTAL\s+\d+\s+\d+\s+\d+\s+(\d+)%/i);

  if (linesMatch) {
    return {
      lines: { pct: safeFloat(linesMatch[1]), covered: safeInt(linesMatch[2]), total: safeInt(linesMatch[3]) },
      branches: branchesMatch ? { pct: safeFloat(branchesMatch[1]), covered: safeInt(branchesMatch[2]), total: safeInt(branchesMatch[3]) } : { pct: 0, covered: 0, total: 0 },
      functions: funcsMatch ? { pct: safeFloat(funcsMatch[1]), covered: safeInt(funcsMatch[2]), total: safeInt(funcsMatch[3]) } : { pct: 0, covered: 0, total: 0 },
      statements: stmtsMatch ? { pct: safeFloat(stmtsMatch[1]), covered: safeInt(stmtsMatch[2]), total: safeInt(stmtsMatch[3]) } : { pct: 0, covered: 0, total: 0 },
    };
  }

  if (goMatch) {
    const pct = safeFloat(goMatch[1]);
    return { lines: { pct, covered: 0, total: 0 }, branches: { pct: 0, covered: 0, total: 0 }, functions: { pct, covered: 0, total: 0 }, statements: { pct, covered: 0, total: 0 } };
  }

  if (pyMatch) {
    const pct = safeInt(pyMatch[1]);
    return { lines: { pct, covered: 0, total: 0 }, branches: { pct: 0, covered: 0, total: 0 }, functions: { pct, covered: 0, total: 0 }, statements: { pct, covered: 0, total: 0 } };
  }

  return null;
}

async function runCoverageStage(
  rootPath: string,
  identity: ProjectIdentity,
  timeout: number,
  startTime: number
): Promise<StageResult> {
  const resolved = await resolveStageCommand(rootPath, identity, 'coverage');
  if (!resolved) {
    return {
      stage: 'coverage',
      status: 'skipped',
      output: `语言 ${identity.language} 无覆盖率工具支持`,
      duration: Date.now() - startTime,
    };
  }

  try {
    const output = execSync(resolved.command, {
      cwd: rootPath,
      timeout: Math.max(timeout, 10000),
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    let coverage = parseCoverageOutput(output);
    if (!coverage) {
      const fileCoverage = await collectCoverage(rootPath, identity);
      if (fileCoverage) {
        coverage = {
          lines: {
            pct: fileCoverage.lineCoverage,
            covered: fileCoverage.coveredLines,
            total: fileCoverage.totalLines,
          },
          branches: {
            pct: fileCoverage.branchCoverage,
            covered: 0,
            total: 0,
          },
          functions: { pct: 0, covered: 0, total: 0 },
          statements: { pct: 0, covered: 0, total: 0 },
        };
      }
    }

    if (!coverage) {
      return {
        stage: 'coverage',
        status: 'pass',
        output: `${resolved.label} 通过；未发现可解析覆盖率报告`,
        duration: Date.now() - startTime,
        command: resolved.command,
        exitCode: 0,
        stdout: output,
      };
    }

    // Default thresholds: 60% lines, 50% branches, 60% functions
    const thresholds = { lines: 60, branches: 50, functions: 60 };

    // Load baseline if it exists, use it for comparison
    let baseline: import('../types.js').CoverageBaseline | null = null;
    try {
      const baselinePath = path.join(rootPath, '.icloser', 'coverage-baseline.json');
      if (existsSync(baselinePath)) {
        baseline = JSON.parse(await (await import('fs/promises')).readFile(baselinePath, 'utf-8'));
      }
    } catch { /* best-effort */ }

    // Save/update baseline + append to history
    try {
      const plansDir = path.join(rootPath, '.icloser');
      const { mkdirSync } = await import('fs');
      mkdirSync(plansDir, { recursive: true });

      // Current baseline
      const baselinePath = path.join(plansDir, 'coverage-baseline.json');
      const baselineData: import('../types.js').CoverageBaseline = {
        projectName: rootPath.split(/[/\\]/).pop() || rootPath,
        updatedAt: new Date().toISOString(),
        summary: coverage,
        threshold: baseline?.threshold || thresholds,
      };
      await (await import('fs/promises')).writeFile(baselinePath, JSON.stringify(baselineData, null, 2));

      // History tracking (last 30 runs)
      const historyPath = path.join(plansDir, 'coverage-history.json');
      let history: { date: string; lines: number; branches: number; functions: number }[] = [];
      try { history = JSON.parse(await (await import('fs/promises')).readFile(historyPath, 'utf-8')); } catch { /* best-effort */ }
      history.push({
        date: new Date().toISOString().split('T')[0],
        lines: Math.round(coverage.lines.pct * 10) / 10,
        branches: Math.round(coverage.branches.pct * 10) / 10,
        functions: Math.round(coverage.functions.pct * 10) / 10,
      });
      if (history.length > 30) history = history.slice(-30);
      await (await import('fs/promises')).writeFile(historyPath, JSON.stringify(history, null, 2));
    } catch { /* best-effort */ }

    const linesOk = coverage.lines.pct >= thresholds.lines;
    const branchesOk = coverage.branches.pct >= thresholds.branches;
    const funcsOk = coverage.functions.pct >= thresholds.functions;
    const allOk = linesOk && branchesOk && funcsOk;

    // Check if coverage dropped below baseline
    let droppedFromBaseline = false;
    if (baseline) {
      droppedFromBaseline = coverage.lines.pct < baseline.summary.lines.pct - 1 ||
        coverage.branches.pct < baseline.summary.branches.pct - 1 ||
        coverage.functions.pct < baseline.summary.functions.pct - 1;
    }

    const summary = [
      `Lines: ${coverage.lines.pct.toFixed(1)}% (${coverage.lines.covered}/${coverage.lines.total})`,
      `Branches: ${coverage.branches.pct.toFixed(1)}% (${coverage.branches.covered}/${coverage.branches.total})`,
      `Functions: ${coverage.functions.pct.toFixed(1)}% (${coverage.functions.covered}/${coverage.functions.total})`,
    ].join(', ');

    const status = !allOk ? 'fail' : droppedFromBaseline ? 'fail' : 'pass';
    let reason = '';
    if (!linesOk) reason = `行覆盖率 ${coverage.lines.pct.toFixed(1)}% < ${thresholds.lines}%`;
    if (!branchesOk) reason = (reason ? reason + '; ' : '') + `分支覆盖率 ${coverage.branches.pct.toFixed(1)}% < ${thresholds.branches}%`;
    if (!funcsOk) reason = (reason ? reason + '; ' : '') + `函数覆盖率 ${coverage.functions.pct.toFixed(1)}% < ${thresholds.functions}%`;
    if (droppedFromBaseline && allOk) reason = `覆盖率较基线下降 (曾: ${baseline!.summary.lines.pct.toFixed(1)}%)`;

    return {
      stage: 'coverage',
      status,
      output: summary + (reason ? ` [${reason}]` : ''),
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: 0,
      stdout: output,
      errorDetails: reason || undefined,
    };
  } catch (e) {
    const error = normalizeExecError(e);
    return {
      stage: 'coverage',
      status: 'fail',
      output: '覆盖率工具执行失败',
      duration: Date.now() - startTime,
      command: resolved.command,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      errorDetails: formatExecError(error),
    };
  }
}

// ============================================================
// Test output parsing
// ============================================================
function parseTestOutput(
  output: string,
  _language: string
): { total: number; passed: number } {
  // Jest/Vitest output: "Tests: 10 passed, 23 total"
  const jestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+total/);
  if (jestMatch) return { total: parseInt(jestMatch[2]), passed: parseInt(jestMatch[1]) };

  // Vitest output: "Tests  23 passed (23)"
  const vitestMatch = output.match(/Tests\s+(\d+)\s+passed/);
  if (vitestMatch) return { total: parseInt(vitestMatch[1]), passed: parseInt(vitestMatch[1]) };

  // Go test output
  const goMatch = output.match(/ok\s+\S+\s+[\d.]+s/);
  if (goMatch) return { total: 1, passed: 1 }; // Go test per package

  // pytest output: "10 passed"
  const pyMatch = output.match(/(\d+)\s+passed/);
  if (pyMatch) return { total: parseInt(pyMatch[1]), passed: parseInt(pyMatch[1]) };

  return { total: 0, passed: 0 };
}

async function collectCoverage(rootPath: string, _identity: ProjectIdentity): Promise<import('../types.js').CoverageResult | undefined> {
  const path = await import('path');
  const fsp = await import('fs/promises');

  // Check standard coverage output locations
  const locations = [
    path.join(rootPath, 'coverage', 'coverage-summary.json'),   // vitest/jest/nyc
    path.join(rootPath, 'coverage', 'coverage-final.json'),     // istanbul
    path.join(rootPath, 'coverage', 'lcov.info'),               // lcov
  ];

  for (const loc of locations) {
    try {
      const content = await fsp.readFile(loc, 'utf-8');
      if (loc.endsWith('.json')) {
        return parseJsonCoverage(JSON.parse(content));
      } else if (loc.endsWith('.info')) {
        return parseLcovCoverage(content);
      }
    } catch { /* try next */ }
  }

  // Fallback: parse test output for coverage info
  // vitest outputs lines like "All files | 85.2 | 72.1 | 80.0 | 82.5 |"
  return undefined;
}

function parseJsonCoverage(data: Record<string, unknown>): import('../types.js').CoverageResult | undefined {
  // vitest/nyc format: { total: { lines: { pct: 85 }, branches: { pct: 72 }, ... } }
  const total = (data.total || data) as Record<string, unknown>;
  const lines = total.lines as Record<string, number> | undefined;
  const branches = total.branches as Record<string, number> | undefined;

  if (!lines) return undefined;

  return {
    lineCoverage: Math.round(lines.pct || 0),
    branchCoverage: Math.round(branches?.pct || 0),
    coveredLines: lines.covered || 0,
    totalLines: lines.total || 0,
  };
}

function parseLcovCoverage(content: string): import('../types.js').CoverageResult | undefined {
  let coveredLines = 0;
  let totalLines = 0;
  let coveredBranches = 0;
  let totalBranches = 0;

  for (const line of content.split('\n')) {
    if (line.startsWith('LF:')) totalLines += parseInt(line.substring(3)) || 0;
    if (line.startsWith('LH:')) coveredLines += parseInt(line.substring(3)) || 0;
    if (line.startsWith('BRF:')) totalBranches += parseInt(line.substring(4)) || 0;
    if (line.startsWith('BRH:')) coveredBranches += parseInt(line.substring(4)) || 0;
  }

  if (totalLines === 0) return undefined;
  return {
    lineCoverage: Math.round((coveredLines / totalLines) * 100),
    branchCoverage: totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 100) : 0,
    coveredLines,
    totalLines,
  };
}

function countTotalTests(results: StageResult[]): number {
  let total = 0;
  for (const r of results) {
    if ((r.stage === 'unit-test' || r.stage === 'integration-test') && r.status === 'pass') {
      const match = r.output.match(/(\d+)\/(\d+)/);
      if (match) total += parseInt(match[2]);
      else {
        const passedMatch = r.output.match(/^(\d+)/);
        if (passedMatch) total += parseInt(passedMatch[1]);
      }
    }
  }
  return total;
}

function countPassedTests(results: StageResult[]): number {
  let passed = 0;
  for (const r of results) {
    if ((r.stage === 'unit-test' || r.stage === 'integration-test') && r.status === 'pass') {
      const match = r.output.match(/(\d+)\/(\d+)/);
      if (match) passed += parseInt(match[1]);
      else {
        const passedMatch = r.output.match(/^(\d+)/);
        if (passedMatch) passed += parseInt(passedMatch[1]);
      }
    }
  }
  return passed;
}
