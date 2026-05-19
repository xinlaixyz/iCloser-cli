import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import type { AutopilotVerifyReceipt } from './autopilot-verify.js';

export interface AutopilotRepairPlan {
  kind: 'docs' | 'tests';
  summary: string;
  command?: string;
  files: string[];
  confidence: 'low' | 'medium' | 'high';
  autoApply: boolean;
  actions: string[];
  generatedAt: string;
}

export interface AutopilotRepairReceipt {
  file: string;
  fullPath: string;
  action: 'updated' | 'skipped';
  ok: boolean;
  message: string;
}

export async function applyAutopilotRepairPlan(rootPath: string, plan: AutopilotRepairPlan): Promise<AutopilotRepairReceipt[]> {
  if (!plan.autoApply) {
    return plan.files.map(file => ({
      file,
      fullPath: resolveInsideRoot(rootPath, file),
      action: 'skipped',
      ok: true,
      message: '当前失败类型只生成建议，不自动改写文件',
    }));
  }

  if (plan.kind === 'docs') return applyDocRepair(rootPath, plan);
  if (plan.kind === 'tests') return applyTestRepair(rootPath, plan);
  return plan.files.map(file => ({
    file,
    fullPath: resolveInsideRoot(rootPath, file),
    action: 'skipped',
    ok: true,
    message: `不支持修复类型：${plan.kind}`,
  }));
}

export function buildAutopilotRepairPlan(receipt: AutopilotVerifyReceipt, files: string[]): AutopilotRepairPlan {
  const evidence = [receipt.summary, receipt.stdout || '', receipt.stderr || '', receipt.suggestion || ''].join('\n').toLowerCase();
  const actions = receipt.kind === 'docs'
    ? buildDocRepairActions(evidence, files)
    : buildTestRepairActions(evidence, files, receipt.command);
  const confidence = inferConfidence(evidence, actions);

  return {
    kind: receipt.kind,
    summary: receipt.summary,
    command: receipt.command,
    files,
    confidence,
    autoApply: confidence !== 'low',
    actions,
    generatedAt: new Date().toISOString(),
  };
}

export function renderAutopilotRepairPlan(plan: AutopilotRepairPlan): string {
  const lines: string[] = [];
  lines.push('自动修复诊断');
  lines.push('');
  lines.push(`类型：${plan.kind === 'docs' ? '文档校验' : '测试校验'}`);
  lines.push(`可信度：${formatConfidence(plan.confidence)}`);
  lines.push(`可自动修复：${plan.autoApply ? '是' : '否'}`);
  if (plan.command) lines.push(`失败命令：${plan.command}`);
  lines.push(`失败摘要：${plan.summary}`);
  lines.push('');
  lines.push('涉及文件：');
  if (plan.files.length === 0) lines.push('- 暂无本轮写入文件');
  for (const file of plan.files) lines.push(`- ${file}`);
  lines.push('');
  lines.push('建议下一步：');
  plan.actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
  lines.push('');
  lines.push(plan.autoApply
    ? '当前策略：只允许自动修复本轮写入文件，修复后立即重新验证。'
    : '当前策略：先给出修复建议，不自动扩大修改范围；需要继续修复时，用户只需输入“继续修复”。');
  return lines.join('\n');
}

export function renderAutopilotRepairReceipts(receipts: AutopilotRepairReceipt[]): string {
  if (receipts.length === 0) return '没有文件被修复。';
  return receipts.map(receipt => {
    const status = receipt.ok ? '✓' : '✗';
    return `${status} ${receipt.file}：${receipt.message}\n  路径 ${receipt.fullPath}`;
  }).join('\n');
}

async function applyDocRepair(rootPath: string, plan: AutopilotRepairPlan): Promise<AutopilotRepairReceipt[]> {
  const receipts: AutopilotRepairReceipt[] = [];
  for (const file of plan.files) {
    const fullPath = resolveInsideRoot(rootPath, file);
    try {
      let content = existsSync(fullPath) ? await readFile(fullPath, 'utf-8') : '';
      const title = inferDocTitle(file);
      let changed = false;
      if (!content.trim()) {
        content = `# ${title}\n\n> 自动修复：原文档为空，请补充实际业务内容。\n`;
        changed = true;
      } else if (!/^#\s+/m.test(content)) {
        content = `# ${title}\n\n${content.trimStart()}`;
        changed = true;
      }

      if (!changed) {
        receipts.push({ file, fullPath, action: 'skipped', ok: true, message: '未发现可自动修复的问题' });
        continue;
      }

      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
      receipts.push({ file, fullPath, action: 'updated', ok: true, message: '已应用文档最小修复' });
    } catch (err) {
      receipts.push({ file, fullPath, action: 'skipped', ok: false, message: (err as Error).message });
    }
  }
  return receipts;
}

