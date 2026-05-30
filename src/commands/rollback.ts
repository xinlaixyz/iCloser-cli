// src/commands/rollback.ts — ic rollback command

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config.js';
import { success, fail, warn, progress, info } from '../cli/output.js';
import { isGitRepo } from '../utils/git.js';

export function registerRollbackCommand(program: Command): void {
  program.command('rollback')
    .description('回滚任务或最近一次 autopilot 快照')
    .argument('[task-id]', '任务 ID（--auto 模式下可省略）')
    .option('--auto', '回滚最近一次 autopilot 快照（无需任务 ID）')
    .option('--dry-run', '预览回滚操作而不实际执行')
    .option('--list', '列出所有 autopilot 回滚快照')
    .action(async (taskId: string | undefined, options?: { auto?: boolean; dryRun?: boolean; list?: boolean }) => {
      const rootPath = process.cwd();

      if (options?.list) {
        const { listAutopilotRollbackSnapshots, renderAutopilotRollbackSummary } =
          await import('../core/autopilot-rollback.js');
        const snapshots = await listAutopilotRollbackSnapshots(rootPath);
        console.log(renderAutopilotRollbackSummary(snapshots));
        return;
      }

      const config = await loadConfig(rootPath);
      const useAuto = options?.auto ?? config?.execution?.autoRollbackOnFailure ?? false;

      if (useAuto) {
        const {
          loadLatestAutopilotRollbackPlan, dryRunAutopilotRollback,
          rollbackAutopilotChanges, renderAutopilotRollbackReceipts, renderAutopilotRollbackDryRun,
        } = await import('../core/autopilot-rollback.js');
        const plan = await loadLatestAutopilotRollbackPlan(rootPath);
        if (!plan) { warn('没有找到 autopilot 快照，请先运行 ic auto docs/tests --go'); return; }

        if (options?.dryRun) {
          const entries = await dryRunAutopilotRollback(plan);
          console.log(renderAutopilotRollbackDryRun(entries));
          return;
        }

        progress('正在执行 autopilot 快照回滚...');
        const receipts = await rollbackAutopilotChanges(plan);
        console.log(renderAutopilotRollbackReceipts(receipts));
        broadcastRollback(rootPath, taskId, plan.reason, receipts).catch(() => {});
        success('回滚完成');
        return;
      }

      if (!taskId) { fail('请提供任务 ID，或使用 --auto 回滚 autopilot 快照'); return; }
      if (!isGitRepo(rootPath)) { fail('需要 Git 仓库'); }
      const { loadTask, updateTaskStatus, releaseFileLocks, persistTask } =
        await import('../core/task-engine.js');
      const task = await loadTask(rootPath, taskId);
      if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }

      if (options?.dryRun) {
        info('任务回滚预览（不会实际修改）：');
        for (const c of task.changes) console.log(`  ${c.file} — ${c.intent}`);
        return;
      }

      progress(`回滚任务 ${chalk.cyan(taskId)}...`);
      try {
        const { execFileSync } = await import('child_process');
        const taskFiles = task.changes.map(c => c.file);
        execFileSync('git', ['checkout', '--', ...taskFiles], { cwd: rootPath, timeout: 10000 });
        for (const f of taskFiles) {
          try { execFileSync('git', ['clean', '-f', '--', f], { cwd: rootPath, timeout: 5000 }); } catch { /* may not exist */ }
        }
      } catch { /* best-effort */ }
      updateTaskStatus(taskId, 'cancelled');
      releaseFileLocks(task);
      await persistTask(rootPath, task);
      success('回滚完成');
    });
}

export async function broadcastRollback(
  rootPath: string,
  taskId: string | undefined,
  reason: string,
  receipts: Array<{ file: string; action: string; ok: boolean }>,
): Promise<void> {
  const restored = receipts.filter(r => r.action === 'restored' && r.ok).length;
  const deleted = receipts.filter(r => r.action === 'deleted' && r.ok).length;

  import('../core/memory/integration.js')
    .then(m => m.onRollbackCompleted(rootPath, taskId, { reason, filesRestored: restored, filesDeleted: deleted, totalFiles: receipts.length, receipts }))
    .catch(() => {});

  import('../core/audit.js')
    .then(a => a.appendAuditEvent(rootPath, 'system', 'rollback-executed', `reason: ${reason}`, 'success', {
      payload: { taskId, filesRestored: restored, filesDeleted: deleted, totalFiles: receipts.length },
    }))
    .catch(() => {});

  if (taskId) {
    import('../core/task-engine.js')
      .then(te => { te.updateTaskStatus(taskId, 'rolled-back', rootPath); })
      .catch(() => {});
  }
}
