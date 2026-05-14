import * as path from 'path';
import { detectProject } from '../utils/detect.js';
import { fileExists, findFiles, readJson, relativePath } from '../utils/fs.js';
import type { ProjectIdentity } from '../types.js';

export type AutopilotActionId =
  | 'analyze-only'
  | 'write-docs'
  | 'plan-tests'
  | 'safe-fixes'
  | 'cancel';

export interface AutopilotFinding {
  severity: 'info' | 'warn' | 'risk';
  category: 'project' | 'docs' | 'tests' | 'scripts' | 'quality';
  title: string;
  detail: string;
  suggestion: string;
}

export interface AutopilotAction {
  id: AutopilotActionId;
  label: string;
  description: string;
  risk: 'none' | 'low' | 'medium';
}

export interface AutopilotReport {
  rootPath: string;
  identity: ProjectIdentity;
  summary: {
    sourceFiles: number;
    testFiles: number;
    docFiles: number;
    modules: number;
    packageScripts: string[];
  };
  docs: {
    required: string[];
    existing: string[];
    missing: string[];
  };
  tests: {
    detected: boolean;
    files: number;
    scripts: string[];
    missingSuggestion: string;
  };
  findings: AutopilotFinding[];
  actions: AutopilotAction[];
  generatedAt: string;
}

export interface AutopilotTestTarget {
  module: string;
  sourceFiles: string[];
  existingTestFiles: string[];
  suggestedTestFiles: string[];
  coverageStatus: 'missing' | 'partial' | 'covered';
  priority: 'high' | 'normal' | 'low';
  rationale: string;
}

export interface AutopilotTestPlan {
  rootPath: string;
  identity: ProjectIdentity;
  detectedFramework: string;
  testCommand: string;
  summary: {
    sourceModules: number;
    testedModules: number;
    missingModules: number;
    existingTestFiles: number;
  };
  targets: AutopilotTestTarget[];
  nextSteps: string[];
  generatedAt: string;
}

export async function planProjectTests(rootPath: string): Promise<AutopilotTestPlan> {
  const identity = await detectProject(rootPath);
  const [allSourceFiles, testFiles, packageScripts] = await Promise.all([
    findSourceFiles(rootPath),
    findTestFiles(rootPath),
    readPackageScripts(rootPath),
  ]);
  const sourceFiles = allSourceFiles.filter(file => !isTestFilePath(file));
  const modules = groupSourceFilesByModule(rootPath, sourceFiles);
  const testsByModule = groupTestFilesByModule(rootPath, testFiles);
  const targets: AutopilotTestTarget[] = [];

  for (const [module, files] of modules.entries()) {
    const existingTestFiles = testsByModule.get(module) || [];
    const coverageStatus = existingTestFiles.length === 0
      ? 'missing'
      : existingTestFiles.length < Math.max(1, Math.ceil(files.length / 3))
        ? 'partial'
        : 'covered';
    const priority = coverageStatus === 'covered'
      ? 'low'
      : coverageStatus === 'missing' && files.length >= 3
        ? 'high'
        : 'normal';

    targets.push({
      module,
      sourceFiles: files,
      existingTestFiles,
      suggestedTestFiles: files.slice(0, 4).map(file => suggestTestFile(file, identity.language)),
      coverageStatus,
      priority,
      rationale: buildTestTargetRationale(coverageStatus, files.length, existingTestFiles.length),
    });
  }

  targets.sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 } as const;
    const statusOrder = { missing: 0, partial: 1, covered: 2 } as const;
    return priorityOrder[a.priority] - priorityOrder[b.priority]
      || statusOrder[a.coverageStatus] - statusOrder[b.coverageStatus]
      || b.sourceFiles.length - a.sourceFiles.length
      || a.module.localeCompare(b.module);
  });

  const missingModules = targets.filter(target => target.coverageStatus === 'missing').length;
  const testedModules = targets.filter(target => target.coverageStatus !== 'missing').length;

  return {
    rootPath,
    identity,
    detectedFramework: detectTestFrameworkName(identity, packageScripts),
    testCommand: detectTestCommand(identity, packageScripts),
    summary: {
      sourceModules: modules.size,
      testedModules,
      missingModules,
      existingTestFiles: testFiles.length,
    },
    targets,
    nextSteps: buildTestPlanNextSteps(missingModules, testFiles.length),
    generatedAt: new Date().toISOString(),
  };
}

