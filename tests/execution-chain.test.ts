import { describe, expect, it } from 'vitest';
import { buildExecutionChain, renderExecutionChain } from '../src/core/execution-chain.js';

describe('autonomous execution chain', () => {
  it('defines the full analyze-execute-verify-repair-rollback loop', () => {
    const chain = buildExecutionChain();
    const ids = chain.stages.map(stage => stage.id);

    expect(ids).toEqual([
      'understand',
      'inspect',
      'plan',
      'confirm',
      'execute',
      'verify',
      'repair',
      'rollback',
      'report',
      'remember',
    ]);
    expect(chain.policy.writeRequiresChoice).toBe(true);
    expect(chain.policy.commandRequiresChoice).toBe(true);
    expect(chain.policy.rollbackOnUnsafeFailure).toBe(true);
  });

  it('renders a Chinese beginner-readable chain', () => {
    const text = renderExecutionChain(buildExecutionChain());
    expect(text).toContain('iCloser 自动执行链');
    expect(text).toContain('自动修复最多重试');
    expect(text).toContain('安全回滚');
    expect(text).toContain('记忆压缩与沉淀');
  });
});

import { jsonEnvelope } from '../src/cli/json.js';
import { buildTaskThinkingLoop } from '../src/core/task-loop.js';

describe('autonomous execution chain with task loop', () => {
  it('can expose the three-step task loop in JSON payloads', () => {
    const payload = jsonEnvelope('autonomous-execution-chain', {
      ...buildExecutionChain(),
      taskLoop: buildTaskThinkingLoop(),
    });

    expect(payload.data.taskLoop.steps.map(step => step.id)).toEqual([
      'collect-context',
      'take-action',
      'verify-result',
    ]);
  });
});
