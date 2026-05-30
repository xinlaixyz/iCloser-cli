import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import type { AgentTaskType } from './agent-task-loop.js';
import type { CodeDeliveryReadiness, CodeDeliveryResult } from './code-delivery-pipeline.js';
import type { GoldenPathState } from './golden-path-state.js';
import type { ResultQualityGateReport } from './result-quality-gate.js';
import { classifySourceCredibility, type SourceCredibility } from './source-credibility.js';

export interface TaskQualityReport {
  version: 1;
  taskId: string;
  type: AgentTaskType;
  input: string;
  success: boolean;
  generatedAt: string;
  state: GoldenPathState;
  qualityGate: ResultQualityGateReport;
  codeDelivery: {
    status: CodeDeliveryResult['status'];
    files: string[];
    readiness?: CodeDeliveryReadiness;
  };
  evidence: {
    count: number;
    toolCount: number;
    targets: string[];
    sources: SourceCredibility[];
  };
  nextActions: string[];
}

export async function saveTaskQualityReport(rootPath: string, report: TaskQualityReport): Promise<string> {
  const dir = path.join(rootPath, '.icloser', 'agent-tasks', report.taskId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'quality-report.json');
  await writeFile(file, JSON.stringify(report, null, 2), 'utf-8');
  return file;
}

export function buildTaskQualityReport(input: {
  taskId: string;
  type: AgentTaskType;
  input: string;
  success: boolean;
  state: GoldenPathState;
  qualityGate: ResultQualityGateReport;
  codeDelivery: CodeDeliveryResult;
  codeDeliveryReadiness?: CodeDeliveryReadiness;
  evidenceTargets: string[];
  toolCount: number;
}): TaskQualityReport {
  const sources = input.evidenceTargets.filter(Boolean).map(classifySourceCredibility);
  return {
    version: 1,
    taskId: input.taskId,
    type: input.type,
    input: input.input,
    success: input.success,
    generatedAt: new Date().toISOString(),
    state: input.state,
    qualityGate: input.qualityGate,
    codeDelivery: {
      status: input.codeDelivery.status,
      files: input.codeDelivery.changes.map(change => change.file),
      readiness: input.codeDeliveryReadiness,
    },
    evidence: {
      count: input.state.evidenceCount,
      toolCount: input.toolCount,
      targets: input.evidenceTargets,
      sources,
    },
    nextActions: buildNextActions(input.qualityGate, input.codeDeliveryReadiness, input.state.nextAction),
  };
}

function buildNextActions(
  qualityGate: ResultQualityGateReport,
  readiness?: CodeDeliveryReadiness,
  stateNextAction?: string,
): string[] {
  const actions = new Set<string>();
  if (qualityGate.nextAction) actions.add(qualityGate.nextAction);
  if (readiness?.nextAction) actions.add(readiness.nextAction);
  if (stateNextAction) actions.add(stateNextAction);
  if (actions.size === 0) actions.add('结果已通过质量门，可继续追问细节或进入下一任务。');
  return [...actions];
}
