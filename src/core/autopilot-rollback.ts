import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';

export interface AutopilotRollbackSnapshot {
  file: string;
  fullPath: string;
  existed: boolean;
  content: string | null;
}

export interface AutopilotRollbackPlan {
  rootPath: string;
  reason: string;
  files: AutopilotRollbackSnapshot[];
  createdAt: string;
}

export interface AutopilotRollbackReceipt {
  file: string;
  fullPath: string;
  action: 'restored' | 'deleted' | 'skipped';
  ok: boolean;
  message: string;
}

export async function createAutopilotRollbackPlan(rootPath: string, files: string[], reason: string): Promise<AutopilotRollbackPlan> {
  const uniqueFiles = [...new Set(files.map(normalizeRelativeFile).filter(Boolean))];
  const snapshots: AutopilotRollbackSnapshot[] = [];

  for (const file of uniqueFiles) {
    const fullPath = resolveInsideRoot(rootPath, file);
    const existed = existsSync(fullPath);
    snapshots.push({
      file,
      fullPath,
      existed,
      content: existed ? await readFile(fullPath, 'utf-8') : null,
    });
  }

  return {
    rootPath,
    reason,
    files: snapshots,
    createdAt: new Date().toISOString(),
  };
}

export async function rollbackAutopilotChanges(plan: AutopilotRollbackPlan): Promise<AutopilotRollbackReceipt[]> {
  const receipts: AutopilotRollbackReceipt[] = [];

  for (const snapshot of plan.files) {
    try {
      const fullPath = resolveInsideRoot(plan.rootPath, snapshot.file);
      if (snapshot.existed) {
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, snapshot.content || '', 'utf-8');
        receipts.push({ file: snapshot.file, fullPath, action: 'restored', ok: true, message: '已恢复到写入前内容' });
        continue;
      }

      if (existsSync(fullPath)) {
        await rm(fullPath, { force: true });
        receipts.push({ file: snapshot.file, fullPath, action: 'deleted', ok: true, message: '已删除本轮新建文件' });
      } else {
        receipts.push({ file: snapshot.file, fullPath, action: 'skipped', ok: true, message: '文件已不存在，无需回滚' });
      }
    } catch (err) {
      receipts.push({
        file: snapshot.file,
        fullPath: snapshot.fullPath,
        action: 'skipped',
        ok: false,
        message: (err as Error).message,
      });
    }
  }

  return receipts;
}

export function renderAutopilotRollbackPlan(plan: AutopilotRollbackPlan): string {
  const lines = [
    '验证失败，系统已准备回滚方案。',
    '',
    `原因：${plan.reason}`,
    `项目路径：${plan.rootPath}`,
    '',
    '将处理：',
  ];

  if (plan.files.length === 0) lines.push('- 没有可回滚文件。');
  for (const file of plan.files) {
    lines.push(`- ${file.file}：${file.existed ? '恢复写入前内容' : '删除本轮新建文件'}`);
  }
  lines.push('', '规则：只处理本轮 autopilot 写入前已快照的文件，不回滚其它用户改动。');
  return lines.join('\n');
}

export function renderAutopilotRollbackReceipts(receipts: AutopilotRollbackReceipt[]): string {
  if (receipts.length === 0) return '没有文件被回滚。';
  return receipts.map(receipt => {
    const status = receipt.ok ? '✓' : '✗';
    return `${status} ${receipt.file}：${receipt.message}\n  路径 ${receipt.fullPath}`;
  }).join('\n');
}

function normalizeRelativeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function resolveInsideRoot(rootPath: string, file: string): string {
  const root = path.resolve(rootPath);
  const fullPath = path.resolve(root, file);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝回滚项目目录外的文件：${file}`);
  }
  return fullPath;
}
