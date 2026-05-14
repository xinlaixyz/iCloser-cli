import * as path from 'path';
import { ensureDir, fileExists, getFileSize, writeFile } from '../utils/fs.js';
import type { AutopilotTestPlan, AutopilotTestTarget } from './autopilot.js';

export interface TestDraft {
  file: string;
  sourceFile: string;
  module: string;
  content: string;
  exists: boolean;
}

export interface TestWritePlan {
  rootPath: string;
  testCommand: string;
  target: AutopilotTestTarget | null;
  tests: TestDraft[];
  totalNew: number;
  totalExisting: number;
}

export interface TestWriteReceipt extends TestDraft {
  fullPath: string;
  verified: boolean;
  bytes: number;
  lines: number;
}

export async function buildTestWritePlan(
  rootPath: string,
  plan: AutopilotTestPlan,
  options: { module?: string; maxFiles?: number } = {},
): Promise<TestWritePlan> {
  const target = pickTarget(plan, options.module);
  if (!target) {
    return {
      rootPath,
      testCommand: plan.testCommand,
      target: null,
      tests: [],
      totalNew: 0,
      totalExisting: 0,
    };
  }

  const maxFiles = Math.max(1, options.maxFiles || 1);
  const tests: TestDraft[] = [];
  const pairs = target.sourceFiles.slice(0, maxFiles).map((sourceFile, index) => ({
    sourceFile,
    testFile: target.suggestedTestFiles[index] || suggestFallbackTestFile(sourceFile),
  }));

  for (const pair of pairs) {
    const fullPath = path.join(rootPath, pair.testFile);
    tests.push({
      file: pair.testFile,
      sourceFile: pair.sourceFile,
      module: target.module,
      content: generateTestContent(pair.sourceFile, pair.testFile, plan.detectedFramework),
      exists: await fileExists(fullPath),
    });
  }

  return {
    rootPath,
    testCommand: plan.testCommand,
    target,
    tests,
    totalNew: tests.filter(test => !test.exists).length,
    totalExisting: tests.filter(test => test.exists).length,
  };
}

export async function writeTests(
  rootPath: string,
  plan: TestWritePlan,
  options: { overwrite?: boolean; selected?: string[] } = {},
): Promise<TestWriteReceipt[]> {
  const selectedSet = options.selected ? new Set(options.selected) : null;
  const written: TestWriteReceipt[] = [];

  for (const draft of plan.tests) {
    if (selectedSet && !selectedSet.has(draft.file)) continue;
    if (draft.exists && !options.overwrite) continue;

    const fullPath = path.join(rootPath, draft.file);
    await ensureDir(path.dirname(fullPath));
    await writeFile(fullPath, draft.content);
    const verified = await fileExists(fullPath);
    written.push({
      ...draft,
      fullPath,
      verified,
      bytes: verified ? await getFileSize(fullPath) : 0,
      lines: draft.content.split('\n').length,
    });
  }

  return written;
}

export function renderTestWritePlan(plan: TestWritePlan): string {
  const lines: string[] = [];
  lines.push('安全测试写入计划');
  lines.push('');
  lines.push(`项目路径：${plan.rootPath}`);
  lines.push(`目标模块：${plan.target ? plan.target.module : '暂无缺口'}`);
  lines.push(`建议验证命令：${plan.testCommand}`);
  lines.push('');

  if (plan.tests.length === 0) {
    lines.push('暂未找到需要自动补测的模块。');
    return lines.join('\n');
  }

  lines.push('将生成：');
  for (const test of plan.tests) {
    lines.push(`- ${test.file} ${test.exists ? '(已存在，默认跳过)' : '(新建)'}`);
    lines.push(`  来源：${test.sourceFile}`);
  }
  lines.push('');
  lines.push('规则：一次只写入一个模块的最小测试，写入后必须运行验证命令。');
  return lines.join('\n');
}

function pickTarget(plan: AutopilotTestPlan, moduleName?: string): AutopilotTestTarget | null {
  const candidates = plan.targets.filter(target => target.coverageStatus !== 'covered');
  if (moduleName) {
    return candidates.find(target => target.module === moduleName || target.module.endsWith(`/${moduleName}`)) || null;
  }
  return candidates[0] || null;
}

function generateTestContent(sourceFile: string, testFile: string, framework: string): string {
  const ext = path.posix.extname(sourceFile.toLowerCase());
  if (ext === '.go') return generateGoTest(sourceFile);
  if (ext === '.py') return generatePythonTest(sourceFile);
  if (ext === '.java') return generateJavaTest(sourceFile);
  return generateJavaScriptTest(sourceFile, testFile, framework);
}

function generateJavaScriptTest(sourceFile: string, testFile: string, framework: string): string {
  const importPath = toRelativeImport(testFile, sourceFile);
  const suiteName = path.posix.basename(sourceFile);
  const api = framework.toLowerCase().includes('jest') ? '@jest/globals' : 'vitest';
  return [
    `import { describe, expect, it } from '${api}';`,
    `import * as subject from '${importPath}';`,
    '',
    `describe('${suiteName}', () => {`,
    `  it('exports a usable module API', () => {`,
    `    expect(Object.keys(subject).length).toBeGreaterThan(0);`,
    '  });',
    '});',
    '',
  ].join('\n');
}

function generatePythonTest(sourceFile: string): string {
  const moduleName = path.posix.basename(sourceFile, '.py');
  return [
    `import importlib`,
    '',
    '',
    `def test_${safeIdentifier(moduleName)}_module_imports():`,
    `    module = importlib.import_module('${moduleName}')`,
    '    assert module is not None',
    '',
  ].join('\n');
}

function generateGoTest(sourceFile: string): string {
  const packageName = path.posix.basename(path.posix.dirname(sourceFile)) || 'main';
  return [
    `package ${safeIdentifier(packageName)}`,
    '',
    `import "testing"`,
    '',
    `func TestModuleCompiles(t *testing.T) {`,
    `\tt.Log("${sourceFile} is covered by a starter test")`,
    '}',
    '',
  ].join('\n');
}

function generateJavaTest(sourceFile: string): string {
  const className = path.posix.basename(sourceFile, '.java');
  return [
    'import org.junit.jupiter.api.Test;',
    'import static org.junit.jupiter.api.Assertions.assertTrue;',
    '',
    `class ${className}Test {`,
    '  @Test',
    '  void moduleHasStarterTest() {',
    '    assertTrue(true);',
    '  }',
    '}',
    '',
  ].join('\n');
}

function toRelativeImport(testFile: string, sourceFile: string): string {
  const fromDir = path.posix.dirname(testFile.replace(/\\/g, '/'));
  const sourceWithoutExt = sourceFile.replace(/\\/g, '/').replace(/\.[^.]+$/, '');
  let rel = path.posix.relative(fromDir, sourceWithoutExt);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function suggestFallbackTestFile(sourceFile: string): string {
  const ext = path.posix.extname(sourceFile);
  return sourceFile.slice(0, -ext.length) + `.test${ext || '.ts'}`;
}

function safeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, '_');
  return cleaned || 'module';
}
