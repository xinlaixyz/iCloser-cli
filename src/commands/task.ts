// src/commands/task.ts — Task display & management commands
// Extracted from src/index.ts (P3#22)
// Registers: st, queue, d, n, l, r, cancel
// Exports:   statusLabel, printTaskPlan, printTaskDetail, printTaskList

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { fileExists, readFile } from '../utils/fs.js';
import { isGitRepo, getDiff } from '../utils/git.js';
import { formatGateSummary } from '../cli/format.js';
import { jsonEnvelope, serializeTask, serializeTaskList } from '../cli/json.js';
import {
  success, fail, warn, info, section, detail, printError, ICONS,
} from '../cli/output.js';
import { loadConfig } from '../config.js';
import type { Task } from '../types.js';

// ════════════════════════════════════════════════════════════
// Shared helpers (exported so index.ts can use them too)
// ════════════════════════════════════════════════════════════

export function statusLabel(status: string): string {
  const m: Record<string, string> = {
    queued: '排队中', scheduled: '已调度', running: '执行中', verifying: '验证中',
    completed: '已完成', failed: '失败', cancelled: '已取消', blocked: '已阻塞', paused: '已暂停',
  };
  return m[status] || status;
}

export function printTaskPlan(task: Task): void {
  console.log();
  section('修改计划预览');
  if (task.plan && task.plan.subGoals.length > 0) {
    console.log();
    for (const sg of task.plan.subGoals) {
      const icon = sg.status === 'done' ? '[✓]' : sg.status === 'failed' ? '[✗]' : '[ ]';
      console.log(`  ${chalk.cyan(icon)} ${sg.description}`);
      if (sg.files.length > 0) {
        const fl = sg.files.slice(0, 5).join(', ');
        console.log(`     ${chalk.dim(`涉及：${fl}${sg.files.length > 5 ? ` 等 ${sg.files.length} 个文件` : ''}`)}`);
      }
    }
  }
  if (task.plan?.affectedFiles && task.plan.affectedFiles.length > 0) {
    console.log();
    console.log(`  ${chalk.dim('影响文件:')}`);
    for (const f of task.plan.affectedFiles.slice(0, 15)) {
      console.log(`    ${chalk.yellow('✎')} ${chalk.dim(f)}`);
    }
    if (task.plan.affectedFiles.length > 15) {
      console.log(`    ${chalk.dim(`... 等 ${task.plan.affectedFiles.length} 个文件`)}`);
    }
  }
  console.log();
  detail('风险等级', task.plan?.estimatedImpact === 'high' ? chalk.red('高') :
    task.plan?.estimatedImpact === 'medium' ? chalk.yellow('中') : chalk.green('低'));
}

export function printTaskList(tasks: Task[]): void {
  const order: Record<string, number> = { running: 0, verifying: 1, queued: 2, scheduled: 3, blocked: 4, completed: 5, failed: 6, cancelled: 7 };
  const sorted = tasks.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  section(`任务列表 (${tasks.length} 条)`);
  console.log();
  for (const t of sorted.slice(0, 30)) {
    const icon = t.status === 'completed' ? ICONS.success :
      t.status === 'failed' ? ICONS.fail :
      t.status === 'running' || t.status === 'verifying' ? ICONS.progress :
      t.status === 'blocked' ? ICONS.warn : ICONS.info;
    const id = t.id.substring(0, 10);
    const desc = t.description.substring(0, 45);
    const stat = statusLabel(t.status);
    const time = t.createdAt.substring(11, 19);
    console.log(`  ${icon} ${chalk.cyan(id)}  ${chalk.dim(stat.padEnd(6) + time)}  ${desc}`);
  }
  console.log();
}

// Show planned verification commands (when no verifyResult yet)
async function printPlannedVerification(rootPath: string): Promise<void> {
  const config = await loadConfig(rootPath);
  if (!config) return;
  const { resolveVerificationCommand } = await import('../core/verifier.js');
  console.log(`\n  ${chalk.dim('计划执行的验证命令:')}`);
  for (const stage of config.execution.verifyStages) {
    try {
      const cmd = await resolveVerificationCommand(rootPath, config.project.identity, stage);
      if (cmd) {
        console.log(`  ${chalk.dim('·')} ${stage.padEnd(18)} ${chalk.dim('$ ' + cmd.command.substring(0, 60))}`);
      } else {
        console.log(`  ${chalk.dim('·')} ${stage.padEnd(18)} ${chalk.dim('(跳过)')}`);
      }
    } catch {
      console.log(`  ${chalk.dim('·')} ${stage.padEnd(18)} ${chalk.dim('(不可用)')}`);
    }
  }
}

