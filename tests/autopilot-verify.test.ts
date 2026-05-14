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
});
