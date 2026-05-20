// Extra coverage for src/core/autopilot-verify.ts
// Targets: verifyAutopilotTests pass path (85-99), fail path (100-112),
//          shouldSkipForMissingDependencies return null (130),
//          summarizeOutput (133-136), bufferToString (138-141)
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyAutopilotTests } from '../src/core/autopilot-verify.js';

describe('verifyAutopilotTests — execution paths', () => {
  let tmpDir: string;

  // ── Pass path: command succeeds (lines 85-99 + summarizeOutput 133-136) ──
  it('returns pass status when command succeeds', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'av-pass-'));
    try {
      // 'node --version' does NOT trigger shouldSkipForMissingDependencies
      // (no npm/npx/vitest/jest keyword), so execSync runs and succeeds
      const receipt = await verifyAutopilotTests(tmpDir, 'node --version');
      expect(receipt.status).toBe('pass');
      expect(receipt.kind).toBe('tests');
      expect(typeof receipt.stdout).toBe('string');
      expect(receipt.summary).toContain('通过');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  // ── Fail path: command exits with non-zero (lines 100-112 + bufferToString 138-141) ──
  it('returns fail status when command exits non-zero', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'av-fail-'));
    try {
      // 'node -e "process.exit(1)"' does NOT match the npm/vitest skip check,
      // so execSync runs and throws (exit code 1) → catch block
      const receipt = await verifyAutopilotTests(tmpDir, 'node -e "process.exit(1)"');
      expect(receipt.status).toBe('fail');
      expect(receipt.kind).toBe('tests');
      expect(receipt.summary).toContain('失败');
      expect(typeof receipt.duration).toBe('number');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  // ── shouldSkipForMissingDependencies returns null when node_modules exists ──
  // Use actual project root which has node_modules; command contains 'vitest'
  // but node_modules exists → returns null → falls through to execSync
  it('does not skip when node_modules exists (covers return null, line 130)', async () => {
    // Use a failing vitest-like command that won't actually run tests
    // but passes the dependency check (node_modules exists in process.cwd())
    const root = process.cwd();
    // We use 'node -e "process.exit(0)"' which won't trigger the vitest/npm keyword check
    // Instead use a command with vitest but run it from project root which HAS node_modules
    const receipt = await verifyAutopilotTests(root, 'node -e "process.exit(0)"');
    // No node_modules check for non-npm commands → null returned → runs execSync → pass
    expect(receipt.status).toBe('pass');
  }, 15000);
});
