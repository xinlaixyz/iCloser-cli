// src/commands/ops.ts — ic g | ic audit | ic rule | ic doctor | ic orchestrate
// Extracted from src/index.ts (architecture split)
// Registers: g/gate | audit | rule | doctor | orchestrate

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../config.js';
import { fileExists } from '../utils/fs.js';
import { jsonEnvelope, serializeGateResult } from '../cli/json.js';
import { getProviderStatus } from '../ai/provider.js';
import {
  success, fail, warn, info, section, detail, progress, printError, ICONS,
} from '../cli/output.js';
import type { ICloserConfig, Task } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────

function printGateResult(result: import('../types.js').GateResult, _task: Task): void {
  console.log();
  for (const c of result.checks) {
    const icon = c.status === 'pass' ? ICONS.success :
      c.status === 'fail' ? ICONS.fail :
      c.status === 'warn' ? ICONS.warn : ICONS.progress;
    console.log(`${icon} ${c.name.padEnd(16)} — ${c.detail}`);

    // Expand security blocking with detailed suggestions
    if (c.category === 'security' && c.status === 'fail' && c.suggestion) {
      const lines = c.suggestion.split('\n').filter(l => l.trim());
      for (const l of lines.slice(0, 8)) {
        console.log(`   ${chalk.red('▸')} ${l.substring(0, 100)}`);
      }
      if (lines.length > 8) console.log(`   ${chalk.dim(`... 还有 ${lines.length - 8} 条`)}`);
    } else if (c.suggestion && c.status !== 'pass') {
      // Non-security: show as single suggestion line
      const lines = c.suggestion.split('\n').filter(l => l.trim());
      for (const l of lines.slice(0, 3)) {
        console.log(`   ${chalk.yellow('→')} ${l.substring(0, 100)}`);
      }
    }
  }
  console.log();
  if (result.passed) {
    console.log(`${ICONS.success} ${chalk.green.bold('门禁通过，任务可交付')}`);
  } else {
    const blockers = result.blocking.map(b => b.name).join(', ');
    console.log(`${ICONS.fail} ${chalk.red.bold(`门禁阻塞 (${result.blocking.length} 项):`)} ${blockers}`);
  }
  console.log();
}

interface DoctorReport {
  rootPath: string;
  initialized: boolean;
  ready: boolean;
  project: {
    name: string;
    identity: ICloserConfig['project']['identity'];
  } | null;
  provider: {
    name: string;
    model: string;
    ready: boolean;
    keySource: string;
    requiresApiKey: boolean;
    envVars: string[];
  } | null;
  index: {
    exists: boolean;
    path: string;
  };
  tasks: {
    count: number;
  };
  warnings: string[];
  nextActions: string[];
}

async function buildDoctorReport(rootPath: string): Promise<DoctorReport> {
  const config = await loadConfig(rootPath);
  const indexPath = path.join(rootPath, '.icloser', 'index.json');
  const indexExists = await fileExists(indexPath);
  let taskCount = 0;
  if (config) {
    try {
      const { listTasks } = await import('../core/task-engine.js');
      taskCount = (await listTasks(rootPath)).length;
    } catch {
      taskCount = 0;
    }
  }

  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (!config) {
    warnings.push('项目未初始化');
    nextActions.push('ic init');
    nextActions.push('ic');
    nextActions.push('在 REPL 中直接粘贴 API Key，或输入 /apikey 安全录入');
  }

  const provider = config ? getProviderStatus(config.ai) : null;
  if (config && provider && !provider.ready) {
    warnings.push('当前 Provider 缺少 API Key 或不可用');
    nextActions.push('ic');
    nextActions.push('在 REPL 中直接粘贴 API Key，或输入 /apikey 安全录入');
    nextActions.push(`ic provider env ${provider.name}`);
    nextActions.push('ic provider test');
  }

  if (config && !indexExists) {
    warnings.push('项目索引不存在或未生成');
    nextActions.push('ic scan');
  }

  if (config && provider?.ready && indexExists) {
    nextActions.push('ic t "你的任务描述"');
  }

  const ready = Boolean(config && provider?.ready && indexExists);

  return {
    rootPath,
    initialized: Boolean(config),
    ready,
    project: config
      ? {
          name: config.project.name,
          identity: config.project.identity,
        }
      : null,
    provider: provider && config
      ? {
          name: provider.name,
          model: config.ai.model,
          ready: provider.ready,
          keySource: provider.keySource,
          requiresApiKey: provider.requiresApiKey,
          envVars: provider.envVars,
        }
      : null,
    index: {
      exists: indexExists,
      path: indexPath,
    },
    tasks: {
      count: taskCount,
    },
    warnings,
    nextActions,
  };
}