export function printTaskDetail(task: Task): void {
  section(`任务 ${chalk.cyan(task.id)}`);
  detail('状态', statusLabel(task.status));
  detail('描述', task.description);
  detail('优先级', task.priority);
  detail('创建', task.createdAt.substring(0, 19));
  if (task.startedAt) detail('开始', task.startedAt.substring(0, 19));
  if (task.completedAt) detail('完成', task.completedAt.substring(0, 19));
  detail('修改', `${task.changes.length} 个文件`);
  detail('推理', `${task.reasoning.length} 条记录`);

  // Verification stages detail
  if (task.verifyResult) {
    detail('验证', task.verifyResult.overall === 'pass' ? chalk.green('通过') : chalk.red('失败'));
    if (task.verifyResult.totalTests > 0) detail('测试', `${task.verifyResult.passedTests}/${task.verifyResult.totalTests}`);
    if (task.verifyResult.attempts > 1) detail('重试', `${task.verifyResult.attempts} 轮`);

    if (task.verifyResult.stages.length > 0) {
      console.log();
      console.log(`  ${chalk.bold('验证阶段:')}`);
      for (const s of task.verifyResult.stages) {
        const icon = s.status === 'pass' ? ICONS.success :
          s.status === 'fail' ? ICONS.fail : ICONS.warn;
        const dur = s.duration > 0 ? ` ${chalk.dim(`(${(s.duration / 1000).toFixed(1)}s)`)}` : '';
        const ec = s.exitCode != null ? ` ${chalk.dim(`exit=${s.exitCode}`)}` : '';
        console.log(`  ${icon} ${s.stage.padEnd(18)}${dur}${ec}`);
        if (s.command) {
          console.log(`     ${chalk.dim('$ ' + s.command.substring(0, 72))}`);
        }
        // Show error summary for failed stages
        if (s.status === 'fail') {
          const errText = s.stderr || s.errorDetails || '';
          if (errText.trim()) {
            const summary = errText.trim().split('\n').filter(l => l.trim()).slice(0, 5).join('\n');
            console.log(`     ${chalk.red(summary.substring(0, 500))}`);
          }
        }
      }
    }
  } else {
    // No verifyResult — show what WOULD run
    detail('验证', chalk.dim('未执行'));
    try {
      const rootPath = process.cwd();
      printPlannedVerification(rootPath).catch(() => {});
    } catch { /* best-effort */ }
  }

  // Gate result summary
  if (task.gateResult) {
    const gr = task.gateResult;
    console.log();
    console.log(`  ${chalk.bold('门禁检查:')} ${gr.passed ? chalk.green('通过') : chalk.red(`阻塞 (${gr.blocking.length} 项)`)}`);

    // Security gate with structured issues
    try {
      const gs = formatGateSummary(gr);
      if (gs.security) {
        const sc = gs.security;
        const icon = sc.status === 'pass' ? ICONS.success : sc.status === 'fail' ? ICONS.fail : ICONS.warn;
        console.log(`  ${icon} 安全门禁 — ${sc.detail}`);

        // Structured issues (dev2 format)
        if (sc.structuredIssues.length > 0) {
          for (const iss of sc.structuredIssues.slice(0, 8)) {
            const loc = iss.line ? `${iss.file}:${iss.line}` : iss.file;
            const sev = iss.severity === 'high' ? chalk.red('HIGH') :
              iss.severity === 'medium' ? chalk.yellow('MED') : chalk.dim('LOW');
            console.log(`  ${chalk.dim('▸')} ${sev} ${chalk.dim(loc.padEnd(28))} ${chalk.cyan(iss.ruleId)}`);
            if (iss.evidence) {
              console.log(`     ${chalk.dim(iss.evidence.substring(0, 100))}`);
            }
            if (iss.message) {
              console.log(`     ${chalk.dim(iss.message.substring(0, 120))}`);
            }
          }
          if (sc.structuredIssues.length > 8) {
            console.log(`  ${chalk.dim(`... 还有 ${sc.structuredIssues.length - 8} 个问题`)}`);
          }
        } else if (sc.issues.length > 0) {
          // Fallback to suggestion text
          for (const s of sc.issues.slice(0, 5)) {
            console.log(`     ${chalk.red(s.substring(0, 100))}`);
          }
        }
      }
    } catch { /* fallback to basic display */ }
  }

  if (task.errorLog.length > 0) {
    console.log();
    console.log(`  ${chalk.dim('错误日志:')}`);
    for (const err of task.errorLog.slice(-3)) {
      console.log(`  ${chalk.red(err.substring(0, 120))}`);
    }
  }
  console.log();
}