export function renderAutopilotTestPlan(plan: AutopilotTestPlan): string {
  const lines: string[] = [];
  lines.push('自动测试规划');
  lines.push('');
  lines.push(`项目路径：${plan.rootPath}`);
  lines.push(`技术栈：${plan.identity.language} / ${plan.identity.framework}`);
  lines.push(`测试框架：${plan.detectedFramework}`);
  lines.push(`建议验证命令：${plan.testCommand}`);
  lines.push(`覆盖概览：${plan.summary.sourceModules} 个源码模块，${plan.summary.testedModules} 个已有测试模块，${plan.summary.missingModules} 个缺测试模块`);
  lines.push('');
  lines.push('优先补测模块：');

  const visibleTargets = plan.targets.filter(target => target.coverageStatus !== 'covered').slice(0, 8);
  if (visibleTargets.length === 0) {
    lines.push('- 暂未发现明显测试缺口，可继续做覆盖率和端到端场景分析。');
  } else {
    for (const target of visibleTargets) {
      lines.push(`- [${target.priority}] ${target.module}：${target.rationale}`);
      lines.push(`  源码：${target.sourceFiles.slice(0, 4).join('、')}`);
      lines.push(`  建议测试：${target.suggestedTestFiles.slice(0, 3).join('、')}`);
    }
  }

  lines.push('');
  lines.push('下一步：');
  plan.nextSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  return lines.join('\n');
}
const REQUIRED_DOCS = [
  'docs/README.md',
  'docs/PRD.md',
  'docs/ARCHITECTURE.md',
  'docs/API.md',
  'docs/TESTING.md',
];

const SOURCE_PATTERNS = [
  'src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'app/**/*.{ts,tsx,js,jsx}',
  'pages/**/*.{ts,tsx,js,jsx}',
  'components/**/*.{ts,tsx,js,jsx}',
  'lib/**/*.{ts,tsx,js,jsx}',
  'services/**/*.{ts,tsx,js,jsx}',
  'server/**/*.{ts,tsx,js,jsx}',
  'api/**/*.{ts,tsx,js,jsx}',
  '**/*.go',
  '**/*.py',
  '**/*.java',
  '**/*.rs',
];

const TEST_PATTERNS = [
  '**/*.{test,spec}.{ts,tsx,js,jsx}',
  'tests/**/*.{ts,tsx,js,jsx,py}',
  '**/*_test.go',
  '**/test_*.py',
];

export async function analyzeProjectAutopilot(rootPath: string): Promise<AutopilotReport> {
  const identity = await detectProject(rootPath);
  const [sourceFiles, testFiles, docFiles, packageScripts] = await Promise.all([
    findSourceFiles(rootPath),
    findTestFiles(rootPath),
    findDocFiles(rootPath),
    readPackageScripts(rootPath),
  ]);

  const existingDocs = await findExistingRequiredDocs(rootPath);
  const missingDocs = REQUIRED_DOCS.filter(doc => !existingDocs.includes(doc));
  const modules = estimateModuleCount(sourceFiles, rootPath);
  const testScripts = packageScripts.filter(script => /test|spec|vitest|jest|pytest|go test|mvn test/i.test(script));
  const findings = buildFindings({
    sourceFiles,
    testFiles,
    docFiles,
    packageScripts,
    missingDocs,
    testScripts,
    modules,
  });

  return {
    rootPath,
    identity,
    summary: {
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      docFiles: docFiles.length,
      modules,
      packageScripts,
    },
    docs: {
      required: REQUIRED_DOCS,
      existing: existingDocs,
      missing: missingDocs,
    },
    tests: {
      detected: testFiles.length > 0 || testScripts.length > 0 || identity.testFramework !== 'unknown',
      files: testFiles.length,
      scripts: testScripts,
      missingSuggestion: testFiles.length > 0 ? '已有测试文件，下一步可分析覆盖缺口。' : '未发现明显测试文件，建议先生成测试计划，不要直接批量写测试。',
    },
    findings,
    actions: buildActions(missingDocs.length, testFiles.length, findings),
    generatedAt: new Date().toISOString(),
  };
}

export function renderAutopilotReport(report: AutopilotReport): string {
  const lines: string[] = [];
  lines.push('项目工程自动分析');
  lines.push('');
  lines.push(`项目路径：${report.rootPath}`);
  lines.push(`技术栈：${report.identity.language} / ${report.identity.framework} / ${report.identity.buildSystem}`);
  lines.push(`规模：${report.summary.sourceFiles} 个源码文件，${report.summary.modules} 个模块，${report.summary.testFiles} 个测试文件，${report.summary.docFiles} 个文档文件`);
  lines.push('');
  lines.push('发现的问题：');
  if (report.findings.length === 0) {
    lines.push('- 暂未发现明显缺口');
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity}] ${finding.title}：${finding.detail}`);
    }
  }
  lines.push('');
  lines.push('建议下一步：');
  report.actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.label} - ${action.description}`);
  });
  return lines.join('\n');
}

async function findSourceFiles(rootPath: string): Promise<string[]> {
  const files = await findFiles(rootPath, SOURCE_PATTERNS, defaultAutopilotIgnores());
  return unique(files);
}

