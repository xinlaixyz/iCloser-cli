// Report Engine — Chinese report generation, diff output, PR description
import * as path from 'path';
import { ensureDir, writeFile } from '../utils/fs.js';
import { getSecurityIssuesFromGateCheck } from '../core/security.js';
import { loadProjectMemory } from '../core/memory.js';
import type { Task, GateCheck, ICloserConfig, MemoryCandidate, SecurityIssue } from '../types.js';

// ============================================================
// Main report generation
// ============================================================
export async function generateTaskReport(
  rootPath: string,
  task: Task,
  _config: ICloserConfig
): Promise<string> {
  const reportDir = path.join(rootPath, '.icloser', 'tasks', task.id);
  await ensureDir(reportDir);

  const sections: string[] = [];

  // Header
  sections.push(`# 任务报告`);
  sections.push('');
  sections.push(`| 项目 | 值 |`);
  sections.push(`|------|-----|`);
  sections.push(`| 任务 ID | ${task.id} |`);
  sections.push(`| 状态 | ${task.status} |`);
  sections.push(`| 创建时间 | ${task.createdAt} |`);
  if (task.completedAt) sections.push(`| 完成时间 | ${task.completedAt} |`);
  if (task.retryCount > 0) sections.push(`| 修复轮次 | ${task.retryCount} |`);
  sections.push('');

  // Agent execution summary (S15)
  if (task.agentExecutions.length > 0) {
    sections.push('## Agent 执行');
    sections.push('');

    const totalTokens = task.agentExecutions.reduce((s, a) => s + a.result.tokensUsed, 0);
    const totalDuration = task.agentExecutions.reduce((s, a) => s + a.result.duration, 0);
    const successCount = task.agentExecutions.filter(a => a.status === 'done').length;

    sections.push(`| 指标 | 值 |`);
    sections.push(`|------|-----|`);
    sections.push(`| 参与 Agent | ${task.agentExecutions.length} 个 |`);
    sections.push(`| 成功 / 失败 | ${successCount} / ${task.agentExecutions.length - successCount} |`);
    sections.push(`| Token 总用量 | ${totalTokens.toLocaleString()} |`);
    sections.push(`| 总耗时 | ${(totalDuration / 1000).toFixed(1)}s |`);
    sections.push('');

    for (const [i, exec] of task.agentExecutions.entries()) {
      const icon = exec.status === 'done' ? '✓' : '✗';
      sections.push(`### Agent ${i + 1}: ${exec.agentName}`);
      sections.push('');
      sections.push(`| 属性 | 值 |`);
      sections.push(`|------|-----|`);
      sections.push(`| ID | \`${exec.agentId}\` |`);
      sections.push(`| 类型 | ${exec.agentType} |`);
      sections.push(`| 状态 | ${icon} ${exec.status} |`);
      sections.push(`| 模型 | ${exec.model} |`);
      sections.push(`| 沙箱 | ${exec.sandboxLevel} |`);
      sections.push(`| Token 用量 | ${exec.result.tokensUsed.toLocaleString()} |`);
      sections.push(`| 耗时 | ${(exec.result.duration / 1000).toFixed(1)}s |`);
      if (exec.result.artifacts.length > 0) {
        sections.push(`| 产出 | ${exec.result.artifacts.join(', ')} |`);
      }
      if (exec.result.error) {
        sections.push(`| 错误 | ${exec.result.error} |`);
      }
      sections.push('');

      if (exec.result.output && exec.result.output.length < 500) {
        sections.push(`**输出：** ${exec.result.output}`);
        sections.push('');
      } else if (exec.result.output) {
        sections.push(`**输出（截断）：** ${exec.result.output.slice(0, 500)}...`);
        sections.push('');
      }

      // Agent hierarchy tree
      if (exec.tree && exec.childAgentIds.length > 0) {
        sections.push('**执行树：**');
        sections.push('');
        sections.push('```');
        sections.push(formatAgentTree(exec.tree, ''));
        sections.push('```');
        sections.push('');
      }
    }
  }

  // Task description and decomposition
  sections.push('## 任务摘要');
  sections.push('');
  sections.push(`**原始描述：** ${task.description}`);
  sections.push('');

  if (task.plan) {
    sections.push('### AI 解析后的子目标');
    sections.push('');
    for (const goal of task.plan.subGoals) {
      const icon = goal.status === 'done' ? '✓' : goal.status === 'failed' ? '✗' : '·';
      sections.push(`- [${icon}] **${goal.description}**`);
      if (goal.files.length > 0) {
        sections.push(`  - 涉及文件：${goal.files.slice(0, 5).join(', ')}${goal.files.length > 5 ? ` 等 ${goal.files.length} 个文件` : ''}`);
      }
    }
    sections.push('');
  }

  // Analysis-only tasks: no file changes, just report findings
  if (task.changes.length === 0 && task.reasoning.length > 0 && task.reasoning[0].file === '(无文件修改 — 纯分析任务)') {
    sections.push('## 分析结论');
    sections.push('');
    sections.push(task.reasoning[0].reasoning.slice(0, 5000));
    sections.push('');
  }

  // File changes
  if (task.changes.length > 0) {
    sections.push('## 修改文件清单');
    sections.push('');
    sections.push(`| 文件 | 意图 | 变更行数 |`);
    sections.push(`|------|------|---------|`);
    for (const change of task.changes) {
      sections.push(`| ${change.file} | ${change.intent} | +${change.added} -${change.removed} |`);
    }
    sections.push('');
    sections.push(`**总计：** 修改 ${task.changes.length} 个文件，新增 ${task.changes.reduce((s, c) => s + c.added, 0)} 行，删除 ${task.changes.reduce((s, c) => s + c.removed, 0)} 行`);
    sections.push('');
  }

  // Reasoning chain
  if (task.reasoning.length > 0) {
    sections.push('## 修改推理链');
    sections.push('');
    for (const reasoning of task.reasoning) {
      sections.push(`### ${reasoning.file} (风险等级: ${reasoning.riskLevel})`);
      sections.push('');
      sections.push(`**意图：** ${reasoning.intent}`);
      sections.push('');
      sections.push(`**推理：** ${reasoning.reasoning}`);
      sections.push('');
      sections.push('**影响分析：**');
      sections.push(`- 直接影响：${reasoning.impact.directlyAffected.join(', ') || '无'}`);
      sections.push(`- 间接影响：${reasoning.impact.indirectlyAffected.join(', ') || '无'}`);
      sections.push(`- 不受影响：${reasoning.impact.notAffected.join(', ') || '无'}`);
      sections.push('');
    }
  }

  // Verification results
  if (task.verifyResult) {
    sections.push('## 验证结果');
    sections.push('');
    sections.push(`**总体结果：** ${task.verifyResult.overall === 'pass' ? '✅ 通过' : '❌ 失败'}`);
    sections.push(`**修复轮次：** ${task.verifyResult.attempts}`);
    sections.push(`**耗时：** ${(task.verifyResult.duration / 1000).toFixed(1)}s`);
    sections.push('');

    sections.push('| 阶段 | 结果 | 详情 |');
    sections.push('|------|------|------|');
    for (const stage of task.verifyResult.stages) {
      const icon = stage.status === 'pass' ? '✅' : stage.status === 'fail' ? '❌' : '⏭️';
      sections.push(`| ${stage.stage} | ${icon} | ${stage.output} |`);
    }
    sections.push('');

    if (task.verifyResult.totalTests > 0) {
      sections.push(`**测试：** ${task.verifyResult.passedTests}/${task.verifyResult.totalTests} 通过`);
      if (task.verifyResult.coverage) {
        sections.push(`**覆盖率：** 行 ${task.verifyResult.coverage.lineCoverage}% / 分支 ${task.verifyResult.coverage.branchCoverage}%`);
      }
      sections.push('');
    }

    if (task.verifyResult.errorSummary) {
      sections.push('### 失败详情');
      sections.push('');
      sections.push('```');
      sections.push(task.verifyResult.errorSummary);
      sections.push('```');
      sections.push('');
    }
  }

  // Gate result
  if (task.gateResult) {
    sections.push('## 门禁检查');
    sections.push('');
    sections.push(`**结果：** ${task.gateResult.passed ? '✅ 通过' : '❌ 阻塞'}`);
    sections.push('');

    if (task.gateResult.blocking.length > 0) {
      sections.push('### 阻塞项');
      for (const block of task.gateResult.blocking) {
        sections.push(`- **${block.name}：** ${block.detail}`);
        appendGateSuggestion(sections, block);
      }
      sections.push('');
    }
  }

  // Risk assessment
  sections.push('## 风险评估');
  sections.push('');
  const riskLevel = task.reasoning.some(r => r.riskLevel === 'high')
    ? '高' : task.reasoning.some(r => r.riskLevel === 'medium') ? '中' : '低';
  sections.push(`- **整体风险等级：** ${riskLevel}`);
  if (task.reasoning.length > 0) {
    const highRisk = task.reasoning.filter(r => r.riskLevel === 'high');
    if (highRisk.length > 0) {
      sections.push('- **高风险变更：**');
      for (const r of highRisk) {
        sections.push(`  - ${r.file}`);
      }
    }
  }
  sections.push('');

  // Rollback
  // Audit log summary
  try {
    const { loadAuditEvents } = await import('../core/audit.js');
    const auditEvents = await loadAuditEvents(rootPath, { taskId: task.id });
    if (auditEvents.length > 0) {
      sections.push('## 审计日志');
      sections.push('');
      sections.push(`本次任务共记录 ${auditEvents.length} 条审计事件。`);
      sections.push('');
      sections.push('| 动作 | 目标 | 结果 |');
      sections.push('|------|------|------|');
      for (const e of auditEvents.slice(0, 15)) {
        const actionLabel = e.action === 'task-started' ? '开始执行' :
          e.action === 'ai-called' ? 'AI 调用' :
          e.action === 'file-written' ? '写入文件' :
          e.action === 'verify-run' ? '验证' :
          e.action === 'report-generated' ? '生成报告' :
          e.action === 'memory-updated' ? '记忆更新' : e.action;
        const resultIcon = e.result === 'success' ? '✓' : e.result === 'failure' ? '✗' : '~';
        sections.push(`| ${actionLabel} | ${escapeTable(e.target.substring(0, 60))} | ${resultIcon} |`);
      }
      if (auditEvents.length > 15) {
        sections.push(`| ... | _共 ${auditEvents.length} 条_ | |`);
      }
      sections.push('');
      sections.push('运行 `ic audit` 查看完整审计日志。');
      sections.push('');
    }
  } catch {}

  sections.push('## 回滚方法');
  sections.push('');
  if (task.rollbackPoint) {
    sections.push(`回滚引用点：${task.rollbackPoint}`);
  }
  sections.push('');
  sections.push('```bash');
  sections.push(`ic rollback ${task.id}`);
  sections.push('```');
  sections.push('');
  sections.push('或手动：');
  sections.push('```bash');
  sections.push('git checkout -- .');
  sections.push('git clean -fd');
  sections.push('```');
  sections.push('');

  // Error log
  if (task.errorLog.length > 0) {
    sections.push('## 错误日志');
    sections.push('');
    sections.push('```');
    sections.push(task.errorLog.join('\n'));
    sections.push('```');
    sections.push('');
  }

  const memoryCandidates = await getTaskMemoryCandidates(rootPath, task.id);
  if (memoryCandidates.length > 0) {
    sections.push('## 任务记忆候选');
    sections.push('');
    sections.push('本次任务产生了可复用记忆，默认不会写入全局长期知识库。需要确认时可运行 `ic mem review`。');
    sections.push('');
    sections.push('| 类型 | 状态 | 风险 | 摘要 |');
    sections.push('|------|------|------|------|');
    for (const candidate of memoryCandidates.slice(0, 10)) {
      sections.push(`| ${formatMemoryKind(candidate.kind)} | ${formatMemoryStatus(candidate.reviewStatus)} | ${formatRisk(candidate.riskLevel)} | ${escapeTable(candidate.summary)} |`);
    }
    sections.push('');
  }

  const reportContent = sections.join('\n');

  // Write report file
  const reportPath = path.join(reportDir, 'report.md');
  await writeFile(reportPath, reportContent);

  // Also save commit message
  const commitMessage = generateCommitMessage(task);
  await writeFile(path.join(reportDir, 'commit-message.txt'), commitMessage);

  return reportContent;
}

