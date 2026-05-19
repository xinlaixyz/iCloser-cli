import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile, readdir } from 'fs/promises';
import * as path from 'path';

export interface AutopilotRollbackSnapshot {
  file: string;
  fullPath: string;
  existed: boolean;
  content: string | null;
  bytes: number;
}

export interface AutopilotRollbackPlanMeta {
  fileCount: number;
  newFileCount: number;
  existingFileCount: number;
  totalBytes: number;
  readableTime: string;
}

export interface AutopilotRollbackPlan {
  version: 1;
  rootPath: string;
  reason: string;
  files: AutopilotRollbackSnapshot[];
  createdAt: string;
  meta: AutopilotRollbackPlanMeta;
}

export interface AutopilotRollbackReceipt {
  file: string;
  fullPath: string;
  action: 'restored' | 'deleted' | 'skipped';
  ok: boolean;
  message: string;
}

export interface AutopilotRollbackDryRunEntry {
  file: string;
  action: 'would-restore' | 'would-delete' | 'no-op';
  existed: boolean;
  currentlyExists: boolean;
  bytes: number;
}

export interface AutopilotRollbackListItem {
  id: string;
  reason: string;
  createdAt: string;
  readableTime: string;
  fileCount: number;
  totalBytes: number;
  latest: boolean;
}

function computeMeta(files: AutopilotRollbackSnapshot[]): AutopilotRollbackPlanMeta {
  const newFileCount = files.filter(f => !f.existed).length;
  const existingFileCount = files.filter(f => f.existed).length;
  const totalBytes = files.reduce((sum, f) => sum + (f.bytes || 0), 0);
  return {
    fileCount: files.length,
    newFileCount,
    existingFileCount,
    totalBytes,
    readableTime: formatLocalTime(new Date()),
  };
}

function formatLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ============================================================
// Core API
// ============================================================