async function findTestFiles(rootPath: string): Promise<string[]> {
  const files = await findFiles(rootPath, TEST_PATTERNS, defaultAutopilotIgnores());
  return unique(files);
}

async function findDocFiles(rootPath: string): Promise<string[]> {
  const files = await findFiles(rootPath, ['README.md', 'docs/**/*.md', 'doc/**/*.md'], defaultAutopilotIgnores());
  return unique(files);
}

async function findExistingRequiredDocs(rootPath: string): Promise<string[]> {
  const existing: string[] = [];
  for (const doc of REQUIRED_DOCS) {
    if (await fileExists(path.join(rootPath, doc))) existing.push(doc);
  }
  if (await fileExists(path.join(rootPath, 'README.md')) && !existing.includes('docs/README.md')) {
    existing.push('README.md');
  }
  return existing;
}

async function readPackageScripts(rootPath: string): Promise<string[]> {
  try {
    const pkg = await readJson(path.join(rootPath, 'package.json'));
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {};
    return Object.entries(scripts).map(([name, command]) => `${name}: ${String(command)}`);
  } catch {
    return [];
  }
}

function estimateModuleCount(files: string[], rootPath: string): number {
  const modules = new Set<string>();
  for (const file of files) {
    const rel = relativePath(file, rootPath).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts[0] === 'src' && parts.length > 2) modules.add(`${parts[0]}/${parts[1]}`);
    else modules.add(parts[0]);
  }
  return modules.size;
}

function buildFindings(input: {
  sourceFiles: string[];
  testFiles: string[];
  docFiles: string[];
  packageScripts: string[];
  missingDocs: string[];
  testScripts: string[];
  modules: number;
}): AutopilotFinding[] {
  const findings: AutopilotFinding[] = [];
  if (input.missingDocs.length > 0) {
    findings.push({
      severity: 'warn',
      category: 'docs',
      title: '项目文档不完整',
      detail: `缺少 ${input.missingDocs.join('、')}`,
      suggestion: '先自动生成缺失文档草稿，写入 docs/ 后由用户确认。',
    });
  }
  if (input.testFiles.length === 0 && input.testScripts.length === 0) {
    findings.push({
      severity: 'warn',
      category: 'tests',
      title: '未发现测试入口',
      detail: '没有检测到测试文件或 package.json 测试脚本。',
      suggestion: '先生成测试计划，再按模块逐步补测试。',
    });
  }
  if (input.sourceFiles.length > 50 && input.modules <= 3) {
    findings.push({
      severity: 'risk',
      category: 'quality',
      title: '源码集中度较高',
      detail: `${input.sourceFiles.length} 个源码文件集中在 ${input.modules} 个模块内。`,
      suggestion: '建议分析页面/服务/组件职责，优先提取可复用模块。',
    });
  }
  if (input.packageScripts.length === 0) {
    findings.push({
      severity: 'info',
      category: 'scripts',
      title: '未发现 npm 脚本',
      detail: '当前项目没有可直接识别的 package.json scripts。',
      suggestion: '如非 Node 项目，可根据语言识别构建命令。',
    });
  }
  return findings;
}

function buildActions(missingDocCount: number, testFileCount: number, findings: AutopilotFinding[]): AutopilotAction[] {
  const actions: AutopilotAction[] = [
    { id: 'analyze-only', label: '只生成分析报告', description: '不写代码，不改文件，只输出项目画像和问题清单。', risk: 'none' },
  ];
  if (missingDocCount > 0) {
    actions.push({ id: 'write-docs', label: '补齐缺失文档', description: '生成缺失文档草稿，统一写入 docs/。', risk: 'low' });
  }
  actions.push({
    id: 'plan-tests',
    label: testFileCount > 0 ? '分析测试覆盖缺口' : '生成测试计划',
    description: '只规划测试，不直接批量修改业务代码。',
    risk: 'low',
  });
  if (findings.some(finding => finding.severity === 'risk')) {
    actions.push({ id: 'safe-fixes', label: '规划低风险修复', description: '仅生成小步修复计划，需要再次确认才会执行。', risk: 'medium' });
  }
  actions.push({ id: 'cancel', label: '取消', description: '不执行任何后续动作。', risk: 'none' });
  return actions;
}