async function getTaskMemoryCandidates(rootPath: string, taskId: string): Promise<MemoryCandidate[]> {
  try {
    const memory = await loadProjectMemory(rootPath);
    return (memory.memoryCandidates || []).filter(candidate => candidate.taskId === taskId);
  } catch {
    return [];
  }
}

function formatMemoryKind(kind: MemoryCandidate['kind']): string {
  if (kind === 'template') return '模板';
  if (kind === 'rule') return '规则';
  if (kind === 'preference') return '偏好';
  if (kind === 'fact') return '事实';
  if (kind === 'sensitive') return '敏感输入';
  return '其他';
}

function formatMemoryStatus(status: MemoryCandidate['reviewStatus']): string {
  if (status === 'approved') return '已保存';
  if (status === 'proposed') return '待确认';
  if (status === 'archived') return '已归档';
  if (status === 'rejected') return '已拒绝';
  return '草稿';
}

function formatRisk(risk: MemoryCandidate['riskLevel']): string {
  if (risk === 'high') return '高';
  if (risk === 'medium') return '中';
  return '低';
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function appendGateSuggestion(sections: string[], block: GateCheck): void {
  if (block.category === 'security') {
    const issues = getSecurityIssuesFromGateCheck(block);
    if (issues.length > 0) {
      sections.push('  - 安全问题：');
      for (const issue of issues) {
        sections.push(`    - ${formatSecurityIssueForReport(issue)}`);
      }
      return;
    }
  }

  if (!block.suggestion) return;
  const suggestions = block.suggestion.split('\n').filter(line => line.trim());
  for (const suggestion of suggestions) {
    sections.push(`  - 建议：${suggestion}`);
  }
}

function formatSecurityIssueForReport(issue: SecurityIssue): string {
  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
  const evidence = issue.evidence ? ` — \`${issue.evidence}\`` : '';
  return `\`${location}\` [${issue.ruleId}/${issue.severity}] ${issue.message}${evidence}`;
}

// ============================================================
// PR Description generation
// ============================================================
export function generatePRDescription(task: Task): string {
  const parts: string[] = [];

  parts.push('## 变更摘要');
  parts.push('');
  parts.push(task.description);
  parts.push('');

  if (task.changes.length > 0) {
    parts.push('## 修改文件');
    parts.push('');
    for (const change of task.changes) {
      parts.push(`- **${change.file}** — ${change.intent}`);
    }
    parts.push('');
  }

  if (task.reasoning.length > 0) {
    parts.push('## 变更推理');
    parts.push('');
    for (const r of task.reasoning) {
      parts.push(`### ${r.file}`);
      parts.push(`- 风险等级：${r.riskLevel}`);
      parts.push(`- ${r.reasoning}`);
      parts.push('');
    }
  }

  if (task.verifyResult) {
    parts.push('## 验证结果');
    parts.push('');
    parts.push(`- 总体：${task.verifyResult.overall}`);
    if (task.verifyResult.totalTests > 0) {
      parts.push(`- 测试：${task.verifyResult.passedTests}/${task.verifyResult.totalTests} 通过`);
    }
    parts.push('');
  }

  parts.push('---');
  parts.push('🤖 Generated with [iCloser Agent Shell](https://github.com/icloser/agent-shell)');

  return parts.join('\n');
}

// ============================================================
// Commit message generation
// ============================================================
function generateCommitMessage(task: Task): string {
  const scope = guessScope(task);
  const type = guessCommitType(task.description);
  const summary = task.description.substring(0, 72);

  const lines = [
    `${type}${scope}: ${summary}`,
    '',
    ...(task.changes.length > 0
      ? task.changes.map(c => `- ${c.file}: ${c.intent}`)
      : []),
    '',
    ...(task.verifyResult
      ? [
        `Verification: ${task.verifyResult.overall}`,
        `Tests: ${task.verifyResult.passedTests}/${task.verifyResult.totalTests}`,
      ]
      : []),
    '',
    `Task: ${task.id}`,
    `Co-Authored-By: iCloser Agent Shell <agent@icloser.dev>`,
  ];

  return lines.join('\n');
}

function guessScope(task: Task): string {
  const lower = task.description.toLowerCase();
  if (lower.includes('登录') || lower.includes('auth')) return '(auth)';
  if (lower.includes('ui') || lower.includes('界面') || lower.includes('样式')) return '(ui)';
  if (lower.includes('api') || lower.includes('接口')) return '(api)';
  if (lower.includes('数据库') || lower.includes('db')) return '(db)';
  if (lower.includes('修复') || lower.includes('fix') || lower.includes('bug')) return '(fix)';
  if (lower.includes('测试') || lower.includes('test')) return '(test)';
  return '';
}

function guessCommitType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes('修复') || lower.includes('fix') || lower.includes('bug')) return 'fix';
  if (lower.includes('新增') || lower.includes('添加') || lower.includes('add')) return 'feat';
  if (lower.includes('重构') || lower.includes('refactor')) return 'refactor';
  if (lower.includes('优化') || lower.includes('perf')) return 'perf';
  if (lower.includes('文档') || lower.includes('doc')) return 'docs';
  return 'feat';
}

