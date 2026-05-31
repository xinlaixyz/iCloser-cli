// Auto Documentation Writer — generates missing doc drafts from AutopilotReport
import * as path from 'path';
import { fileExists, ensureDir, getFileSize, writeFile } from '../utils/fs.js';
import type { AutopilotReport } from './autopilot.js';

export interface DocDraft {
  file: string;
  title: string;
  content: string;
  exists: boolean;
}

export interface DocWritePlan {
  rootPath: string;
  docs: DocDraft[];
  totalNew: number;
  totalExisting: number;
}

export interface DocWriteReceipt extends DocDraft {
  fullPath: string;
  verified: boolean;
  bytes: number;
  lines: number;
}

export function buildDocDrafts(report: AutopilotReport): DocDraft[] {
  const drafts: DocDraft[] = [];
  const required = report.docs.required || ALL_REQUIRED_DOCS;
  const existingSet = new Set(report.docs.existing || []);

  for (const file of required) {
    const exists = existingSet.has(file);
    const draft = generateDraft(file, report);
    if (draft) drafts.push({ ...draft, exists });
  }

  return drafts;
}

export async function buildDocWritePlan(rootPath: string, report: AutopilotReport): Promise<DocWritePlan> {
  const drafts = buildDocDrafts(report);
  const docs: DocDraft[] = [];

  for (const draft of drafts) {
    const fullPath = path.join(rootPath, draft.file);
    const exists = await fileExists(fullPath);
    docs.push({ ...draft, exists });
  }

  return {
    rootPath,
    docs,
    totalNew: docs.filter(d => !d.exists).length,
    totalExisting: docs.filter(d => d.exists).length,
  };
}

