#!/usr/bin/env node
// iCloser Agent Shell — CLI Entry Point

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from './config.js';
import { fileExists } from './utils/fs.js';
import { isGitRepo, getDiff } from './utils/git.js';
import { jsonEnvelope } from './cli/json.js';
import { AICallError } from './ai/errors.js';
import { AIOutputContractError, parseAIOutput } from './ai/output-contract.js';
import {
  success, fail, progress, warn, info, section, detail,
  printError, printHelp,
  enableOutputSanitizer,
} from './cli/output.js';
import { startRepl } from './cli/repl.js';
import type { ICloserConfig, Task, VerifyStage } from './types.js';
import { registerTaskCommands, statusLabel, printTaskPlan } from './commands/task.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerCollaborationCommands } from './commands/collaboration.js';
import { registerDiffCommands } from './commands/diff.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerAndroidCommands } from './commands/android.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerProviderCommands } from './commands/provider.js';
import { registerGenCommands } from './commands/gen.js';
import { registerDocsCommands } from './commands/docs.js';
import { registerCodeCommands } from './commands/code.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerPmCommands } from './commands/pm.js';
import { registerMarketCommands } from './commands/market.js';
import { registerProjectCommands } from './commands/project.js';
import { registerServerCommands } from './commands/server.js';
import { registerSearchCommands } from './commands/search.js';
import { registerConfigCommands } from './commands/config-cmd.js';
import { registerOpsCommands } from './commands/ops.js';

const program = new Command();
program.name('ic').description('iCloser Agent Shell — AI 工程执行 CLI').version('0.1.0');

// ── Shared helpers from task-pipeline.ts ──
import { getToolStrategy, isAnalysisOnlyTask } from './core/task-pipeline.js';

// Register extracted command modules
registerTaskCommands(program);
registerMemoryCommands(program);
registerCollaborationCommands(program);
registerDiffCommands(program);
registerImpactCommand(program);
registerAndroidCommands(program);

registerProjectCommands(program);

// ============================================================
// ic autopilot — large project automatic analysis entry
// ============================================================
program.command('autopilot')
  .alias('auto')
  .description('大项目工程自动分析：识别结构、文档缺口、测试缺口和下一步动作')
  .argument('[mode]', '模式：report | tests | docs | chain', 'report')
  .option('--json', 'JSON 格式输出')
  .option('--go', '写入模式（docs 模式下生成并写入缺失文档）')
  .option('--yes', '与 --go 搭配使用：覆盖已有文档或测试')
  .option('--module <name>', 'tests 模式下指定要补测的模块')
  .option('--auto', '验证失败时自动回滚写入的文件')
  .action(async (mode: string, options?: { json?: boolean; go?: boolean; yes?: boolean; module?: string; auto?: boolean }) => {
    const rootPath = process.cwd();
    // Resolve --auto from config if not explicitly passed
    if (options && options.auto === undefined) {
      const cfg = await loadConfig(rootPath);
      options.auto = cfg?.execution?.autoRollbackOnFailure ?? false;
    }
    try {
      const normalizedMode = mode.toLowerCase();

      // ═══ autopilot docs — generate missing documentation ═══
      if (['docs', 'doc', 'document', 'documentation'].includes(normalizedMode)) {
        const { analyzeProjectAutopilot } = await import('./core/autopilot.js');
        const { buildDocWritePlan, writeDocs } = await import('./core/autodoc.js');
        const report = await analyzeProjectAutopilot(rootPath);
        const plan = await buildDocWritePlan(rootPath, report);

        if (options?.json && !options.go) {
          console.log(JSON.stringify(jsonEnvelope('autopilot-docs', {
            rootPath: plan.rootPath,
            totalNew: plan.totalNew,
            totalExisting: plan.totalExisting,
            docs: plan.docs.map(d => ({ file: d.file, title: d.title, exists: d.exists, action: d.exists ? 'skip-existing' : 'write-new' })),
          }), null, 2));
          return;
        }

        if (options?.json && options.go) {
          const written = await writeDocs(rootPath, plan, { overwrite: options.yes || false });
          const { verifyAutopilotDocs } = await import('./core/autopilot-verify.js');
          let verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
          let repairResult = null;

          if (verification.status === 'fail') {
            repairResult = await runAutopilotRepairLoop({
              rootPath, kind: 'docs',
              written: written.map(d => ({ file: d.file, fullPath: d.fullPath })),
              jsonMode: true,
              autoRollback: options?.auto ?? false,
            });
            if (repairResult.finalStatus === 'pass') {
              verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
            }
          }

          console.log(JSON.stringify(jsonEnvelope('autopilot-docs-written', {
            rootPath,
            docsDir: path.join(rootPath, 'docs'),
            overwrite: options.yes || false,
            written: written.map(d => ({
              file: d.file,
              fullPath: d.fullPath,
              verified: d.verified,
              bytes: d.bytes,
              lines: d.lines,
            })),
            verification,
            ...(repairResult ? { repair: { attempts: repairResult.attempts, finalStatus: repairResult.finalStatus } } : {}),
          }), null, 2));
          return;
        }

        section('自动文档生成');
        if (plan.totalNew === 0) {
          success(`全部 ${plan.docs.length} 个文档已存在。运行 ${chalk.cyan('ic auto docs --go --yes')} 强制覆盖。`);
          console.log();
          return;
        }

        progress(`发现 ${plan.totalNew} 个缺失文档，${plan.totalExisting} 个已存在`);

        // Show choice panel for user confirmation
        const { renderChoicePanel } = await import('./cli/choice-panel.js');
        const bodyLines = plan.docs.map(d => {
          const icon = d.exists ? chalk.dim('(已存在)') : chalk.green('+ 新建');
          return `  ${icon} ${chalk.cyan(d.file)} ${chalk.dim(d.title)}`;
        });

        const panel = renderChoicePanel({
          title: '文档写入确认',
          subtitle: `将生成 ${plan.totalNew} 个新文档到 docs/ 目录`,
          bodyLines,
          options: [
            { id: 1, label: '写入全部缺失文档', description: `新建 ${plan.totalNew} 个文件到 docs/` },
            { id: 2, label: '写入全部（覆盖已有）', description: '包括已存在的文档在内全部生成' },
            { id: 3, label: '仅预览不写入', description: '查看文档草稿，不做实际写入' },
          ],
          hint: '下面输入框只接受 1 / 2 / 3，回车确认。',
        });
        console.log(panel);

        if (!options?.go) {
          info(`使用 ${chalk.cyan('ic auto docs --go')} 直接写入缺失文档。`);
          info(`使用 ${chalk.cyan('ic auto docs --go --yes')} 覆盖全部已有文档。`);
          return;
        }

        // Execute write
        progress('正在生成文档...');
        const written = await writeDocs(rootPath, plan, {
          overwrite: options?.yes || false,
        });

        if (written.length === 0) {
          warn('未写入任何文件（可能因为文档已存在，使用 --yes 覆盖）。');
          console.log();
          return;
        }

        for (const d of written) {
          success(`${d.file} ${chalk.dim(`+${d.lines} 行，${d.bytes} bytes`)}`);
          info(`  ${chalk.dim('路径')} ${chalk.cyan(d.fullPath)}`);
          info(`  ${chalk.dim('磁盘确认')} ${d.verified ? chalk.green('已确认存在') : chalk.red('未确认')}`);
        }
        const { verifyAutopilotDocs, formatAutopilotVerification } = await import('./core/autopilot-verify.js');
        const verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
        console.log();
        success(`已写入 ${written.length} 个文档到 ${chalk.cyan(path.join(rootPath, 'docs'))}`);
        info(formatAutopilotVerification(verification));

        if (verification.status === 'fail') {
          await runAutopilotRepairLoop({
            rootPath, kind: 'docs',
            written: written.map(d => ({ file: d.file, fullPath: d.fullPath })),
            jsonMode: false,
            autoRollback: options?.auto ?? false,
          });
        }

        console.log();
        info('下次可以问「刚才写到哪里了」查看文件路径。');
        return;
      }

      // ═══ autopilot tests — generate test plan or safe starter tests ═══
      if (['tests', 'test', 'plan-tests'].includes(normalizedMode)) {
        if (!options?.json) progress(options?.go ? '正在生成安全测试写入计划...' : '正在生成自动测试规划...');
        const { planProjectTests, renderAutopilotTestPlan } = await import('./core/autopilot.js');
        const plan = await planProjectTests(rootPath);

        if (options?.go) {
          const { buildTestWritePlan, renderTestWritePlan, writeTests } = await import('./core/autotest.js');
          const writePlan = await buildTestWritePlan(rootPath, plan, { module: options.module });

          if (options?.json) {
            const written = await writeTests(rootPath, writePlan, { overwrite: options.yes || false });
            const { verifyAutopilotTests } = await import('./core/autopilot-verify.js');
            let verification: import('./core/autopilot-verify.js').AutopilotVerifyReceipt = written.length > 0
              ? await verifyAutopilotTests(rootPath, writePlan.testCommand)
              : { status: 'skipped', kind: 'tests' as const, duration: 0, summary: '没有新写入测试文件，跳过验证' };
            let repairResult = null;

            if (verification.status === 'fail') {
              repairResult = await runAutopilotRepairLoop({
                rootPath, kind: 'tests',
                written: written.map(w => ({ file: w.file, fullPath: w.fullPath })),
                testCommand: writePlan.testCommand,
                jsonMode: true,
                autoRollback: options?.auto ?? false,
              });
              if (repairResult.finalStatus === 'pass') {
                verification = await verifyAutopilotTests(rootPath, writePlan.testCommand);
              }
            }

            console.log(JSON.stringify(jsonEnvelope('autopilot-tests-written', {
              rootPath,
              testCommand: writePlan.testCommand,
              target: writePlan.target?.module || null,
              overwrite: options.yes || false,
              written: written.map(item => ({
                file: item.file,
                sourceFile: item.sourceFile,
                fullPath: item.fullPath,
                verified: item.verified,
                bytes: item.bytes,
                lines: item.lines,
              })),
              verification,
              ...(repairResult ? { repair: { attempts: repairResult.attempts, finalStatus: repairResult.finalStatus } } : {}),
            }), null, 2));
            return;
          }

          section('Project Autopilot / Safe Test Writer');
          console.log(renderTestWritePlan(writePlan));
          console.log();

          if (writePlan.tests.length === 0) {
            success('暂未发现需要自动补测的模块。');
            console.log();
            return;
          }

          const written = await writeTests(rootPath, writePlan, { overwrite: options.yes || false });
          if (written.length === 0) {
            warn('未写入任何测试文件（可能已存在，使用 --yes 覆盖）。');
            console.log();
            return;
          }

          for (const item of written) {
            success(`${item.file} ${chalk.dim(`+${item.lines} 行，${item.bytes} bytes`)}`);
            info(`  ${chalk.dim('来源')} ${chalk.cyan(item.sourceFile)}`);
            info(`  ${chalk.dim('路径')} ${chalk.cyan(item.fullPath)}`);
            info(`  ${chalk.dim('磁盘确认')} ${item.verified ? chalk.green('已确认存在') : chalk.red('未确认')}`);
          }
          const { verifyAutopilotTests, formatAutopilotVerification } = await import('./core/autopilot-verify.js');
          const verification = await verifyAutopilotTests(rootPath, writePlan.testCommand);
          console.log();
          info(formatAutopilotVerification(verification));

          if (verification.status === 'fail') {
            await runAutopilotRepairLoop({
              rootPath, kind: 'tests',
              written: written.map(w => ({ file: w.file, fullPath: w.fullPath })),
              testCommand: writePlan.testCommand,
              jsonMode: false,
              autoRollback: options?.auto ?? false,
            });
          }

          return;
        }

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('autopilot-test-plan', plan), null, 2));
          return;
        }

        section('Project Autopilot / Tests');
        console.log(renderAutopilotTestPlan(plan));
        console.log();
        info(`使用 ${chalk.cyan('ic auto tests --go')} 为最高优先级模块生成 1 个最小测试文件。`);
        return;
      }
      if (['chain', 'flow', 'workflow', 'execute-chain'].includes(normalizedMode)) {
        if (!options?.json) progress('正在生成自动执行链...');
        const { buildExecutionChain, renderExecutionChain } = await import('./core/execution-chain.js');
        const { buildTaskThinkingLoop, renderTaskThinkingLoop } = await import('./core/task-loop.js');
        const chain = buildExecutionChain();
        const loop = buildTaskThinkingLoop();

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('autonomous-execution-chain', { ...chain, taskLoop: loop }), null, 2));
          return;
        }

        section('Project Autopilot / Chain');
        console.log(renderExecutionChain(chain));
        console.log();
        console.log(renderTaskThinkingLoop(loop));
        console.log();
        info('这条链是后续自动写文档、写测试、低风险修复、失败回滚的统一执行规则。');
        return;
      }

      if (!['report', 'analyze', 'analysis'].includes(normalizedMode)) {
        warn(`未知 autopilot 模式：${mode}，已按 report 分析。`);
      }
      if (!options?.json) progress('正在自动分析整个项目...');
      const { analyzeProjectAutopilot, renderAutopilotReport } = await import('./core/autopilot.js');
      const report = await analyzeProjectAutopilot(rootPath);

      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('autopilot-report', report), null, 2));
        return;
      }

      section('Project Autopilot');
      console.log(renderAutopilotReport(report));
      console.log();
      info('当前阶段只做分析和计划，不会自动写代码。后续执行会进入中文确认面板。');
    } catch (err) { printError(err as Error); }
  });
