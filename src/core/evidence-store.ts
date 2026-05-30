import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';

export type EvidenceKind = 'tool' | 'memory' | 'verification' | 'diff' | 'provider' | 'user';
export type EvidenceStatus = 'success' | 'failure' | 'warning';

export interface EvidenceRecord {
  id: string;
  taskId: string;
  kind: EvidenceKind;
  source: string;
  target?: string;
  status: EvidenceStatus;
  summary: string;
  contentRef?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceStoreSnapshot {
  version: 1;
  taskId: string;
  records: EvidenceRecord[];
  updatedAt: string;
}

export interface CreateEvidenceInput {
  taskId: string;
  kind: EvidenceKind;
  source: string;
  target?: string;
  status?: EvidenceStatus;
  content?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class EvidenceStore {
  private records: EvidenceRecord[] = [];

  constructor(private readonly rootPath: string, private readonly taskId: string) {}

  add(input: CreateEvidenceInput): EvidenceRecord {
    const content = input.content || '';
    const record: EvidenceRecord = {
      id: `ev-${Date.now().toString(36)}-${(this.records.length + 1).toString(36)}`,
      taskId: input.taskId || this.taskId,
      kind: input.kind,
      source: input.source,
      target: input.target,
      status: input.status || 'success',
      summary: input.summary || summarizeEvidenceContent(input.source, content),
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    this.records.push(record);
    return record;
  }

  list(): EvidenceRecord[] {
    return [...this.records];
  }

  latest(limit = 8): EvidenceRecord[] {
    return this.records.slice(-limit);
  }

  toProviderContext(limit = 8): string {
    const records = this.latest(limit);
    if (records.length === 0) return '';
    return records.map(record => {
      const target = record.target ? ` · ${normalizeEvidenceText(record.target, 120)}` : '';
      return `[证据:${record.kind}/${record.status}] ${record.source}${target}\n${record.summary}`;
    }).join('\n\n');
  }

  toUserSummary(limit = 8): string {
    const records = this.latest(limit);
    if (records.length === 0) return '暂无证据';
    return records.map(record => {
      const icon = record.status === 'success' ? '✓' : record.status === 'failure' ? '✗' : '!';
      const target = record.target ? ` ${normalizeEvidenceText(record.target, 80)}` : '';
      return `${icon} ${record.source}${target} — ${record.summary}`;
    }).join('\n');
  }

  async save(): Promise<string> {
    const dir = path.join(this.rootPath, '.icloser', 'agent-tasks', this.taskId);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'evidence.json');
    const snapshot: EvidenceStoreSnapshot = {
      version: 1,
      taskId: this.taskId,
      records: this.records,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(file, JSON.stringify(snapshot, null, 2), 'utf-8');
    return file;
  }

  static async load(rootPath: string, taskId: string): Promise<EvidenceStore> {
    const store = new EvidenceStore(rootPath, taskId);
    const file = path.join(rootPath, '.icloser', 'agent-tasks', taskId, 'evidence.json');
    try {
      const snapshot = JSON.parse(await readFile(file, 'utf-8')) as EvidenceStoreSnapshot;
      store.records = Array.isArray(snapshot.records) ? snapshot.records : [];
    } catch {
      // no previous evidence
    }
    return store;
  }
}

export function summarizeToolEvidence(toolName: string, args: Record<string, unknown>, result: string): string {
  const target = String(args.path || args.file || args.url || args.query || args.pattern || args.command || '').trim();
  return summarizeEvidenceContent(toolName + (target ? ` ${target}` : ''), result);
}

export function summarizeEvidenceContent(source: string, content: string, max = 900): string {
  const cleaned = normalizeEvidenceText(content, max * 3);
  if (!cleaned) return '无文本结果';
  if (source === 'search_code' || /找到 \d+ 条|匹配/.test(cleaned)) {
    const lines = cleaned.split('\n').filter(Boolean);
    return lines.slice(0, 12).join('\n').slice(0, max);
  }
  if (source === 'web_fetch') {
    const title = cleaned.match(/^标题:\s*(.+)$/m)?.[1];
    const body = cleaned.split('\n').filter(line => !/^标题:|^来源:|^发布时间:/.test(line.trim())).join('\n');
    return [title ? `标题：${title}` : '', body.slice(0, max)].filter(Boolean).join('\n');
  }
  return cleaned.slice(0, max);
}

export function normalizeEvidenceText(text: string, max = 2000): string {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\\/g, '/')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
