export type GoldenPathStage =
  | 'created'
  | 'understanding'
  | 'planning'
  | 'tool_running'
  | 'evidence_ready'
  | 'generating'
  | 'patch_ready'
  | 'awaiting_approval'
  | 'writing'
  | 'verifying'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'blocked';

export interface GoldenPathState {
  taskId: string;
  input: string;
  stage: GoldenPathStage;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  evidenceCount: number;
  toolCount: number;
  resultReady: boolean;
  patchReady: boolean;
  verificationReady: boolean;
  memoryApplied: boolean;
  failure?: string;
  nextAction?: string;
  updatedAt: string;
}

export function createGoldenPathState(taskId: string, input: string): GoldenPathState {
  return {
    taskId,
    input,
    stage: 'created',
    status: 'running',
    evidenceCount: 0,
    toolCount: 0,
    resultReady: false,
    patchReady: false,
    verificationReady: false,
    memoryApplied: false,
    updatedAt: new Date().toISOString(),
  };
}

export function advanceGoldenPathState(
  state: GoldenPathState,
  patch: Partial<Omit<GoldenPathState, 'taskId' | 'input'>>
): GoldenPathState {
  return {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

export function renderGoldenPathState(state: GoldenPathState): string {
  const rows: Array<[string, boolean | 'fail' | 'warn']> = [
    ['理解需求', stageAtLeast(state.stage, 'understanding')],
    ['调用工具', state.toolCount > 0],
    ['形成结论', state.status === 'failed' ? 'fail' : state.resultReady],
    ['验证证据', state.status === 'failed' ? 'warn' : state.verificationReady],
    ['沉淀记忆', state.memoryApplied],
  ];
  const lines = ['  Golden Path'];
  for (const [label, status] of rows) {
    const stateText = status === true ? '完成' : status === 'fail' ? '失败' : status === 'warn' ? '需注意' : '跳过';
    lines.push(`  ● ${label.padEnd(8)} ${stateText}`);
  }
  lines.push(`  证据 ${state.evidenceCount} 条 · 工具 ${state.toolCount} 次`);
  lines.push(`  结果 ${state.status === 'completed' ? '完成' : state.status === 'failed' ? '失败' : state.status === 'blocked' ? '阻塞' : '进行中'}`);
  if (state.failure) lines.push(`  失败 ${state.failure.slice(0, 140)}`);
  if (state.nextAction) lines.push(`  下一步 ${state.nextAction}`);
  return lines.join('\n') + '\n';
}

const STAGE_ORDER: GoldenPathStage[] = [
  'created', 'understanding', 'planning', 'tool_running', 'evidence_ready', 'generating',
  'patch_ready', 'awaiting_approval', 'writing', 'verifying', 'repairing', 'completed',
  'failed', 'blocked',
];

function stageAtLeast(stage: GoldenPathStage, target: GoldenPathStage): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(target);
}