// ============================================================
// ic t — REAL task orchestration
// ============================================================
program.command('t')
  .alias('task')
  .description('创建并执行任务')
  .argument('<descriptions...>', '任务描述（支持多个独立任务）')
  .option('--go', '跳过预览，直接执行')
  .option('--priority <level>', '优先级：high | normal | low', 'normal')
  .option('--retry <task-id>', '重试失败的任务')
  .action(async (descriptions: string[], options) => {
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化，请先运行 ic init'); }

      // --retry: re-run a failed task
      if (options.retry) {
        const { loadTask } = await import('./core/task-engine.js');
        const task = await loadTask(rootPath, options.retry);
        if (!task) { fail(`任务 ${chalk.cyan(options.retry)} 不存在`); }
        if (task.status !== 'failed') { fail(`任务状态为 ${task.status}，只有 failed 状态的任务可以重试。运行 ic st 查看`); }
        progress(`重试任务：${chalk.cyan(task.description)}`);
        task.status = 'queued';
        task.retryCount++;
        task.errorLog = [];
        const index = await (await import('./core/scanner.js')).loadProjectIndex(rootPath);
        await executeRetryTask(task, config, rootPath, index);
        return;
      }

      // T3-2: Support parallel tasks via multiple quoted arguments
      const taskDescriptions = descriptions.length > 1 && descriptions.every(d => d.length > 3)
        ? descriptions  // ic t "task1" "task2" → parallel
        : [descriptions.join(' ')]; // ic t single task → serial

      if (taskDescriptions.length > 1) {
        progress(`并行任务：${chalk.cyan(taskDescriptions.length + ' 个任务')}`);
        const { createTask: ct } = await import('./core/task-engine.js');
        const tasks = taskDescriptions.map(d => ct(d, { priority: options.priority as 'high' | 'normal' | 'low' }));
        success(`已创建 ${tasks.length} 个任务: ${tasks.map(t => chalk.cyan(t.id.slice(-6))).join(', ')}`);
        for (const t of tasks) {
          if (options.go) {
            const idx = await (await import('./core/scanner.js')).loadProjectIndex(rootPath);
            await executeTask(t, config, rootPath, idx);
          }
        }
        return;
      }

      const description = taskDescriptions[0];
      progress(`解析任务：${chalk.cyan(description)}`);

      const { createTask, generatePlanAsync, persistTask } =
        await import('./core/task-engine.js');
      const { recordUserInputEvent } = await import('./core/memory.js');

      // Create task
      const task = createTask(description, { priority: options.priority as 'high' | 'normal' | 'low' });
      await recordUserInputEvent(rootPath, description, { kind: 'task-description', taskId: task.id });
      const { appendAuditEvent: auditTaskCreated } = await import('./core/audit.js');
      await auditTaskCreated(rootPath, 'user', 'task-created', task.id, 'success', { taskId: task.id, payload: { description: description.substring(0, 100) } });
      progress(`任务 ${chalk.cyan(task.id)} 已创建`);
      try {
        const { buildTaskMemorySummary, renderTaskMemorySummary } = await import('./core/memory-experience.js');
        const memorySummary = await buildTaskMemorySummary(rootPath, description, 5);
        const renderedMemory = renderTaskMemorySummary(memorySummary);
        if (renderedMemory) {
          section('长期记忆');
          console.log(renderedMemory);
          console.log();
        }
      } catch {
        // Memory preview must never block task execution.
      }

      // Load or build index (use loadProjectIndex to properly deserialize Map fields)
      let index: import('./types.js').ProjectIndex | null = null;
      try {
        const { loadProjectIndex } = await import('./core/scanner.js');
        index = await loadProjectIndex(rootPath);
      } catch { /* best-effort */ }
      if (!index) {
        try {
          const { scanProject, saveProjectIndex } = await import('./core/scanner.js');
          const r = await scanProject({ rootPath, deep: true, includeTests: false, maxFileSize: 500 * 1024 });
          index = r.index;
          await saveProjectIndex(rootPath, index);
        } catch { /* best-effort */ }
      }

      // Generate plan
      progress('生成修改方案...');
      if (index) {
        let planningProvider: import('./ai/provider.js').AIProviderAdapter | undefined;
        try {
          const { createProvider } = await import('./ai/provider.js');
          planningProvider = createProvider(config.ai);
        } catch { /* best-effort: generatePlanAsync falls back without a provider */ }
        task.plan = await generatePlanAsync(task, description, config.project.identity, index, planningProvider);
      }

      // P2-3: Forced workflow — always show plan before executing code changes
      const { classifyIntentRegex } = await import('./core/intent-classifier.js');
      const intent = classifyIntentRegex(description);
      const isCodeTask = intent ? /^(code_change|code_fix|code_complete|plan)$/.test(intent.category) : Boolean(index);
      if (isCodeTask) {
        printTaskPlan(task);
        console.log();
        if (task.plan) {
          const affectedCount = task.plan.affectedFiles.length;
          const highImpact = affectedCount > 5;
          if (highImpact) warn(`影响 ${affectedCount} 个文件，建议审查后再执行`);
        }
      }

      // Preview mode
      if (!options.go && config.execution.defaultMode === 'preview') {
        await persistTask(rootPath, task);
        info(`使用 ${chalk.cyan(`ic y ${task.id}`)} 确认执行，${chalk.cyan(`ic n ${task.id}`)} 取消`);
        return;
      }

      // Execute mode
      await executeTask(task, config, rootPath, index);
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic y / ic n — Accept / Reject
// ============================================================
program.command('y')
  .alias('accept')
  .description('确认并执行任务。支持 --skip <file> 跳过指定文件，--only <file> 仅应用指定文件')
  .argument('<task-id>', '任务 ID')
  .option('--skip <files>', '跳过指定文件（逗号分隔）')
  .option('--only <files>', '仅应用指定文件（逗号分隔）')
  .action(async (taskId: string, options: { skip?: string; only?: string }) => {
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化'); }
      const { loadTask } = await import('./core/task-engine.js');
      const task = await loadTask(rootPath, taskId);
      if (!task) { fail(`任务 ${chalk.cyan(taskId)} 不存在`); }
      if (task.status !== 'queued' && task.status !== 'running') {
        warn(`任务状态为 ${statusLabel(task.status)}，无法执行`); return;
      }

      // T1-2d: Selective file approval / rejection
      if (options.skip) {
        const skipFiles = options.skip.split(',').map(f => f.trim());
        if (task.plan?.affectedFiles) {
          task.plan.affectedFiles = task.plan.affectedFiles.filter(f => !skipFiles.includes(f));
          detail('局部执行', `跳过 ${skipFiles.length} 个文件: ${skipFiles.join(', ')}`);
        }
      }
      if (options.only) {
        const onlyFiles = options.only.split(',').map(f => f.trim());
        if (task.plan?.affectedFiles) {
          task.plan.affectedFiles = task.plan.affectedFiles.filter(f => onlyFiles.includes(f));
          detail('局部执行', `仅应用 ${onlyFiles.length} 个文件: ${onlyFiles.join(', ')}`);
        }
      }

      let index: import('./types.js').ProjectIndex | null = null;
      try {
        const { loadProjectIndex } = await import('./core/scanner.js');
        index = await loadProjectIndex(rootPath);
      } catch { /* best-effort */ }
      await executeTask(task, config, rootPath, index);
    } catch (err) { printError(err as Error); }
  });

registerOpsCommands(program);
registerConfigCommands(program);

// ic provider — extracted to src/commands/provider.ts
registerProviderCommands(program);

registerServerCommands(program);

registerSearchCommands(program);

// ============================================================
// ic rollback
// ============================================================
program.command('rollback')
  .description('回滚任务或最近一次 autopilot 快照')
  .argument('[task-id]', '任务 ID（--auto 模式下可省略）')
  .option('--auto', '回滚最近一次 autopilot 快照（无需任务 ID）')
  .option('--dry-run', '预览回滚操作而不实际执行')
  .option('--list', '列出所有 autopilot 回滚快照')
  .action(async (taskId: string | undefined, options?: { auto?: boolean; dryRun?: boolean; list?: boolean }) => {
    const rootPath = process.cwd();

    // --list: show all saved snapshots
    if (options?.list) {
      const { listAutopilotRollbackSnapshots, renderAutopilotRollbackSummary } =
        await import('./core/autopilot-rollback.js');
      const snapshots = await listAutopilotRollbackSnapshots(rootPath);
      console.log(renderAutopilotRollbackSummary(snapshots));
      return;
    }

    // --auto (or config default): autopilot rollback
    const config = await loadConfig(rootPath);
    const useAuto = options?.auto ?? config?.execution?.autoRollbackOnFailure ?? false;

    if (useAuto) {
      const {
        loadLatestAutopilotRollbackPlan,
        dryRunAutopilotRollback,
        rollbackAutopilotChanges,
        renderAutopilotRollbackReceipts,
        renderAutopilotRollbackDryRun,
      } = await import('./core/autopilot-rollback.js');
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

      // Broadcast rollback event to memory/task/audit
      broadcastRollback(rootPath, taskId, plan.reason, receipts).catch(() => { /* fire-and-forget */ });

      success('回滚完成');
      return;
    }

    // Without --auto: git-based task rollback
    if (!taskId) { fail('请提供任务 ID，或使用 --auto 回滚 autopilot 快照'); return; }
    if (!isGitRepo(rootPath)) { fail('需要 Git 仓库'); }
    const { loadTask, updateTaskStatus, releaseFileLocks, persistTask } =
      await import('./core/task-engine.js');
    const task = await loadTask(rootPath, taskId);
    if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }

    if (options?.dryRun) {
      info('任务回滚预览（不会实际修改）：');
      for (const c of task.changes) {
        console.log(`  ${c.file} — ${c.intent}`);
      }
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

// ============================================================
// Default — REPL
// ============================================================
// ic risk/release-status/roadmap/deps/estimate/changelog/quality — extracted to src/commands/pm.ts
registerPmCommands(program);

// FIX-1: ic plan — structured development workflow with persistence
let activePlan: import("./core/task-planner.js").DevPlan | null = null;
let activePlanFile: string | null = null;
async function saveActivePlan(rootPath: string) {
  if (!activePlan || !activePlanFile) return;
  try {
    const plansDir = path.join(rootPath, ".icloser", "plans");
    const { ensureDir, writeFile } = await import("./utils/fs.js");
    await ensureDir(plansDir);
    await writeFile(activePlanFile, JSON.stringify(activePlan, null, 2));
  } catch { /* best-effort */ }
}
async function loadLatestPlan(rootPath: string) {
  try {
    const plansDir = path.join(rootPath, ".icloser", "plans");
    const fs = await import("fs/promises");
    const entries = await fs.readdir(plansDir).catch(() => [] as string[]);
    const plans = entries.filter(e => e.startsWith("PLAN-") && e.endsWith(".json")).sort().reverse();
    if (plans.length > 0) {
      activePlanFile = path.join(plansDir, plans[0]);
      activePlan = JSON.parse(await fs.readFile(activePlanFile, "utf-8"));
      return true;
    }
  } catch { return false; }
  return false;
}
program.command("plan")
  .description("结构化开发规划：分析需求→分解任务→编号确认→逐任务开发（持久化到 .icloser/plans/")
  .argument("[action]", "create <描述> | status | next | start <任务ID> | accept | list | load <planId>")
  .action(async (action?: string) => {
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail("项目未初始化"); }

      // List saved plans
      if (action === "list") {
        const plansDir = path.join(rootPath, ".icloser", "plans");
        const fs = await import("fs/promises");
        const entries = await fs.readdir(plansDir).catch(() => [] as string[]);
        const plans = entries.filter(e => e.endsWith(".json")).sort().reverse();
        if (plans.length === 0) { info("无已保存的计划"); return; }
        for (const pf of plans) {
          const p = JSON.parse(await fs.readFile(path.join(plansDir, pf), "utf-8"));
          const done = p.tasks.filter((t: {status:string}) => t.status === "done").length;
          console.log(`  ${pf.replace(".json","")} — ${p.requirement.slice(0, 50)} [${done}/${p.tasks.length}]`);
        }
        return;
      }

      // Load a specific plan
      if (action === "load") {
        const planId = process.argv[process.argv.indexOf("load") + 1] || "";
        if (!planId) { info("用法: ic plan load <planId>"); return; }
        const plansDir = path.join(rootPath, ".icloser", "plans");
        const fs = await import("fs/promises");
        const planFile = path.join(plansDir, planId.includes(".json") ? planId : planId + ".json");
        try {
          activePlan = JSON.parse(await fs.readFile(planFile, "utf-8"));
          activePlanFile = planFile;
          const loaded = activePlan!;
          const { formatPlanForDisplay } = await import("./core/task-planner.js");
          console.log(formatPlanForDisplay(loaded));
          success("已加载: " + loaded.requirement);
        } catch { fail("计划不存在: " + planId); }
        return;
      }

      // Try to load latest plan if none active
      if (!activePlan && action !== "create") {
        const loaded = await loadLatestPlan(rootPath);
        if (!loaded) { info("无活跃计划。运行 ic plan create <描述>"); return; }
      }

      const { createProvider } = await import("./ai/provider.js");
      const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || "" });

      if (!action || action === "create") {
        const desc = process.argv.slice(process.argv.indexOf("create") + 1).join(" ") || process.argv.slice(3).join(" ") || "新功能";
        progress("分析需求: " + desc);
        const resp = await provider.chat({
          systemPrompt: "你是项目规划专家。分析需求后输出JSON: {\"analysis\":\"需求分析(2-3句)\",\"tasks\":[{\"seq\":1,\"title\":\"任务标题\",\"desc\":\"任务描述\",\"files\":[\"文件路径\"],\"deps\":[],\"est\":\"2h\"}]}。分解为3-7个任务。",
          task: desc,
          context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
        });
        try {
          const j = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || "{}"));
          const { createDevPlan, formatPlanForDisplay } = await import("./core/task-planner.js");
          activePlan = createDevPlan(desc, j.analysis || "", (j.tasks || []).map((t: Record<string,unknown>, i: number) => ({
            id: `task-${Date.now().toString(36)}-${i}`, seq: (t.seq as number) || i+1,
            title: (t.title as string) || (t.desc as string)?.slice(0, 40) || `任务${i+1}`,
            description: (t.desc as string) || "", files: (t.files as string[]) || [],
            dependencies: (t.deps as number[]) || [], estimated: (t.est as string) || "2h", status: "pending" as const,
          })));
          // Persist to file
          const plansDir = path.join(rootPath, ".icloser", "plans");
          const { ensureDir, writeFile } = await import("./utils/fs.js");
          await ensureDir(plansDir);
          activePlanFile = path.join(plansDir, `PLAN-${activePlan.planId}.json`);
          await writeFile(activePlanFile, JSON.stringify(activePlan, null, 2));
          console.log(formatPlanForDisplay(activePlan));
          detail("已保存", activePlanFile);
          return;
        } catch { info("AI 规划失败，请重试"); return; }
      }

      if (!activePlan) { info("无活跃计划。运行 ic plan create <描述>"); return; }

      if (action === "status") {
        const { formatPlanForDisplay } = await import("./core/task-planner.js");
        console.log(formatPlanForDisplay(activePlan));
        return;
      }

      if (action === "next") {
        const { getNextPendingTask } = await import("./core/task-planner.js");
        const t = getNextPendingTask(activePlan);
        if (!t) { success("全部任务已完成！运行 ic plan accept 验收"); return; }
        info(`下一个任务: Task-${t.seq} — ${t.title}`);
        info(`描述: ${t.description}`);
        info(`预估: ${t.estimated} | 文件: ${t.files.join(", ") || "待定"}`);
        info("输入 ic plan start " + t.seq + " 开始此任务");
        return;
      }

      if (action === "start") {
        const seq = parseInt(process.argv[process.argv.indexOf("start") + 1] || "1");
        const task = activePlan.tasks.find(t => t.seq === seq);
        if (!task) { fail("任务不存在: Task-" + seq); }
        task.status = "in_progress";
        await saveActivePlan(rootPath);
        progress(`开始 Task-${seq}: ${task.title}`);
        const { createTask: ct } = await import("./core/task-engine.js");
        const newTask = ct(task.title + ": " + task.description, { priority: "high" });
        await executeTask(newTask, config, rootPath, null);
        task.status = "done";
        await saveActivePlan(rootPath);
        success(`Task-${seq} 完成`);
        const { getNextPendingTask } = await import("./core/task-planner.js");
        const next = getNextPendingTask(activePlan);
        if (next) info(`下一步: ic plan start ${next.seq} — ${next.title}`);
        else success("全部任务完成！运行 ic plan accept 验收");
        return;
      }

      if (action === "accept") {
        const { allTasksDone } = await import("./core/task-planner.js");
        if (!allTasksDone(activePlan)) { warn("还有未完成任务。运行 ic plan status 查看"); return; }
        success("验收通过！计划完成: " + activePlan.requirement);
        if (activePlanFile) {
          try {
            const completedFile = activePlanFile.replace(".json", "-DONE.json");
            await (await import("fs/promises")).rename(activePlanFile, completedFile);
          } catch { /* best-effort */ }
        }
        activePlan = null;
        activePlanFile = null;
        return;
      }

      // DAG: Show parallelization plan
      if (action === "dag") {
        const { getDAGLevels } = await import("./core/task-planner.js");
        const levels = await getDAGLevels(activePlan);
        for (const level of levels) {
          const names = level.tasks.map(t => `Task-${t.seq} ${t.status === 'done' ? '✅' : '·'}`);
          console.log(`  层 ${level.level} [${level.estimatedTime}]  ${names.join(' ⏺ ')}`);
          if (level.tasks.length > 1) console.log(`    ↳ ${level.tasks.length} 任务可并行执行`);
        }
        return;
      }

      // DAG: Execute all ready tasks in parallel by level
      if (action === "run-all") {
        const { getDAGLevels, validatePlanDAG } = await import("./core/task-planner.js");
        // Gap-2: DAG cycle check before execution
        const cycleCheck = await validatePlanDAG(activePlan);
        if (cycleCheck) { fail(`DAG 循环: ${cycleCheck}`); return; }

        const { executeDAG, calculateParallelSavings } = await import('./core/dag-scheduler.js');
        const levels = await getDAGLevels(activePlan);
        const savings = calculateParallelSavings(levels);
        detail('DAG', `${levels.length} 层 / ${levels.reduce((s, l) => s + l.tasks.length, 0)} 任务 / 并行节省 ${savings} 步`);

        // T1-6e: --isolated flag for git worktree per task
        const isolated = process.argv.includes('--isolated');
        const pendingTasks = levels.flatMap(l => l.tasks.filter(t => t.status !== 'done'));
        const result = await executeDAG(pendingTasks, async (t) => {
          t.status = 'in_progress';
          await saveActivePlan(rootPath);
          const { createTask: ct } = await import('./core/task-engine.js');
          const newTask = ct(t.title + ': ' + t.description, { priority: 'high' });

          let worktree: import('./utils/git.js').WorktreeInfo | null = null;
          if (isolated) {
            const { createWorktree: cw } = await import('./utils/git.js');
            const wt = cw(rootPath, `icloser/task-${newTask.id.slice(-8)}`, `.icloser/worktrees/${newTask.id}`);
            if (wt) { worktree = { path: `.icloser/worktrees/${newTask.id}`, branch: `icloser/task-${newTask.id.slice(-8)}` }; detail('隔离', worktree.branch); }
          }

          await executeTask(newTask, config, rootPath, null);

          if (worktree) {
            const { removeWorktree: rw } = await import('./utils/git.js');
            rw(rootPath, worktree.path);
          }

          t.status = 'done';
          await saveActivePlan(rootPath);
          return t;
        });
        success(`DAG 执行完成: ${result.results.length} 个任务 / ${(result.totalTime / 1000).toFixed(1)}s`);
        return;
      }

      info("用法: ic plan [create|status|next|start|accept|dag|run-all|list|load]");
    } catch (err) { printError(err as Error); }
  });