function defaultAutopilotIgnores(): string[] {
  return [
    'node_modules/**', '.git/**', 'dist/**', 'build/**', 'target/**', '.next/**', 'coverage/**',
    '.icloser/**', '__pycache__/**', '.venv/**', 'vendor/**', '*.min.js', '*.map',
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function isTestFilePath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  return /(^|\/)(tests|__tests__)\//.test(normalized)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    || /_test\.go$/.test(normalized)
    || /(^|\/)test_[^/]+\.py$/.test(normalized);
}

function groupSourceFilesByModule(rootPath: string, files: string[]): Map<string, string[]> {
  const modules = new Map<string, string[]>();
  for (const file of files) {
    const rel = relativePath(file, rootPath).replace(/\\/g, '/');
    const module = moduleNameFromRelative(rel);
    const bucket = modules.get(module) || [];
    bucket.push(rel);
    modules.set(module, bucket.sort());
  }
  return modules;
}

function groupTestFilesByModule(rootPath: string, files: string[]): Map<string, string[]> {
  const modules = new Map<string, string[]>();
  for (const file of files) {
    const rel = relativePath(file, rootPath).replace(/\\/g, '/');
    const module = moduleNameFromTestRelative(rel);
    const bucket = modules.get(module) || [];
    bucket.push(rel);
    modules.set(module, bucket.sort());
  }
  return modules;
}

function moduleNameFromRelative(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return 'root';
  if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}`;
  if (['app', 'pages', 'components', 'lib', 'services', 'server', 'api'].includes(parts[0]) && parts.length > 1) {
    return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

function moduleNameFromTestRelative(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  if (parts[0] === 'tests' && parts[1]) return `src/${parts[1]}`;
  if (parts[0] === '__tests__' && parts[1]) return `src/${parts[1]}`;
  return moduleNameFromRelative(rel);
}

function suggestTestFile(sourceFile: string, language: string): string {
  const normalized = sourceFile.replace(/\\/g, '/');
  const ext = path.extname(normalized);
  const withoutExt = normalized.slice(0, -ext.length);
  if (language === 'go' || ext === '.go') return `${withoutExt}_test.go`;
  if (language === 'python' || ext === '.py') {
    const dir = path.posix.dirname(normalized);
    const base = path.posix.basename(withoutExt);
    return dir === '.' ? `tests/test_${base}.py` : `tests/${dir}/test_${base}.py`;
  }
  if (language === 'java' || ext === '.java') return withoutExt.replace(/^src\/main\//, 'src/test/') + 'Test.java';
  if (['.tsx', '.jsx'].includes(ext)) return `${withoutExt}.test${ext}`;
  if (['.ts', '.js', '.mjs', '.cjs'].includes(ext)) return `${withoutExt}.test${ext}`;
  return `${withoutExt}.test${ext || '.ts'}`;
}

function buildTestTargetRationale(status: AutopilotTestTarget['coverageStatus'], sourceCount: number, testCount: number): string {
  if (status === 'missing') return `${sourceCount} 个源码文件还没有对应测试，建议先补最小单元测试。`;
  if (status === 'partial') return `${sourceCount} 个源码文件仅发现 ${testCount} 个测试文件，建议补关键分支和失败场景。`;
  return `已发现 ${testCount} 个测试文件，当前先不作为补测重点。`;
}

function detectTestFrameworkName(identity: ProjectIdentity, packageScripts: string[]): string {
  if (identity.testFramework !== 'unknown') return identity.testFramework;
  const scripts = packageScripts.join('\n').toLowerCase();
  if (scripts.includes('vitest')) return 'vitest';
  if (scripts.includes('jest')) return 'jest';
  if (scripts.includes('playwright')) return 'playwright';
  if (scripts.includes('pytest')) return 'pytest';
  if (scripts.includes('go test')) return 'go test';
  if (scripts.includes('mvn test')) return 'maven test';
  return '未识别，需先确认测试框架';
}

function detectTestCommand(identity: ProjectIdentity, packageScripts: string[]): string {
  const exactTest = packageScripts.find(script => /^test:\s*/i.test(script));
  if (exactTest) return 'npm run test';
  const preferred = packageScripts.find(script => /^test:[^:]+:\s*/i.test(script) || /vitest|jest|playwright|pytest/i.test(script));
  if (preferred) return `npm run ${preferred.split(':')[0]}`;
  if (identity.language === 'go') return 'go test ./...';
  if (identity.language === 'python') return 'pytest';
  if (identity.buildSystem === 'maven') return 'mvn test';
  if (identity.buildSystem === 'gradle') return './gradlew test';
  if (identity.language === 'rust') return 'cargo test';
  return '需要先配置测试命令';
}

function buildTestPlanNextSteps(missingModules: number, testFiles: number): string[] {
  if (missingModules === 0 && testFiles > 0) {
    return [
      '运行建议验证命令，确认现有测试可稳定通过。',
      '下一阶段再做覆盖率分析和端到端场景补齐。',
    ];
  }
  return [
    '先从 high 优先级模块开始，每次只补 1-2 个测试文件。',
    '每轮补测后自动运行建议验证命令，失败则回到小步修复。',
    '所有写入动作必须进入中文确认面板，用户只需选择执行、查看差异或取消。',
  ];
}

