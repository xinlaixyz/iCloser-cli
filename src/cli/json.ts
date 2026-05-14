import { formatGateSummary, formatVerificationSummary } from './format.js';
import { getProviderStatus } from '../ai/provider.js';
import type { GateResult, ICloserConfig, SecurityRuleDefinition, Task } from '../types.js';

export const JSON_CONTRACT_VERSION = 1;

export interface JsonEnvelope<T> {
  version: number;
  kind: string;
  data: T;
}

export interface TaskJson {
  id: string;
  description: string;
  status: Task['status'];
  priority: Task['priority'];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  changes: Task['changes'];
  plan: Task['plan'] | null;
  verify: ReturnType<typeof formatVerificationSummary> | null;
  gate: ReturnType<typeof formatGateSummary> | null;
  reportPath: string | null;
  errorLog: string[];
  agentExecutions: Task['agentExecutions'];
}

export interface TaskListJson {
  tasks: TaskJson[];
}

export interface GateJson {
  passed: boolean;
  blockingCount: number;
  checks: GateResult['checks'];
  blocking: GateResult['blocking'];
  suggestions: GateResult['suggestions'];
  security: ReturnType<typeof formatGateSummary>['security'];
  prDescription: string | null;
  commitMessage: string | null;
}

export interface SecurityRuleJson extends SecurityRuleDefinition {
  enabled: boolean;
}

export interface SecurityRulesJson {
  rules: SecurityRuleJson[];
  disabledRules: string[];
}

export interface ConfigJson {
  project: {
    name: string;
    rootPath: string;
    identity: ICloserConfig['project']['identity'];
  };
  ai: {
    provider: string;
    model: string;
    ready: boolean;
    keySource: string;
    requiresApiKey: boolean;
    envVars: string[];
  };
  execution: ICloserConfig['execution'];
  security: {
    sensitiveFilePatterns: number;
    dangerousCommandPatterns: number;
    disabledRules: string[];
    disabledRuleCount: number;
    allowGitPush: boolean;
  };
  skills: ICloserConfig['skills'];
  memory: ICloserConfig['memory'];
}

export function jsonEnvelope<T>(kind: string, data: T): JsonEnvelope<T> {
  return {
    version: JSON_CONTRACT_VERSION,
    kind,
    data,
  };
}

export function serializeTask(task: Task): TaskJson {
  return {
    id: task.id,
    description: task.description,
    status: task.status,
    priority: task.priority,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    changes: task.changes,
    plan: task.plan ?? null,
    verify: task.verifyResult ? formatVerificationSummary(task.verifyResult) : null,
    gate: task.gateResult ? formatGateSummary(task.gateResult) : null,
    reportPath: task.reportPath ?? null,
    errorLog: task.errorLog,
    agentExecutions: task.agentExecutions,
  };
}

export function serializeTaskList(tasks: Task[]): TaskListJson {
  return {
    tasks: tasks.map(serializeTask),
  };
}

export function serializeGateResult(result: GateResult): GateJson {
  const summary = formatGateSummary(result);
  return {
    passed: result.passed,
    blockingCount: result.blocking.length,
    checks: result.checks,
    blocking: result.blocking,
    suggestions: result.suggestions,
    security: summary.security,
    prDescription: result.prDescription ?? null,
    commitMessage: result.commitMessage ?? null,
  };
}

export function serializeSecurityRules(
  rules: SecurityRuleDefinition[],
  disabledRules: string[] = [],
): SecurityRulesJson {
  const disabled = new Set(disabledRules);
  return {
    disabledRules: [...disabled],
    rules: rules.map(rule => ({
      ...rule,
      enabled: !disabled.has(rule.ruleId),
    })),
  };
}

export function serializeConfig(config: ICloserConfig): ConfigJson {
  const provider = getProviderStatus(config.ai);
  return {
    project: {
      name: config.project.name,
      rootPath: config.project.rootPath,
      identity: config.project.identity,
    },
    ai: {
      provider: config.ai.provider,
      model: config.ai.model,
      ready: provider.ready,
      keySource: provider.keySource,
      requiresApiKey: provider.requiresApiKey,
      envVars: provider.envVars,
    },
    execution: config.execution,
    security: {
      sensitiveFilePatterns: config.security.sensitiveFiles.length,
      dangerousCommandPatterns: config.security.dangerousCommands.length,
      disabledRules: config.security.disabledRules || [],
      disabledRuleCount: config.security.disabledRules?.length || 0,
      allowGitPush: config.security.allowGitPush,
    },
    skills: config.skills,
    memory: config.memory,
  };
}