// PM4: Multi-perspective report generator
export function generatePerspectiveReport(task: Task, perspective: string): string {
  const lines: string[] = [];
  const pct = task.status === 'completed' ? 100 : task.status === 'running' ? 50 : 0;
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));

  if (perspective === 'pm') {
    lines.push(chalk.bold.blue('\n# PM 视角 — 项目状态报告\n'));
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 任务 | ${task.id.slice(0, 12)} |`);
    lines.push(`| 描述 | ${task.description.slice(0, 60)} |`);
    lines.push(`| 状态 | ${task.status} |`);
    lines.push(`| 进度 | ${bar} ${pct}% |`);
    if (task.milestone) lines.push(`| 里程碑 | ${task.milestone} |`);
    if (task.storyPoints) lines.push(`| 复杂度 | ${task.storyPoints} pts |`);
    const blocks = task.blockedBy || [];
    if (blocks.length > 0) lines.push(`| 阻塞项 | ${blocks.join(', ')} |`);
    lines.push(`\n## 下一步建议`);
    if (task.status === 'blocked') lines.push(`- ⚠️ 解除阻塞项后继续`);
    else if (task.status === 'failed') lines.push(`- 运行 ic t --retry ${task.id} 重试`);
    else if (task.status === 'completed') lines.push(`- ✅ 可进入下一里程碑`);
    else lines.push(`- 继续执行当前任务`);
  } else if (perspective === 'qa') {
    lines.push(chalk.bold.yellow('\n# QA 视角 — 质量报告\n'));
    if (task.verifyResult) {
      lines.push(`| 阶段 | 结果 |`);
      lines.push(`|------|------|`);
      for (const s of task.verifyResult.stages) {
        lines.push(`| ${s.stage} | ${s.status === 'pass' ? '✅' : '❌'} |`);
      }
      lines.push(`\n测试: ${task.verifyResult.passedTests}/${task.verifyResult.totalTests} 通过`);
    } else { lines.push('暂无验证结果'); }
  } else if (perspective === 'arch') {
    lines.push(chalk.bold.magenta('\n# 架构师视角 — 模块健康\n'));
    lines.push(`| 检查项 | 状态 |`);
    lines.push(`|------|------|`);
    lines.push(`| 变更文件 | ${task.changes.length} |`);
    lines.push(`| 推理链 | ${task.reasoning.length} 条 |`);
    lines.push(`| 风险等级 | ${task.reasoning.some(r => r.riskLevel === 'high') ? '高' : '低'} |`);
  }
  return lines.join('\n') + '\n';
}

// ════════════════════════════════════════════════════════════
// registerTaskCommands — called from src/index.ts
// ════════════════════════════════════════════════════════════

