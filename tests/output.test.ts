// Unit tests for src/cli/output.ts — display functions
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  printTaskSummary,
  printVerifyResult,
  printGateResult,
  printError,
  printHelp,
} from '../src/cli/output.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('output.ts — display functions', () => {
  describe('printTaskSummary', () => {
    it('prints completed task with file/test stats', () => {
      printTaskSummary({ id: 'abc1234567', description: 'Add unit tests', status: 'completed', changes: 3, tests: 12, riskLevel: 'low' });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints failed task (no stats line)', () => {
      printTaskSummary({ id: 'def456', description: 'Build failed', status: 'failed', changes: 0, tests: 0, riskLevel: 'high' });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints running task with progress icon', () => {
      printTaskSummary({ id: 'ghi789', description: 'Deploying', status: 'running', changes: 0, tests: 0, riskLevel: 'medium' });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints pending task with info icon', () => {
      printTaskSummary({ id: 'jkl012', description: 'Queued scan', status: 'pending', changes: 0, tests: 0, riskLevel: 'none' });
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('printVerifyResult', () => {
    it('prints result with passing stages', () => {
      printVerifyResult({
        overall: 'pass',
        stages: [{ stage: 'compile', status: 'pass' }],
        totalTests: 10,
        passedTests: 10,
        attempts: 1,
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints result with failed stages and triggers suggestions (compile+lint+test+e2e)', () => {
      printVerifyResult({
        overall: 'fail',
        stages: [
          { stage: 'tsc compile error', status: 'fail', errorDetails: 'TS2345: type mismatch' },
          { stage: 'eslint lint check', status: 'fail' },
          { stage: 'vitest test suite', status: 'fail' },
          { stage: 'e2e playwright', status: 'fail' },
        ],
        totalTests: 5,
        passedTests: 2,
        attempts: 3,
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints result with coverage data (with branchCoverage)', () => {
      printVerifyResult({
        overall: 'pass',
        stages: [{ stage: 'compile', status: 'pass' }],
        totalTests: 10,
        passedTests: 10,
        attempts: 1,
        coverage: { lineCoverage: 80, branchCoverage: 72, coveredLines: 800, totalLines: 1000 },
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints coverage with branchCoverage = 0 (skips branch detail)', () => {
      printVerifyResult({
        overall: 'pass',
        stages: [{ stage: 'compile', status: 'pass' }],
        totalTests: 5,
        passedTests: 5,
        attempts: 1,
        coverage: { lineCoverage: 70, branchCoverage: 0, coveredLines: 70, totalLines: 100 },
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('skips tests line when totalTests is 0', () => {
      printVerifyResult({
        overall: 'pass',
        stages: [],
        totalTests: 0,
        passedTests: 0,
        attempts: 1,
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('skips coverage when totalLines is 0', () => {
      printVerifyResult({
        overall: 'pass',
        stages: [],
        totalTests: 0,
        passedTests: 0,
        attempts: 1,
        coverage: { lineCoverage: 0, branchCoverage: 0, coveredLines: 0, totalLines: 0 },
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints attempts line when attempts > 1', () => {
      printVerifyResult({
        overall: 'fail',
        stages: [{ stage: 'compile', status: 'fail' }],
        totalTests: 0,
        passedTests: 0,
        attempts: 2,
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('handles warn stage status (shows warn icon)', () => {
      printVerifyResult({
        overall: 'warn',
        stages: [{ stage: 'lint', status: 'warn' }],
        totalTests: 0,
        passedTests: 0,
        attempts: 1,
      });
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('printGateResult', () => {
    it('prints passing gate result', () => {
      printGateResult({
        passed: true,
        checks: [
          { name: 'Compile', status: 'pass', detail: 'No errors' },
          { name: 'Tests', status: 'pass', detail: 'All 42 tests passing' },
        ],
        blocking: [],
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints failing gate result with suggestions', () => {
      printGateResult({
        passed: false,
        checks: [
          { name: 'Compile', status: 'pass', detail: 'OK' },
          { name: 'Tests', status: 'fail', detail: '3 failed' },
        ],
        blocking: [
          { name: 'Tests', detail: '3 tests failed', suggestion: 'Run ic code fix tests' },
          { name: 'Lint', detail: 'Lint errors found' },
        ],
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints check with warn status icon', () => {
      printGateResult({
        passed: false,
        checks: [{ name: 'Coverage', status: 'warn', detail: 'Below 80%' }],
        blocking: [{ name: 'Coverage', detail: 'Coverage too low' }],
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints check with progress status icon', () => {
      printGateResult({
        passed: false,
        checks: [{ name: 'Scan', status: 'pending', detail: 'In progress' }],
        blocking: [],
      });
      expect(console.log).toHaveBeenCalled();
    });

    it('prints failing gate result without suggestions (no suggestion field)', () => {
      printGateResult({
        passed: false,
        checks: [{ name: 'Deploy', status: 'fail', detail: 'timeout' }],
        blocking: [{ name: 'Deploy', detail: 'Deployment failed' }],
      });
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('printError', () => {
    it('prints Error object message', () => {
      printError(new Error('something went wrong'));
      expect(console.log).toHaveBeenCalled();
    });

    it('prints string error', () => {
      printError('network timeout');
      expect(console.log).toHaveBeenCalled();
    });

    it('uses toDisplay() when available on error object', () => {
      const fancy = { message: 'raw', toDisplay: () => 'Pretty error message' };
      printError(fancy as any);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('printHelp', () => {
    it('prints help text without throwing', () => {
      expect(() => printHelp()).not.toThrow();
      expect(console.log).toHaveBeenCalled();
    });
  });
});