async function applyTestRepair(rootPath: string, plan: AutopilotRepairPlan): Promise<AutopilotRepairReceipt[]> {
  const receipts: AutopilotRepairReceipt[] = [];
  const evidence = `${plan.summary}\n${plan.actions.join('\n')}`.toLowerCase();
  const cmd = plan.command || '';

  for (const file of plan.files) {
    const fullPath = resolveInsideRoot(rootPath, file);
    try {
      if (!existsSync(fullPath)) {
        receipts.push({ file, fullPath, action: 'skipped', ok: true, message: '文件不存在，跳过修复' });
        continue;
      }

      let content = await readFile(fullPath, 'utf-8');
      let changed = false;
      let repairMsg = '';

      // Rule 1: Fix import path errors (Cannot find module / Module not found)
      if (evidence.includes('cannot find module') || evidence.includes('module not found') || evidence.includes('找不到模块')) {
        const result = fixBrokenImport(content, file, evidence, cmd);
        if (result.content !== content) {
          content = result.content;
          changed = true;
          repairMsg = result.message;
        }
      }

      // Rule 2: Fix syntax errors — missing closing braces/parens
      if (!changed && (evidence.includes('syntaxerror') || evidence.includes('unexpected token'))) {
        const result = fixSyntaxError(content, file);
        if (result.content !== content) {
          content = result.content;
          changed = true;
          repairMsg = result.message;
        }
      }

      // Rule 3: Fix TypeScript type errors in imports
      if (!changed && (evidence.includes('typescript') || evidence.includes('ts(') || evidence.includes('has no exported member'))) {
        const result = fixTypeScriptImport(content, evidence);
        if (result.content !== content) {
          content = result.content;
          changed = true;
          repairMsg = result.message;
        }
      }

      if (!changed) {
        receipts.push({ file, fullPath, action: 'skipped', ok: true, message: '未匹配到可自动修复的错误模式' });
        continue;
      }

      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
      receipts.push({ file, fullPath, action: 'updated', ok: true, message: repairMsg || '已应用测试文件最小修复' });
    } catch (err) {
      receipts.push({ file, fullPath, action: 'skipped', ok: false, message: (err as Error).message });
    }
  }

  return receipts;
}

function fixBrokenImport(content: string, file: string, evidence: string, _command: string): { content: string; message: string } {
  const importRegex = /^(import\s+(?:\*\s+as\s+\w+\s+from\s+)?['"])([^'"]+)(['"])/gm;
  const requireRegex = /(require\s*\(\s*['"])([^'"]+)(['"]\s*\))/g;
  let match: RegExpExecArray | null;

  // Try ESM imports first
  while ((match = importRegex.exec(content)) !== null) {
    const [fullMatch, prefix, importPath, suffix] = match;
    if (importPath.startsWith('.')) {
      // Check if the import path resolves to anything reasonable
      const attempt = tryFixRelativePath(file, importPath);
      if (attempt && attempt !== importPath) {
        const fixed = prefix + attempt + suffix;
        return {
          content: content.replace(fullMatch, fixed),
          message: `修正导入路径 ${importPath} → ${attempt}`,
        };
      }
    }
    // If import looks broken (e.g., has double extensions like .ts.ts)
    if (importPath.endsWith('.ts.ts') || importPath.endsWith('.tsx.tsx')) {
      const fixedPath = importPath.replace(/(\.(?:ts|tsx|js|jsx))(\.(?:ts|tsx|js|jsx))$/i, '$1');
      const fixed = prefix + fixedPath + suffix;
      return {
        content: content.replace(fullMatch, fixed),
        message: `修正重复扩展名 ${importPath} → ${fixedPath}`,
      };
    }
  }

  // Try CommonJS requires
  requireRegex.lastIndex = 0;
  while ((match = requireRegex.exec(content)) !== null) {
    const [fullMatch, prefix, importPath, suffix] = match;
    if (importPath.startsWith('.')) {
      const attempt = tryFixRelativePath(file, importPath);
      if (attempt && attempt !== importPath) {
        const fixed = prefix + attempt + suffix;
        return {
          content: content.replace(fullMatch, fixed),
          message: `修正 require 路径 ${importPath} → ${attempt}`,
        };
      }
    }
  }

  return { content, message: '' };
}

function tryFixRelativePath(testFile: string, importPath: string): string | null {
  const testDir = path.posix.dirname(testFile);
  const resolved = path.posix.join(testDir, importPath);

  // Remove trailing extension to check
  const withoutExt = resolved.replace(/\.[^.]+$/, '');
  const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', ''];
  for (const ext of possibleExtensions) {
    if (existsSync(resolved + ext) || existsSync(withoutExt + ext)) {
      return importPath; // Path is fine
    }
  }

  // Try removing one directory level (e.g., ../../../src → ../../src)
  const parts = resolved.split('/');
  for (let i = 0; i < Math.min(3, parts.length); i++) {
    const candidate = parts.slice(i).join('/');
    for (const ext of possibleExtensions) {
      if (existsSync(candidate + ext)) {
        const newRelative = path.posix.relative(testDir, candidate);
        return newRelative.startsWith('.') ? newRelative : './' + newRelative;
      }
      // Try with /index pattern
      if (existsSync(candidate + '/index' + ext)) {
        const newRelative = path.posix.relative(testDir, candidate);
        return (newRelative.startsWith('.') ? newRelative : './' + newRelative) + '/index';
      }
    }
  }

  return null;
}