// ── Commands ─────────────────────────────────────────────────

export function registerOpsCommands(program: Command): void {
  // ============================================================
  // ic gate — REAL gate check
  // ============================================================
  program.command('g')
    .alias('gate')
    .description('门禁检查（6 道门禁）')
    .argument('<task-id>', '任务 ID')
    .option('--skip-gate', '跳过门禁')
    .option('--json', 'JSON 格式输出')
    .action(async (taskId: string, options) => {
      if (options.skipGate) { warn('已跳过门禁检查'); return; }
      const rootPath = process.cwd();
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化'); }
        const { loadTask, persistTask } = await import('../core/task-engine.js');
        const task = await loadTask(rootPath, taskId);
        if (!task) { fail(`任务 ${chalk.cyan(taskId)} 不存在`); }

        if (!options.json) progress('执行门禁检查...');
        const { runGateCheck } = await import('../gate/checker.js');
        const result = await runGateCheck(rootPath, task, config);
        task.gateResult = result;
        await persistTask(rootPath, task);
        try {
          const { generateTaskReport } = await import('../report/generator.js');
          await generateTaskReport(rootPath, task, config);
        } catch { /* best-effort */ }

        if (options.json) {
          console.log(JSON.stringify(jsonEnvelope('gate-result', serializeGateResult(result)), null, 2));
        } else {
          printGateResult(result, task);
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic audit — agent action audit log
  // ============================================================
  program.command('audit')
    .description('查看最近 20 条 Agent 动作审计日志')
    .option('-t, --task <id>', '按任务 ID 过滤')
    .action(async (options?: { task?: string }) => {
      const rootPath = process.cwd();
      try {
        const { loadAuditEvents, auditActionLabel } = await import('../core/audit.js');
        const events = await loadAuditEvents(rootPath, {
          taskId: options?.task,
          limit: 20,
        });
        if (events.length === 0) {
          info('暂无审计事件。运行 ic t --go 后会开始记录。');
          console.log();
          return;
        }
        section(`审计日志 (最近 ${events.length} 条)`);
        for (const e of events.reverse()) {
          const icon = e.result === 'success' ? chalk.green('✓') :
            e.result === 'failure' ? chalk.red('✗') : chalk.yellow('~');
          const created = e.createdAt.substring(0, 19).replace('T', ' ');
          const meta = [
            e.taskId ? chalk.dim(`task:${e.taskId.substring(0, 10)}`) : '',
            e.durationMs ? chalk.dim(`${e.durationMs}ms`) : '',
            e.tokensUsed ? chalk.dim(`${e.tokensUsed} tokens`) : '',
          ].filter(Boolean).join(' ');
          console.log(`  ${icon} ${chalk.dim(`[${created}]`)} ${chalk.cyan(auditActionLabel(e.action))} → ${e.target}`);
          if (meta) console.log(`    ${meta}`);
        }
        console.log();
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic rule — real persistence
  // ============================================================
  program.command('rule')
    .description('管理架构约束')
    .argument('[constraint]', '约束描述（不指定则列出所有）')
    .option('--list', '列出所有约束')
    .option('--delete <id>', '删除指定约束')
    .action(async (constraint?: string, options?: { list?: boolean; delete?: string }) => {
      const rootPath = process.cwd();
      try {
        const { loadProjectMemory, saveProjectMemory, addRule, removeRule } =
          await import('../core/memory.js');
        const { recordUserInputEvent } = await import('../core/memory.js');
        let memory = await loadProjectMemory(rootPath);

        if (options?.delete) {
          memory = await removeRule(memory, options.delete);
          await saveProjectMemory(rootPath, memory);
          success(`约束 ${chalk.cyan(options.delete)} 已删除`);
        } else if (options?.list || !constraint) {
          section('架构约束');
          if (memory.rules.length === 0) {
            info('暂无约束。使用 ic rule "<描述>" 添加');
          } else {
            for (const r of memory.rules) {
              console.log(`  ${chalk.cyan(`[${r.id}]`)} ${r.description}`);
              console.log(`     ${chalk.dim(`scope:${r.scope}  permanent:${r.permanent}`)}`);
            }
          }
        } else {
          await recordUserInputEvent(rootPath, constraint, { kind: 'rule' });
          memory = await loadProjectMemory(rootPath);
          memory = await addRule(memory, constraint);
          await saveProjectMemory(rootPath, memory);
          success(`约束已保存：${chalk.cyan(constraint)}`);
        }
        console.log();
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic doctor — project readiness diagnostics
  // ============================================================
  program.command('doctor')
    .description('检查当前项目是否已准备好执行任务')
    .option('--json', 'JSON 格式输出')
    .option('--strict', '未 ready 时返回非 0，适合 CI/脚本门禁')
    .action(async (options?: { json?: boolean; strict?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const report = await buildDoctorReport(rootPath);
        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('doctor', report), null, 2));
          if (options.strict && !report.ready) {
            process.exitCode = 1;
          }
          return;
        }

        section('Project Doctor');
        detail('Root', report.rootPath);
        detail('Initialized', report.initialized ? chalk.green('yes') : chalk.red('no'));
        if (report.project) {
          detail('Project', `${report.project.name} (${report.project.identity.language}/${report.project.identity.framework || '—'})`);
        }
        detail('Provider', report.provider ? `${report.provider.name} / ${report.provider.model}` : chalk.dim('—'));
        detail('Provider Ready', report.provider?.ready ? chalk.green(report.provider.keySource) : chalk.red(report.provider?.keySource || 'missing'));
        detail('Index', report.index.exists ? chalk.green('exists') : chalk.yellow('missing'));
        detail('Tasks', `${report.tasks.count}`);
        detail('Ready', report.ready ? chalk.green('yes') : chalk.red('no'));
        if (report.warnings.length > 0) {
          console.log();
          for (const warning of report.warnings) warn(warning);
        }
        if (report.nextActions.length > 0) {
          console.log();
          console.log(chalk.dim('Next actions:'));
          for (const action of report.nextActions) {
            console.log(`  ${chalk.cyan(action)}`);
          }
        }
        console.log();
        if (options?.strict && !report.ready) {
          process.exitCode = 1;
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic orchestrate — deterministic tool orchestration
  // ============================================================
  program.command('orchestrate')
    .alias('orch')
    .description('把自然语言任务拆成工具计划，并按观察/恢复循环执行')
    .argument('<task...>', '任务描述，例如：启动项目 / 修复测试失败 / 发布检查')
    .option('--execute', '允许执行真实命令；默认命令只 dry-run')
    .option('--json', 'JSON 格式输出')
    .option('--max-steps <n>', '最多执行步骤数', '12')
    .action(async (parts: string[], options?: { execute?: boolean; json?: boolean; maxSteps?: string }) => {
      const task = parts.join(' ').trim();
      const rootPath = process.cwd();
      try {
        const { runToolOrchestrator } = await import('../core/tool-orchestrator.js');
        const maxSteps = parseInt(options?.maxSteps || '12', 10) || 12;
        if (!options?.json) {
          section('Tool Orchestrator');
          detail('任务', chalk.cyan(task));
          detail('模式', options?.execute ? chalk.yellow('execute') : chalk.green('dry-run'));
          console.log();
        }
        const result = await runToolOrchestrator({
          rootPath,
          task,
          executeCommands: Boolean(options?.execute),
          maxSteps,
          onProgress: options?.json ? undefined : (event) => {
            if (event.phase === 'plan') {
              info(event.message);
            } else if (event.phase === 'step_start' && event.step) {
              console.log(`  ${chalk.cyan('→')} ${event.step.id} ${event.step.title} ${chalk.dim(event.step.tool)}`);
            } else if (event.phase === 'step_result' && event.step) {
              const icon = event.step.status === 'success' ? chalk.green('✓') : chalk.red('✗');
              console.log(`  ${icon} ${event.step.id} ${chalk.dim(event.step.result || '')}`);
            } else if (event.phase === 'recover' && event.step) {
              warn(`追加恢复步骤：${event.step.title}`);
            }
          },
        });
        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('tool-orchestration', result), null, 2));
          if (!result.success) process.exitCode = 1;
          return;
        }
        console.log();
        section('编排结果');
        console.log(result.summary);
        if (result.memory.decisions.length > 0) {
          console.log();
          detail('恢复决策', result.memory.decisions.slice(0, 3).join(' / '));
        }
        console.log();
        if (!result.success) process.exitCode = 1;
      } catch (err) { printError(err as Error); }
    });
}
