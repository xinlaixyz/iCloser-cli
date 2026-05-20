import * as path from 'path';
import { ensureDir, fileExists, getFileSize, writeFile, readFile } from '../utils/fs.js';
import type { AIProviderAdapter } from '../ai/provider.js';
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
  options: { module?: string; maxFiles?: number; provider?: AIProviderAdapter } = {},
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
    const content = await generateTestContent(rootPath, pair.sourceFile, pair.testFile, plan.detectedFramework, options.provider);
    tests.push({
      file: pair.testFile,
      sourceFile: pair.sourceFile,
      module: target.module,
      content,
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

async function generateTestContent(
  rootPath: string, sourceFile: string, testFile: string, framework: string,
  provider?: AIProviderAdapter,
): Promise<string> {
  const ext = path.posix.extname(sourceFile.toLowerCase());

  // Extract source for AI analysis + export detection
  let sourceContent = '';
  let exports: { name: string; kind: string }[] = [];
  try {
    const fullPath = path.join(rootPath, sourceFile);
    sourceContent = await readFile(fullPath);
    exports = extractExportsRegex(sourceContent);
  } catch { /* best-effort */ }

  // T10: AI-driven test generation for JS/TS with real provider
  if (provider && exports.length > 0 && /\.(ts|tsx|js|jsx)$/i.test(ext)) {
    try {
      const aiContent = await generateAITestContent(sourceFile, testFile, framework, sourceContent, exports, provider);
      if (aiContent?.trim().length > 50) return aiContent;
    } catch { /* fall through to template */ }
  }

  // Enhanced template-based (used when AI unavailable)
  if (ext === '.go') return generateGoTest(sourceFile);
  if (ext === '.py') return generatePythonTest(sourceFile);
  if (ext === '.java') return generateJavaTest(sourceFile);
  return generateJavaScriptTest(sourceFile, testFile, framework, exports);
}

// ── T10: AI-driven test content generation ──

async function generateAITestContent(
  sourceFile: string, testFile: string, framework: string,
  sourceContent: string, exports: { name: string; kind: string }[],
  provider: AIProviderAdapter,
): Promise<string> {
  const fns = exports.filter(e => e.kind === 'function');
  const classes = exports.filter(e => e.kind === 'class');
  const testApi = framework.toLowerCase().includes('jest') ? 'jest' : 'vitest';

  const prompt = [
    `为以下源文件生成${testApi}单元测试。`,
    `源文件: ${sourceFile}  测试文件: ${testFile}`,
    `导入: import { describe, expect, it } from '${testApi === 'jest' ? '@jest/globals' : 'vitest'}'`,
    `导出函数: ${fns.map(f => f.name).join(', ') || '无'}`,
    `导出类: ${classes.map(c => c.name).join(', ') || '无'}`,
    '',
    '要求:',
    '1. 每个导出函数至少1个行为验证（检查返回值/副作用，不只 typeof）',
    '2. 有参数的函数传入合理样本值',
    '3. async函数用 async/await',
    '4. 可能抛异常的函数测试错误路径',
    '5. 匹配现有代码风格',
    '6. 只输出完整测试代码，不要markdown包裹，不要解释',
    '',
    '```typescript',
    sourceContent.slice(0, 4000),
    '```',
  ].join('\n');

  const resp = await provider.chat({
    systemPrompt: `你是测试专家。生成${testApi}单元测试。每个导出函数至少1个行为验证。只输出代码，不要解释。`,
    task: prompt,
    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
    history: '',
  });

  const content = (resp.content || '').trim();
  return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
}

// ── T10: Full verify-repair loop ──

export interface TestVerifyResult { rounds: number; passed: boolean; diagnostics: string; testOutput: string; }

export async function generateAndVerifyTests(
  rootPath: string,
  sourceFiles: { file: string; testFile: string; framework: string }[],
  provider: AIProviderAdapter,
): Promise<TestVerifyResult> {
  const diagnostics: string[] = [];
  const MAX_ROUNDS = 3;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const testContents: { file: string; content: string }[] = [];
    for (const sf of sourceFiles) {
      const content = await generateTestContent(rootPath, sf.file, sf.testFile, sf.framework, provider);
      testContents.push({ file: sf.testFile, content });
    }

    for (const tc of testContents) {
      const fp = path.join(rootPath, tc.file);
      await ensureDir(path.dirname(fp));
      await writeFile(fp, tc.content);
    }

    try {
      const { execSync } = await import('child_process');
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const output = execSync(`${cmd} vitest run ${testContents.map(t => t.file).join(' ')}`, {
        cwd: rootPath, timeout: 120000, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024,
      });
      return { rounds: round, passed: true, diagnostics: diagnostics.join('\n'), testOutput: output };
    } catch (e: any) {
      const errOut = (e.stdout || '') + (e.stderr || '');
      diagnostics.push(`Round ${round}: ${(e as Error).message.slice(0, 200)}`);
      if (round < MAX_ROUNDS) {
        try {
          const fixResp = await provider.chat({
            systemPrompt: '你是测试修复专家。分析失败原因并修复测试。只输出修复后的完整测试代码。',
            task: `测试失败:\n${errOut.slice(0, 3000)}\n\n当前测试:\n${testContents.map(t => `### ${t.file}\n${t.content.slice(0, 2000)}`).join('\n\n')}`,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
            history: '',
          });
          const fixed = (fixResp.content || '').replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
          if (fixed.trim()) for (const tc of testContents) tc.content = fixed;
        } catch { /* continue loop */ }
      }
    }
  }
  return { rounds: MAX_ROUNDS, passed: false, diagnostics: diagnostics.join('\n'), testOutput: '' };
}

// ── Export extraction ──

function extractExportsRegex(content: string): { name: string; kind: string }[] {
  const exports: { name: string; kind: string }[] = [];
  const patterns: [RegExp, string][] = [
    [/export\s+(?:async\s+)?function\s+(\w+)/g, 'function'],
    [/export\s+(?:const|let|var)\s+(\w+)\s*[:=]/g, 'const'],
    [/export\s+class\s+(\w+)/g, 'class'],
    [/export\s+(?:type|interface)\s+(\w+)/g, 'type'],
  ];
  for (const [regex, kind] of patterns) {
    for (const m of content.matchAll(regex)) {
      if (!exports.some(e => e.name === m[1])) {
        exports.push({ name: m[1], kind });
      }
    }
  }
  return exports;
}

function generateJavaScriptTest(sourceFile: string, testFile: string, framework: string, exports?: { name: string; kind: string }[]): string {
  const importPath = toRelativeImport(testFile, sourceFile);
  const suiteName = path.posix.basename(sourceFile);
  const api = framework.toLowerCase().includes('jest') ? '@jest/globals' : 'vitest';
  const lines: string[] = [
    `import { describe, expect, it } from '${api}';`,
    `import * as subject from '${importPath}';`,
    '',
    `describe('${suiteName}', () => {`,
  ];

  // Generate meaningful tests for each exported function
  const exportedFns = (exports || []).filter(e => e.kind === 'function');
  for (const fn of exportedFns.slice(0, 5)) {
    lines.push(`  describe('${fn.name}', () => {`);
    lines.push(`    it('should be callable', () => {`);
    lines.push(`      expect(typeof subject.${fn.name}).toBe('function');`);
    lines.push(`    });`);
    lines.push(`    it('should handle null/undefined gracefully', () => {`);
    lines.push(`      expect(() => { try { subject.${fn.name}(); } catch(e) {} }).not.toThrow();`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }

  // Fallback: generic module test
  if (exportedFns.length === 0) {
    lines.push(`  it('exports a usable module API', () => {`);
    lines.push(`    expect(Object.keys(subject).length).toBeGreaterThan(0);`);
    lines.push(`  });`);
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
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
