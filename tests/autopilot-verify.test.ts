import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { formatAutopilotVerification, verifyAutopilotDocs, verifyAutopilotTests } from '../src/core/autopilot-verify.js';

describe('autopilot write verification', () => {
  it('passes markdown docs with headings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'PRD.md'), '# PRD\n\ncontent\n', 'utf-8');

      const receipt = await verifyAutopilotDocs(root, ['docs/PRD.md']);

      expect(receipt.status).toBe('pass');
      expect(receipt.summary).toContain('已校验');
      expect(formatAutopilotVerification(receipt)).toContain('验证通过');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails invalid markdown docs clearly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'PRD.md'), 'missing heading\n', 'utf-8');

      const receipt = await verifyAutopilotDocs(root, ['docs/PRD.md']);

      expect(receipt.status).toBe('fail');
      expect(receipt.summary).toContain('缺少一级标题');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips npm test command when dependencies are not installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');

      const receipt = await verifyAutopilotTests(root, 'npm run test');

      expect(receipt.status).toBe('skipped');
      expect(receipt.summary).toContain('依赖尚未安装');
      expect(receipt.suggestion).toContain('npm install');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips when no test command provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      const receipt = await verifyAutopilotTests(root, '');
      expect(receipt.status).toBe('skipped');
      expect(receipt.summary).toContain('未识别到');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips when command is placeholder string', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      const receipt = await verifyAutopilotTests(root, '需要先配置测试命令');
      expect(receipt.status).toBe('skipped');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips docs verification when file list is empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      const receipt = await verifyAutopilotDocs(root, []);
      expect(receipt.status).toBe('skipped');
      expect(receipt.summary).toContain('跳过');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when doc file does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      const receipt = await verifyAutopilotDocs(root, ['docs/MISSING.md']);
      expect(receipt.status).toBe('fail');
      expect(receipt.summary).toContain('不存在');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when doc file is empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'EMPTY.md'), '   ', 'utf-8');
      const receipt = await verifyAutopilotDocs(root, ['docs/EMPTY.md']);
      expect(receipt.status).toBe('fail');
      expect(receipt.summary).toContain('内容为空');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes multiple valid docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'icloser-autopilot-verify-'));
    try {
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(join(root, 'docs', 'A.md'), '# A\n\ncontent\n', 'utf-8');
      await writeFile(join(root, 'docs', 'B.md'), '# B\n\ncontent\n', 'utf-8');
      const receipt = await verifyAutopilotDocs(root, ['docs/A.md', 'docs/B.md']);
      expect(receipt.status).toBe('pass');
      expect(receipt.summary).toContain('2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('formatAutopilotVerification renders skipped status', () => {
    const text = formatAutopilotVerification({
      status: 'skipped', kind: 'tests', duration: 0, summary: '跳过验证',
    });
    expect(text).toContain('跳过');
    expect(text).toContain('跳过验证');
  });

  it('formatAutopilotVerification includes command and suggestion when present', () => {
    const text = formatAutopilotVerification({
      status: 'fail', kind: 'tests', command: 'npm test',
      duration: 100, summary: '测试失败', suggestion: '请检查错误',
    });
    expect(text).toContain('npm test');
    expect(text).toContain('请检查错误');
    expect(text).toContain('失败');
  });
});