// ============================================================
// Diff file generation
// ============================================================
export async function generateDiffFile(
  rootPath: string,
  task: Task,
  diff: string
): Promise<string> {
  const diffPath = path.join(rootPath, '.icloser', 'tasks', task.id, 'diff.patch');
  await ensureDir(path.dirname(diffPath));
  await writeFile(diffPath, diff);
  return diffPath;
}

// ============================================================
// Reasoning file generation
// ============================================================
export async function generateReasoningFile(
  rootPath: string,
  task: Task
): Promise<string> {
  const reasoningPath = path.join(rootPath, '.icloser', 'tasks', task.id, 'reasoning.md');
  await ensureDir(path.dirname(reasoningPath));

  const lines: string[] = [];
  lines.push('# 修改推理链');
  lines.push('');

  for (const r of task.reasoning) {
    lines.push(`## ${r.file}`);
    lines.push('');
    lines.push(`- **意图：** ${r.intent}`);
    lines.push(`- **推理：** ${r.reasoning}`);
    lines.push(`- **风险等级：** ${r.riskLevel}`);
    lines.push(`- **直接影响：** ${r.impact.directlyAffected.join(', ')}`);
    lines.push(`- **间接影响：** ${r.impact.indirectlyAffected.join(', ')}`);
    lines.push('');
  }

  const content = lines.join('\n');
  await writeFile(reasoningPath, content);
  return reasoningPath;
}

