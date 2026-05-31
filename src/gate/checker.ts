// Gate Checker — quality gate before delivery
import * as path from 'path';
import { isGitRepo, getGitStatus } from '../utils/git.js';
import { fileExists } from '../utils/fs.js';
import { scanTaskSecurity } from '../core/security.js';
import type {
  Task, GateResult, GateCheck, ICloserConfig,
} from '../types.js';

// ============================================================
// Main gate check
// ============================================================
export async function runGateCheck(
  rootPath: string,
  task: Task,
  config: ICloserConfig
): Promise<GateResult> {
  const checks: GateCheck[] = [];

  // Gate 1: Test check
  checks.push(checkTests(task));

  // Gate 2: Security check
  checks.push(await checkSecurity(rootPath, task, config));

  // Gate 3: Reasoning chain completeness
  checks.push(checkReasoning(task));

  // Gate 4: Report completeness
  checks.push(await checkReport(rootPath, task));

  // Gate 5: Rollback feasibility
  checks.push(checkRollback(task));

  // Gate 6: Git status
  checks.push(await checkGit(rootPath));

  const blocking = checks.filter(c => c.status === 'fail' || c.status === 'pending');
  const suggestions = checks.filter(c => c.status === 'warn');
  const passed = blocking.length === 0;

  const gateResult: GateResult = {
    passed,
    checks,
    blocking,
    suggestions,
  };

  if (passed) {
    gateResult.prDescription = generatePRDescription(task);
    gateResult.commitMessage = generateCommitMessage(task);
  }

  return gateResult;
}

// ============================================================
// Individual gates
// ============================================================
function checkTests(task: Task): GateCheck {
  if (!task.verifyResult) {
    return {
      name: '测试门禁',
      category: 'test',
      status: 'pending',
      detail: '尚未执行验证',
      suggestion: '运行 ic verify <task-id>',
    };
  }

  if (task.verifyResult.overall === 'pass') {
    const testInfo = task.verifyResult.totalTests > 0
      ? `${task.verifyResult.passedTests}/${task.verifyResult.totalTests} 通过${task.verifyResult.coverage ? `，覆盖率 ${task.verifyResult.coverage.lineCoverage}%` : ''}`
      : '验证通过';
    return {
      name: '测试门禁',
      category: 'test',
      status: 'pass',
      detail: testInfo,
    };
  }

  return {
    name: '测试门禁',
    category: 'test',
    status: 'fail',
    detail: '测试未全部通过',
    suggestion: task.verifyResult.errorSummary || '检查失败详情并修复',
  };
}

async function checkSecurity(rootPath: string, task: Task, config: ICloserConfig): Promise<GateCheck> {
  const issues = await scanTaskSecurity(rootPath, task, config);

  if (issues.length > 0) {
    return {
      name: '安全门禁',
      category: 'security',
      status: 'fail',
      detail: `${issues.length} 个告警`,
      suggestion: issues.map(formatSecurityIssue).join('\n'),
      metadata: { issues },
    };
  }

  return {
    name: '安全门禁',
    category: 'security',
    status: 'pass',
    detail: '无告警',
    metadata: { issues: [] },
  };
}

function formatSecurityIssue(issue: Awaited<ReturnType<typeof scanTaskSecurity>>[number]): string {
  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
  const evidence = issue.evidence ? ` — ${issue.evidence}` : '';
  return `${location} [${issue.ruleId}/${issue.severity}] ${issue.message}${evidence}`;
}

function checkReasoning(task: Task): GateCheck {
  const changeCount = task.changes.length;
  const reasoningCount = task.reasoning.length;

  if (changeCount === 0) {
    return {
      name: '推理门禁',
      category: 'reasoning',
      status: 'pass',
      detail: '无修改，无需推理',
    };
  }

  // Every changed file should have reasoning
  if (reasoningCount < changeCount) {
    return {
      name: '推理门禁',
      category: 'reasoning',
      status: 'fail',
      detail: `${changeCount - reasoningCount} 个文件缺少修改推理`,
      suggestion: '为每个修改补充意图-推理-影响说明',
    };
  }

  // Check reasoning quality
  const incompleteReasoning = task.reasoning.filter(r =>
    !r.intent || !r.reasoning || !r.impact || !r.riskLevel
  );

  if (incompleteReasoning.length > 0) {
    return {
      name: '推理门禁',
      category: 'reasoning',
      status: 'warn',
      detail: `${incompleteReasoning.length} 个推理不完整`,
      suggestion: '确保每个推理包含意图、推理过程、影响分析和风险等级',
    };
  }

  return {
    name: '推理门禁',
    category: 'reasoning',
    status: 'pass',
    detail: `${changeCount} 个修改文件，推理链完整`,
  };
}

