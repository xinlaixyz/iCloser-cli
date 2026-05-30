import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildAndroidDoctorReport } from '../src/commands/android.js';

// 临时目录清理是 best-effort：Windows 上偶发 EPERM（句柄竞争）不应让已通过的测试变红。
function safeRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // 测试已断言完成，清理失败无害，忽略。
  }
}

describe('android command helpers', () => {
  it('uses local.properties sdk.dir when env is empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ic-android-'));
    try {
      writeFileSync(join(dir, 'local.properties'), 'sdk.dir=C\\:\\\\Android\\\\sdk\n');
      const report = await buildAndroidDoctorReport(dir, {});
      expect(report.sdkDir).toBe('C:\\Android\\sdk');
      expect(report.sdkSource).toBe('local.properties');
      expect(report.status).toMatch(/ready|partial|blocked/);
    } finally {
      safeRm(dir);
    }
  });

  it('reports blocked when no SDK is discoverable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ic-android-missing-'));
    try {
      const report = await buildAndroidDoctorReport(dir, {});
      expect(report.status).toBe('blocked');
      expect(report.issues.join('\n')).toContain('Android SDK not found');
    } finally {
      safeRm(dir);
    }
  });
});