program.action(async () => {
  if (process.argv.length <= 2) await startRepl();
  else printHelp();
});

// ============================================================
// ============================================================
// ic code — extracted to src/commands/code.ts
registerCodeCommands(program);
// ic gen — extracted to src/commands/gen.ts
registerGenCommands(program);
// ic docs — extracted to src/commands/docs.ts
registerDocsCommands(program);

// ic agent — extracted to src/commands/agent.ts
registerAgentCommands(program);
// ic skill — extracted to src/commands/skill.ts
registerSkillCommands(program);

// ============================================================
// ic market — extracted to src/commands/market.ts
registerMarketCommands(program);

enableOutputSanitizer();
if (process.argv.length <= 2) {
  await startRepl();
} else {
  program.parse(process.argv);
}

// ════════════════════════════════════════════════════════════
// CORE: autopilot repair loop — write → verify → repair → retry → rollback
// ════════════════════════════════════════════════════════════
const MAX_AUTOPILOT_REPAIR_ATTEMPTS = 2;

interface AutopilotWrittenFile {
  file: string;
  fullPath: string;
}

async function broadcastRollback(
  rootPath: string,
  taskId: string | undefined,
  reason: string,
  receipts: Array<{ file: string; action: string; ok: boolean }>,
): Promise<void> {
  const restored = receipts.filter(r => r.action === 'restored' && r.ok).length;
  const deleted = receipts.filter(r => r.action === 'deleted' && r.ok).length;

  // Memory kernel (fire-and-forget)
  import('./core/memory/integration.js')
    .then(m => m.onRollbackCompleted(rootPath, taskId, { reason, filesRestored: restored, filesDeleted: deleted, totalFiles: receipts.length, receipts }))
    .catch(() => {});

  // Audit log (fire-and-forget)
  import('./core/audit.js')
    .then(a => a.appendAuditEvent(rootPath, 'system', 'rollback-executed', `reason: ${reason}`, 'success', {
      payload: { taskId, filesRestored: restored, filesDeleted: deleted, totalFiles: receipts.length },
    }))
    .catch(() => {});

  // Task engine: update task status if taskId is known
  if (taskId) {
    import('./core/task-engine.js')
      .then(te => { te.updateTaskStatus(taskId, 'rolled-back', rootPath); })
      .catch(() => {});
  }
}