async function checkReport(rootPath: string, task: Task): Promise<GateCheck> {
  const requiredFields = [
    task.description,
    task.changes.length > 0,
    task.status,
    task.createdAt,
  ];

  const missingFields = requiredFields.filter(f => !f).length;

  if (missingFields > 2) {
    return {
      name: '报告门禁',
      category: 'report',
      status: 'fail',
      detail: '报告缺少关键字段',
      suggestion: '确保任务报告包含描述、修改清单、状态和时间信息',
    };
  }

  const hasVerification = task.verifyResult !== undefined;
  const hasPlanning = task.plan !== undefined;

  if (!hasVerification || !hasPlanning) {
    return {
      name: '报告门禁',
      category: 'report',
      status: 'warn',
      detail: '报告不完整',
      suggestion: `${!hasPlanning ? '缺少修改方案，' : ''}${!hasVerification ? '缺少验证结果' : ''}`,
    };
  }

  const taskDir = path.join(rootPath, '.icloser', 'tasks', task.id);
  const requiredArtifacts = ['report.md', 'reasoning.md', 'verify.log'];
  const missingArtifacts: string[] = [];
  for (const artifact of requiredArtifacts) {
    if (!(await fileExists(path.join(taskDir, artifact)))) {
      missingArtifacts.push(artifact);
    }
  }

  if (missingArtifacts.length > 0) {
    return {
      name: '报告门禁',
      category: 'report',
      status: 'fail',
      detail: `缺少交付物：${missingArtifacts.join(', ')}`,
      suggestion: '重新生成任务报告、推理链和验证日志',
    };
  }

  return {
    name: '报告门禁',
    category: 'report',
    status: 'pass',
    detail: '报告包含全部必填项',
  };
}

function checkRollback(task: Task): GateCheck {
  if (task.rollbackPoint) {
    return {
      name: '回滚门禁',
      category: 'rollback',
      status: 'pass',
      detail: '回滚方案已就绪',
    };
  }

  // Can still rollback if git is available
  return {
    name: '回滚门禁',
    category: 'rollback',
    status: 'warn',
    detail: '尚未执行回滚验证',
    suggestion: '建议执行 ic rollback <task-id> 验证回滚方案',
  };
}

async function checkGit(rootPath: string): Promise<GateCheck> {
  if (!isGitRepo(rootPath)) {
    return {
      name: 'Git 门禁',
      category: 'git',
      status: 'warn',
      detail: '非 Git 仓库',
    };
  }

  const status = getGitStatus(rootPath);
  if (!status.clean) {
    return {
      name: 'Git 门禁',
      category: 'git',
      status: 'fail',
      detail: '工作区不清洁',
      suggestion: `有 ${status.changed.length + status.untracked.length} 个文件未暂存。使用 git add 暂存或 git stash 暂存`,
    };
  }

  return {
    name: 'Git 门禁',
    category: 'git',
    status: 'pass',
    detail: '工作区清洁',
  };
}

// ============================================================
// PR Description & Commit Message
// ============================================================
function generatePRDescription(task: Task): string {
  const lines: string[] = [];
  lines.push('## 变更摘要');
  lines.push('');
  lines.push(task.description);
  lines.push('');

  if (task.changes.length > 0) {
    lines.push('## 修改文件');
    lines.push('');
    for (const change of task.changes) {
      lines.push(`- **${change.file}** — ${change.intent} (+${change.added} -${change.removed})`);
    }
    lines.push('');
  }

  if (task.verifyResult) {
    lines.push('## 验证');
    lines.push(`- ${task.verifyResult.overall === 'pass' ? '✅' : '❌'} ${task.verifyResult.overall}`);
    if (task.verifyResult.totalTests > 0) {
      lines.push(`- 测试：${task.verifyResult.passedTests}/${task.verifyResult.totalTests}`);
    }
    lines.push('');
  }

  const riskLevel = task.reasoning.some(r => r.riskLevel === 'high') ? '⚠️ 高'
    : task.reasoning.some(r => r.riskLevel === 'medium') ? '⚡ 中' : '✅ 低';
  lines.push(`风险等级：${riskLevel}`);
  lines.push('');
  lines.push('---');
  lines.push(`🤖 Generated with icloser Agent Shell | Task: ${task.id}`);

  return lines.join('\n');
}

function generateCommitMessage(task: Task): string {
  const scope = guessScope(task);
  const type = task.description.includes('修复') || task.description.includes('fix') ? 'fix'
    : task.description.includes('重构') ? 'refactor'
    : 'feat';
  const summary = task.description.substring(0, 60);

  const lines = [
    `${type}${scope}: ${summary}`,
    '',
    ...task.changes.map(c => `- ${c.file}: ${c.intent}`),
    '',
    `Task: ${task.id}`,
  ];

  return lines.join('\n');
}

function guessScope(task: Task): string {
  const lower = task.description.toLowerCase();
  if (lower.includes('auth') || lower.includes('登录')) return '(auth)';
  if (lower.includes('ui') || lower.includes('界面')) return '(ui)';
  if (lower.includes('api') || lower.includes('接口')) return '(api)';
  if (lower.includes('db') || lower.includes('数据库')) return '(db)';
  return '';
}