export function registerTaskCommands(program: Command): void {
  // ============================================================
  // ic st — shows real task data from .icloser/tasks/
  // ============================================================
  program.command('st')
    .alias('status')
    .description('查看任务状态')
    .argument('[task-id]', '任务 ID（不指定则显示所有）')
    .allowUnknownOption(true)
    .action(async (taskId?: string) => {
      const rootPath = process.cwd();
      const jsonMode = process.argv.includes('--json');
      try {
        const { listTasks, loadTask } = await import('../core/task-engine.js');
        if (taskId && taskId !== '--json') {
          const task = await loadTask(rootPath, taskId);
          if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }
          if (jsonMode) {
            console.log(JSON.stringify(jsonEnvelope('task', serializeTask(task)), null, 2));
            return;
          }
          printTaskDetail(task);
        } else {
          const tasks = await listTasks(rootPath);
          if (tasks.length === 0) {
            if (jsonMode) {
              console.log(JSON.stringify(jsonEnvelope('task-list', serializeTaskList([])), null, 2));
              return;
            }
            info('无任务记录。使用 ic t "描述" 创建任务');
            return;
          }
          if (jsonMode) {
            console.log(JSON.stringify(jsonEnvelope('task-list', serializeTaskList(tasks)), null, 2));
            return;
          }
          printTaskList(tasks);
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic queue — 队列监控 (T3-3)
  // ============================================================
  program.command('queue')
    .description('查看任务队列（--watch 实时监控）')
    .option('--watch', '实时监控队列状态（2s刷新，按 q 退出）')
    .option('--json', 'JSON 格式输出')
    .action(async (options: { watch?: boolean; json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const { listTasks } = await import('../core/task-engine.js');
        if (options.watch) {
          console.log(chalk.dim('实时监控中（按 q 退出，60s 自动停止）...\n'));
          const { stdin, stdout } = process;
          stdin.setRawMode?.(true); stdin.resume();
          const timer = setInterval(async () => {
            const tasks = await listTasks(rootPath);
            stdout.write('\x1b[2J\x1b[H');
            console.log(chalk.bold(`任务队列 (${tasks.length} 个)\n`));
            for (const t of tasks.slice(0, 10)) {
              const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'running' ? '·' : ' ';
              console.log(`  ${icon} ${chalk.cyan(t.id.slice(-6))} ${chalk.dim(t.description.slice(0, 50))}`);
            }
            console.log(chalk.dim(`\n${new Date().toLocaleTimeString()} — 按 q 退出`));
          }, 2000);
          let stopWatching: () => void = () => {};
          stdin.on('data', (d: Buffer) => { if (d.toString().trim() === 'q') { clearInterval(timer); stopWatching(); stdin.setRawMode?.(false); stdin.pause(); } });
          await new Promise<void>(r => { stopWatching = r; setTimeout(r, 60000); }); clearInterval(timer);
          return;
        }
        const tasks = await listTasks(rootPath);
        if (options.json) { console.log(JSON.stringify({ tasks: tasks.map(t => ({ id: t.id, description: t.description, status: t.status })) }, null, 2)); return; }
        if (tasks.length === 0) { info('任务队列为空'); return; }
        for (const t of tasks) console.log(`  ${chalk.cyan(t.id.slice(-6))} ${chalk.dim(t.description.slice(0, 50))}`);
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic d — diff
  // ============================================================
  program.command('d')
    .alias('diff')
    .description('查看代码 diff')
    .argument('[task-id]', '任务 ID（不指定则显示工作区 diff）')
    .action(async (taskId?: string) => {
      const rootPath = process.cwd();
      try {
        const { parseDiff, renderDiff } = await import('../cli/diff-renderer.js');
        if (taskId) {
          const diffPath = path.join(rootPath, '.icloser', 'tasks', taskId, 'diff.patch');
          if (await fileExists(diffPath)) {
            const raw = await readFile(diffPath) || '';
            if (raw.trim()) console.log(renderDiff(parseDiff(raw)));
            else console.log(chalk.dim('  (空 diff)'));
          } else {
            warn(`任务 ${chalk.cyan(taskId)} 的 diff 不存在（任务可能尚未执行）`);
          }
        } else {
          if (!isGitRepo(rootPath)) { warn('当前目录不是 Git 仓库'); return; }
          const diff = getDiff(rootPath);
          if (diff) console.log(renderDiff(parseDiff(diff)));
          else console.log(chalk.dim('  工作区无变更'));
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic n — reject/cancel task
  // ============================================================
  program.command('n')
    .alias('reject')
    .description('拒绝并取消任务')
    .argument('<task-id>', '任务 ID')
    .action(async (taskId: string) => {
      const rootPath = process.cwd();
      try {
        const { loadTask, updateTaskStatus, releaseFileLocks, persistTask } =
          await import('../core/task-engine.js');
        const task = await loadTask(rootPath, taskId);
        if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }

        if (task.changes.length > 0 && isGitRepo(rootPath)) {
          try {
            const { execFileSync } = await import('child_process');
            const taskFiles = task.changes.map(c => c.file);
            execFileSync('git', ['checkout', '--', ...taskFiles], { cwd: rootPath, timeout: 10000 });
            info('已回滚任务文件变更');
          } catch { /* best-effort */ }
        }
        updateTaskStatus(taskId, 'cancelled');
        releaseFileLocks(task);
        await persistTask(rootPath, task);
        warn(`任务 ${chalk.cyan(taskId)} 已取消`);
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic l / log — task history
  // ============================================================
  program.command('l')
    .alias('log')
    .description('查看任务历史')
    .argument('[task-id]', '任务 ID（不指定则列出历史）')
    .action(async (taskId?: string) => {
      const rootPath = process.cwd();
      try {
        if (taskId) {
          const reportPath = path.join(rootPath, '.icloser', 'tasks', taskId, 'report.md');
          if (await fileExists(reportPath)) {
            console.log(await readFile(reportPath));
          } else {
            const { loadTask } = await import('../core/task-engine.js');
            const task = await loadTask(rootPath, taskId);
            if (task) {
              section(`任务 ${chalk.cyan(task.id)}`);
              detail('状态', statusLabel(task.status));
              detail('描述', task.description);
              detail('修改文件', `${task.changes.length} 个`);
              if (task.completedAt) detail('完成', task.completedAt.substring(0, 19));
            } else { warn(`任务 ${chalk.cyan(taskId)} 不存在`); }
          }
        } else {
          const { listTasks } = await import('../core/task-engine.js');
          const tasks = await listTasks(rootPath);
          if (tasks.length === 0) { info('暂无历史任务'); return; }
          printTaskList(tasks);
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic r / report — last task report
  // ============================================================
  program.command('r')
    .alias('report')
    .description('查看最近一次任务报告')
    .option('--regenerate', '强制重新生成报告')
    .option('--json', 'JSON 格式输出任务数据')
    .option('--pm', '产品经理视角：进度/阻塞/风险/下一步')
    .option('--qa', '质量视角：测试覆盖/失败清单/回归风险')
    .option('--arch', '架构师视角：债务/耦合度/模块健康')
    .action(async (options) => {
      const rootPath = process.cwd();
      try {
        const { listTasks } = await import('../core/task-engine.js');
        const tasks = await listTasks(rootPath);
        if (tasks.length === 0) { info('还没有任务。运行 ic t "你的任务描述" 创建第一个任务'); return; }
        const latest = tasks.find(t => t.status === 'completed' || t.status === 'failed');
        if (!latest) { info('没有已完成或失败的任务。当前任务可能还在执行中，运行 ic st 查看'); return; }

        if (options.json) {
          console.log(JSON.stringify(jsonEnvelope('report', { taskId: latest.id, status: latest.status, description: latest.description, changes: latest.changes, agentExecutions: latest.agentExecutions, verifyResult: latest.verifyResult })));
          return;
        }

        const reportPath = path.join(rootPath, '.icloser', 'tasks', latest.id, 'report.md');
        const hasReport = await fileExists(reportPath);

        const config = await loadConfig(rootPath);
        if (options.regenerate || !hasReport) {
          if (config) {
            const { progress: prog } = await import('../cli/output.js');
            prog('重新生成报告...');
            const { generateTaskReport, generateReasoningFile } = await import('../report/generator.js');
            await generateTaskReport(rootPath, latest, config);
            await generateReasoningFile(rootPath, latest);
            success(`报告已生成: ${chalk.cyan(reportPath)}`);
          }
        }

        // PM4: Multi-perspective reports
        if (options.pm || options.qa || options.arch) {
          const perspective = options.pm ? 'pm' : options.qa ? 'qa' : 'arch';
          const summary = generatePerspectiveReport(latest, perspective);
          console.log(summary);
        } else if (await fileExists(reportPath)) {
          console.log(await readFile(reportPath));
        } else {
          warn('报告文件不存在，使用 --regenerate 重新生成');
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic cancel
  // ============================================================
  program.command('cancel')
    .description('取消排队中的任务')
    .argument('<task-id>', '任务 ID')
    .action(async (taskId: string) => {
      const rootPath = process.cwd();
      try {
        const { loadTask, cancelTask, persistTask } = await import('../core/task-engine.js');
        const task = await loadTask(rootPath, taskId);
        if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }
        if (cancelTask(taskId)) {
          await persistTask(rootPath, task);
          success(`任务 ${chalk.cyan(taskId)} 已取消`);
        } else {
          warn(`任务状态为 ${statusLabel(task.status)}，无法取消`);
        }
      } catch (err) { printError(err as Error); }
    });
}

// Keep void export to satisfy "isolatedModules" if needed
export type { Task };