async function runAutopilotRepairLoop(options: {
  rootPath: string;
  kind: 'docs' | 'tests';
  written: AutopilotWrittenFile[];
  testCommand?: string;
  jsonMode: boolean;
  autoRollback?: boolean;
}): Promise<{ finalStatus: 'pass' | 'fail' | 'rolled-back'; attempts: number }> {
  const { rootPath, kind, written, testCommand, jsonMode } = options;
  const files = written.map(w => w.file);
  let attemptCount = 0;

  const { buildAutopilotRepairPlan } = await import('./core/autopilot-repair.js');
  const { createAutopilotRollbackPlan, persistAutopilotRollbackPlan, rollbackAutopilotChanges, renderAutopilotRollbackPlan } = await import('./core/autopilot-rollback.js');

  // Build rollback snapshot before any repair and persist for ic rollback --auto
  const rollbackPlan = await createAutopilotRollbackPlan(rootPath, files, `autopilot ${kind} 验证失败，进入自动修复`);
  await persistAutopilotRollbackPlan(rollbackPlan).catch(() => { /* best-effort */ });

  while (attemptCount < MAX_AUTOPILOT_REPAIR_ATTEMPTS) {
    attemptCount++;

    // Re-verify
    let verification: import('./core/autopilot-verify.js').AutopilotVerifyReceipt;
    if (kind === 'docs') {
      const { verifyAutopilotDocs } = await import('./core/autopilot-verify.js');
      verification = await verifyAutopilotDocs(rootPath, files);
    } else {
      const { verifyAutopilotTests } = await import('./core/autopilot-verify.js');
      verification = await verifyAutopilotTests(rootPath, testCommand || '');
    }

    if (verification.status !== 'fail') {
      if (!jsonMode) {
        const { formatAutopilotVerification } = await import('./core/autopilot-verify.js');
        console.log();
        info(formatAutopilotVerification(verification));
        if (attemptCount > 1) success(`第 ${attemptCount} 次自动修复后验证通过。`);
      }
      return { finalStatus: 'pass', attempts: attemptCount };
    }

    // Build repair plan
    const repairPlan = buildAutopilotRepairPlan(verification, files);

    // Apply repair
    const { applyAutopilotRepairPlan, renderAutopilotRepairReceipts } = await import('./core/autopilot-repair.js');

    if (!jsonMode) {
      progress(`自动修复尝试 ${attemptCount}/${MAX_AUTOPILOT_REPAIR_ATTEMPTS}...`);
      const { renderAutopilotRepairPlan } = await import('./core/autopilot-repair.js');
      console.log(renderAutopilotRepairPlan(repairPlan));
    }

    if (repairPlan.autoApply) {
      const repairReceipts = await applyAutopilotRepairPlan(rootPath, repairPlan);
      const changed = repairReceipts.some(r => r.action === 'updated');
      if (!jsonMode) {
        console.log(renderAutopilotRepairReceipts(repairReceipts));
      }
      if (!changed && !jsonMode) {
        warn('未匹配到可自动修复的错误模式，停止重试。');
        break;
      }
    } else {
      if (!jsonMode) {
        warn('当前失败类型只能生成修复建议，无法自动应用。');
      }
      break;
    }
  }

  // Max attempts reached — auto-execute or offer rollback
  if (options.autoRollback) {
    const receipts = await rollbackAutopilotChanges(rollbackPlan);
    if (!jsonMode) {
      const { renderAutopilotRollbackReceipts } = await import('./core/autopilot-rollback.js');
      console.log();
      warn(`已尝试 ${MAX_AUTOPILOT_REPAIR_ATTEMPTS} 次自动修复，已自动执行回滚。`);
      console.log(renderAutopilotRollbackReceipts(receipts));
    }
    broadcastRollback(rootPath, undefined, rollbackPlan.reason, receipts).catch(() => {});
    return { finalStatus: 'rolled-back', attempts: attemptCount };
  }

  if (!jsonMode) {
    console.log();
    warn(`已尝试 ${MAX_AUTOPILOT_REPAIR_ATTEMPTS} 次自动修复，建议回滚本次写入。`);
    console.log(renderAutopilotRollbackPlan(rollbackPlan));
    info(`使用 ${chalk.cyan('ic auto docs --go')} 或 ${chalk.cyan('ic auto tests --go')} 重新生成。`);
  }

  return { finalStatus: 'fail', attempts: attemptCount };
}