function fixSyntaxError(content: string, _file: string): { content: string; message: string } {
  // Check for mismatched braces
  const opens = (content.match(/[{[(]/g) || []).length;
  const closes = (content.match(/[}\])]/g) || []).length;
  if (opens > closes) {
    const missing = opens - closes;
    // Add missing closing braces at end
    const lines = content.split('\n');
    // Find last non-empty, non-comment line
    let insertIdx = lines.length - 1;
    while (insertIdx >= 0 && !lines[insertIdx].trim()) insertIdx--;
    const indent = lines[insertIdx] ? (lines[insertIdx].match(/^(\s*)/)?.[1] || '') : '';
    const closingBraces = Array.from({ length: missing }, (_, i) => indent.slice(0, Math.max(0, indent.length - i * 2)) + '}');
    lines.splice(insertIdx + 1, 0, ...closingBraces.reverse());
    return {
      content: lines.join('\n'),
      message: `补全 ${missing} 个缺失的闭合括号`,
    };
  }

  return { content, message: '' };
}

function fixTypeScriptImport(content: string, evidence: string): { content: string; message: string } {
  // If "has no exported member" or "not a module", try changing to default import
  if (evidence.includes('has no exported member') || evidence.includes('not a module')) {
    // Change `import * as X from` to `import X from` for default-export-only modules
    const namedImportRegex = /^import\s+\*\s+as\s+(\w+)\s+from\s+(['"][^'"]+['"])/m;
    const match = namedImportRegex.exec(content);
    if (match) {
      const [fullMatch, name, pathStr] = match;
      const fixed = `import ${name} from ${pathStr}`;
      return {
        content: content.replace(fullMatch, fixed),
        message: `将命名空间导入改为默认导入：import * as ${name} → import ${name}`,
      };
    }
  }

  return { content, message: '' };
}


function buildDocRepairActions(evidence: string, files: string[]): string[] {
  const actions: string[] = [];
  if (evidence.includes('缺少一级标题')) actions.push('为失败文档补充 Markdown 一级标题，例如 # PRD / # API / # TESTING。');
  if (evidence.includes('内容为空')) actions.push('重新生成非空文档内容，至少包含用途、当前项目事实、待补充项。');
  if (evidence.includes('不存在')) actions.push('重新检查 docs 目录路径，并只在当前项目 docs/ 下写入缺失文件。');
  if (actions.length === 0) actions.push('重新运行文档校验，按失败摘要逐个修正文档格式。');
  if (files.length > 0) actions.push('修复范围限制在本轮写入文件内，不覆盖用户已有文档。');
  return actions;
}

function buildTestRepairActions(evidence: string, files: string[], command?: string): string[] {
  const actions: string[] = [];
  if (evidence.includes('cannot find module') || evidence.includes('module not found') || evidence.includes('找不到模块')) {
    actions.push('检查测试文件 import 路径，优先改为相对路径并匹配源文件实际导出。');
  }
  if (evidence.includes('syntaxerror') || evidence.includes('语法')) actions.push('修复测试文件语法错误，保持最小断言，不引入复杂 mock。');
  if (evidence.includes('typescript') || evidence.includes('ts')) actions.push('按 TypeScript 错误调整导入或断言类型，避免使用不存在的默认导出。');
  if (evidence.includes('no test') || evidence.includes('没有测试')) actions.push('确认测试文件命名符合项目框架约定，例如 *.test.ts 或 *.spec.ts。');
  if (actions.length === 0) actions.push('根据失败输出保留最小测试目标，先修 import、再修断言、最后重跑验证命令。');
  if (command) actions.push(`修复后重新运行：${command}`);
  if (files.length > 0) actions.push('修复范围限制在本轮写入的测试文件内。');
  return actions;
}

function inferConfidence(evidence: string, actions: string[]): AutopilotRepairPlan['confidence'] {
  if (/缺少一级标题|内容为空|cannot find module|module not found|syntaxerror/.test(evidence)) return 'high';
  return actions.length >= 2 ? 'medium' : 'low';
}

function inferDocTitle(file: string): string {
  const base = path.basename(file, path.extname(file)).trim();
  if (!base) return 'Document';
  if (/^prd$/i.test(base)) return 'PRD';
  if (/^api$/i.test(base)) return 'API';
  if (/^testing$/i.test(base)) return 'TESTING';
  if (/^architecture$/i.test(base)) return 'ARCHITECTURE';
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function resolveInsideRoot(rootPath: string, file: string): string {
  const root = path.resolve(rootPath);
  const fullPath = path.resolve(root, file);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝修复项目目录外的文件：${file}`);
  }
  return fullPath;
}

function formatConfidence(confidence: AutopilotRepairPlan['confidence']): string {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