export async function writeDocs(rootPath: string, plan: DocWritePlan, options: { overwrite?: boolean; selected?: string[] } = {}): Promise<DocWriteReceipt[]> {
  const docsDir = path.join(rootPath, 'docs');
  await ensureDir(docsDir);

  const selectedSet = options.selected ? new Set(options.selected) : null;
  const written: DocWriteReceipt[] = [];

  for (const draft of plan.docs) {
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

// ============================================================
// Draft generators — each produces markdown from project context
// ============================================================
function generateDraft(file: string, report: AutopilotReport): Omit<DocDraft, 'exists'> | null {
  switch (file) {
    case 'docs/README.md': return { file, title: 'README', content: generateReadme(report) };
    case 'docs/PRD.md': return { file, title: 'PRD', content: generatePrd(report) };
    case 'docs/ARCHITECTURE.md': return { file, title: 'ARCHITECTURE', content: generateArchitecture(report) };
    case 'docs/API.md': return { file, title: 'API', content: generateApi(report) };
    case 'docs/TESTING.md': return { file, title: 'TESTING', content: generateTesting(report) };
    default: return null;
  }
}

function generateReadme(report: AutopilotReport): string {
  const name = path.basename(report.rootPath);
  const { identity, summary } = report;
  return [
    `# ${name}`,
    '',
    '## 概述',
    '',
    `${name} — 基于 ${identity.language}${identity.framework !== 'unknown' ? ' / ' + identity.framework : ''} 构建。`,
    '',
    `- 语言：${identity.language}`,
    `- 框架：${identity.framework !== 'unknown' ? identity.framework : '无'}`,
    `- 构建系统：${identity.buildSystem}`,
    `- 测试框架：${identity.testFramework !== 'unknown' ? identity.testFramework : '无'}`,
    `- 运行时：${identity.runtime}`,
    '',
    `源码文件：${summary.sourceFiles} 个 | 模块：${summary.modules} 个 | 测试文件：${summary.testFiles} 个`,
    '',
    '## 快速开始',
    '',
    '```bash',
    `cd ${report.rootPath}`,
    ...(summary.packageScripts.some(s => s.startsWith('dev:')) ? [`${identity.buildSystem} run dev`] : []),
    ...(summary.packageScripts.some(s => /^build:/.test(s)) ? [`${identity.buildSystem} run build`] : []),
    ...(summary.packageScripts.some(s => /^test:/.test(s)) ? [`${identity.buildSystem} run test`] : []),
    '```',
    '',
    '## 项目结构',
    '',
    '> 由 icloser autopilot 自动生成，运行 `ic autopilot` 刷新。',
    '',
    '## 文档索引',
    '',
    '- [PRD](PRD.md) — 产品需求文档',
    '- [ARCHITECTURE](ARCHITECTURE.md) — 架构设计',
    '- [API](API.md) — 接口文档',
    '- [TESTING](TESTING.md) — 测试说明',
  ].join('\n') + '\n';
}

function generatePrd(report: AutopilotReport): string {
  const name = path.basename(report.rootPath);
  return [
    `# ${name} — 产品需求文档`,
    '',
    '## 项目简介',
    '',
    `${name} 是基于 ${report.identity.language} ${report.identity.framework !== 'unknown' ? '和 ' + report.identity.framework : ''} 开发的工程。`,
    '',
    '## 核心功能',
    '',
    '> 待补充：请根据实际业务填写核心功能描述。运行 `ic autopilot` 可刷新项目分析数据。',
    '',
    '## 技术栈',
    '',
    `- 语言：${report.identity.language}`,
    `- 框架：${report.identity.framework !== 'unknown' ? report.identity.framework : '无'}`,
    `- 构建：${report.identity.buildSystem}`,
    `- 测试：${report.identity.testFramework !== 'unknown' ? report.identity.testFramework : '无'}`,
    `- 运行时：${report.identity.runtime}`,
    `- 包管理器：${report.identity.packageManager || 'npm'}`,
    `- 部署形态：${report.identity.deploymentType !== 'unknown' ? report.identity.deploymentType : '未识别'}`,
    '',
    `规模：${report.summary.sourceFiles} 个源码文件，${report.summary.modules} 个模块。`,
    '',
    '## 用户角色',
    '',
    '> 待补充。',
    '',
    '## 非功能需求',
    '',
    '> 待补充：性能、安全、可维护性等约束。',
    '',
    '---',
    '',
    '> 本文档由 icloser autopilot 自动生成草稿，请根据实际项目情况补充完善。运行 `ic auto docs` 重新生成。',
  ].join('\n') + '\n';
}

function generateArchitecture(report: AutopilotReport): string {
  const name = path.basename(report.rootPath);
  const modules = report.summary.modules > 0
    ? `${report.summary.modules} 个模块`
    : '模块化结构待分析（运行 ic scan 更新索引）';
  return [
    `# ${name} — 架构设计文档`,
    '',
    '## 架构概览',
    '',
    `项目 ${name} 采用 ${modules} 组织代码。技术栈为 ${report.identity.language}${report.identity.framework !== 'unknown' ? ' + ' + report.identity.framework : ''}。`,
    '',
    '## 技术决策',
    '',
    `- 语言选择：${report.identity.language}`,
    `- 框架：${report.identity.framework !== 'unknown' ? report.identity.framework : '无框架，vanilla 方案'}`,
    `- 构建系统：${report.identity.buildSystem}`,
    `- 测试框架：${report.identity.testFramework !== 'unknown' ? report.identity.testFramework : '待确认'}`,
    `- 数据库：${report.identity.database !== 'unknown' ? report.identity.database : '无（或未识别）'}`,
    '',
    '## 模块划分',
    '',
    `当前项目包含 ${report.summary.sourceFiles} 个源码文件，分布在 ${report.summary.modules} 个模块中。`,
    '',
    '> 运行 `ic scan` 更新模块索引后，此处将显示详细模块职责和依赖关系。',
    '',
    '## 目录结构',
    '',
    '```',
    formatDirectoryTree(report),
    '```',
    '',
    '## 数据流',
    '',
    '> 待补充：描述请求/数据在模块间的流转路径。',
    '',
    '## 关键设计约束',
    '',
    '> 待补充：安全边界、性能基线、兼容性要求等。',
    '',
    '---',
    '',
    '> 本文档由 icloser autopilot 自动生成草稿，运行 `ic auto docs` 重新生成。',
  ].join('\n') + '\n';
}

function generateApi(report: AutopilotReport): string {
  return [
    `# ${path.basename(report.rootPath)} — API 文档`,
    '',
    '## 接口概览',
    '',
    `当前项目为 ${report.identity.language} 工程。`,
    report.identity.framework !== 'unknown'
      ? `框架 ${report.identity.framework} 的接口定义分布在源码模块中。`
      : '接口定义分布在源码文件中。',
    '',
    '## 接口列表',
    '',
    '> 待补充：具体接口路径、方法、参数和返回值。运行 `ic scan` 可自动识别 API 端点。',
    '',
    '## 认证与鉴权',
    '',
    '> 待补充。',
    '',
    '## 错误码',
    '',
    '> 待补充。',
    '',
    '---',
    '',
    '> 本文档由 icloser autopilot 自动生成草稿。',
  ].join('\n') + '\n';
}

function generateTesting(report: AutopilotReport): string {
  const { identity, summary } = report;
  const testScripts = summary.packageScripts.filter(s => /^test|vitest|jest|pytest/i.test(s));
  return [
    `# ${path.basename(report.rootPath)} — 测试说明`,
    '',
    '## 测试策略',
    '',
    summary.testFiles > 0
      ? `当前项目已有 ${summary.testFiles} 个测试文件。`
      : '当前项目暂未发现测试文件，建议先补最小单元测试。',
    '',
    '## 测试框架',
    '',
    identity.testFramework !== 'unknown'
      ? `检测到测试框架：${identity.testFramework}`
      : '未检测到明确测试框架。',
    '',
    '## 运行测试',
    '',
    testScripts.length > 0
      ? testScripts.map(s => `- \`${s}\``).join('\n')
      : '```bash\nnpm run test\n```',
    '',
    '## 测试覆盖目标',
    '',
    `源码文件 ${summary.sourceFiles} 个，分布在 ${summary.modules} 个模块中。`,
    summary.testFiles > 0
      ? `已有 ${summary.testFiles} 个测试文件。运行 \`ic auto tests\` 查看覆盖缺口。`
      : '运行 `ic auto tests` 生成测试计划，按优先级逐步补齐。',
    '',
    '## 编写测试规范',
    '',
    '> 待补充：测试命名规范、Mock 策略、CI 集成要求等。',
    '',
    '---',
    '',
    '> 本文档由 icloser autopilot 自动生成草稿。',
  ].join('\n') + '\n';
}

function formatDirectoryTree(report: AutopilotReport): string {
  const lines: string[] = [];
  lines.push(path.basename(report.rootPath) + '/');
  lines.push('├── src/');
  lines.push('│   ├── (源码模块)');
  if (report.summary.testFiles > 0) {
    lines.push('├── tests/');
    lines.push('│   ├── (测试文件)');
  }
  if (report.summary.docFiles > 0) {
    lines.push('└── docs/');
    lines.push('    ├── (文档文件)');
  }
  return lines.join('\n');
}

const ALL_REQUIRED_DOCS = [
  'docs/README.md',
  'docs/PRD.md',
  'docs/ARCHITECTURE.md',
  'docs/API.md',
  'docs/TESTING.md',
];

