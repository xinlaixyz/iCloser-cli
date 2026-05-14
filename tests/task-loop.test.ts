import { describe, expect, it } from 'vitest';
import {
  advanceTaskLoop,
  applyUserIntervention,
  buildTaskThinkingLoop,
  createTaskLoopState,
  renderTaskThinkingLoop,
} from '../src/core/task-loop.js';

describe('task thinking loop', () => {
  it('defines the collect-action-verify loop with model/tool separation', () => {
    const loop = buildTaskThinkingLoop();

    expect(loop.steps.map(step => step.id)).toEqual([
      'collect-context',
      'take-action',
      'verify-result',
    ]);
    expect(loop.steps[0].owner).toBe('model');
    expect(loop.steps[1].owner).toBe('tools');
    expect(loop.steps[2].owner).toBe('verifier');
    expect(loop.policy.toolActionsUseLocalCapabilities).toBe(true);
    expect(loop.policy.memoryCapturesAllUserInput).toBe(true);
    expect(loop.policy.userCanInterveneAtAnyStep).toBe(true);
  });

  it('cycles back to collect context after failed verification', () => {
    let state = createTaskLoopState();

    state = advanceTaskLoop(state);
    expect(state.currentStep).toBe('take-action');

    state = advanceTaskLoop(state);
    expect(state.currentStep).toBe('verify-result');

    state = advanceTaskLoop(state, { verification: 'fail' });
    expect(state.status).toBe('running');
    expect(state.iteration).toBe(2);
    expect(state.currentStep).toBe('collect-context');
  });

  it('completes on pass and stops after max iterations', () => {
    let state = createTaskLoopState();
    state = advanceTaskLoop(advanceTaskLoop(state));
    state = advanceTaskLoop(state, { verification: 'pass' });
    expect(state.status).toBe('completed');

    let failing = createTaskLoopState();
    for (let i = 0; i < 3; i++) {
      failing = advanceTaskLoop(advanceTaskLoop(failing));
      failing = advanceTaskLoop(failing, { verification: 'fail', maxIterations: 3 });
    }
    expect(failing.status).toBe('stopped');
    expect(failing.interruptReason).toBe('max-iterations');
  });

  it('can be interrupted by the user', () => {
    const state = advanceTaskLoop(createTaskLoopState(), { interrupt: 'try-another-way' });

    expect(state.status).toBe('paused');
    expect(state.interruptReason).toBe('try-another-way');
  });


  it('maps user intervention from the flow diagram into loop branches', () => {
    const base = createTaskLoopState();

    const addContext = applyUserIntervention(base, 'add-context');
    expect(addContext.status).toBe('running');
    expect(addContext.currentStep).toBe('collect-context');
    expect(addContext.nextBranch).toBe('continue-loop');

    const changed = advanceTaskLoop(base, { intervention: 'change-direction' });
    expect(changed.status).toBe('running');
    expect(changed.currentStep).toBe('collect-context');
    expect(changed.interruptReason).toBe('new-instruction');

    const stopped = applyUserIntervention(base, 'interrupt-task');
    expect(stopped.status).toBe('stopped');
    expect(stopped.nextBranch).toBe('ask-user');
  });

  it('combines the three-step loop with the five required tool categories', () => {
    const loop = buildTaskThinkingLoop();
    const toolIds = loop.toolCategories.map(tool => tool.id);

    expect(toolIds).toEqual([
      'file-ops',
      'search',
      'command',
      'web-search',
      'code-intelligence',
    ]);

    const byStep = Object.fromEntries(loop.steps.map(step => [step.id, step.requiredToolCategories]));
    expect(byStep['collect-context']).toEqual(['file-ops', 'search', 'web-search', 'code-intelligence']);
    expect(byStep['take-action']).toEqual(['file-ops', 'search', 'command']);
    expect(byStep['verify-result']).toEqual(['file-ops', 'search', 'command', 'code-intelligence']);

    expect(loop.toolCategories.find(tool => tool.id === 'code-intelligence')?.fallback).toContain('降级');
  });
  it('renders beginner-readable Chinese rules', () => {
    const text = renderTaskThinkingLoop();

    expect(text).toContain('iCloser 三步任务循环');
    expect(text).toContain('模型：负责理解目标');
    expect(text).toContain('工具：负责真正动手');
    expect(text).toContain('用户可随时打断');
    expect(text).toContain('用户输入 Prompt -> 收集上下文');
    expect(text).toContain('用户干预');
    expect(text).toContain('五大工具能力');
    expect(text).toContain('循环 × 工具矩阵');
    expect(text).toContain('代码智能');
  });
});