// ════════════════════════════════════════════════════════════
// Retry a previously failed task
async function executeRetryTask(
  task: Task,
  config: ICloserConfig,
  rootPath: string,
  index: import('./types.js').ProjectIndex | null,
): Promise<void> {
  info(`第 ${task.retryCount} 次重试任务 ${task.id}`);
  await executeTask(task, config, rootPath, index);
}

// CORE: executeTask — full pipeline
// ════════════════════════════════════════════════════════════
async function executeTask(
  task: Task,
  config: ICloserConfig,
  rootPath: string,
  index: import('./types.js').ProjectIndex | null,
): Promise<void> {
  const {
    updateTaskStatus, addFileChange, addReasoning, setVerifyResult,
    persistTask, acquireFileLocks, releaseFileLocks,
    setTaskLoopStep, advanceTaskLoopState, completeTaskLoop,
  } = await import('./core/task-engine.js');

  const { appendAuditEvent } = await import('./core/audit.js');

  console.log();
  progress(`执行任务 ${chalk.cyan(task.id)}...`);
  updateTaskStatus(task.id, 'running');
  await persistTask(rootPath, task);

  await appendAuditEvent(rootPath, 'system', 'task-started', task.id, 'success', { taskId: task.id, payload: { description: task.description } });

  // 1. File locks
  if (task.plan && task.plan.affectedFiles.length > 0) {
    acquireFileLocks(task);
    if (task.status === 'blocked') {
      await persistTask(rootPath, task);
      fail('任务阻塞：文件被其他任务锁定');
      return;
    }
  }

  // 2. Context assembly — use dev2's assembleContextFromProject
  setTaskLoopStep(task.id, 'collect-context');
  progress('组装上下文...');
  let contextPkg: import('./types.js').ContextPackage | null = null;
  try {
    const { assembleContextFromProject } = await import('./core/context.js');
    contextPkg = await assembleContextFromProject(rootPath, task, {
      maxTokens: config.ai.maxTokens,
    });
    detail('上下文', `${contextPkg.totalTokens.toLocaleString()} tokens (${contextPkg.budgetUsed}% 预算)`);
  } catch { /* proceed without context */ }

  // Auto-7: Inject task pattern suggestions from past executions
  try {
    const { getTaskSuggestions } = await import('./core/task-memory.js');
    const suggestions = await getTaskSuggestions(rootPath, task.description);
    if (suggestions.length > 0) {
      const top = suggestions[0];
      const hint = `[学习提示] 过去 ${top.sampleCount} 次类似任务成功率 ${Math.round(top.successRate * 100)}%` +
        (top.commonFiles.length > 0 ? `。常用文件: ${top.commonFiles.join(', ')}` : '') +
        (top.recommendedStrategy.length > 0 ? `。推荐策略: ${top.recommendedStrategy.join(' → ')}` : '');
      task.description += '\n\n' + hint;
    }
  } catch { /* best-effort */ }

  setTaskLoopStep(task.id, 'take-action');

  // 3. Create Agent via AgentManager to bridge Task → Agent (S6: Task→Agent 自动桥接)
  let agent: import('./types.js').AgentInstance | null = null;
  let mgrAgent: import('./agent/manager.js').AgentManager | null = null;
  try {
    const { AgentManager, DEFAULT_TEMPLATES } = await import('./agent/manager.js');
    mgrAgent = new AgentManager(config.ai, 3);
    agent = mgrAgent.create({
      name: task.description,
      type: 'task',
      model: config.ai.model,
      context: contextPkg || undefined,
      tools: DEFAULT_TEMPLATES.find(t => t.type === 'task')?.defaultTools || [],
      sandboxLevel: 'none',
      budget: { maxTokens: config.ai.maxTokens, maxTime: 600000 },
    });
    detail('Agent', `${chalk.cyan(agent.id)} 已创建用于执行`);
  } catch { /* agent creation is best-effort */ }

  // 4. Create provider (shared for initial call + auto-fix loop)
  let provider: import('./ai/provider.js').AIProviderAdapter | null = null;
  try {
    const { createProvider } = await import('./ai/provider.js');
    provider = createProvider({
      provider: config.ai.provider,
      model: config.ai.model,
      apiKey: config.ai.apiKey || '',
      maxTokens: config.ai.maxTokens,
      temperature: config.ai.temperature,
    });
  } catch (err) {
    const msg = (err as Error).message;
    task.errorLog.push(`创建 AI Provider 失败: ${msg}`);
    updateTaskStatus(task.id, 'failed');
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    fail(`创建 AI Provider 失败: ${msg}`);
    return;
  }

  // 4.5. Multi-Agent parallel exploration for analysis tasks
  const isAnalysisTask = isAnalysisOnlyTask(task.description);
  let orchestratedResults: string[] = [];
  if (isAnalysisTask && provider.supportsToolUse) {
    try {
      const { AgentManager } = await import('./agent/manager.js');
      const orch = new AgentManager(config.ai, 3);
      // Decompose analysis into 3 parallel dimensions
      const dimensions = [
        '分析项目结构和模块组织：列出所有目录、文件数量、模块职责、技术栈识别',
        '分析代码质量和测试覆盖：检查测试文件、lint配置、CI/CD、构建产物管理',
        '分析项目完成度：读取任务文件、报告、版本信息，评估进度和阻塞项',
      ];
      const children = dimensions.map((d, i) =>
        orch.create({
          name: `分析维度${i + 1}`,
          type: 'explore',
          sandboxLevel: 'readonly',
          context: contextPkg || undefined,
          budget: { maxTokens: 8000, maxTime: 120000 },
        })
      );
      progress('并行探索中（3 个 Agent）...');
      await Promise.all(children.map((c, i) => orch.start(c.id, dimensions[i])));
      // Wait up to 2 minutes per agent
      await Promise.all(children.map(c => orch.waitForAgent(c.id, 120000)));
      for (const c of children) {
        const agent = orch.get(c.id);
        if (agent?.result?.output) orchestratedResults.push(`## ${agent.name}\n${agent.result.output.slice(0, 1500)}`);
      }
      if (orchestratedResults.length > 0) detail('并行探索', `${orchestratedResults.length}/3 Agent 完成`);
    } catch { /* orchestration is best-effort */ }
  }

  // F-1: Multi-agent orchestration for complex code tasks (>3 affected files)
  if (!isAnalysisTask && task.plan && (task.plan.affectedFiles?.length || 0) > 3 && provider.supportsToolUse && config.ai.provider !== 'mock') {
    try {
      const { ExecutionBus } = await import('./core/execution-engine.js');
      const bus = new ExecutionBus(3);
      const modules = [...new Set((task.plan.affectedFiles || []).map(f => f.split('/')[0] || 'root'))];
      const agents = modules.slice(0, 3).map(mod =>
        bus.createAgent(`理解模块: ${mod}`, contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 })
      );
      if (agents.length > 1) {
        detail('并行探索', `${agents.length} Agent 分析 ${agents.length} 个模块`);
        const results = await bus.executeParallel(agents.slice(0, 3), rootPath, provider);
        for (const r of results) {
          if (r.result) orchestratedResults.push(`## ${r.name}\n${r.result.slice(0, 1000)}`);
        }
      }
    } catch { /* best-effort */ }
  }

  // FIX-3: For code_change tasks, inject style constraints + code patterns via code-writer.ts
  if (!isAnalysisTask && index && index.styleFingerprint && config.ai.provider !== 'mock') {
    try {
      const { buildStyleConstraints, readCodePatterns } = await import('./core/code-writer.js');
      const styleConstraint = buildStyleConstraints(index.styleFingerprint);
      task.description += '\n\n' + styleConstraint;
      const codeSamples = await readCodePatterns(rootPath, index);
      if (codeSamples) {
        task.description += '\n\n现有代码模式参考:\n' + codeSamples.slice(0, 2000);
      }
    } catch { /* best-effort */ }
  }

  // 5. B1+B2: System-driven execution — plan → execute → synthesize
  let aiContent = '';
  let aiOutput: ReturnType<typeof parseAIOutput> | null = null;
  const aiCallStarted = Date.now();
  let totalTokensUsed = 0;
  const isAnalysis = isAnalysisOnlyTask(task.description);

  try {
    // Generate execution plan via AI
    progress('AI 任务规划...');
    const { generateExecutionPlan, clarifyVagueTask } = await import('./core/execution-plan.js');
    const ctxPkg = contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 };

    // #5: Clarify vague tasks before planning
    if (!isAnalysis && config.ai.provider !== 'mock') {
      try {
        const clarification = await clarifyVagueTask(task.description, provider);
        if (clarification.isVague && clarification.questions.length > 0) {
          detail('任务澄清', `检测到模糊任务，AI 提出 ${clarification.questions.length} 个问题`);
          for (const q of clarification.questions) {
            console.log(`  ${chalk.yellow('?')} ${chalk.dim(q)}`);
          }
          console.log(chalk.dim(`\n  请用更具体的描述重新运行 ic t "具体需求"\n`));
          updateTaskStatus(task.id, 'failed');
          task.errorLog.push('任务描述过于模糊，需要更具体的信息');
          await persistTask(rootPath, task);
          releaseFileLocks(task);
          return;
        }
      } catch { /* best-effort */ }
    }

    const plan = await generateExecutionPlan(task.description, ctxPkg, provider, isAnalysis ? 'analysis' : undefined);

    if (plan.steps.length > 0) {
      const stepList = plan.steps.map((s: any) => `  ${s.seq}. ${s.tool} — ${s.why}`).join('\n');
      detail('执行计划', `${plan.steps.length} 步\n${stepList}`);
    }

    // Execute via system-driven engine
    const { executeWithPlan } = await import('./core/execution-engine.js');
    const engineResult = await executeWithPlan(plan, task, rootPath, provider, ctxPkg);

    if (engineResult.decisionPoints.length > 0) {
      detail('系统决策', `${engineResult.decisionPoints.length} 次干预: ${engineResult.decisionPoints.join('; ')}`);
    }

    aiContent = engineResult.aiResponse;
    aiOutput = parseAIOutput(aiContent);
    totalTokensUsed = engineResult.executionState.completedSteps.length * 500;

    // Fallback: if AI produced no changes but it's a code task, try one more synthesis
    if ((!aiOutput || !aiOutput.changes || aiOutput.changes.length === 0) && !isAnalysis) {
      try {
        const { buildExecutionSummary } = await import('./core/execution-plan.js');
        const summary = buildExecutionSummary(engineResult.executionState);
        const fallbackResp = await provider.chat({
          systemPrompt: '基于探索结果输出变更契约。不要继续探索。',
          task: summary + '\n\n请输出最终变更。',
          context: ctxPkg,
          history: '',
        });
        aiContent = fallbackResp.content;
        aiOutput = parseAIOutput(aiContent);
        totalTokensUsed += fallbackResp.tokensUsed;
      } catch { /* best-effort */ }
    }
  } catch (engineErr) {
    // Gap-4: Engine failure is a real failure — no silent fallback
    task.errorLog.push(`执行引擎异常: ${(engineErr as Error).message}`);
    updateTaskStatus(task.id, 'failed');
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    fail(`执行引擎异常: ${(engineErr as Error).message.slice(0, 200)}`);
    return;
  }

  if (!aiContent) aiContent = JSON.stringify({ summary: task.description, changes: [] });
  if (!aiOutput) aiOutput = parseAIOutput(aiContent);
  const elapsedSec = ((Date.now() - aiCallStarted) / 1000).toFixed(1);
  success(`AI 执行完成 — ${totalTokensUsed.toLocaleString()} tokens / ${elapsedSec}s`);
  // 5. Extract file changes — or handle analysis-only tasks
  const fileBlocks = aiOutput?.changes.map(change => ({
    path: change.file,
    content: change.content,
    reasoning: change.reasoning,
  })) || [];

  // Analysis-only task: AI returned text analysis, no file changes needed
  if (fileBlocks.length === 0 && isAnalysisOnlyTask(task.description)) {
    addReasoning(task.id, {
      file: '(无文件修改 — 纯分析任务)',
      intent: task.description,
      reasoning: aiContent,
      impact: { directlyAffected: [], indirectlyAffected: [], notAffected: [] },
      riskLevel: 'low',
    });
    updateTaskStatus(task.id, 'completed');
    task.completedAt = new Date().toISOString();
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    setTaskLoopStep(task.id, 'verify-result');
    await completeTaskLoop(task.id, 'pass');
    success('分析完成（纯分析任务，无文件修改）');
    console.log(chalk.dim(aiContent.slice(0, 2000)));
    return;
  }

  if (fileBlocks.length === 0) {
    task.errorLog.push('AI 未返回可执行的文件变更');
    updateTaskStatus(task.id, 'failed');
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    fail('AI 未返回可执行的文件变更（请检查 AI 输出协议）');
    return;
  }

  // 6. Write files
  // S14: Agent sandbox check — filter blocked files via filterSandboxedFiles
  const agentSandboxLevel = agent?.sandboxLevel || 'none';
  if (agentSandboxLevel !== 'none') {
    try {
      const { checkSandboxWrite } = await import('./agent/manager.js');
      const blockedPaths = new Set<string>();
      for (const fb of fileBlocks) {
        const check = checkSandboxWrite(fb.path, agentSandboxLevel as 'readonly' | 'isolated', rootPath);
        if (!check.allowed) {
          warn(`沙箱拦截: ${fb.path} — ${check.reason}`);
          blockedPaths.add(fb.path);
        }
      }
      // Remove blocked files, preserving reasoning metadata
      for (let i = fileBlocks.length - 1; i >= 0; i--) {
        if (blockedPaths.has(fileBlocks[i].path)) fileBlocks.splice(i, 1);
      }
    } catch { /* sandbox check is best-effort */ }
  }

  // Gate-1: Compile enforcement before writing (skip for mock provider)
  let validatedBlocks = fileBlocks;
  const isMock = config.ai.provider === 'mock';
  if (!isMock && fileBlocks.length > 0 && index) {
    progress('编译验证...');
    try {
      const { enforceCodeQuality } = await import('./core/code-writer.js');
      const enforcement = await enforceCodeQuality(
        fileBlocks.map(fb => ({ file: fb.path, content: fb.content })),
        rootPath,
        config.project.identity,
        provider!,
        index,
      );
      if (!enforcement.passed) {
        warn(`编译验证失败，变更已拒绝:\n${enforcement.diagnostics}`);
        task.errorLog.push(`Gate-1: 编译验证失败 — ${enforcement.diagnostics}`);
        updateTaskStatus(task.id, 'failed');
        await persistTask(rootPath, task);
        releaseFileLocks(task);
        return;
      }
      if (enforcement.fixes > 0) {
        detail('编译修复', `自动修复 ${enforcement.fixes} 轮后通过`);
        validatedBlocks = enforcement.changes.map(c => {
          const orig = fileBlocks.find(fb => fb.path === c.file);
          return orig ? { ...orig, content: c.content } : { path: c.file, content: c.content, reasoning: 'AI 生成' };
        });
      }
      if (enforcement.diagnostics) {
        detail('编译验证', enforcement.diagnostics.slice(0, 100));
      }
    } catch (e) {
      detail('编译验证', `跳过: ${(e as Error).message}`);
      // Non-blocking — proceed with original changes if gate fails to run
    }
  }

  // Auto-8: Snapshot files before writing (for safe rollback)
  const snapshots: Map<string, string | null> = new Map(); // filePath → originalContent | null (new file)
  const { writeFile, ensureDir } = await import('./utils/fs.js');
  const { fileExists: fe } = await import('./utils/fs.js');
  const snapDir = path.join(rootPath, '.icloser', 'snapshots', task.id);
  await ensureDir(snapDir);
  for (const fb of validatedBlocks) {
    const fp = path.join(rootPath, fb.path);
    if (await fe(fp)) {
      const { readFile: rf2 } = await import('./utils/fs.js');
      const orig = await rf2(fp);
      snapshots.set(fb.path, orig);
      await writeFile(path.join(snapDir, fb.path.replace(/[/\\]/g, '_')), orig);
    } else {
      snapshots.set(fb.path, null); // new file, no original
    }
  }

  // Store snapshot metadata for rollback
  await writeFile(path.join(snapDir, 'manifest.json'), JSON.stringify({
    taskId: task.id,
    files: [...snapshots.entries()].map(([f, c]) => ({ file: f, isNew: c === null })),
    createdAt: new Date().toISOString(),
  }));

  // Auto-9: Dependency-ordered writes — least-depended files first
  let orderedBlocks = validatedBlocks;
  if (validatedBlocks.length > 1 && index?.dependencyGraph) {
    try {
      const depCount = new Map<string, number>();
      for (const fb of validatedBlocks) {
        const modName = fb.path.replace(/\.[^.]+$/, '').replace(/[/\\]index$/, '');
        let count = 0;
        for (const [_, deps] of index.dependencyGraph) {
          if (deps.some((d: string) => d.includes(modName) || modName.includes(d))) count++;
        }
        depCount.set(fb.path, count);
      }
      orderedBlocks = [...validatedBlocks].sort((a, b) => (depCount.get(a.path) || 0) - (depCount.get(b.path) || 0));
      if (orderedBlocks.some((fb, i) => fb.path !== validatedBlocks[i].path)) {
        detail('写入顺序', `已按依赖关系优化`);
      }
    } catch { /* best-effort */ }
  }

  progress(`写入 ${orderedBlocks.length} 个文件...`);
  for (const fb of orderedBlocks) {
    try {
      const fp = path.join(rootPath, fb.path);
      await ensureDir(path.dirname(fp));
      await writeFile(fp, fb.content);
      const lines = fb.content.split('\n').length;
      addFileChange(task.id, { file: fb.path, intent: task.description, reasoning: fb.reasoning || aiOutput?.summary || 'AI 生成', added: lines, removed: 0 });
      success(`${fb.path} ${chalk.dim(`+${lines} 行`)}`);
      appendAuditEvent(rootPath, 'agent', 'file-written', fb.path, 'success', { taskId: task.id, payload: { lines, reasoning: fb.reasoning?.substring(0, 100) } }).catch(() => {});
    } catch (err) {
      const m = (err as Error).message;
      task.errorLog.push(`写入 ${fb.path} 失败: ${m}`);
      fail(`${fb.path} — ${m}`);
    }
  }

  // 6.5 Auto-5: Auto-test generation for changed files (best-effort)
  const changedSourceFiles = fileBlocks.filter(fb => /\.(ts|tsx|js|jsx)$/.test(fb.path) && !fb.path.includes('.test.') && !fb.path.includes('.spec.'));
  if (changedSourceFiles.length > 0 && config.ai.provider !== 'mock') {
    try {
      const { getTestFilePath } = await import('./core/code-writer.js');
      for (const src of changedSourceFiles) {
        const testPath = getTestFilePath(src.path, index!);
        const fullTestPath = path.join(rootPath, testPath);
        const testExists = await (await import('./utils/fs.js')).fileExists(fullTestPath);
        if (!testExists) {
          detail('自动测试', `为 ${src.path} 生成测试`);
          const testResp = await provider.chat({
            systemPrompt: '你是测试专家。为源码生成单元测试。只输出一个包含完整测试文件的 JSON 变更契约。',
            task: `为以下源文件生成测试:\n## ${src.path}\n${src.content.slice(0, 2000)}`,
            context: contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          const testChanges = parseAIOutput(testResp.content).changes;
          // T1-4a: Detect empty tests — re-generate if assertions missing
          const { scanGeneratedTests } = await import('./core/code-writer.js');
          let finalTests = testChanges;
          const emptyCheck = scanGeneratedTests(testChanges);
          if (emptyCheck.some(t => t.isEmpty || !t.hasAssertions)) {
            detail('空测试检测', `${emptyCheck.length} 个测试缺少断言，重新生成`);
            const retryResp = await provider.chat({
              systemPrompt: '你是测试专家。之前的测试缺少断言。重新生成包含完整 expect/assert 的测试。只输出 JSON 变更契约。',
              task: `为以下文件生成包含断言的测试:\n${src.path}\n${src.content.slice(0, 2000)}\n\n前次生成的问题: ${emptyCheck.map(t => t.file + ': ' + t.issues.join(', ')).join('; ')}`,
              context: contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
            });
            finalTests = parseAIOutput(retryResp.content).changes;
          }
          for (const tc of finalTests) {
            const tpf = path.join(rootPath, tc.file);
            await (await import('./utils/fs.js')).ensureDir(path.dirname(tpf));
            await (await import('./utils/fs.js')).writeFile(tpf, tc.content);
            success(tc.file + ' (测试)');
          }
        }
      }
    } catch { /* best-effort, non-blocking */ }
  }

  // 7. Reasoning
  addReasoning(task.id, {
    file: fileBlocks.map(f => f.path).join(', '),
    intent: task.description,
    reasoning: aiOutput?.summary || 'AI 自动生成，基于项目上下文分析',
    impact: { directlyAffected: fileBlocks.map(f => f.path), indirectlyAffected: [], notAffected: [] },
    riskLevel: fileBlocks.length > 5 ? 'medium' : 'low',
  });

  // 8. Diff
  if (isGitRepo(rootPath)) {
    const diff = getDiff(rootPath);
    if (diff) {
      task.diffs.push(diff);
      const { generateDiffFile } = await import('./report/generator.js');
      await generateDiffFile(rootPath, task, diff);
    }
  }

  // #4: Incremental index refresh — re-scan changed files for latest AST data
  if (index && fileBlocks.length > 0) {
    try {
      const { scanProject } = await import('./core/scanner.js');
      const refreshed = await scanProject({ rootPath, deep: false, includeTests: false, maxFileSize: 500 * 1024 });
      if (refreshed.index) {
        index = refreshed.index;
        detail('索引刷新', `更新 ${fileBlocks.length} 个文件的索引`);
      }
    } catch { /* best-effort */ }
  }

  setTaskLoopStep(task.id, 'verify-result');

  // A1: Analysis-only tasks skip verification (no compile/lint/test needed)
  if (isAnalysisOnlyTask(task.description)) {
    updateTaskStatus(task.id, 'completed');
    task.completedAt = new Date().toISOString();
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    await completeTaskLoop(task.id, 'pass');
    success(`分析完成 — ${fileBlocks.length} 个文件已写入`);
    return;
  }

  // 9. Verification + auto-fix loop
  progress('验证中...');
  const { runVerification } = await import('./core/verifier.js');
  let vr = await runVerification(rootPath, config.project.identity, task, {
    stages: config.execution.verifyStages as VerifyStage[],
    maxRetries: config.execution.maxRetries,
    timeout: 120000,
  });
  setVerifyResult(task.id, vr);
  completeTaskLoop(task.id, vr.overall === 'pass' ? 'pass' : 'fail');
  appendAuditEvent(rootPath, 'verifier', 'verify-run', `${vr.overall}`, vr.overall === 'pass' ? 'success' : 'failure', { taskId: task.id, durationMs: vr.stages.reduce((s, st) => s + (st.duration || 0), 0), payload: { overall: vr.overall, stages: vr.stages.length, tests: vr.totalTests } }).catch(() => {});

  // Auto-fix: feed errors to AI, repair, re-verify
  const MAX_FIX_ROUNDS = config.execution.maxRetries;
  for (let fixRound = 0; fixRound < MAX_FIX_ROUNDS && vr.overall !== 'pass'; fixRound++) {
    // Advance loop: verification failed → go back to collect-context for next round
    advanceTaskLoopState(task.id, { verification: 'fail' });
    setTaskLoopStep(task.id, 'take-action');
    if (!aiContent) break; // No AI to fix with

    const errorText = vr.errorSummary || vr.stages
      .filter(s => s.status === 'fail')
      .map(s => `${s.stage}: ${s.errorDetails || s.output}`)
      .join('\n');

    if (!errorText.trim()) break;

    progress(`AI 自动修复中 (第 ${fixRound + 1}/${MAX_FIX_ROUNDS} 轮)...`);

    let fixContent = '';
    try {
      const fixResp = await provider.chat({
        systemPrompt: `你是代码修复专家。根据编译/测试/lint 错误，修复代码。
只输出一个 JSON 代码块，结构为 {"summary":"...","changes":[{"file":"相对路径","operation":"write","content":"完整文件内容","reasoning":"..."}]}。
只修复错误相关代码，不改其他部分。`,
        context: contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        task: `以下修改导致了错误：

\`\`\`
${errorText.substring(0, 3000)}
\`\`\`

请分析错误原因，按 AI 输出协议返回修复后的完整文件。`,
        history: '',
      });
      fixContent = fixResp.content;
    } catch (err) {
      const ae = err instanceof AICallError
        ? err
        : new AICallError('UNKNOWN', config.ai.provider, (err as Error).message || String(err), '运行 ic provider test 诊断连接问题');
      task.errorLog.push(`自动修复 AI 调用失败: ${ae.message}`);
      warn(`自动修复 AI 调用失败: ${ae.message}`);
      if (ae.suggestion) info(`建议：${ae.suggestion}`);
      break;
    }

    // Apply fix
    let fixBlocks: { path: string; content: string; reasoning: string }[] = [];
    try {
      const fixOutput = parseAIOutput(fixContent);
      fixBlocks = fixOutput.changes.map(change => ({
        path: change.file,
        content: change.content,
        reasoning: change.reasoning,
      }));
    } catch (err) {
      const msg = err instanceof AIOutputContractError ? err.message : (err as Error).message;
      task.errorLog.push(`AI 自动修复输出协议错误: ${msg}`);
      break;
    }
    if (fixBlocks.length === 0) {
      task.errorLog.push('AI 自动修复未返回可写入代码块');
      break;
    }

    for (const fb of fixBlocks) {
      try {
        const fp = path.join(rootPath, fb.path);
        await ensureDir(path.dirname(fp));
        await writeFile(fp, fb.content);
        success(`修复 ${fb.path} ${chalk.dim(`(${fb.content.split('\n').length} 行)`)}`);
        addFileChange(task.id, {
          file: fb.path,
          intent: `自动修复 (第 ${fixRound + 1} 轮)`,
          reasoning: 'AI 根据验证错误自动修复',
          added: fb.content.split('\n').length,
          removed: 0,
        });
      } catch (err) {
        task.errorLog.push(`修复写入 ${fb.path} 失败: ${(err as Error).message}`);
      }
    }

    // Re-verify
    progress('重新验证...');
    vr = await runVerification(rootPath, config.project.identity, task, {
      stages: config.execution.verifyStages as VerifyStage[],
      maxRetries: 1,
      timeout: 120000,
    });
    setVerifyResult(task.id, vr);
    setTaskLoopStep(task.id, 'verify-result');
    completeTaskLoop(task.id, vr.overall === 'pass' ? 'pass' : 'fail');
  }

  if (vr.overall === 'pass') {
    success('验证通过');
    if (vr.totalTests > 0) detail('测试', `${vr.passedTests}/${vr.totalTests}`);
    if (vr.coverage && vr.coverage.totalLines > 0) {
      detail('行覆盖率', `${vr.coverage.lineCoverage}% (${vr.coverage.coveredLines}/${vr.coverage.totalLines})`);
      if (vr.coverage.branchCoverage > 0) detail('分支覆盖率', `${vr.coverage.branchCoverage}%`);
    }
    if (vr.attempts > 1) detail('修复轮次', `${vr.attempts}`);
  } else {
    warn(`验证未通过 (${vr.attempts} 轮验证)`);
    if (vr.errorSummary) {
      const summary = vr.errorSummary.substring(0, 120);
      detail('错误', summary);
      info('请手动检查并修复上述错误');
    }
    // Easy-1: Auto-rollback from snapshots on verification failure
    try {
      const snapManifest = path.join(rootPath, '.icloser', 'snapshots', task.id, 'manifest.json');
      const { fileExists: fe2 } = await import('./utils/fs.js');
      if (await fe2(snapManifest)) {
        const manifest = JSON.parse(await (await import('./utils/fs.js')).readFile(snapManifest));
        detail('自动回滚', `恢复 ${manifest.files.length} 个文件`);
        for (const f of manifest.files) {
          const snapPath = path.join(rootPath, '.icloser', 'snapshots', task.id, f.file.replace(/[/\\]/g, '_'));
          if (f.isNew) {
            try { await (await import('fs/promises')).unlink(path.join(rootPath, f.file)); } catch { /* best-effort */ }
          } else if (await fe2(snapPath)) {
            const orig = await (await import('./utils/fs.js')).readFile(snapPath);
            await writeFile(path.join(rootPath, f.file), orig);
          }
        }
        success('已自动回滚到修改前状态');
      }
    } catch { /* rollback best-effort */ }
  }

  updateTaskStatus(task.id, vr.overall === 'pass' ? 'completed' : 'failed');

  // 10. Memory update
  try {
    const { loadProjectMemory, saveProjectMemory, recordTask } = await import('./core/memory.js');
    let mem = await loadProjectMemory(rootPath);
    mem = await recordTask(mem, task, config.project.identity);
    await saveProjectMemory(rootPath, mem);
    appendAuditEvent(rootPath, 'memory-updater', 'memory-updated', task.id, 'success', { taskId: task.id }).catch(() => {});
  } catch { /* best-effort */ }

  // Auto-7: Record task execution for pattern learning
  try {
    const { recordTaskExecution } = await import('./core/task-memory.js');
    await recordTaskExecution(rootPath, task, {
      status: vr.overall === 'pass' ? 'completed' : 'failed',
      strategies: task.agentExecutions?.flatMap((a: any) => a.result?.artifacts || []) || [],
      filesChanged: fileBlocks.map(f => f.path),
      verifyPassed: vr.overall === 'pass',
      duration: Date.now() - aiCallStarted,
      tokensUsed: totalTokensUsed,
      errors: task.errorLog || [],
    });
  } catch { /* best-effort */ }

  // 11. Report
  progress('生成报告...');
  try {
    const { generateTaskReport, generateReasoningFile, generateVerifyLog } = await import('./report/generator.js');
    await generateTaskReport(rootPath, task, config);
    await generateReasoningFile(rootPath, task);
    await generateVerifyLog(rootPath, task);
    appendAuditEvent(rootPath, 'reporter', 'report-generated', task.id, 'success', { taskId: task.id }).catch(() => {});
  } catch { /* best-effort */ }

  // 12. Finalize
  releaseFileLocks(task);
  await persistTask(rootPath, task);

  console.log();
  if (vr.overall === 'pass') success('任务完成');
  else warn('任务部分完成（验证未通过）');

  info(`报告目录：${chalk.cyan(`.icloser/tasks/${task.id}/`)}`);
  const reportFiles = ['report.md', 'diff.patch', 'reasoning.md', 'verify.log'];
  for (const fn of reportFiles) {
    if (await fileExists(path.join(rootPath, '.icloser', 'tasks', task.id, fn))) {
      detail(`  ${fn}`, '✓');
    }
  }
  info(`运行 ${chalk.cyan(`ic gate ${task.id}`)} 执行门禁检查`);
  console.log();
}

// ════════════════════════════════════════════════════════════
// Output helpers (statusLabel / printTaskPlan / printTaskDetail
//  are now in src/commands/task.ts — imported at top of file)
// ════════════════════════════════════════════════════════════

// TI1: Map recognized intents to tool strategies (unified — uses classifier output when available)
// P1-1: helpers moved to src/core/task-pipeline.ts

async function _buildSystemPrompt(
  config: ICloserConfig,
  index: import('./types.js').ProjectIndex | null,
  taskDescription?: string,
): Promise<string> {
  const isAnalysis = taskDescription ? isAnalysisOnlyTask(taskDescription) : false;

  let toolSection = '';
  try {
    let capabilities: { name: string; status: string; purpose: string; fallback: string }[] = [];
    try { const mod = await import('./core/tool-registry.js'); capabilities = mod.buildToolCapabilitySnapshot().capabilities; } catch { /* non-critical */ }
    const available = capabilities.filter(c => c.status === 'available');
    const degraded = capabilities.filter(c => c.status !== 'available');
    toolSection = '\n\n## 本地工具能力（S17.1）';
    toolSection += '\n' + available.map((c: { name: string; purpose: string }) => `- ${c.name}：${c.purpose}`).join('\n');
    if (degraded.length > 0) {
      toolSection += '\n\n降级工具：';
      toolSection += '\n' + degraded.map((c: { name: string; fallback: string }) => `- ${c.name} 不可用 → ${c.fallback}`).join('\n');
    }
  } catch { /* non-critical */ }

  const isWin = process.platform === 'win32';
  let p = `你是 iCloser Agent Shell，终端中的 AI 工程助手。

## 记忆规则
- 如果上下文中没有相关信息，说"无历史记录"，不要编造
- 每次回答前先确认当前对话的上下文边界
- 引用的记忆必须标注来源（如 [来源: 任务#xxx]）

## 激活技能
${taskDescription ? (await import('./core/skill-system.js')).buildSkillPrompt(taskDescription) : ''}

## 运行环境
- 操作系统: ${isWin ? 'Windows' : process.platform}
- Shell: ${isWin ? 'PowerShell / CMD（不是 bash）' : 'bash/zsh'}
- 文件列表: ${isWin ? '用 dir /B 或 Get-ChildItem' : '用 ls'}
- 文件搜索: ${isWin ? '用 findstr 或 Select-String' : '用 grep'}
- 路径分隔: ${isWin ? '反斜杠 \\ 或正斜杠 /' : '正斜杠 /'}
${isWin ? '- 注意: 不要使用 ls/grep/find 等 Unix 命令，它们在此环境不可用。使用 PowerShell cmdlet 或 Node.js 执行命令。' : ''}

## 项目信息
- 语言: ${config.project.identity.language}
- 框架: ${config.project.identity.framework || '无'}
- 数据库: ${config.project.identity.database || '无'}
- 构建: ${config.project.identity.buildSystem}
- 测试: ${config.project.identity.testFramework || '无'}${toolSection}

## 回复规则
1. 只输出一个 JSON 代码块，不要输出其他解释
2. JSON 结构必须是：
{
  "summary": "本次修改摘要",
  "changes": [
    {
      "file": "相对路径",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "为什么修改这个文件"
    }
  ]
}
3. changes 至少 1 项，file 必须是项目内相对路径，operation 只能是 write
4. content 必须是完整文件内容，不能只给片段或 diff
5. 代码匹配项目的语言/框架/代码风格
6. 中文说明写在 summary/reasoning 中，代码术语保留英文
7. 上述工具能力可供理解项目时参考，最终输出必须是 JSON 变更契约`;

  // TI1: Intent-aware tool strategy mapping
  const strategy = taskDescription ? await getToolStrategy(taskDescription) : '';
  if (strategy) { p += '\n\n## 推荐工具策略\n' + strategy; }

  // B2: Analysis-specific instructions — override the JSON contract for analysis tasks
  if (isAnalysis) {
    p += '\n\n## 分析任务特殊规则（覆盖上述 JSON 变更规则）';
    p += '\n你是项目分析专家。当前任务是分析项目，不是修改代码。';
    p += '\n\n**你只有 6 轮工具调用！第 6 轮必须输出结果！**';
    p += '\n- 第1轮: read_file README + main.go';
    p += '\n- 第2轮: read_file go.mod + 关键源码';
    p += '\n- 第3-4轮: search_code + read_file 核心文件';
    p += '\n- **第5轮开始准备输出，第6轮必须输出 ANALYSIS.md JSON！**';
    p += '\n- 不要在第5-6轮继续探索。信息不够也要输出已有发现。';
    p += '\n\n输出格式（直接输出 JSON，不要继续探索）：';
    p += '\n```json';
    p += '\n{"summary":"一句话总结","changes":[{"file":"ANALYSIS.md","operation":"write","content":"# 项目名\\n\\n## 身份\\n...\\n\\n## 技术栈\\n|技术|说明|\\n|---|---|\\n|...|...|\\n\\n## 架构\\n...\\n\\n## 已实现功能(至少15项)\\n- ...\\n- ...\\n\\n## 待开发\\n- ...\\n\\n## 完整度: XX%\\n理由: ...","reasoning":"基于对README+源码的分析"}]}';
    p += '\n```';
  }

  if (index) {
    p += `\n\n## 项目结构
- 文件: ${index.modules.reduce((s, m) => s + m.files.length, 0)} 个
- 模块: ${index.modules.length} 个
- 架构: ${index.architecturePattern}
${index.modules.slice(0, 10).map(m => `- ${m.name} (${m.files.length} 文件)`).join('\n')}`;
  }
  return p;
}