export async function createAutopilotRollbackPlan(rootPath: string, files: string[], reason: string): Promise<AutopilotRollbackPlan> {
  const uniqueFiles = [...new Set(files.map(normalizeRelativeFile).filter(Boolean))];
  const snapshots: AutopilotRollbackSnapshot[] = [];

  for (const file of uniqueFiles) {
    const fullPath = resolveInsideRoot(rootPath, file);
    const existed = existsSync(fullPath);
    let content: string | null = null;
    let bytes = 0;
    if (existed) {
      content = await readFile(fullPath, 'utf-8');
      bytes = Buffer.byteLength(content, 'utf-8');
    }
    snapshots.push({ file, fullPath, existed, content, bytes });
  }

  return {
    version: 1,
    rootPath,
    reason,
    files: snapshots,
    createdAt: new Date().toISOString(),
    meta: computeMeta(snapshots),
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

export async function dryRunAutopilotRollback(plan: AutopilotRollbackPlan): Promise<AutopilotRollbackDryRunEntry[]> {
  return plan.files.map(snapshot => {
    const currentlyExists = existsSync(snapshot.fullPath);
    let action: AutopilotRollbackDryRunEntry['action'];
    if (snapshot.existed && currentlyExists) {
      action = 'would-restore';
    } else if (!snapshot.existed && currentlyExists) {
      action = 'would-delete';
    } else {
      action = 'no-op';
    }
    return {
      file: snapshot.file,
      action,
      existed: snapshot.existed,
      currentlyExists,
      bytes: snapshot.bytes || 0,
    };
  });
}

// ============================================================
// Persistence
// ============================================================

const SNAPSHOT_PREFIX = 'autopilot-rollback-';
const LEGACY_SNAPSHOT_FILE = 'latest-autopilot-rollback.json';

export async function persistAutopilotRollbackPlan(plan: AutopilotRollbackPlan): Promise<string> {
  const snapshotDir = path.join(plan.rootPath, '.icloser', 'snapshots');
  await mkdir(snapshotDir, { recursive: true });
  // Timestamped filename so history is preserved
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${SNAPSHOT_PREFIX}${ts}.json`;
  const snapshotPath = path.join(snapshotDir, filename);
  await writeFile(snapshotPath, JSON.stringify(plan, null, 2), 'utf-8');
  return filename;
}

export async function loadLatestAutopilotRollbackPlan(rootPath: string): Promise<AutopilotRollbackPlan | null> {
  const snapshotDir = path.join(rootPath, '.icloser', 'snapshots');
  if (!existsSync(snapshotDir)) return null;

  let filenames: string[];
  try {
    filenames = await readdir(snapshotDir);
  } catch {
    return null;
  }

  // Prefer timestamped snapshots, fall back to legacy
  const snapshotFiles = filenames
    .filter(f => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith('.json'))
    .sort()
    .reverse();

  const legacyPath = path.join(snapshotDir, LEGACY_SNAPSHOT_FILE);

  if (snapshotFiles.length > 0) {
    const raw = await readFile(path.join(snapshotDir, snapshotFiles[0]), 'utf-8');
    return JSON.parse(raw) as AutopilotRollbackPlan;
  }

  if (existsSync(legacyPath)) {
    const raw = await readFile(legacyPath, 'utf-8');
    return JSON.parse(raw) as AutopilotRollbackPlan;
  }

  return null;
}

export async function listAutopilotRollbackSnapshots(rootPath: string): Promise<AutopilotRollbackListItem[]> {
  const snapshotDir = path.join(rootPath, '.icloser', 'snapshots');
  if (!existsSync(snapshotDir)) return [];

  let filenames: string[];
  try {
    filenames = await readdir(snapshotDir);
  } catch {
    return [];
  }

  const plans: { filename: string; plan: AutopilotRollbackPlan }[] = [];

  for (const f of filenames) {
    if (!f.startsWith(SNAPSHOT_PREFIX) || !f.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(snapshotDir, f), 'utf-8');
      const plan = JSON.parse(raw) as AutopilotRollbackPlan;
      plans.push({ filename: f, plan });
    } catch {
      // corrupted snapshot — skip
    }
  }

  // Also include legacy snapshot
  const legacyPath = path.join(snapshotDir, LEGACY_SNAPSHOT_FILE);
  if (existsSync(legacyPath)) {
    try {
      const raw = await readFile(legacyPath, 'utf-8');
      const plan = JSON.parse(raw) as AutopilotRollbackPlan;
      plans.push({ filename: LEGACY_SNAPSHOT_FILE, plan });
    } catch { /* skip */ }
  }

  plans.sort((a, b) => b.plan.createdAt.localeCompare(a.plan.createdAt));

  return plans.map((p, i) => ({
    id: p.filename.replace(/\.json$/, ''),
    reason: p.plan.reason,
    createdAt: p.plan.createdAt,
    readableTime: p.plan.meta?.readableTime || p.plan.createdAt,
    fileCount: p.plan.meta?.fileCount ?? p.plan.files.length,
    totalBytes: p.plan.meta?.totalBytes ?? 0,
    latest: i === 0,
  }));
}

// ============================================================
// Rendering
// ============================================================

export function renderAutopilotRollbackPlan(plan: AutopilotRollbackPlan): string {
  const lines = [
    '验证失败，系统已准备回滚方案。',
    '',
    `原因：${plan.reason}`,
    `项目路径：${plan.rootPath}`,
    `快照时间：${plan.meta?.readableTime || plan.createdAt}`,
    `文件数：${plan.meta?.fileCount ?? plan.files.length}（${plan.meta?.newFileCount ?? 0} 新建 + ${plan.meta?.existingFileCount ?? 0} 已有）`,
    '',
    '将处理：',
  ];

  if (plan.files.length === 0) lines.push('- 没有可回滚文件。');
  for (const file of plan.files) {
    const sizeHint = file.bytes > 0 ? ` (${formatBytes(file.bytes)})` : '';
    lines.push(`- ${file.file}${sizeHint}：${file.existed ? '恢复写入前内容' : '删除本轮新建文件'}`);
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

export function renderAutopilotRollbackDryRun(entries: AutopilotRollbackDryRunEntry[]): string {
  if (entries.length === 0) return '没有需要回滚的文件。';

  const labels: Record<AutopilotRollbackDryRunEntry['action'], string> = {
    'would-restore': '将恢复到写入前内容',
    'would-delete': '将删除本轮新建文件',
    'no-op': '无需操作',
  };

  const lines = ['回滚预览（不会实际修改文件）：', ''];

  for (const e of entries) {
    const marker = e.action === 'no-op' ? '○' : '▶';
    const sizeHint = e.bytes > 0 ? ` (${formatBytes(e.bytes)})` : '';
    lines.push(`${marker} ${e.file}${sizeHint} — ${labels[e.action]}`);
  }

  const wouldChange = entries.filter(e => e.action !== 'no-op').length;
  lines.push('', `共 ${entries.length} 个文件，将回滚 ${wouldChange} 个。`);
  return lines.join('\n');
}

export function renderAutopilotRollbackSummary(list: AutopilotRollbackListItem[]): string {
  if (list.length === 0) return '没有找到 autopilot 快照。';

  const lines = ['Autopilot 回滚快照列表：', ''];

  for (const item of list) {
    const marker = item.latest ? '▶' : ' ';
    const latestTag = item.latest ? '  ← 最新' : '';
    lines.push(`${marker} ${item.readableTime} — ${item.reason}${latestTag}`);
    lines.push(`   ${item.fileCount} 个文件，${formatBytes(item.totalBytes)}`);
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// Helpers
// ============================================================

function normalizeRelativeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function resolveInsideRoot(rootPath: string, file: string): string {
  const root = path.resolve(rootPath);
  if (path.isAbsolute(file)) {
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`拒绝回滚项目目录外的文件：${file}`);
    }
  }
  const fullPath = path.resolve(root, file);
  const normalizedRoot = root.toLowerCase();
  const normalizedFull = fullPath.toLowerCase();
  if (!normalizedFull.startsWith(normalizedRoot + path.sep) && normalizedFull !== normalizedRoot) {
    throw new Error(`拒绝回滚项目目录外的文件：${file}`);
  }
  const relative = path.relative(root, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝回滚项目目录外的文件：${file}`);
  }
  return fullPath;
}
