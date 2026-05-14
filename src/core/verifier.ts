// Verification Engine — compile, lint, test with auto-repair loop
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type {
  VerifyResult, VerifyStage, StageResult, ProjectIdentity, Task,
} from '../types.js';
import { fileExists, readJson } from '../utils/fs.js';

export interface VerifyOptions {
  stages: VerifyStage[];
  maxRetries: number;
  timeout: number;       // ms per stage
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
    stageResults.length = 0; // Reset for retry
    allPassed = true;

    for (const stage of options.stages) {
      const result = await runStage(rootPath, identity, stage, options.timeout);

      if (result.status === 'fail') {
        stageResults.push(result);
        allPassed = false;

        // If this is the last attempt, don't try remaining stages
        if (attempts === options.maxRetries) {
          // Mark remaining as skipped
          const remaining = options.stages.slice(options.stages.indexOf(stage) + 1);
          for (const s of remaining) {
            stageResults.push({
              stage: s,
              status: 'skipped',
              output: '前序阶段失败，跳过',
              duration: 0,
            });
          }
          break;
        }

        // Auto-repair: the AI would fix the error here
        // For now, just record the error and continue
        break;
      }

      stageResults.push(result);
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
// Stage execution
// ============================================================
async function runStage(
  rootPath: string,
  identity: ProjectIdentity,
  stage: VerifyStage,
  timeout: number
): Promise<StageResult> {
  const startTime = Date.now();

  switch (stage) {
    case 'compile':
      return runCompile(rootPath, identity, timeout, startTime);
    case 'lint':
      return runLint(rootPath, identity, timeout, startTime);
    case 'unit-test':
      return runUnitTest(rootPath, identity, timeout, startTime);
    case 'integration-test':
      return runIntegrationTest(rootPath, identity, timeout, startTime);
    case 'e2e':
      return runE2E(rootPath, identity, timeout, startTime);
    default:
      return {
        stage,
        status: 'skipped',
        output: '未知验证阶段',
        duration: 0,
      };
  }
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
  }
  if (text.includes('cannot find module') || text.includes('module not found')) {
    return '项目依赖可能缺失。请先运行 npm install；如果仍失败，检查 package.json 是否缺少对应依赖。';
  }
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
  identity: ProjectIdentity,
  stage: VerifyStage
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

async function collectCoverage(rootPath: string, identity: ProjectIdentity): Promise<import('../types.js').CoverageResult | undefined> {
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
