import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { readFile } from '../utils/fs.js';

export type AutopilotVerifyStatus = 'pass' | 'fail' | 'skipped';

export interface AutopilotVerifyReceipt {
  status: AutopilotVerifyStatus;
  kind: 'docs' | 'tests';
  command?: string;
  duration: number;
  summary: string;
  stdout?: string;
  stderr?: string;
  suggestion?: string;
}

export async function verifyAutopilotDocs(rootPath: string, files: string[]): Promise<AutopilotVerifyReceipt> {
  const start = Date.now();
  const problems: string[] = [];

  for (const file of files) {
    const fullPath = path.join(rootPath, file);
    if (!existsSync(fullPath)) {
      problems.push(`${file} 不存在`);
      continue;
    }
    const content = await readFile(fullPath);
    if (!content.trim()) problems.push(`${file} 内容为空`);
    if (!/^#\s+/m.test(content)) problems.push(`${file} 缺少一级标题`);
  }

  if (files.length === 0) {
    return {
      status: 'skipped',
      kind: 'docs',
      duration: Date.now() - start,
      summary: '没有新写入文档，跳过文档校验',
    };
  }

  if (problems.length > 0) {
    return {
      status: 'fail',
      kind: 'docs',
      duration: Date.now() - start,
      summary: problems.slice(0, 5).join('；'),
      suggestion: '请重新运行 ic auto docs --go，或检查对应 docs 文件内容。',
    };
  }

  return {
    status: 'pass',
    kind: 'docs',
    duration: Date.now() - start,
    summary: `已校验 ${files.length} 个文档：文件存在、内容非空、包含一级标题`,
  };
}

export async function verifyAutopilotTests(rootPath: string, command: string): Promise<AutopilotVerifyReceipt> {
  const start = Date.now();
  if (!command || command === '需要先配置测试命令') {
    return {
      status: 'skipped',
      kind: 'tests',
      duration: Date.now() - start,
      summary: '未识别到可运行的测试命令',
      suggestion: '请先在 package.json 或项目配置中添加测试命令。',
    };
  }

  const dependencySkip = shouldSkipForMissingDependencies(rootPath, command);
  if (dependencySkip) {
    return {
      status: 'skipped',
      kind: 'tests',
      command,
      duration: Date.now() - start,
      summary: dependencySkip,
      suggestion: '请先运行 npm install，然后重新执行 ic auto tests --go。',
    };
  }

  try {
    const stdout = execSync(command, {
      cwd: rootPath,
      timeout: 120000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return {
      status: 'pass',
      kind: 'tests',
      command,
      duration: Date.now() - start,
      summary: '测试命令通过',
      stdout: summarizeOutput(stdout),
    };
  } catch (err) {
    const error = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; message?: string };
    return {
      status: 'fail',
      kind: 'tests',
      command,
      duration: Date.now() - start,
      summary: `测试命令失败${typeof error.status === 'number' ? `，exit=${error.status}` : ''}`,
      stdout: summarizeOutput(bufferToString(error.stdout)),
      stderr: summarizeOutput(bufferToString(error.stderr) || error.message || ''),
      suggestion: '保留本次测试文件，按失败摘要修复后重新运行验证；如需撤销可删除本次写入的测试文件。',
    };
  }
}

export function formatAutopilotVerification(receipt: AutopilotVerifyReceipt): string {
  const status = receipt.status === 'pass' ? '通过' : receipt.status === 'fail' ? '失败' : '跳过';
  const parts = [`验证${status}：${receipt.summary}`];
  if (receipt.command) parts.push(`命令：${receipt.command}`);
  if (receipt.suggestion) parts.push(`建议：${receipt.suggestion}`);
  return parts.join('\n');
}

function shouldSkipForMissingDependencies(rootPath: string, command: string): string | null {
  const lower = command.toLowerCase();
  if (/\bnpm\s+run\b|\bnpx\b|\bvitest\b|\bjest\b/.test(lower)) {
    if (!existsSync(path.join(rootPath, 'node_modules'))) {
      return '项目依赖尚未安装，跳过测试命令执行';
    }
  }
  return null;
}

function summarizeOutput(output: string): string {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.slice(-20).join('\n');
}

function bufferToString(value: string | Buffer | undefined): string {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf-8') : value;
}
