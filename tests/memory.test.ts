import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  classifyMemoryRisk,
  compressMemoryCandidate,
  loadProjectMemory,
  loadUserInputEvents,
  recordUserInputEvent,
  sanitizeUserInput,
} from '../src/core/memory.js';

describe('S4 memory input events', () => {
  it('records every user input as a traceable short-term event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-'));
    try {
      const event = await recordUserInputEvent(root, '帮我给登录模块加验证码', {
        kind: 'task-description',
        taskId: 'task-memory-test',
        sessionId: 'session-test',
      });

      expect(event.kind).toBe('task-description');
      expect(event.content).toContain('验证码');
      expect(event.metadata.source).toBe('user');
      expect(event.metadata.taskId).toBe('task-memory-test');
      expect(event.metadata.rawInputRef).toBe(event.id);
      expect(event.metadata.sourceEventIds).toEqual([event.id]);

      const events = await loadUserInputEvents(root);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);

      const memory = await loadProjectMemory(root);
      expect(memory.inputEvents).toHaveLength(1);
      expect(memory.inputEvents[0].metadata.reviewStatus).toBe('draft');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('redacts api keys before writing user input memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-redact-'));
    const key = 'sk-1234567890abcdef1234567890abcdef';
    try {
      const event = await recordUserInputEvent(root, `/apikey deepseek ${key}`, {
        kind: 'slash-command',
      });

      expect(event.redacted).toBe(true);
      expect(event.content).not.toContain(key);
      expect(event.metadata.riskLevel).toBe('high');

      const rawLog = await readFile(join(root, '.icloser', 'input-events.jsonl'), 'utf-8');
      expect(rawLog).not.toContain(key);
      expect(rawLog).toContain('sk-1');
      expect(rawLog).toContain('cdef');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes old project memory files without inputEvents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-legacy-'));
    try {
      await mkdir(join(root, '.icloser'), { recursive: true });
      await writeFile(join(root, '.icloser', 'memory.json'), JSON.stringify({
        projectId: 'legacy',
        rules: [],
        decisions: [],
        taskHistory: [],
        feedbacks: [],
        snapshot: { modules: '', dependencies: '', architecture: '', timestamp: new Date().toISOString(), compressedSize: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }), 'utf-8');

      const memory = await loadProjectMemory(root);
      expect(memory.inputEvents).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sanitizes explicit secret assignments', () => {
    const sanitized = sanitizeUserInput('token=super-secret-token-value');
    expect(sanitized.redacted).toBe(true);
    expect(sanitized.content).toBe('token=<redacted>');
  });

  it('auto-approves low-risk project preferences without user review burden', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-auto-'));
    try {
      await recordUserInputEvent(root, '以后报告默认用中文，少用英文术语', {
        kind: 'rule',
        sessionId: 'session-auto',
      });

      const memory = await loadProjectMemory(root);
      expect(memory.memoryCandidates).toHaveLength(1);
      const candidate = memory.memoryCandidates[0];
      expect(candidate.kind).toBe('preference');
      expect(candidate.riskLevel).toBe('low');
      expect(candidate.reviewStatus).toBe('approved');
      expect(candidate.suggestedAction).toBe('auto-approve-project');
      expect(candidate.summary).toContain('中文');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks database schema rules as high-risk ask-now candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-risk-'));
    try {
      await recordUserInputEvent(root, '以后登录相关任务不要直接修改数据库 schema', {
        kind: 'rule',
        taskId: 'task-risk',
      });

      const memory = await loadProjectMemory(root);
      expect(memory.memoryCandidates).toHaveLength(1);
      const candidate = memory.memoryCandidates[0];
      expect(candidate.kind).toBe('rule');
      expect(candidate.riskLevel).toBe('high');
      expect(candidate.reviewStatus).toBe('proposed');
      expect(candidate.suggestedAction).toBe('ask-now');
      expect(candidate.metadata.taskId).toBe('task-risk');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('archives sensitive inputs as redacted audit candidates only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-memory-sensitive-'));
    const key = 'sk-sensitive1234567890abcdef';
    try {
      await recordUserInputEvent(root, key, { kind: 'api-key' });

      const memory = await loadProjectMemory(root);
      expect(memory.memoryCandidates).toHaveLength(1);
      const candidate = memory.memoryCandidates[0];
      expect(candidate.kind).toBe('sensitive');
      expect(candidate.reviewStatus).toBe('archived');
      expect(candidate.suggestedAction).toBe('ignore');
      expect(JSON.stringify(candidate)).not.toContain(key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies and compresses memory candidates deterministically', () => {
    expect(classifyMemoryRisk('以后所有项目都默认中文报告', 'rule')).toBe('medium');
    expect(classifyMemoryRisk('以后不要修改数据库 schema', 'rule')).toBe('high');
    expect(compressMemoryCandidate('以后默认使用中文报告', 'preference')).toBe('偏好：默认使用中文报告');
  });
});
