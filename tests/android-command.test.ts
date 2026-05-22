import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildAndroidDoctorReport } from '../src/commands/android.js';

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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports blocked when no SDK is discoverable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ic-android-missing-'));
    try {
      const report = await buildAndroidDoctorReport(dir, {});
      expect(report.status).toBe('blocked');
      expect(report.issues.join('\n')).toContain('Android SDK not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