// ============================================================
// Verification log
// ============================================================
export async function generateVerifyLog(
  rootPath: string,
  task: Task
): Promise<string> {
  if (!task.verifyResult) return '';

  const logPath = path.join(rootPath, '.icloser', 'tasks', task.id, 'verify.log');
  await ensureDir(path.dirname(logPath));

  const lines: string[] = [];
  lines.push(`验证时间: ${new Date().toISOString()}`);
  lines.push(`总体结果: ${task.verifyResult.overall}`);
  lines.push(`轮次: ${task.verifyResult.attempts}`);
  lines.push(`耗时: ${task.verifyResult.duration}ms`);
  lines.push('');

  for (const stage of task.verifyResult.stages) {
    lines.push(`[${stage.status.toUpperCase()}] ${stage.stage} (${stage.duration}ms)`);
    if (stage.command) lines.push(`命令: ${stage.command}`);
    if (stage.exitCode !== undefined) lines.push(`退出码: ${stage.exitCode === null ? 'unknown' : stage.exitCode}`);
    lines.push(stage.output);
    if (stage.stdout?.trim()) {
      lines.push('--- stdout ---');
      lines.push(truncateLogSection(stage.stdout));
    }
    if (stage.stderr?.trim()) {
      lines.push('--- stderr ---');
      lines.push(truncateLogSection(stage.stderr));
    }
    if (stage.errorDetails) {
      lines.push('--- error details ---');
      lines.push(truncateLogSection(stage.errorDetails));
    }
    lines.push('');
  }

  const content = lines.join('\n');
  await writeFile(logPath, content);
  return logPath;
}

function truncateLogSection(content: string, maxChars = 8000): string {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n... truncated ${trimmed.length - maxChars} chars`;
}

function formatAgentTree(tree: Record<string, unknown>, prefix: string): string {
  const lines: string[] = [];
  const typed = tree as { id?: string; name?: string; type?: string; status?: string; result?: Record<string, unknown> | null; children?: Record<string, unknown>[] };
  const statusIcon = typed.status === 'done' ? '✓' : typed.status === 'failed' ? '✗' : typed.status === 'running' ? '▶' : '·';
  const tokens = typed.result?.tokensUsed ? ` (${(typed.result.tokensUsed as number).toLocaleString()} tokens)` : '';
  lines.push(`${prefix}${statusIcon} ${typed.name || typed.id || '?'} [${typed.type || '?'}]${tokens}`);

  if (typed.children && Array.isArray(typed.children)) {
    for (let i = 0; i < typed.children.length; i++) {
      const isLast = i === typed.children.length - 1;
      const childPrefix = prefix + (isLast ? '  └─ ' : '  ├─ ');
      const childLines = formatAgentTree(typed.children[i] as Record<string, unknown>, childPrefix);
      lines.push(childLines);
    }
  }

  return lines.join('\n');
}
