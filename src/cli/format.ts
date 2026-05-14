// Pure formatters for CLI status display — testable without chalk/I/O
import type { VerifyResult, StageResult, GateResult, VerifyStage, SecurityIssue } from '../types.js';
import { getSecurityIssuesFromGateCheck } from '../core/security.js';

export interface StageLine {
  stage: string;
  status: 'pass' | 'fail' | 'skipped';
  duration: number;        // ms
  exitCode: number | null;
  command: string;
  errors: string[];       // stderr/errorDetails summary lines
}

export interface VerifySummary {
  overall: 'pass' | 'fail';
  totalTests: number;
  passedTests: number;
  attempts: number;
  stages: StageLine[];
}

export interface PlannedCommand {
  stage: string;
  command: string | null;  // null = skipped
}

export interface GateSummary {
  passed: boolean;
  blockingCount: number;
  security: {
    status: 'pass' | 'fail' | 'warn' | 'pending';
    detail: string;
    issues: string[];
    structuredIssues: SecurityIssue[];
  } | null;
}

// ============================================================
// formatVerificationSummary — extract stage lines from VerifyResult
// ============================================================
export function formatVerificationSummary(vr: VerifyResult): VerifySummary {
  const stages: StageLine[] = vr.stages.map(s => formatStageLine(s));
  return {
    overall: vr.overall,
    totalTests: vr.totalTests,
    passedTests: vr.passedTests,
    attempts: vr.attempts,
    stages,
  };
}

export function formatStageLine(s: StageResult): StageLine {
  const errText = s.stderr || s.errorDetails || '';
  const rawLines = errText.trim()
    ? errText.trim().split('\n').filter(l => l.trim())
    : [];
  const nonWarningLines = rawLines.filter(l => !/^\s*warning:/i.test(l));
  const errors = (nonWarningLines.length > 0 ? nonWarningLines : rawLines).slice(0, 5);
  return {
    stage: s.stage,
    status: s.status,
    duration: s.duration,
    exitCode: s.exitCode ?? null,
    command: s.command || '',
    errors,
  };
}

// ============================================================
// formatPlannedCommands — what WOULD run for a stage list
// ============================================================
export function formatPlannedCommands(
  stages: VerifyStage[],
  resolved: Map<string, string | null>
): PlannedCommand[] {
  return stages.map(stage => ({
    stage,
    command: resolved.get(stage) ?? null,
  }));
}

// ============================================================
// formatGateSummary — extract key gate check info
// ============================================================
export function formatGateSummary(gr: GateResult): GateSummary {
  const securityCheck = gr.checks.find(c => c.category === 'security');
  const structuredIssues = securityCheck ? getSecurityIssuesFromGateCheck(securityCheck) : [];
  const security = securityCheck
    ? {
        status: securityCheck.status,
        detail: securityCheck.detail,
        issues: securityCheck.suggestion
          ? securityCheck.suggestion.split('\n').filter(l => l.trim())
          : [],
        structuredIssues,
      }
    : null;

  return {
    passed: gr.passed,
    blockingCount: gr.blocking.length,
    security,
  };
}

// ============================================================
// hasVerifyInfo — quick check helper
// ============================================================
export function hasVerifyInfo(vr: VerifyResult): boolean {
  return vr.stages.length > 0;
}

export function hasSecurityBlocking(gr: GateResult): boolean {
  const sc = gr.checks.find(c => c.category === 'security');
  return sc ? sc.status === 'fail' : false;
}
// iCloser mock edit: 接入ai
