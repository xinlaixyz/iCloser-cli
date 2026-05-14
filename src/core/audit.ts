// Audit Engine — Agent action audit log
// Records key actions during task execution for traceability and report integration.
import * as path from 'path';
import { appendFile } from 'fs/promises';
import { ensureDir, readFile, fileExists } from '../utils/fs.js';
import type { AuditEvent, AuditActor, AuditAction, AuditResult } from '../types.js';

// ============================================================
// Append
// ============================================================
export interface AppendAuditOptions {
  taskId?: string;
  sessionId?: string;
  durationMs?: number;
  tokensUsed?: number;
  payload?: Record<string, unknown>;
}

export async function appendAuditEvent(
  rootPath: string,
  actor: AuditActor,
  action: AuditAction,
  target: string,
  result: AuditResult,
  options: AppendAuditOptions = {}
): Promise<AuditEvent> {
  const now = new Date().toISOString();
  const id = `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const rawPayload = options.payload || {};
  const sanitized = sanitizeAuditPayload(rawPayload);
  const payload = sanitized.payload;

  const event: AuditEvent = {
    id,
    actor,
    action,
    target,
    taskId: options.taskId,
    sessionId: options.sessionId,
    result,
    durationMs: options.durationMs,
    tokensUsed: options.tokensUsed,
    payload,
    createdAt: now,
    redacted: sanitized.redacted,
  };
  if (sanitized.redactionReason) {
    event.redactionReason = sanitized.redactionReason;
  }

  const auditDir = path.join(rootPath, '.icloser', 'audit');
  await ensureDir(auditDir);
  await appendFile(path.join(auditDir, 'events.jsonl'), JSON.stringify(event) + '\n', 'utf-8');

  return event;
}

// ============================================================
// Load
// ============================================================
export interface LoadAuditOptions {
  taskId?: string;
  action?: AuditAction;
  limit?: number;
}

export async function loadAuditEvents(
  rootPath: string,
  options: LoadAuditOptions = {}
): Promise<AuditEvent[]> {
  const eventsPath = path.join(rootPath, '.icloser', 'audit', 'events.jsonl');
  if (!(await fileExists(eventsPath))) return [];

  const content = await readFile(eventsPath);
  let events: AuditEvent[] = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as AuditEvent; }
      catch { return null as unknown as AuditEvent; }
    })
    .filter((e): e is AuditEvent => e !== null && typeof e.id === 'string');

  if (options.taskId) {
    events = events.filter(e => e.taskId === options.taskId);
  }
  if (options.action) {
    events = events.filter(e => e.action === options.action);
  }
  if (options.limit && options.limit > 0) {
    events = events.slice(-options.limit);
  }

  return events;
}

// ============================================================
// Sanitize
// ============================================================
const SENSITIVE_KEYS = new Set([
  'apiKey', 'apikey', 'api_key', 'key',
  'token', 'accessToken', 'access_token',
  'password', 'passwd', 'pass',
  'secret', 'privateKey', 'private_key',
]);

function maskSecret(value: string): string {
  if (value.length <= 8) return '<redacted>';
  return value.substring(0, 4) + '...' + value.substring(value.length - 4);
}

export function sanitizeAuditPayload(
  payload: Record<string, unknown>
): { payload: Record<string, unknown>; redacted: boolean; redactionReason?: string } {
  let redacted = false;
  const reasons: string[] = [];

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_KEYS.has(lowerKey)) {
      redacted = true;
      reasons.push(key);
      if (typeof value === 'string' && value.length > 0) {
        sanitized[key] = maskSecret(value);
      } else {
        sanitized[key] = '<redacted>';
      }
      continue;
    }

    if (typeof value === 'string') {
      const keyPatterns = [
        /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
        /\bsk-[A-Za-z0-9_-]{16,}\b/g,
        /\bdashscope-[A-Za-z0-9_-]{8,}\b/g,
        /\bqwen-[A-Za-z0-9_-]{8,}\b/g,
      ];
      let strValue = value;
      for (const pat of keyPatterns) {
        const before = strValue;
        strValue = strValue.replace(pat, match => {
          redacted = true;
          reasons.push(key);
          return maskSecret(match);
        });
        if (strValue !== before) break;
      }
      sanitized[key] = strValue;
    } else if (typeof value === 'object' && value !== null) {
      const nested = sanitizeAuditPayload(value as Record<string, unknown>);
      if (nested.redacted) {
        redacted = true;
        reasons.push(key);
      }
      sanitized[key] = nested.payload;
    } else {
      sanitized[key] = value;
    }
  }

  return {
    payload: sanitized,
    redacted,
    redactionReason: redacted ? reasons.join(', ') : undefined,
  };
}

// ============================================================
// Helpers
// ============================================================
export function auditActionLabel(action: AuditAction): string {
  const labels: Record<AuditAction, string> = {
    'task-created': '创建任务',
    'task-started': '开始执行',
    'ai-called': 'AI 调用',
    'file-written': '写入文件',
    'file-fixed': '自动修复',
    'verify-run': '验证',
    'verify-passed': '验证通过',
    'verify-failed': '验证失败',
    'report-generated': '生成报告',
    'memory-updated': '记忆更新',
  };
  return labels[action] || action;
}
