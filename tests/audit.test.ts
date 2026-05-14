import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  appendAuditEvent,
  loadAuditEvents,
  sanitizeAuditPayload,
} from '../src/core/audit.js';

describe('S4 audit engine', () => {
  it('appends an audit event and writes to events.jsonl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-audit-'));
    try {
      await mkdir(join(root, 'package.json').replace('package.json', ''), { recursive: true });
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'audit-test' }));

      const event = await appendAuditEvent(root, 'agent', 'ai-called', 'mock', 'success', {
        taskId: 'task-audit-1',
        tokensUsed: 42,
        durationMs: 300,
      });

      expect(event.actor).toBe('agent');
      expect(event.action).toBe('ai-called');
      expect(event.taskId).toBe('task-audit-1');
      expect(event.tokensUsed).toBe(42);

      const eventsPath = join(root, '.icloser', 'audit', 'events.jsonl');
      expect(existsSync(eventsPath)).toBe(true);

      const raw = await readFile(eventsPath, 'utf-8');
      expect(raw).toContain('"actor":"agent"');
      expect(raw).toContain('"action":"ai-called"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads audit events with taskId and action filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-audit-'));
    try {
      await mkdir(join(root, 'package.json').replace('package.json', ''), { recursive: true });
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'audit-test' }));

      await appendAuditEvent(root, 'user', 'task-created', 'task-1', 'success', { taskId: 'task-1' });
      await appendAuditEvent(root, 'agent', 'ai-called', 'mock', 'success', { taskId: 'task-1' });
      await appendAuditEvent(root, 'agent', 'file-written', 'src/a.ts', 'success', { taskId: 'task-1' });
      await appendAuditEvent(root, 'agent', 'file-written', 'src/b.ts', 'success', { taskId: 'task-2' });

      const all = await loadAuditEvents(root);
      expect(all.length).toBe(4);

      const task1 = await loadAuditEvents(root, { taskId: 'task-1' });
      expect(task1.length).toBe(3);

      const fileWritten = await loadAuditEvents(root, { action: 'file-written' });
      expect(fileWritten.length).toBe(2);

      const limited = await loadAuditEvents(root, { limit: 2 });
      expect(limited.length).toBe(2);
      // limit returns the LAST N events
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('redacts API keys from audit payload', () => {
    const result = sanitizeAuditPayload({
      model: 'gpt-4',
      apiKey: 'sk-1234567890abcdef1234567890abcdef',
    });
    expect(result.redacted).toBe(true);
    expect(result.payload.apiKey).not.toBe('sk-1234567890abcdef1234567890abcdef');
    expect(result.payload.apiKey).toContain('sk-1');
    expect(result.payload.apiKey).toContain('cdef');
  });

  it('redacts secrets and tokens', () => {
    const result = sanitizeAuditPayload({
      token: 'my-secret-token-value-long',
      password: 'hunter2',
      secret: 'sssh',
      name: 'safe-field',
    });
    expect(result.redacted).toBe(true);
    expect(result.payload.token).toContain('...');
    expect(result.payload.password).toBe('<redacted>');
    expect(result.payload.secret).toBe('<redacted>');
    expect(result.payload.name).toBe('safe-field');
  });

  it('redacts API key patterns in string values', () => {
    const result = sanitizeAuditPayload({
      error: 'auth failed with key sk-1234567890abcdef1234567890abcdef',
    });
    expect(result.redacted).toBe(true);
    expect(result.payload.error).not.toContain('sk-1234567890abcdef');
    expect(result.payload.error).toContain('sk-1');
    expect(result.payload.error).toContain('cdef');
  });

  it('handles nested objects and empty payloads', () => {
    const result = sanitizeAuditPayload({
      nested: { apiKey: 'sk-secret', safe: 'ok' },
      empty: {},
    });
    expect(result.redacted).toBe(true);
    expect((result.payload.nested as any).apiKey).toContain('sk-');
    expect((result.payload.nested as any).safe).toBe('ok');
  });

  it('returns empty array for nonexistent audit log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-audit-empty-'));
    try {
      const events = await loadAuditEvents(root);
      expect(events).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
