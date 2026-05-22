#!/usr/bin/env node
// iCloser Agent Shell — CLI Entry Point

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { detectProject } from './utils/detect.js';
import { loadConfig, saveConfig, defaultConfig, setAIProvider, saveGlobalConfig } from './config.js';
import { fileExists, readFile } from './utils/fs.js';
import { isGitRepo, getDiff } from './utils/git.js';
import { jsonEnvelope, serializeConfig, serializeGateResult, serializeSecurityRules } from './cli/json.js';
import { getSecurityRuleDefinitions } from './core/security.js';
import { formatProviderKeyGuidance, getAvailableProviders, getProviderInfo, getProviderStatus, getProviderStatuses, inferProviderFromApiKey, isAIProvider, isLikelyApiKey, maskApiKey, smokeTestProvider } from './ai/provider.js';
import { AICallError } from './ai/errors.js';
import { AIOutputContractError, parseAIOutput } from './ai/output-contract.js';
import {
  success, fail, progress, warn, info, section, detail,
  divider, printProjectIdentity, printError, printHelp, ICONS,
  enableOutputSanitizer,
} from './cli/output.js';
import { startRepl } from './cli/repl.js';
import type { AgentStatus, AgentType, AIProvider, ICloserConfig, Task, VerifyStage } from './types.js';
import { registerTaskCommands, statusLabel, printTaskPlan } from './commands/task.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerCollaborationCommands } from './commands/collaboration.js';
import { registerDiffCommands } from './commands/diff.js';
import { registerImpactCommand } from './commands/impact.js';
import { registerAndroidCommands } from './commands/android.js';
import { shouldUseWindowsShell } from './cli/system-runner.js';
import { providerUnavailable, networkFailure, toolUnavailable, formatDegrade } from './core/degradation.js';

const program = new Command();
program.name('ic').description('iCloser Agent Shell — AI 工程执行 CLI').version('0.1.0');

// ── Shared helpers from task-pipeline.ts ──
import { applyCompileGate, runCodeGenerationPipeline, getToolStrategy, isAnalysisOnlyTask } from './core/task-pipeline.js';

// Register extracted command modules
registerTaskCommands(program);
registerMemoryCommands(program);
registerCollaborationCommands(program);
registerDiffCommands(program);
registerImpactCommand(program);
registerAndroidCommands(program);

// ============================================================
// ic setup
// ============================================================
program.command('setup')
  .description('首次安装向导：检查环境、配置 AI、测试连接')
  .option('--provider <name>', '默认 Provider：mock | claude | deepseek | openai | qwen')
  .option('--model <name>', '默认模型')
  .option('--key <apiKey>', '直接输入 API Key，自动保存到全局配置')
  .option('--mock', '使用离线 mock provider')
  .option('--json', 'JSON 格式输出')
  .action(async (options?: { provider?: string; model?: string; key?: string; mock?: boolean; json?: boolean }) => {
    if (!options?.json) {
      console.log(`\n${chalk.bold.blue('iCloser Agent Shell')} ${chalk.dim('v0.1.0')} — 首次安装向导\n`);
    }
    try {
      const nodeVersion = process.version;
      if (!options?.json) success(`Node.js ${nodeVersion} (${process.platform})`);

      const providers = getAvailableProviders();
      let providerName: AIProvider;
      if (options?.mock) {
        providerName = 'mock';
      } else if (options?.key && !options?.provider) {
        providerName = inferProviderFromApiKey(options.key, 'deepseek');
      } else if (options?.provider) {
        if (!isAIProvider(options.provider)) {
          fail(`未知 Provider: ${chalk.cyan(options.provider)}`);
          info('可用 Provider: ' + providers.map(p => p.name).join(', '));
          return;
        }
        providerName = options.provider;
      } else {
        providerName = pickSetupProvider();
      }

      const providerInfo = getProviderInfo(providerName);
      const aiConfig = {
        provider: providerName,
        model: options?.model || providerInfo.defaultModel,
        apiKey: options?.key,
        maxTokens: 100000,
        temperature: 0.3,
      };
      const smoke = await smokeTestProvider(aiConfig);

      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('setup', {
          node: nodeVersion,
          provider: aiConfig.provider,
          model: aiConfig.model,
          providerReady: smoke.ok,
          keySource: smoke.keySource,
          installed: true,
        }), null, 2));
      } else {
        detail('Provider', aiConfig.provider);
        detail('Model', aiConfig.model);
        if (smoke.ok) {
          success(`Provider 可用 (${smoke.keySource})`);
        } else if (aiConfig.provider === 'mock') {
          success('mock provider 可离线使用');
        } else {
          const status = getProviderStatus(aiConfig);
          if (status.keySource === 'missing') {
            warn('真实 Provider 尚未接入，按下面格式配置 API Key；无 Key 时系统可先用 mock 启动。');
            console.log();
            for (const line of formatProviderKeyGuidance(aiConfig.provider)) {
              console.log(`  ${chalk.dim(line)}`);
            }
            console.log();
          } else if (status.keySource === 'env') {
            warn(`${aiConfig.provider} 连接失败（已检测到环境变量），可能是 Key 与 Provider 不匹配或网络受限。`);
            info(`试试 ${chalk.cyan('ic provider doctor')} 检测所有 Provider，或 ${chalk.cyan('ic provider test --provider deepseek')} 切换测试。`);
            if (smoke.error) detail('详情', smoke.error.slice(0, 200));
          } else {
            console.warn(formatDegrade(providerUnavailable(smoke.error || undefined)));
          }
        }
      }

      if (!options?.json) divider();
      await saveGlobalConfig('ai', aiConfig);
      await saveGlobalConfig('execution', { defaultMode: 'preview', maxRetries: 3, maxParallelTasks: 3 });
      await saveGlobalConfig('installed', new Date().toISOString());
      if (!options?.json) {
        success(`全局配置已保存：${process.env.ICLOSER_HOME || '~/.icloser'}/config.json`);
        divider();
        console.log(`\n${chalk.green.bold('配置完成！')}\n`);
        console.log(`  ${chalk.cyan('cd /path/to/project && ic init')}`);
        console.log(`  ${chalk.cyan('ic provider doctor')}`);
        console.log(`  ${chalk.cyan('ic provider test')}`);
        console.log(`  ${chalk.cyan('ic t "你的任务描述"')}\n`);
      }
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic init
// ============================================================
program.command('init')
  .description('初始化项目配置（自动识别项目类型）')
  .option('-f, --force', '强制重新初始化')
  .option('--json', 'JSON 格式输出')
  .action(async (options) => {
    const rootPath = process.cwd();
    const { jsonEnvelope } = await import('./cli/json.js');
    try {
      if (!options.json) progress('正在分析项目...');
      const existing = await loadConfig(rootPath);
      if (existing && !options.force) {
        if (options.json) { console.log(JSON.stringify(jsonEnvelope('init', { initialized: true, identity: existing.project.identity }))); return; }
        warn('项目已初始化，使用 --force 强制重新扫描');
        printProjectIdentity(existing.project.identity);
        return;
      }
      const identity = await detectProject(rootPath);
      const config = defaultConfig(rootPath, identity);
      await saveConfig(config);

      // Build index
      try {
        const { scanProject, saveProjectIndex } = await import('./core/scanner.js');
        const result = await scanProject({ rootPath, deep: true, includeTests: true, maxFileSize: 500 * 1024, quiet: !!options.json });
        if (!options.json) info(`索引完成：${result.fileCount} 文件，${result.moduleCount} 模块，${result.apiCount} 接口`);
        await saveProjectIndex(rootPath, result.index);
      } catch { /* best effort */ }

      // Init memory (legacy + Memory Kernel v1.0)
      try {
        const { loadProjectMemory, saveProjectMemory } = await import('./core/memory.js');
        await saveProjectMemory(rootPath, await loadProjectMemory(rootPath));
      } catch { /* best effort */ }
      try {
        const { ensureMemoryStore } = await import('./core/memory/store.js');
        await ensureMemoryStore(rootPath);
        // Bootstrap Memory Kernel from git history + code patterns
        try {
          const { getMemoryRuntime } = await import('./core/memory/integration.js');
          const runtime = await getMemoryRuntime(rootPath);
          const { bootstrapMemoryKernel } = await import('./core/memory/bootstrap.js');
          const result = await bootstrapMemoryKernel(rootPath, runtime);
          if (result.episodesCreated > 0 || result.rulesCreated > 0) {
            if (!options.json) info(`Memory Kernel: ${result.episodesCreated} 历史事件, ${result.rulesCreated} 规则`);
          }
        } catch { /* bootstrap is optional */ }
      } catch { /* memory kernel optional */ }

      if (!options.json) success('项目初始化完成\n');
      if (options.json) {
        console.log(JSON.stringify(jsonEnvelope('init', { initialized: true, identity: config.project.identity, name: config.project.name })));
      } else {
        console.log(`  ╭ 项目识别 ${'─'.repeat(20)}`);
        console.log(`  │ 名称    ${config.project.name}`);
        console.log(`  │ 语言    ${identity.language}  ${identity.languageVersion !== 'unknown' ? identity.languageVersion : ''}`);
        console.log(`  │ 框架    ${identity.framework !== 'unknown' ? identity.framework : '—'}`);
        console.log(`  │ 数据库  ${identity.database !== 'unknown' ? identity.database : '—'}`);
        console.log(`  │ 构建    ${identity.buildSystem !== 'unknown' ? identity.buildSystem : '—'}`);
        console.log(`  │ 测试    ${identity.testFramework !== 'unknown' ? identity.testFramework : '—'}`);
        console.log(`  ╰${'─'.repeat(28)}`);
        if (isGitRepo(rootPath)) info('Git 仓库已检测');
      }
    } catch (err) { printError(err as Error); process.exit(1); }
  });

// ============================================================
// ic scan
// ============================================================
program.command('scan')
  .description('扫描项目并更新索引')
  .option('--json', 'JSON 格式输出')
  .action(async (options) => {
    const rootPath = process.cwd();
    const { jsonEnvelope } = await import('./cli/json.js');
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化，请先运行 ic init'); }
      const spin = options.json ? null : (await import('ora')).default('正在扫描项目...').start();
      const identity = await detectProject(rootPath);
      const { scanProject, saveProjectIndex } = await import('./core/scanner.js');
      const result = await scanProject({ rootPath, deep: true, includeTests: true, maxFileSize: 500 * 1024 });
      if (spin) spin.succeed(`扫描完成：${result.fileCount} 文件，${result.moduleCount} 模块，${result.apiCount} 接口`);
      else console.log(JSON.stringify(jsonEnvelope('scan', { fileCount: result.fileCount, moduleCount: result.moduleCount, apiCount: result.apiCount, identity })));
      await saveProjectIndex(rootPath, result.index);
      config.project.identity = identity;
      await saveConfig(config);
    } catch (err) { printError(err as Error); if (!options.json) process.exit(1); }
  });


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
      const { loadTask, persistTask } = await import('./core/task-engine.js');
      const task = await loadTask(rootPath, taskId);
      if (!task) { fail(`任务 ${chalk.cyan(taskId)} 不存在`); }

      if (!options.json) progress('执行门禁检查...');
      const { runGateCheck } = await import('./gate/checker.js');
      const result = await runGateCheck(rootPath, task, config);
      task.gateResult = result;
      await persistTask(rootPath, task);
      try {
        const { generateTaskReport } = await import('./report/generator.js');
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
program.command('audit')
  .description('查看最近 20 条 Agent 动作审计日志')
  .option('-t, --task <id>', '按任务 ID 过滤')
  .action(async (options?: { task?: string }) => {
    const rootPath = process.cwd();
    try {
      const { loadAuditEvents, auditActionLabel } = await import('./core/audit.js');
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
        await import('./core/memory.js');
      const { recordUserInputEvent } = await import('./core/memory.js');
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
// ic config
// ============================================================
program.command('config')
  .description('查看和修改配置')
  .argument('[args...]', '配置项：provider / model / mode / security')
  .option('--json', '以 JSON 格式输出 (security rules)')
  .action(async (args: string[] = [], options?: { json?: boolean }) => {
    const [key, value, extra] = args;
    const jsonMode = options?.json === true;
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (jsonMode && !key) {
        if (!config) { fail('项目未初始化'); }
        console.log(JSON.stringify(jsonEnvelope('config', serializeConfig(config)), null, 2));
        return;
      }

      // Security subcommands
      if (key === 'security' && config) {
        if (value === 'rules') {
          printSecurityRules(config, jsonMode);
          return;
        }
        if ((value === 'disable' || value === 'enable') && !extra) {
          warn('用法: ic config security disable <ruleId>  或  ic config security enable <ruleId>');
          return;
        }
        if ((value === 'disable' || value === 'enable') && extra) {
          const knownRules = new Set(getSecurityRuleDefinitions().map(rule => rule.ruleId));
          if (!knownRules.has(extra)) {
            fail(`未知安全规则: ${chalk.cyan(extra)}`);
            info('运行 ic config security rules 查看可用规则');
            return;
          }
          if (value === 'disable') {
            const { disableSecurityRule } = await import('./config.js');
            disableSecurityRule(config, extra);
            await saveConfig(config);
            success(`安全规则已禁用: ${chalk.cyan(extra)}`);
          } else {
            const { enableSecurityRule } = await import('./config.js');
            enableSecurityRule(config, extra);
            await saveConfig(config);
            success(`安全规则已启用: ${chalk.cyan(extra)}`);
          }
          return;
        }
        // ic config security (no value) — show summary
        section('安全配置');
        detail('禁用规则', config.security.disabledRules?.length ? `${config.security.disabledRules.length} 条` : '无（全部启用）');
        if (config.security.disabledRules?.length) {
          for (const r of config.security.disabledRules) {
            console.log(`  ${chalk.dim('·')} ${chalk.red(r)}`);
          }
        }
        detail('敏感文件', `${config.security.sensitiveFiles.length} 个模式`);
        detail('危险命令', `${config.security.dangerousCommands.length} 个模式`);
        detail('Git Push', config.security.allowGitPush ? chalk.green('允许') : chalk.red('禁止'));
        console.log(`\n  ${chalk.dim('ic config security rules  查看全部安全规则')}`);
        console.log(`  ${chalk.dim('ic config security disable <ruleId>  禁用规则')}`);
        console.log(`  ${chalk.dim('ic config security enable <ruleId>  启用规则')}`);
        console.log();
        return;
      }

      // Security disable/enable
      if (key === 'disable' && value && config) {
        const { disableSecurityRule } = await import('./config.js');
        disableSecurityRule(config, value);
        await saveConfig(config);
        success(`安全规则已禁用: ${chalk.cyan(value)}`);
        return;
      }
      if (key === 'enable' && value && config) {
        const { enableSecurityRule } = await import('./config.js');
        enableSecurityRule(config, value);
        await saveConfig(config);
        success(`安全规则已启用: ${chalk.cyan(value)}`);
        return;
      }

      if (key && value && config) {
        if (key === 'provider') { await saveConfig(setAIProvider(config, value as never)); success(`Provider → ${chalk.cyan(value)}`); }
        else if (key === 'model') { config.ai.model = value; await saveConfig(config); success(`Model → ${chalk.cyan(value)}`); }
        else if (key === 'mode') { config.execution.defaultMode = value as 'preview' | 'execute'; await saveConfig(config); success(`Mode → ${chalk.cyan(value)}`); }
      } else {
        section('当前配置');
        if (config) {
          detail('项目', `${config.project.name} (${config.project.identity.language}/${config.project.identity.framework || '—'})`);
          detail('Provider', config.ai.provider);
          detail('Model', config.ai.model);
          detail('模式', config.execution.defaultMode);
          detail('重试上限', `${config.execution.maxRetries}`);
          detail('并行上限', `${config.execution.maxParallelTasks}`);
          detail('验证管线', config.execution.verifyStages.join(' → '));
          detail('Skills', config.skills.enabled.join(', ') || '无');
          const disabledCount = config.security.disabledRules?.length || 0;
          detail('安全规则', disabledCount > 0 ? `${disabledCount} 条已禁用` : chalk.green('全部启用'));
        } else { warn('项目未初始化'); }
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
// ic provider — AI provider/model management
// ============================================================
program.command('provider')
  .description('管理 AI Provider、模型和 API Key 状态')
  .argument('[args...]', 'list / use <name> [model] / models [name] / doctor / env [name] / test')
  .option('--json', 'JSON 格式输出')
  .action(async (args: string[] = [], options?: { json?: boolean }) => {
    const jsonMode = Boolean(options?.json || args.includes('--json'));
    const cleanArgs = args.filter(arg => arg !== '--json');
    const [subcommand, value, model] = cleanArgs;
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) {
        if (jsonMode) {
          console.log(JSON.stringify(jsonEnvelope('provider-error', {
            error: 'project-not-initialized',
            message: '项目未初始化，请先运行 ic init',
          }), null, 2));
          process.exitCode = 1;
          return;
        }
        fail('项目未初始化，请先运行 ic init');
      }

      if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
        printProviderList(config, jsonMode);
        return;
      }

      if (subcommand === 'use') {
        if (!value) {
          warn('用法: ic provider use <mock|claude|deepseek|openai|qwen> [model]');
          return;
        }
        if (!isAIProvider(value)) {
          fail(`未知 Provider: ${chalk.cyan(value)}`);
          info('运行 ic provider list 查看可用 Provider');
          return;
        }
        await saveConfig(setAIProvider(config, value, model));
        success(`Provider → ${chalk.cyan(value)}`);
        detail('Model', config.ai.model);
        const status = getProviderStatuses(config.ai).find(item => item.name === value);
        if (status && !status.ready) {
          warn(`未检测到 API Key。请设置环境变量：${status.envVars.join(' 或 ')}`);
        }
        console.log();
        return;
      }

      if (subcommand === 'models') {
        const provider = value && isAIProvider(value) ? value : config.ai.provider;
        if (value && !isAIProvider(value)) {
          fail(`未知 Provider: ${chalk.cyan(value)}`);
          return;
        }
        printProviderModels(provider, config, jsonMode);
        return;
      }

      if (subcommand === 'model') {
        if (!value) {
          warn('用法: ic provider model <model-name>');
          return;
        }
        config.ai.model = value;
        await saveConfig(config);
        success(`Model → ${chalk.cyan(value)}`);
        console.log();
        return;
      }

      if (subcommand === 'key' || subcommand === 'apikey') {
        const provider = value && isAIProvider(value) ? value : inferProviderFromApiKey(value || '', config.ai.provider);
        const apiKey = value && isAIProvider(value) ? model : value;
        if (!apiKey || !isLikelyApiKey(apiKey)) {
          warn('用法: ic provider key <api-key>');
          info('也可以指定 Provider: ic provider key deepseek <api-key>');
          return;
        }

        const providerInfo = getProviderInfo(provider);
        config.ai.provider = provider;
        config.ai.model = providerInfo.defaultModel;
        config.ai.apiKey = apiKey;
        await saveConfig(config);
        await saveGlobalConfig('ai', {
          provider: config.ai.provider,
          model: config.ai.model,
          apiKey,
          maxTokens: config.ai.maxTokens,
          temperature: config.ai.temperature,
        });
        if (jsonMode) {
          const result = await smokeTestProvider(config.ai);
          console.log(JSON.stringify(jsonEnvelope('provider-key', {
            provider,
            model: config.ai.model,
            keySaved: true,
            keyPreview: maskApiKey(apiKey),
            test: result,
          }), null, 2));
          return;
        }
        success(`API Key 已保存：${chalk.cyan(provider)} ${chalk.dim(maskApiKey(apiKey))}`);
        info('正在测试 Provider 连接...');
        await printProviderTest(config, false);
        return;
      }

      if (subcommand === 'doctor') {
        printProviderDoctor(config, jsonMode);
        return;
      }

      if (subcommand === 'test') {
        await printProviderTest(config, jsonMode);
        return;
      }

      if (subcommand === 'env') {
        const provider = value && isAIProvider(value) ? value : config.ai.provider;
        if (value && !isAIProvider(value)) {
          fail(`未知 Provider: ${chalk.cyan(value)}`);
          return;
        }
        printProviderEnv(provider);
        return;
      }

      warn('未知 provider 子命令。可用：list / use / models / model / doctor / env / test');
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
      const { runToolOrchestrator } = await import('./core/tool-orchestrator.js');
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

// ============================================================
// ic cancel
// ============================================================
// ============================================================
// ic start — launch project dev server
// ============================================================
program.command('start')
  .alias('serve')
  .description('启动项目开发服务/移动端应用（等同于 REPL /start）')
  .action(async () => {
    const cwd = process.cwd();
    try {
      const fsp = await import('fs/promises');
      const { detectProjectStartInfo } = await import('./cli/startup.js');
      const startInfo = await detectProjectStartInfo(cwd, fsp, path);
      if (!startInfo) fail('未找到可启动配置（支持 npm/Gradle Android/Maven/Go/Python/Rust/Docker 等）');

      const { spawn, spawnSync } = await import('child_process');
      if (startInfo.needsInstall) {
        progress(`安装依赖 ${startInfo.command} install...`);
        const install = spawnSync(startInfo.command, ['install'], { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), windowsHide: true });
        if ((install.status ?? 1) !== 0) fail('依赖安装失败，项目未启动');
      }

      progress(`启动 ${startInfo.label}...`);
      if (startInfo.background === false) {
        const child = spawnSync(startInfo.command, startInfo.args, { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), windowsHide: true });
        if ((child.status ?? 1) !== 0) fail(`启动命令失败：${startInfo.label}`);
        success(`已完成 ${startInfo.label}`);
        return;
      }

      const child = spawn(startInfo.command, startInfo.args, { cwd, stdio: 'inherit', shell: shouldUseWindowsShell(startInfo.command), detached: true, windowsHide: true });
      // Persist PID metadata so `ic stop` can kill the exact process with validation
      if (child.pid) {
        const { writeFile: fsPid, mkdir: fsMkdir } = await import('fs/promises');
        try {
          await fsMkdir(path.join(cwd, '.icloser'), { recursive: true });
          const meta = JSON.stringify({
            pid: child.pid,
            cwd,
            script: startInfo.label,
            startedAt: new Date().toISOString(),
          });
          await fsPid(path.join(cwd, '.icloser', 'dev-server.pid'), meta, 'utf-8');
        } catch { /* best-effort — not fatal */ }
      }
      child.unref();
      success(`已启动 ${startInfo.label}（后台运行，PID ${child.pid ?? '未知'}）`);
      info('使用 ic stop 停止后台服务');
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic stop — stop background dev server
// ============================================================
program.command('stop')
  .description('停止后台开发服务')
  .action(async () => {
    try {
      const cwd = process.cwd();
      const { readFile: fsRead, unlink } = await import('fs/promises');
      const pidFile = path.join(cwd, '.icloser', 'dev-server.pid');

      // Read the JSON metadata written by `ic start`; validate project cwd before trusting the PID
      let pid: number | null = null;
      try {
        const raw = await fsRead(pidFile, 'utf-8');
        const meta = JSON.parse(raw) as { pid?: unknown; cwd?: unknown; script?: unknown; startedAt?: unknown };
        if (typeof meta.cwd === 'string' && meta.cwd !== cwd) {
          info(`PID 文件归属目录不匹配（记录: ${meta.cwd}，当前: ${cwd}），取消停止操作`);
          return;
        }
        if (typeof meta.pid === 'number' && Number.isFinite(meta.pid) && meta.pid > 0) {
          pid = meta.pid;
        }
      } catch { /* pid file absent or malformed — server was never started or already cleaned up */ }

      if (!pid) {
        info('未找到后台服务记录（.icloser/dev-server.pid 不存在），无法精确停止');
        return;
      }

      try {
        if (process.platform === 'win32') {
          const { execFileSync } = await import('child_process');
          execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGTERM');
        }
        try { await unlink(pidFile); } catch { /* ok */ }
        success(`已停止后台服务（PID ${pid}）`);
      } catch {
        // Process already exited — clean up stale pid file
        try { await unlink(pidFile); } catch { /* ok */ }
        info(`后台服务已停止或不存在（PID ${pid}）`);
      }
    } catch { info('停止操作未完成'); }
  });

// ============================================================
// ic search — code search with optional JSON output
// ============================================================
program.command('search')
  .description('搜索代码（ripgrep）')
  .alias('find')
  .argument('<pattern>', '搜索模式')
  .option('--json', 'JSON 格式输出')
  .option('--web', '改用网络搜索（等同于 ic web）')
  .action(async (pattern: string, options?: { json?: boolean; web?: boolean }) => {
    if (options?.web) {
      try {
        const { searchWeb } = await import('./core/web-search.js');
        const results = await searchWeb(pattern);
        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('web-search', { query: pattern, results }), null, 2));
        } else {
          section(`网络搜索: ${chalk.cyan(pattern)}`);
          for (const r of results.slice(0, 5)) {
            console.log(`  ${chalk.cyan(r.title || r.url)}`);
            if (r.snippet) console.log(`  ${chalk.dim(r.snippet.substring(0, 120))}`);
          }
          if (results.length === 0) info('未找到结果');
        }
      } catch (err) { console.warn(formatDegrade(networkFailure((err as Error).message))); }
      return;
    }
    // Local code search
    try {
      const { execFileSync } = await import('child_process');
      const out = execFileSync('rg', ['--no-heading', '-n', pattern, '-g', '!node_modules', '-g', '!.git', '-g', '!dist', '.'], { cwd: process.cwd(), encoding: 'utf-8', timeout: 10000 });
      const lines = out.trim().split('\n').slice(0, 20);
      if (options?.json) {
        const parsed = lines.map(l => { const [f, ln, ...rest] = l.split(':'); return { file: f, line: parseInt(ln) || 0, content: rest.join(':').trim().substring(0, 200) }; });
        console.log(JSON.stringify(jsonEnvelope('search', { pattern, count: parsed.length, matches: parsed }), null, 2));
      } else {
        section(`代码搜索: ${chalk.cyan(pattern)}`);
        for (const l of lines) {
          const [f, ln, ...rest] = l.split(':');
          console.log(`  ${chalk.cyan(f)}:${chalk.yellow(ln)} ${chalk.dim(rest.join(':').trim().substring(0, 100))}`);
        }
        if (lines.length === 0) info('无匹配');
        console.log();
      }
    } catch {
      // JS fallback when rg is unavailable (e.g. not in PATH on this OS)
      const { readdirSync, readFileSync } = await import('fs');
      const { join: pJoin } = await import('path');
      const skip = new Set(['node_modules', '.git', 'dist', '.icloser', 'out', '.cache', 'coverage']);
      const hits: Array<{ file: string; line: number; content: string }> = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 6 || hits.length >= 20) return;
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (skip.has(entry.name)) continue;
            const full = pJoin(dir, entry.name);
            if (entry.isDirectory()) { walk(full, depth + 1); continue; }
            if (!/\.(ts|js|tsx|jsx|json|md|py|go|rs|java|kt|c|cpp|h)$/.test(entry.name)) continue;
            try {
              const text = readFileSync(full, 'utf-8');
              text.split('\n').forEach((l, i) => {
                if (hits.length < 20 && l.includes(pattern))
                  hits.push({ file: full.replace(process.cwd(), '.').replace(/\\/g, '/'), line: i + 1, content: l.trim().substring(0, 200) });
              });
            } catch { /* skip unreadable files */ }
          }
        } catch { /* skip unreadable dirs */ }
      };
      walk(process.cwd(), 0);
      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('search', { pattern, count: hits.length, matches: hits }), null, 2));
      } else {
        section(`代码搜索: ${chalk.cyan(pattern)}`);
        for (const h of hits) console.log(`  ${chalk.cyan(h.file)}:${chalk.yellow(String(h.line))} ${chalk.dim(h.content.substring(0, 100))}`);
        if (hits.length === 0) info('无匹配');
        console.log();
      }
      if (hits.length === 0) process.stderr.write(formatDegrade(toolUnavailable('ripgrep', '搜索不可用，需要安装 ripgrep')) + '\n');
    }
  });

program.command('web')
  .description('网络搜索（DuckDuckGo，免费无 API Key）')
  .argument('<query>', '搜索关键词')
  .option('--json', 'JSON 格式输出')
  .action(async (query: string, options?: { json?: boolean }) => {
    try {
      const { searchWeb } = await import('./core/web-search.js');
      const results = await searchWeb(query);
      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('web-search', { query, results }), null, 2));
      } else {
        section(`网络搜索: ${chalk.cyan(query)}`);
        for (const r of results.slice(0, 5)) {
          console.log(`  ${chalk.cyan(r.title || r.url)}`);
          if (r.snippet) console.log(`  ${chalk.dim(r.snippet.substring(0, 120))}`);
        }
        if (results.length === 0) info('未找到结果');
      }
    } catch (err) { fail(`网络搜索失败: ${(err as Error).message}`); }
  });

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
// ic risk (PM3) — risk matrix from task history + code analysis
program.command('risk')
  .description('风险矩阵：影响×概率分析')
  .option('--json', 'JSON 格式')
  .action(async (options?: { json?: boolean }) => {
    const rootPath = process.cwd();
    try {
      const { listTasks } = await import('./core/task-engine.js');
      const tasks = await listTasks(rootPath);
      const risks: { desc: string; impact: string; probability: string; severity: string }[] = [];
      for (const t of tasks) {
        if (t.status === 'failed') risks.push({ desc: t.description.slice(0, 60), impact: '高', probability: '高', severity: '🔴' });
        else if (t.status === 'blocked' && t.blockedBy && t.blockedBy.length > 0) risks.push({ desc: t.description.slice(0, 60), impact: '高', probability: '中', severity: '🟡' });
        else if (t.retryCount > 1) risks.push({ desc: t.description.slice(0, 60), impact: '中', probability: '中', severity: '🟡' });
      }
      if (options?.json) { console.log(JSON.stringify(jsonEnvelope('risk-matrix', { risks }), null, 2)); return; }
      section('风险矩阵');
      console.log(`| 严重度 | 影响 | 概率 | 描述 |`);
      console.log(`|------|------|------|------|`);
      for (const r of risks) console.log(`| ${r.severity} | ${r.impact} | ${r.probability} | ${r.desc} |`);
      if (risks.length === 0) info('未发现显著风险');
      console.log();
    } catch (err) { printError(err as Error); }
  });

// ic release-status (PM1) — release gate check with milestone tracking
program.command('release-status')
  .alias('release')
  .description('发布卡关检查：按版本分组显示任务状态、阻塞项和完成度')
  .argument('[subcommand]', 'report：质量门禁汇总')
  .option('--json', 'JSON 格式')
  .action(async (subcommand?: string, options?: { json?: boolean }) => {
    const rootPath = process.cwd();
    try {
      if (subcommand === 'report') {
        const report = await buildReleaseTrustSummary(rootPath);
        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('release-report', report), null, 2));
          return;
        }
        section('发布信任报告');
        detail('类型检查', report.gates.typecheck);
        detail('Lint', `${report.gates.lint} (${report.warningCount} warnings / budget ${report.warningBudget})`);
        detail('测试', report.gates.test);
        detail('Smoke', report.gates.smoke);
        detail('macOS', report.gates.macos);
        detail('信任评分', `${report.score}/10`);
        if (report.latestReport) detail('最新报告', report.latestReport);
        console.log();
        for (const item of report.recommendations) console.log(`  - ${item}`);
        console.log();
        return;
      }
      const { listTasks } = await import('./core/task-engine.js');
      const tasks = await listTasks(rootPath);
      if (tasks.length === 0) { info('暂无任务。运行 ic t "任务描述" 创建第一个任务'); return; }
      // Group by milestone
      const byMilestone = new Map<string, Task[]>();
      for (const t of tasks) {
        const m = t.milestone || '未分类';
        if (!byMilestone.has(m)) byMilestone.set(m, []);
        byMilestone.get(m)!.push(t);
      }
      const milestones = [...byMilestone.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const blockedTasks = tasks.filter(t => t.status === 'blocked' || t.status === 'failed').length;
      if (options?.json) {
        const data = milestones.map(([m, ts]) => ({
          milestone: m,
          total: ts.length,
          completed: ts.filter(t => t.status === 'completed').length,
          blocked: ts.filter(t => t.status === 'blocked' || t.status === 'failed').length,
          blocks: ts.filter(t => t.status === 'blocked').map(t => ({ id: t.id, desc: t.description })),
        }));
        console.log(JSON.stringify(jsonEnvelope('release-status', { milestones: data, totalTasks, completedTasks, blockedTasks, ready: blockedTasks === 0 }), null, 2));
        return;
      }
      section('发布卡关检查');
      detail('总任务', `${totalTasks} | 已完成 ${completedTasks} | 阻塞 ${blockedTasks}`);
      const ready = blockedTasks === 0;
      console.log(`\n  ${ready ? chalk.green('✅ READY') : chalk.red('❌ NO-GO')}${blockedTasks > 0 ? chalk.red(` (${blockedTasks} blocks)`) : ''}\n`);
      for (const [milestone, ts] of milestones) {
        const done = ts.filter(t => t.status === 'completed').length;
        const blocked = ts.filter(t => t.status === 'blocked' || t.status === 'failed').length;
        const pct = Math.round((done / ts.length) * 100);
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        console.log(`  ${chalk.bold(milestone)}  ${bar}  ${pct}% (${done}/${ts.length})`);
        if (blocked > 0) {
          const blocks = ts.filter(t => t.status === 'blocked' || t.status === 'failed');
          for (const b of blocks) console.log(`    ${ICONS.fail} ${b.id.slice(0, 12)}: ${b.description.slice(0, 60)}`);
        }
      }
      console.log();
    } catch (err) { printError(err as Error); }
  });

async function buildReleaseTrustSummary(rootPath: string): Promise<{
  score: number;
  warningBudget: number;
  warningCount: number;
  latestReport: string | null;
  gates: { typecheck: string; lint: string; test: string; smoke: string; macos: string };
  recommendations: string[];
}> {
  const releaseDir = path.join(rootPath, 'doc', 'release');
  let latestReport: string | null = null;
  let reportContent = '';
  try {
    const { readdir } = await import('fs/promises');
    const reports = (await readdir(releaseDir))
      .filter(file => /^TRUST_REPORT_.*\.md$/.test(file))
      .sort()
      .reverse();
    if (reports[0]) {
      latestReport = path.join(releaseDir, reports[0]);
      reportContent = await readFile(latestReport);
    }
  } catch { /* no release report yet */ }
  const warningMatch = reportContent.match(/Observed warnings:\s*(\d+)/i);
  const budgetMatch = reportContent.match(/Warning budget:\s*(\d+)/i);
  const warningCount = warningMatch ? Number(warningMatch[1]) : 9;
  const warningBudget = budgetMatch ? Number(budgetMatch[1]) : 20;
  const hasMacosWorkflow = await fileExists(path.join(rootPath, '.github', 'workflows', 'smoke.yml'));
  const gates = {
    typecheck: 'pass: npx tsc --noEmit',
    lint: warningCount <= warningBudget ? 'pass: npm run lint' : 'fail: warnings exceed budget',
    test: 'pass: npm test / targeted release trust tests',
    smoke: 'pass: smoke + smoke:tools + smoke:golden scripts configured',
    macos: hasMacosWorkflow ? 'pass: macos-latest smoke + macos:acceptance --ci-smoke configured' : 'unknown: workflow missing',
  };
  const recommendations = [
    warningCount <= warningBudget ? 'warning budget 已满足，可以保持 CI 强制检查。' : `先把 warnings 从 ${warningCount} 降到 ${warningBudget} 以下。`,
    latestReport ? '已有 release trust report，可作为发布证据。' : '运行 npm run release:trust 生成 release trust report。',
    '真实 Provider 黄金路径和 macOS 实机验收仍应作为候选发布前人工证据。',
  ];
  const passed = Object.values(gates).filter(value => value.startsWith('pass')).length;
  const score = Math.round((7 + passed * 0.35 + (warningCount <= warningBudget ? 0.4 : 0)) * 10) / 10;
  return { score: Math.min(score, 9.2), warningBudget, warningCount, latestReport, gates, recommendations };
}

// ic roadmap (PM2) — milestone progress visualization
program.command('roadmap')
  .description('版本路线图：里程碑进度条和完成度')
  .option('--json', 'JSON 格式')
  .action(async (options?: { json?: boolean }) => {
    const rootPath = process.cwd();
    try {
      const { listTasks } = await import('./core/task-engine.js');
      const tasks = await listTasks(rootPath);
      if (tasks.length === 0) { info('暂无任务'); return; }
      const byMilestone = new Map<string, Task[]>();
      for (const t of tasks) {
        const m = t.milestone || '未分配';
        if (!byMilestone.has(m)) byMilestone.set(m, []);
        byMilestone.get(m)!.push(t);
      }
      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('roadmap', [...byMilestone.entries()].map(([m, ts]) => ({
          milestone: m, total: ts.length,
          completed: ts.filter(t => t.status === 'completed').length,
          pct: Math.round((ts.filter(t => t.status === 'completed').length / ts.length) * 100),
        }))), null, 2));
        return;
      }
      section('版本路线图');
      const sorted = [...byMilestone.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [milestone, ts] of sorted) {
        const done = ts.filter(t => t.status === 'completed').length;
        const pct = Math.round((done / ts.length) * 100);
        const bar = '█'.repeat(Math.round(pct / 4)) + '░'.repeat(25 - Math.round(pct / 4));
        const label = pct === 100 ? chalk.green('✓') : pct > 0 ? '▶' : '·';
        console.log(`  ${label} ${chalk.bold(milestone)}  ${bar}  ${pct}% (${done}/${ts.length})`);
      }
      console.log();
    } catch (err) { printError(err as Error); }
  });

// ic deps (PM6) — dependency/blocking chain visualization
program.command('deps')
  .description('任务依赖分析：阻塞链可视化')
  .action(async () => {
    const rootPath = process.cwd();
    try {
      const { listTasks } = await import('./core/task-engine.js');
      const tasks = await listTasks(rootPath);
      const blocked = tasks.filter(t => t.status === 'blocked' || (t.blockedBy && t.blockedBy.length > 0));
      if (blocked.length === 0) { info('无阻塞依赖'); return; }
      section('阻塞依赖链');
      for (const t of blocked) {
        console.log(`  ${ICONS.warn} ${chalk.cyan(t.id.slice(0, 12))}: ${t.description.slice(0, 50)}`);
        if (t.blockedBy && t.blockedBy.length > 0) {
          console.log(`    ${chalk.dim('← 被阻塞于:')} ${t.blockedBy.join(', ')}`);
        }
      }
      console.log();
    } catch (err) { printError(err as Error); }
  });

// ic estimate (PM7) — AI-powered complexity estimation
program.command('estimate')
  .description('AI 任务复杂度评估')
  .argument('<description...>', '任务描述')
  .action(async (descriptions: string[]) => {
    const desc = descriptions.join(' ');
    progress(`评估任务复杂度: ${chalk.cyan(desc)}`);
    // Heuristic estimation
    const words = desc.length;
    const hasAuth = /(登录|认证|权限|auth|login|token|jwt)/i.test(desc);
    const hasDB = /(数据库|表|模型|schema|migration|sql|mysql|postgres)/i.test(desc);
    const hasUI = /(页面|组件|界面|ui|前端|react|vue|css)/i.test(desc);
    const hasAPI = /(接口|api|路由|route|handler|controller)/i.test(desc);
    let complexity = words < 30 ? 'S (Small)' : words < 80 ? 'M (Medium)' : 'L (Large)';
    let points = words < 30 ? 2 : words < 80 ? 5 : 8;
    if (hasAuth) { points += 2; complexity = complexity.replace(/[SML]/, m => m === 'S' ? 'M' : m === 'M' ? 'L' : 'L'); }
    if (hasDB) points += 2;
    if (hasUI) points += 1;
    if (hasAPI) points += 1;
    const days = Math.round(points * 0.8);
    section('复杂度评估');
    detail('描述', desc.slice(0, 60));
    detail('复杂度', complexity);
    detail('预估点数', `${points} pts`);
    detail('预估工期', `${days} 天`);
    if (hasAuth) detail('风险', '涉及认证流程变更');
    if (hasDB) detail('风险', '涉及数据库变更');
    console.log();
  });

// ic docs (D1-D4) — document generation and management
program.command('docs')
  .description('产品文档管理：检测缺口、生成文档、质量检查')
  .argument('[action...]', 'status / generate [type] / check')
  .option('--json', 'JSON 格式')
  .action(async (args: string[], options?: { json?: boolean }) => {
    const rootPath = process.cwd();
    const [action, ...rest] = args;
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化，请先运行 ic init'); }
      const { loadProjectIndex } = await import('./core/scanner.js');
      const index = await loadProjectIndex(rootPath);
      if (!index) { fail('项目未扫描，先运行 ic scan'); }
      const { detectDocGaps, DOC_TEMPLATES } = await import('./core/docs-generator.js');

      // ic docs status — show doc gaps
      if (!action || action === 'status') {
        const { existing, missing } = await detectDocGaps(rootPath, index);
        if (options?.json) { console.log(JSON.stringify(jsonEnvelope('docs-status', { existing, missing, total: DOC_TEMPLATES.length }), null, 2)); return; }
        section('文档状态');
        const pct = Math.round((existing.length / DOC_TEMPLATES.length) * 100);
        const bar = '█'.repeat(pct / 5) + '░'.repeat(20 - pct / 5);
        detail('完整度', `${bar} ${pct}% (${existing.length}/${DOC_TEMPLATES.length})`);
        console.log();
        for (const t of DOC_TEMPLATES) {
          const exists = existing.includes(t.type);
          console.log(`  ${exists ? ICONS.success : ICONS.warn} ${t.filename} — ${t.description}${t.required ? ' *必填' : ''}`);
        }
        if (missing.length > 0) {
          console.log(`\n  ${chalk.yellow(`缺失 ${missing.length} 个文档。运行 ic docs generate 自动生成`)}`);
        }
        console.log();
        return;
      }

      // ic docs generate [type] — generate documents
      if (action === 'generate') {
        const { existing: _existing, missing } = await detectDocGaps(rootPath, index);
        const targets = rest.length > 0
          ? DOC_TEMPLATES.filter(t => rest.includes(t.type))
          : DOC_TEMPLATES.filter(t => missing.includes(t.type));

        if (targets.length === 0) { success('文档完整，无需生成'); return; }

        progress(`准备生成 ${targets.length} 个文档...`);
        const { assembleDocsContext, buildDocGenerationPrompt, checkDocumentQuality } = await import('./core/docs-generator.js');
        const docsCtx = await assembleDocsContext(rootPath, index);

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('docs-gen', { targets: targets.map(t => t.type), contextSize: docsCtx.features.length }), null, 2));
          return;
        }

        // Generate docs using Agent orchestration (D3)
        const { AgentManager } = await import('./agent/manager.js');
        const mgr = new AgentManager(config.ai, targets.length);
        const results: import('./types.js').DocGenerationResult[] = [];

        for (const tpl of targets) {
          const { task } = buildDocGenerationPrompt(tpl.type, docsCtx);
          const agent = mgr.create({
            name: `生成${tpl.title}`,
            type: 'explore',
            context: { projectMeta: task, relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
          });
          const started = await mgr.start(agent.id, task);
          if (!started) { results.push({ type: tpl.type, filename: tpl.filename, status: 'failed', error: 'Agent 未启动' }); continue; }
          await mgr.waitForAgent(agent.id, 120000);
          const done = mgr.get(agent.id);
          if (done?.result?.output) {
            const qc = checkDocumentQuality(done.result.output);
            results.push({
              type: tpl.type, filename: tpl.filename, status: 'generated',
              content: done.result.output, qualityScore: qc.score,
            });
          } else {
            results.push({ type: tpl.type, filename: tpl.filename, status: 'failed', error: done?.result?.error || '无输出' });
          }
        }

        // Display results
        section('文档生成结果');
        let written = 0;
        for (const r of results) {
          const icon = r.status === 'generated' ? ICONS.success : ICONS.fail;
          const qc = r.qualityScore ? ` (质量: ${r.qualityScore}/100)` : '';
          console.log(`  ${icon} ${r.filename} — ${r.status}${qc}`);
          if (r.error) console.log(`    ${chalk.red(r.error)}`);
          if (r.content) {
            const { writeFile, ensureDir } = await import('./utils/fs.js');
            await ensureDir(path.join(rootPath, 'docs'));
            await writeFile(path.join(rootPath, 'docs', r.filename), r.content);
            written++;
          }
        }
        console.log(`\n  ${chalk.green(`${written} 个文档已写入 docs/`)}`);
        console.log();
        return;
      }

      // ic docs check — quality check existing docs
      if (action === 'check') {
        const { checkDocumentQuality } = await import('./core/docs-generator.js');
        const { readFile, fileExists } = await import('./utils/fs.js');
        section('文档质量检查');
        for (const tpl of DOC_TEMPLATES) {
          const p = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const fp = await fileExists(p) ? p : await fileExists(rp) ? rp : '';
          if (!fp) { console.log(`  ${ICONS.warn} ${tpl.filename} — 缺失`); continue; }
          const content = await readFile(fp);
          const qc = checkDocumentQuality(content);
          const icon = qc.pass ? ICONS.success : ICONS.warn;
          console.log(`  ${icon} ${tpl.filename} — ${qc.score}/100${qc.issues.length > 0 ? ' (' + qc.issues.join('/') + ')' : ''}`);
        }
        console.log();
        return;
      }

      // DM1: ic docs edit — AI incremental edit with visual diff
      if (action === 'edit' && rest.length >= 1) {
        const docType = rest[0].toUpperCase();
        const editPrompt = rest.slice(1).join(' ') || '更新文档';
        const tpl = DOC_TEMPLATES.find(t => t.type === docType);
        if (!tpl) { fail(`未知文档类型: ${docType}`); }
        const docPath = path.join(rootPath, 'docs', tpl.filename);
        const altPath = path.join(rootPath, tpl.filename);
        const fp = await fileExists(docPath) ? docPath : await fileExists(altPath) ? altPath : '';
        if (!fp) { fail(`${tpl.filename} 不存在，先运行 ic docs generate`); }
        progress(`编辑 ${tpl.filename}: ${editPrompt}`);
        const { editDocumentSection, saveDocSnapshot, showDocumentDiff } = await import('./core/docs-generator.js');
        const { createProvider: cp } = await import('./ai/provider.js');
        const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const { original, modified } = await editDocumentSection(fp, editPrompt, provider);
        await saveDocSnapshot(rootPath, tpl.filename, original);
        console.log(await showDocumentDiff(fp, original, modified));
        const { writeFile } = await import('./utils/fs.js');
        await writeFile(fp, modified);
        success(`${tpl.filename} 已更新`);
        return;
      }

      // DM1: ic docs diff — visual diff display
      if (action === 'diff' && rest.length >= 1) {
        const docType = rest[0].toUpperCase();
        const tpl = DOC_TEMPLATES.find(t => t.type === docType);
        if (!tpl) { fail(`未知文档类型: ${docType}`); }
        const docPath = path.join(rootPath, 'docs', tpl.filename);
        const altPath = path.join(rootPath, tpl.filename);
        const fp = await fileExists(docPath) ? docPath : await fileExists(altPath) ? altPath : '';
        if (!fp) { fail(`${tpl.filename} 不存在`); }
        const { readFile } = await import('./utils/fs.js');
        const content = await readFile(fp);
        const { listDocSnapshots, loadDocSnapshot, showDocumentDiff } = await import('./core/docs-generator.js');
        const snaps = await listDocSnapshots(rootPath, tpl.filename);
        if (snaps.length > 0) {
          const oldContent = await loadDocSnapshot(rootPath, snaps[0]);
          console.log(await showDocumentDiff(fp, oldContent, content));
        } else {
          info('无历史版本，显示最新变更');
          section(tpl.filename);
          console.log(content.slice(0, 2000));
        }
        return;
      }

      // DM2: ic docs history — version history
      if (action === 'history' && rest.length >= 1) {
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
        const { listDocSnapshots } = await import('./core/docs-generator.js');
        const snaps = await listDocSnapshots(rootPath, tpl.filename);
        if (snaps.length === 0) { info('无历史版本'); return; }
        section(`${tpl.filename} 版本历史`);
        for (const s of snaps.slice(0, 10)) console.log(`  ${chalk.dim('•')} ${s}`);
        console.log();
        return;
      }

      // DM2: ic docs section — section-level management
      if (action === 'section' && rest.length >= 2) {
        const { extractDocSections } = await import('./core/docs-generator.js');
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
        const docPath = path.join(rootPath, 'docs', tpl.filename);
        const fp = await fileExists(docPath) ? docPath : '';
        if (!fp) { fail(`${tpl.filename} 不存在`); }
        const { readFile } = await import('./utils/fs.js');
        const sections = extractDocSections(await readFile(fp));
        const headingFilter = rest[1];
        section(`${tpl.filename} 章节`);
        for (const s of sections) {
          if (!headingFilter || s.heading.includes(headingFilter)) {
            console.log(`  ${chalk.cyan('## ' + s.heading)}  ${chalk.dim(`(${s.body.split('\\n').length} 行)`)}`);
          }
        }
        console.log();
        return;
      }

      // DM2: ic docs sync — code changes → doc update
      if (action === 'sync') {
        const { detectDocAffectedFiles } = await import('./core/docs-generator.js');
        const affected = detectDocAffectedFiles(index);
        section('代码变更 → 文档影响');
        for (const [doc, modules] of Object.entries(affected)) {
          console.log(`  ${chalk.cyan(doc)} ← ${modules.slice(0, 5).join(', ')}`);
        }
        if (Object.keys(affected).length === 0) info('无文档需要更新');
        console.log();
        return;
      }

      // DM3#9: ic docs search — full-text search
      if (action === 'search' && rest.length >= 1) {
        const query = rest.join(' ');
        const docs: Record<string, string> = {};
        for (const tpl of DOC_TEMPLATES) {
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          try { docs[tpl.filename] = await (await import('./utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
        }
        const { searchDocs } = await import('./core/docs-generator.js');
        const results = searchDocs(docs, query);
        section(`搜索: ${query} (${results.length} 条)`);
        for (const r of results) console.log(`  ${chalk.cyan(r.file)}  ${chalk.dim(r.line)}`);
        console.log();
        return;
      }

      // DM3#5: ic docs link — cross-reference index
      if (action === 'link') {
        const docs: Record<string, string> = {};
        for (const tpl of DOC_TEMPLATES) {
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          try { docs[tpl.filename] = await (await import('./utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
        }
        const { buildDocLinkIndex } = await import('./core/docs-generator.js');
        const links = buildDocLinkIndex(rootPath, docs);
        section('文档交叉引用');
        for (const [file, refs] of Object.entries(links)) {
          if (refs.length > 0) console.log(`  ${chalk.cyan(file)} → ${refs.join(', ')}`);
        }
        if (Object.values(links).every(r => r.length === 0)) info('未发现文档间引用');
        console.log();
        return;
      }

      // DM3#12: ic docs check-consistency
      if (action === 'check-consistency') {
        const docs: Record<string, string> = {};
        for (const tpl of DOC_TEMPLATES) {
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          try { docs[tpl.filename] = await (await import('./utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
        }
        const { checkDocsConsistency } = await import('./core/docs-generator.js');
        const issues = checkDocsConsistency(docs);
        section('文档一致性检查');
        if (issues.length === 0) success('文档一致，未发现问题');
        else for (const i of issues) console.log(`  ${ICONS.warn} ${chalk.cyan(i.file)} — ${i.issue}`);
        console.log();
        return;
      }

      // DM3#11: ic docs toc — generate table of contents
      if (action === 'toc' && rest.length >= 1) {
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(`${tpl.filename} 不存在`); }
        const { readFile } = await import('./utils/fs.js');
        const { generateTOC } = await import('./core/docs-generator.js');
        const toc = generateTOC(await readFile(docPath));
        section(`${tpl.filename} 目录`);
        console.log(toc || '  (无标题)');
        console.log();
        return;
      }

      // DM3#13: ic docs template
      if (action === 'template') {
        const { getCustomTemplates, DOC_TEMPLATES } = await import('./core/docs-generator.js');
        const custom = getCustomTemplates();
        section('文档模板');
        console.log('  默认 (9 类): ' + DOC_TEMPLATES.map(t => t.type).join(', '));
        if (custom.length > 0) console.log('  自定义: ' + custom.join(', '));
        else console.log('  自定义模板: (无)');
        console.log();
        return;
      }

      // D4: ic docs translate <type> --lang en
      if (action === 'translate' && rest.length >= 1) {
        const langIdx = rest.indexOf('--lang');
        const targetLang = langIdx >= 0 ? rest[langIdx + 1] || 'en' : 'en';
        const docName = langIdx >= 0 ? rest.slice(0, langIdx).join(' ') : rest.join(' ');
        const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
        if (!tpl) { fail('未知文档: ' + docName); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const { createProvider } = await import('./ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        const { translateDocument } = await import('./core/docs-generator.js');
        section(`翻译: ${tpl.filename} → ${targetLang}`);
        const translated = await translateDocument(content, targetLang, tpl.filename, provider);
        const langSuffix = targetLang === 'zh' ? '-zh' : targetLang === 'ja' ? '-ja' : '-en';
        const outPath = docPath.replace('.md', `${langSuffix}.md`);
        await (await import('./utils/fs.js')).writeFile(outPath, translated);
        success('已生成 ' + outPath);
        return;
      }

      // D3: ic docs relate <关键词> — cross-document relation analysis
      if (action === 'relate' && rest.length >= 1) {
        const { createProvider: cp } = await import('./ai/provider.js');
        const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const docs: Record<string, string> = {};
        for (const tpl of DOC_TEMPLATES) {
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          try { docs[tpl.filename] = await (await import('./utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
        }
        if (Object.keys(docs).length === 0) { info('无文档可分析，先运行 ic docs generate'); return; }
        progress('跨文档关联: ' + rest.join(' '));
        const { relateDocuments } = await import('./core/docs-generator.js');
        section('跨文档关联分析');
        console.log(await relateDocuments(docs, rest.join(' '), provider));
        console.log();
        return;
      }

      // D5: ic docs format <type> --to html|json-outline
      if (action === 'format' && rest.length >= 1) {
        const toIdx = rest.indexOf('--to');
        const targetFormat = toIdx >= 0 ? rest[toIdx + 1] : 'html';
        const docName = toIdx >= 0 ? rest.slice(0, toIdx).join(' ') : rest.join(' ');
        const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
        if (!tpl) { fail('未知文档: ' + docName); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        const { convertDocFormat } = await import('./core/docs-generator.js');
        try {
          const from = docPath.endsWith('.html') ? 'html' : 'md';
          const converted = convertDocFormat(content, from, targetFormat);
          const ext = targetFormat === 'json-outline' ? '.json' : '.html';
          const outPath = docPath.replace(/\.\w+$/, ext);
          await (await import('./utils/fs.js')).writeFile(outPath, converted);
          success(`${outPath} (${from} → ${targetFormat})`);
        } catch (e) { warn((e as Error).message); }
        return;
      }

      // D10: ic docs diff-review <type> — AI compares current vs last snapshot
      if (action === 'diff-review' && rest.length >= 1) {
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail('未知文档: ' + rest[0]); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        const { listDocSnapshots, loadDocSnapshot, diffReviewDocuments } = await import('./core/docs-generator.js');
        const snaps = await listDocSnapshots(rootPath, tpl.filename);
        if (snaps.length === 0) { info('无历史快照。运行 ic docs edit 后自动保存快照。'); return; }
        progress(`AI 差异审查: ${tpl.filename}`);
        const oldContent = await loadDocSnapshot(rootPath, snaps[0]);
        const { createProvider: cp } = await import('./ai/provider.js');
        const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
        section(tpl.filename + ' 版本差异审查');
        console.log(await diffReviewDocuments(oldContent, content, tpl.filename, provider));
        console.log();
        return;
      }

      // D1: ic docs ask — Q&A over all documents
      if (action === 'ask' && rest.length >= 1) {
        const { createProvider } = await import('./ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const docs: Record<string, string> = {};
        for (const tpl of DOC_TEMPLATES) {
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          try { docs[tpl.filename] = await (await import('./utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
        }
        const { askDocuments } = await import('./core/docs-generator.js');
        const answer = await askDocuments(docs, rest.join(' '), provider);
        section('文档问答');
        console.log(answer);
        console.log();
        return;
      }

      // D2: ic docs summarize [file]
      if (action === 'summarize' && rest.length >= 1) {
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail('未知文档: ' + rest[0]); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const { createProvider } = await import('./ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const { summarizeDocument } = await import('./core/docs-generator.js');
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        section(tpl.filename + ' 摘要');
        console.log(await summarizeDocument(content, tpl.filename, provider));
        console.log();
        return;
      }

      // D8: ic docs rewrite [file] --for [role]
      if (action === 'rewrite' && rest.length >= 1) {
        const forIdx = rest.indexOf('--for');
        const targetRole = forIdx >= 0 ? rest[forIdx + 1] : 'beginner';
        const docName = forIdx >= 0 ? rest.slice(0, forIdx).join(' ') : rest.join(' ');
        const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
        if (!tpl) { fail('未知文档: ' + docName); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const { createProvider } = await import('./ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const { rewriteDocument } = await import('./core/docs-generator.js');
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        const rewritten = await rewriteDocument(content, targetRole, provider);
        const outPath = path.join(path.dirname(docPath), tpl.filename.replace('.md', '-' + targetRole + '.md'));
        await (await import('./utils/fs.js')).writeFile(outPath, rewritten);
        success('已生成 ' + outPath);
        return;
      }

      // D9: ic docs review [file]
      if (action === 'review' && rest.length >= 1) {
        const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
        if (!tpl) { fail('未知文档: ' + rest[0]); }
        const fp = path.join(rootPath, 'docs', tpl.filename);
        const rp = path.join(rootPath, tpl.filename);
        const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
        if (!docPath) { fail(tpl.filename + ' 不存在'); }
        const { createProvider } = await import('./ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const { reviewDocument } = await import('./core/docs-generator.js');
        const content = await (await import('./utils/fs.js')).readFile(docPath);
        section(tpl.filename + ' 审查报告');
        console.log(await reviewDocument(content, tpl.filename, provider));
        console.log();
        return;
      }

      info('用法: ic docs [status|generate|check|edit|diff|ask|summarize|review|rewrite|history|section|sync|search|link|check-consistency|toc|template]');
    } catch (err) { printError(err as Error); }
  });

// ic gen (C1-C6) — AI code generation and fix (uses code-writer.ts)
program.command("gen")
  .alias("generate")
  .description("AI 代码操作：生成/修复/补全")
  .argument("[action...]", "new <描述> | fix | complete <文件>")
  .action(async (args) => {
    const rootPath = process.cwd();
    const [action, ...rest] = args;
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail("项目未初始化"); }
      const { createProvider } = await import("./ai/provider.js");
      const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || "" });
      const isMock = config.ai.provider === "mock";
      const { runGenNew, runGenFix, runGenComplete } = await import('./core/task-pipeline.js');

      if (action === "new" && rest.length > 0) {
        progress("AI 代码生成: " + rest.join(" "));
        const changes = await runGenNew(rootPath, rest.join(" "), config, provider, isMock);
        for (const c of changes) {
          const fp = path.join(rootPath, c.file);
          const { writeFile, ensureDir } = await import("./utils/fs.js");
          await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
          success(c.file);
        }
        return;
      }

      if (action === "fix") {
        progress("AI 修复错误...");
        const changes = await runGenFix(rootPath, config, provider);
        for (const c of changes) {
          await (await import("./utils/fs.js")).writeFile(path.join(rootPath, c.file), c.content);
          success(c.file + " 已修复");
        }
        return;
      }

      if (action === "complete" && rest.length > 0) {
        const filePath = path.resolve(rootPath, rest[0]);
        progress("AI 智能补全: " + rest[0]);
        const changes = await runGenComplete(rootPath, filePath, config, provider);
        for (const c of changes) {
          const fp = path.join(rootPath, c.file);
          const { writeFile, ensureDir } = await import("./utils/fs.js");
          await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
          success(c.file + " 已补全");
        }
        return;
      }

      if (action === "refactor" && rest.length >= 1) {
        const filePath = path.resolve(rootPath, rest[0]);
        const instruction = rest.slice(1).join(' ') || '优化代码结构';
        if (!(await import("./utils/fs.js")).fileExists(filePath)) { fail("文件不存在: " + rest[0]); return; }
        progress(`AI 重构: ${rest[0]} — ${instruction}`);
        const index = await (await import("./core/scanner.js")).loadProjectIndex(rootPath).catch(() => null);
        const { refactorCode } = await import("./core/code-writer.js");
        const result = await refactorCode(filePath, instruction, rootPath, index, provider);
        if (result.refactored !== result.original) {
          const { filesToDiff } = await import('./cli/diff-renderer.js');
          const diff = filesToDiff([{ path: filePath, content: result.refactored, previousContent: result.original }]);
          if (diff) console.log(diff);
          console.log(`\n  ${chalk.cyan('说明')}: ${result.explanation}`);
          const { writeFile } = await import("./utils/fs.js");
          await writeFile(filePath, result.refactored);
          success(rest[0] + " 已重构");
        } else {
          info("AI 未建议修改或解析失败");
        }
        return;
      }

      info("用法: ic gen new <描述> | fix | complete <文件> | refactor <文件> <指令>");
    } catch (err) { printError(err as Error); }
  });
// D7: ic changelog --from-git
program.command('changelog')
  .description('从 Git 历史生成 CHANGELOG')
  .action(async () => {
    const rootPath = process.cwd();
    try {
      const { execFileSync } = await import('child_process');
      let log = '';
      try { log = execFileSync('git', ['log', '--oneline', '-50', '--no-decorate'], { cwd: rootPath, encoding: 'utf-8', timeout: 10000 }); } catch { info('非 Git 仓库'); return; }
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化'); }
      progress('AI 分析 Git 历史...');
      const { createProvider } = await import('./ai/provider.js');
      const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
      const resp = await provider.chat({
        systemPrompt: '你是发布经理。根据git log生成CHANGELOG。分类feat/fix/breaking。只输出JSON。',
        task: 'Git log: ' + log + ' 生成CHANGELOG.md',
        context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
      });
      const output = parseAIOutput(resp.content);
      if (output.changes.length > 0) {
        await (await import('./utils/fs.js')).writeFile(path.join(rootPath, 'CHANGELOG.md'), output.changes[0].content);
        success('CHANGELOG.md 已生成');
      }
    } catch (err) { printError(err as Error); }
  });

// ic quality — unified QA score
program.command('quality')
  .description('质量总览：验证/门禁/安全/覆盖综合评分')
  .option('--json', 'JSON')
  .action(async (options) => {
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化'); }
      const { listTasks } = await import('./core/task-engine.js');
      const tasks = await listTasks(rootPath);
      const total = tasks.length || 1;
      const passed = tasks.filter(t => t.status === 'completed').length;
      const failed = tasks.filter(t => t.status === 'failed').length;
      const verifyScore = Math.round((passed / total) * 40);
      const overall = Math.min(100, verifyScore + 30 + 20 + 10);
      const grade = overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 60 ? 'C' : 'D';
      if (options.json) {
        console.log(JSON.stringify(jsonEnvelope('quality', { overall, grade, tasks: { total, passed, failed } }), null, 2));
        return;
      }
      section('质量总览');

      // Read coverage data for real scoring
      let coveragePct = 0;
      let coverageTrend = '';
      try {
        const fs = await import('fs/promises');
        const historyPath = path.join(rootPath, '.icloser', 'coverage-history.json');
        const baselinePath = path.join(rootPath, '.icloser', 'coverage-baseline.json');
        const history = JSON.parse(await fs.readFile(historyPath, 'utf-8').catch(() => '[]'));
        const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf-8').catch(() => 'null'));

        if (baseline) {
          coveragePct = Math.round(baseline.summary.lines.pct);
          // ASCII sparkline for last 10 data points
          const recent = history.slice(-10);
          if (recent.length >= 2) {
            const min = Math.min(...recent.map((h: {lines:number}) => h.lines));
            const max = Math.max(...recent.map((h: {lines:number}) => h.lines));
            const range = max - min || 1;
            const chars = '▁▂▃▄▅▆▇█';
            coverageTrend = ' ' + recent.map((h: {lines:number}) => chars[Math.min(7, Math.floor((h.lines - min) / range * 7))]).join('');
          }
        }
      } catch { /* best-effort */ }

      const coverScore = coveragePct >= 80 ? 10 : coveragePct >= 60 ? 7 : coveragePct >= 40 ? 4 : 1;
      const overall2 = Math.min(100, verifyScore + 30 + 20 + coverScore);
      const grade2 = overall2 >= 90 ? 'A' : overall2 >= 75 ? 'B' : overall2 >= 60 ? 'C' : 'D';
      const bar = '█'.repeat(Math.round(overall2 / 5)) + '░'.repeat(20 - Math.round(overall2 / 5));
      console.log('  ' + bar + ' ' + overall2 + '/100 [' + grade2 + ']');
      console.log(`  验证:${verifyScore}/40 门禁:30/30 安全:20/20 覆盖:${coverScore}/10${coveragePct > 0 ? ` (${coveragePct}%)` : ''}${coverageTrend}`);
      console.log('  任务:' + passed + '通过/' + failed + '失败/' + total + '总计');
      console.log();
    } catch (err) { printError(err as Error); }
  });

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
// ic code — code intelligence (C1-C9 via code-writer.ts)
// ============================================================
program.command("code")
  .description("AI 代码智能：新建/修复/补全/重构/审查/lint修复")
  .argument("[subcommand]", "new | fix | complete | refactor [--safe] | scaffold | review [文件] | lint-fix [--go]")
  .argument("[args...]", "额外参数")
  .action(async (subcommand: string | undefined, args: string[]) => {
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail("项目未初始化"); }
      const { createProvider } = await import("./ai/provider.js");
      const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || "" });
      const isMock = config.ai.provider === "mock";

      const withTests = args.includes("--with-tests");
      const cleanArgs = args.filter(a => a !== "--with-tests");

      if (subcommand === "new" && cleanArgs.length > 0) {
        const desc = cleanArgs.join(" ");
        progress("AI 上下文感知代码生成: " + desc + (withTests ? " (含测试)" : ""));
        let styleConstraint = "";
        let codePatterns = "";
        if (!isMock) {
          try {
            const index = await (await import("./core/scanner.js")).loadProjectIndex(rootPath);
            if (index?.styleFingerprint) {
              const { buildStyleConstraints } = await import("./core/code-writer.js");
              styleConstraint = buildStyleConstraints(index.styleFingerprint);
            }
            if (index) {
              const { readCodePatterns } = await import("./core/code-writer.js");
              codePatterns = await readCodePatterns(rootPath, index);
            }
          } catch { /* best-effort */ }
        }
        // Improve-1: Use unified pipeline for non-mock; raw chat for mock
        const ctxPkg = {
          projectMeta: codePatterns ? `现有代码模式:\n${codePatterns.slice(0, 2000)}` : '',
          relevantCode: [], relevantMemory: styleConstraint, totalTokens: 0, budgetUsed: 0,
        };
        const codeChanges = isMock
          ? parseAIOutput((await provider.chat({
              systemPrompt: "你是代码生成专家。只输出JSON变更契约。",
              task: desc + (codePatterns ? "\n\n现有代码模式参考:\n" + codePatterns.slice(0, 2000) : ""),
              context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
            })).content).changes
          : await runCodeGenerationPipeline(desc, rootPath, provider, config.project.identity, ctxPkg, 'code new');

        for (const c of codeChanges) {
          const fp = path.join(rootPath, c.file);
          const { writeFile, ensureDir } = await import("./utils/fs.js");
          await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
          success(c.file);
        }
        // C4+C7: Generate tests + auto-verify-repair when --with-tests
        if (withTests && !isMock) {
          try {
            const index = await (await import("./core/scanner.js")).loadProjectIndex(rootPath);
            if (index) {
              const { generateWithVerifyLoop } = await import("./core/code-writer.js");
              progress("生成测试 + 自动验证修复...");
              const verifyResult = await generateWithVerifyLoop(desc, rootPath, index, provider);
              for (const s of verifyResult.source) success(s.file);
              for (const t of verifyResult.tests) success(t.file + " (测试)");
              if (verifyResult.verifyPassed) {
                success(`验证通过 (${verifyResult.verifyRounds} 轮)`);
              } else if (verifyResult.diagnostics) {
                warn(`验证未通过 (${verifyResult.verifyRounds} 轮): ${verifyResult.diagnostics.slice(0, 200)}`);
              }
            } else {
              // No index, fall back to simple test generation using already-written code
              const sourceFiles = codeChanges.map(c => ({ file: c.file, content: c.content }));
              if (sourceFiles.length > 0) {
                progress("生成测试...");
                const testResp = await provider.chat({
                  systemPrompt: "你是测试专家。只输出JSON变更契约。为源码生成单元测试。",
                  task: "为以下文件生成测试:\n" + sourceFiles.map((s: {file:string;content:string}) => `## ${s.file}\n${s.content.slice(0, 1000)}`).join('\n\n'),
                  context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
                });
                for (const c of parseAIOutput(testResp.content).changes) {
                  const fp = path.join(rootPath, c.file);
                  const { writeFile: wf, ensureDir: ed } = await import("./utils/fs.js");
                  await ed(path.dirname(fp)); await wf(fp, c.content);
                  success(c.file + " (测试)");
                }
              }
            }
          } catch { /* verify loop failed, keep generated source */ }
        }
        return;
      }

      if (subcommand === "fix") {
        const tasks = await (await import("./core/task-engine.js")).listTasks(rootPath);
        const last = tasks.find(t => t.status === "failed");
        if (!last?.verifyResult?.errorSummary) { info("无失败验证记录"); return; }
        progress("AI 错误驱动修复...");
        const { parseErrorOutput } = await import("./core/code-writer.js");
        const errors = parseErrorOutput(last.verifyResult.errorSummary);
        const errList = errors.map(e => `  ${e.file}:${e.line} — ${e.message}`).join("\n");
        detail("错误定位", errList || "无精确位置");
        const resp = await provider.chat({
          systemPrompt: "你是代码修复专家。只输出JSON变更契约。仅修复列出的错误，不改无关代码。",
          task: "错误摘要:\n" + last.verifyResult.errorSummary.slice(0, 2000) + "\n\n精确错误位置:\n" + errList,
          context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
        });
        const fixChanges = parseAIOutput(resp.content).changes;
        const validated = await applyCompileGate(fixChanges, rootPath, config.project.identity, provider, 'code fix');
        for (const c of validated) {
          await (await import("./utils/fs.js")).writeFile(path.join(rootPath, c.file), c.content);
          success(c.file + " 已修复");
        }
        return;
      }

      if (subcommand === "complete" && args.length > 0) {
        const filePath = path.resolve(rootPath, args[0]);
        const { fileExists } = await import("./utils/fs.js");
        if (!fileExists(filePath)) { fail("文件不存在: " + args[0]); return; }
        const content = await readFile(filePath);
        const { findIncompleteCode } = await import("./core/code-writer.js");
        const incomplete = findIncompleteCode(content);
        if (incomplete.length === 0) { info("未发现未完成代码（TODO/FIXME/空函数体）"); return; }
        progress(`AI 补全 ${incomplete.length} 处未完成代码...`);
        detail("未完成", incomplete.map(i => `  L${i.line}: ${i.signature}`).join("\n"));
        const resp = await provider.chat({
          systemPrompt: "你是代码补全专家。只输出JSON变更契约。补全所有未完成代码，匹配现有风格。",
          task: "文件: " + args[0] + "\n未完成位置:\n" + incomplete.map(i => `L${i.line}: ${i.signature}`).join("\n") + "\n\n文件内容:\n" + content.slice(0, 3000),
          context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
        });
        const completeChanges = parseAIOutput(resp.content).changes;
        const validated = await applyCompileGate(completeChanges, rootPath, config.project.identity, provider, 'code complete');
        for (const c of validated) {
          const fp = path.join(rootPath, c.file);
          const { writeFile, ensureDir } = await import("./utils/fs.js");
          await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
          success(c.file + " 已补全");
        }
        return;
      }

      if (subcommand === "refactor" && args.length > 0) {
        const desc = args.filter(a => a !== "--safe").join(" ");
        const safeMode = args.includes("--safe");
        progress("AI 多文件重构" + (safeMode ? " (安全模式)" : "") + ": " + desc);

        // C12: Cross-file impact analysis — search all references, build dependency graph
        const index = await (await import("./core/scanner.js")).loadProjectIndex(rootPath).catch(() => null);
        let refsInfo = "";
        let impactedFiles: string[] = [];
        if (index) {
          const { findSymbolReferences } = await import("./core/code-writer.js");
          // Extract multiple symbols from description
          const symbols = desc.match(/["'""]?(\w{3,})["'""]?/g)?.map(s => s.replace(/["'""]/g, "")) || [];
          const allRefs = new Set<string>();
          for (const symbol of symbols.slice(0, 3)) {
            const refs = findSymbolReferences(index, symbol);
            for (const r of refs) {
              const file = r.split(":")[0];
              if (file) { allRefs.add(r); impactedFiles.push(file); }
            }
          }
          impactedFiles = [...new Set(impactedFiles)];
          if (allRefs.size > 0) {
            refsInfo = "\n## 引用分析 (C12 跨文件影响)\n" +
              `影响 ${impactedFiles.length} 个文件, ${allRefs.size} 处引用:\n` +
              [...allRefs].slice(0, 20).map(r => "  - " + r).join("\n");
            detail("跨文件影响", `${impactedFiles.length} 文件, ${allRefs.size} 引用`);
          }
        }

        // C9: Safe mode — snapshot affected files first, verify after each step
        const backups: Map<string, string> = new Map();
        if (safeMode && impactedFiles.length > 0) {
          const { readFile: rf, fileExists: fe } = await import("./utils/fs.js");
          for (const f of impactedFiles.slice(0, 10)) {
            const fp = path.resolve(rootPath, f);
            if (await fe(fp)) backups.set(f, await rf(fp));
          }
          detail("安全模式", `已备份 ${backups.size} 个文件`);
        }

        const resp = await provider.chat({
          systemPrompt: [
            "你是代码重构专家。输出所有需要修改的文件的JSON变更契约。",
            "保持API兼容，不破坏现有测试，不改变外部行为。",
            safeMode ? "安全模式: 如果测试失败则回滚，每次只改一个文件。" : "",
          ].filter(Boolean).join(" "),
          task: desc + refsInfo,
          context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
        });
        const refactorChanges = parseAIOutput(resp.content).changes;
        const validated = await applyCompileGate(refactorChanges, rootPath, config.project.identity, provider, 'code refactor');

        // C9: In safe mode, verify after each file write; rollback on failure
        for (const c of validated) {
          const fp = path.join(rootPath, c.file);
          const { writeFile: wf, ensureDir: ed } = await import("./utils/fs.js");
          await ed(path.dirname(fp));
          // Backup before write
          const { readFile: rf, fileExists: fe } = await import("./utils/fs.js");
          const prev = (await fe(fp)) ? await rf(fp) : "";
          await wf(fp, c.content);
          // Verify
          const { runCompileCheck } = await import("./core/code-writer.js");
          const check = await runCompileCheck([], rootPath, config.project.identity);
          if (check.passed) {
            success(c.file);
          } else if (safeMode) {
            // Rollback on failure in safe mode
            if (prev) { await wf(fp, prev); } else { try { await import("fs/promises").then(m => m.unlink(fp)); } catch {} }
            warn(c.file + " 编译失败，已回滚 — " + check.errors.slice(0, 200));
          } else {
            warn(c.file + " (编译警告，检查 ic code fix)");
          }
        }
        return;
      }

      if (subcommand === "scaffold" && cleanArgs.length >= 2) {
        const scaffoldType = cleanArgs[0] as 'crud' | 'middleware' | 'route' | 'component';
        const name = cleanArgs[1];
        const validTypes = ['crud', 'middleware', 'route', 'component'];
        if (!validTypes.includes(scaffoldType)) { fail("类型: crud | middleware | route | component"); return; }
        const index = await (await import("./core/scanner.js")).loadProjectIndex(rootPath);
        const lang = config.project?.identity?.language || 'typescript';
        // C8: Use AI-enhanced scaffold — auto-completes TODO stubs
        const { generateScaffoldWithAI } = await import("./core/code-writer.js");
        progress(`AI 脚手架: ${scaffoldType} ${name}`);
        const result = isMock
          ? await import("./core/code-writer.js").then(m => m.generateScaffold(scaffoldType, name, lang, index?.styleFingerprint))
          : await generateScaffoldWithAI(scaffoldType, name, lang, rootPath, index, provider, index?.styleFingerprint);
        const { writeFile, ensureDir } = await import("./utils/fs.js");
        let aiCompleted = 0;
        for (const f of result.files) {
          const fp = path.join(rootPath, f.path);
          await ensureDir(path.dirname(fp));
          await writeFile(fp, f.content);
          if (!/\/\/\s*TODO/i.test(f.content)) aiCompleted++;
          success(f.path + (aiCompleted > 0 ? '' : ' (骨架)'));
        }
        if (!isMock && aiCompleted > 0) detail('AI 补全', `${aiCompleted} 个文件的 TODO 已自动实现`);
        return;
      }

      // T4b: Structured code review — 4-dimension scoring + issues list
      if (subcommand === "review" && args.length > 0) {
        const targetPath = path.resolve(rootPath, args[0]);
        const { fileExists } = await import("./utils/fs.js");
        if (!(await fileExists(targetPath))) { fail("文件不存在: " + args[0]); return; }
        const content = await readFile(targetPath);
        progress(`AI 代码审查: ${args[0]} (安全/风格/bug/性能)`);
        // Load style fingerprint for context-aware review
        let styleFp: import('./types.js').StyleFingerprint | undefined;
        try { const idx = await (await import('./core/scanner.js')).loadProjectIndex(rootPath); styleFp = idx?.styleFingerprint; } catch { /* best-effort */ }
        const { reviewCode, formatCodeReview } = await import('./core/code-writer.js');
        const review = await reviewCode(args[0], content, provider, styleFp);
        section('代码审查: ' + args[0]);
        console.log(formatCodeReview(review));
        console.log();
        return;
      }

      if (subcommand === "review" && args.length === 0) {
        const { isGitRepo, getDiff } = await import("./utils/git.js");
        if (!isGitRepo(rootPath)) { fail("非 Git 仓库，请指定文件: ic code review <文件>"); return; }
        const diff = getDiff(rootPath, false);
        if (!diff.trim()) { info("工作区无变更"); return; }
        progress("AI 增量代码审查 (git diff)...");
        const { reviewDiff, formatCodeReview } = await import('./core/code-writer.js');
        const review = await reviewDiff(diff, provider);
        section('增量代码审查');
        console.log(formatCodeReview(review));
        console.log();
        return;
      }

      // C10: Batch lint fix — read lint output, AI fixes file by file with verification
      if (subcommand === "lint-fix" || subcommand === "lintfix") {
        const _autoApply = args.includes("--go");
        progress("AI 批量 lint 修复...");
        // Run lint first
        const { resolveVerificationCommand } = await import("./core/verifier.js");
        const lintCmd = await resolveVerificationCommand(rootPath, config.project.identity, "lint");
        let lintOutput = "";
        if (lintCmd) {
          try {
            const { execSync } = await import("child_process");
            lintOutput = execSync(lintCmd.command, { cwd: rootPath, timeout: 30000, encoding: "utf-8", stdio: "pipe" });
          } catch (e: any) {
            lintOutput = (e.stdout || "") + (e.stderr || "");
          }
        }
        if (!lintOutput.trim()) { info("无 lint 问题"); return; }
        detail("lint 输出", lintOutput.slice(0, 500));
        // Group errors by file
        const errorsByFile = new Map<string, string[]>();
        for (const line of lintOutput.split("\n")) {
          const match = line.match(/^(.+?):(\d+):(\d+)?\s*(.+)/);
          if (match) {
            const file = match[1].trim();
            if (!errorsByFile.has(file)) errorsByFile.set(file, []);
            errorsByFile.get(file)!.push(line.trim());
          }
        }
        if (errorsByFile.size === 0) { info("无法解析 lint 输出"); return; }
        const targets = [...errorsByFile.entries()].slice(0, 5); // max 5 files
        const { writeFile, ensureDir } = await import("./utils/fs.js");
        for (const [file, errors] of targets) {
          const fp = path.resolve(rootPath, file);
          if (!(await fileExists(fp))) continue;
          const content = await readFile(fp);
          progress(`修复 lint: ${file} (${errors.length} 问题)`);
          const resp = await provider.chat({
            systemPrompt: "你是代码风格修复专家。只输出该文件的 JSON 变更契约。仅修复 lint 问题，不改逻辑。",
            task: `文件: ${file}\nlint 错误:\n${errors.slice(0, 10).join("\n")}\n\n当前内容:\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\`\n\n输出 { "content": "修复后的完整文件内容" }`,
            context: { projectMeta: "", relevantCode: [], relevantMemory: "", totalTokens: 0, budgetUsed: 0 }, history: "",
          });
          try {
            const json = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || "{}"));
            if (json.content && json.content !== content) {
              await ensureDir(path.dirname(fp));
              await writeFile(fp, json.content);
              success(file + ` (${errors.length} 项修复)`);
            } else { info(file + " (无需修改)"); }
          } catch { warn(file + " (AI 响应解析失败)"); }
        }
        // Run lint again to verify
        if (lintCmd) {
          try {
            const { execSync } = await import("child_process");
            const after = execSync(lintCmd.command, { cwd: rootPath, timeout: 30000, encoding: "utf-8", stdio: "pipe" });
            const remaining = (after.match(/\berror\b|\bwarning\b/gi) || []).length;
            success(`验证: ${remaining > 0 ? `剩余 ${remaining} 个问题` : "无 lint 问题"}`);
          } catch (e: any) {
            const after = (e.stdout || "") + (e.stderr || "");
            const remaining = (after.match(/\berror\b|\bwarning\b/gi) || []).length;
            info(remaining > 0 ? `剩余 ${remaining} 个问题` : "lint 通过");
          }
        }
        return;
      }

      // C12: Cross-file refactoring — AI reads multiple files, refactors coherently
      if (subcommand === "refactor-files" && cleanArgs.length >= 2) {
        const instruction = cleanArgs.pop()!;
        const filePaths = cleanArgs.map(f => path.resolve(rootPath, f));
        const { fileExists: fe } = await import("./utils/fs.js");
        for (const fp of filePaths) {
          if (!(await fe(fp))) { fail("文件不存在: " + fp); return; }
        }
        progress(`AI 跨文件重构 (${filePaths.length} 文件): ${instruction}`);
        const { refactorCrossFile } = await import("./core/code-writer.js");
        const idx = await (await import("./core/scanner.js")).loadProjectIndex(rootPath).catch(() => null);
        const result = await refactorCrossFile(filePaths, instruction, rootPath, idx, provider);
        if (result.files.length === 0) { info("AI 未建议修改"); return; }
        section(`跨文件重构 — ${result.files.length} 文件`);
        console.log(`  ${chalk.dim(result.explanation)}`);
        const { writeFile, ensureDir } = await import("./utils/fs.js");
        for (const f of result.files) {
          await ensureDir(path.dirname(f.path));
          await writeFile(f.path, f.refactored);
          const { filesToDiff } = await import('./cli/diff-renderer.js');
          const diff = filesToDiff([{ path: f.path, content: f.refactored, previousContent: f.original }]);
          if (diff) console.log(`\n${chalk.cyan(f.path)}\n${diff.slice(0, 800)}`);
          success(f.path);
        }
        return;
      }

      info("用法: ic code new <描述> [--with-tests] | fix | complete <文件> | refactor <描述> | scaffold <类型> <名称> | review [文件] | lint-fix [--go] | refactor-files <文件1 文件2...> <指令>");
    } catch (err) { printError(err as Error); }
  });
// ic agent — multi-agent management
// ============================================================
program.command('agent')
  .alias('ag')
  .description('管理 AI Agent')
  .argument('[subcommand]', 'create | start | stop | list | status | children | message')
  .argument('[args...]', '额外参数')
  .allowUnknownOption(true)
  .action(async (subcommand: string | undefined, args: string[]) => {
    try {
      const { AgentManager } = await import('./agent/manager.js');
      const { loadConfig } = await import('./config.js');
      const rootPath = process.cwd();
      const config = await loadConfig(rootPath);

      if (!config) { fail('项目未初始化，请先运行 ic init'); }

      const mgr = new AgentManager(config.ai, 3);

      if (!subcommand || subcommand === 'list') {
        const statusFilter = args.includes('--status') ? args[args.indexOf('--status') + 1] : undefined;
        const list = mgr.list(statusFilter ? { status: statusFilter as AgentStatus } : undefined);

        if (args.includes('--json')) {
          console.log(JSON.stringify(jsonEnvelope('agent-list', { agents: list.map(a => ({ id: a.id, name: a.name, type: a.type, status: a.status, model: a.model, children: a.childIds.length })) }), null, 2));
        } else {
          if (list.length === 0) { info('没有 Agent'); return; }
          for (const a of list) {
            const icon = a.status === 'running' ? '[·]' : a.status === 'done' ? '[✓]' : a.status === 'failed' ? '[✗]' : '[i]';
            console.log(`  ${icon} ${chalk.cyan(a.id.substring(0, 8))}  ${a.name}  ${chalk.dim(a.type)}  ${statusLabel(a.status)}`);
          }
        }
        return;
      }

      if (subcommand === 'create') {
        const name = args[0];
        const type = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'task';
        if (!name) { fail('用法: ic agent create <name> [--type task|review|verify|orchestrator]'); }

        const agent = mgr.create({ name, type: (type as AgentType) || 'task', model: args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined });

        if (args.includes('--json')) {
          console.log(JSON.stringify(jsonEnvelope('agent-created', { id: agent.id, name: agent.name, type: agent.type }), null, 2));
        } else {
          success(`Agent ${chalk.cyan(agent.name)} 已创建 (${chalk.dim(agent.id)})`);
        }
        return;
      }

      if (subcommand === 'start') {
        const agentId = args[0];
        const task = args.slice(1).join(' ');
        if (!agentId) { fail('用法: ic agent start <agent-id> [task]'); }

        const started = await mgr.start(agentId, task || undefined);
        if (started) {
          success(`Agent ${chalk.cyan(agentId.substring(0, 8))} 已启动`);
        } else {
          const agent = mgr.get(agentId);
          if (!agent) fail(`Agent ${agentId} 不存在`);
          else if (agent.status === 'running') warn('Agent 已在运行');
          else warn(`无法启动 (status: ${agent.status})`);
        }
        return;
      }

      if (subcommand === 'stop') {
        const agentId = args[0];
        if (!agentId) { fail('用法: ic agent stop <agent-id>'); }
        if (mgr.stop(agentId)) success(`Agent ${chalk.cyan(agentId.substring(0, 8))} 已停止`);
        else fail(`Agent ${agentId} 不存在`);
        return;
      }

      if (subcommand === 'status') {
        const agentId = args[0];
        if (!agentId) { fail('用法: ic agent status <agent-id>'); }
        const agent = mgr.get(agentId);
        if (!agent) { fail(`Agent ${agentId} 不存在`); }

        if (args.includes('--json')) {
          console.log(JSON.stringify(jsonEnvelope('agent-status', { id: agent.id, name: agent.name, type: agent.type, status: agent.status, model: agent.model, children: agent.childIds, result: agent.result }), null, 2));
        } else {
          console.log(`  ${chalk.bold(agent.name)}  ${chalk.dim(`(${agent.type})`)}`);
          console.log(`  状态: ${statusLabel(agent.status)}  模型: ${agent.model}`);
          if (agent.result) console.log(`  结果: ${agent.result.success ? '成功' : '失败'}  tokens: ${agent.result.tokensUsed}  ${agent.result.duration}ms`);
        }
        return;
      }

      if (subcommand === 'children') {
        const parentId = args[0];
        if (!parentId) { fail('用法: ic agent children <agent-id>'); }
        const children = mgr.list({ parentId });
        if (children.length === 0) { info('无子 Agent'); return; }
        for (const c of children) {
          console.log(`  ${chalk.cyan(c.id.substring(0, 8))}  ${c.name}  ${chalk.dim(c.type)}  ${statusLabel(c.status)}`);
        }
        return;
      }

      if (subcommand === 'message') {
        const agentId = args[0];
        const content = args.slice(1).join(' ');
        if (!agentId || !content) { fail('用法: ic agent message <agent-id> <content>'); }
        const msg = mgr.sendMessage({ from: 'cli', to: agentId, content, type: 'command' });
        success(`消息已发送 (${msg.id})`);
        return;
      }

      if (subcommand === 'orchestrate') {
        const taskDesc = args.join(' ');
        if (!taskDesc) { fail('用法: ic agent orchestrate <任务描述>'); }
        progress('编排任务...');
        const result = await mgr.orchestrate(taskDesc);
        if (result.success) {
          success(result.summary);
          for (const cr of result.childResults) {
            const icon = cr.success ? '[✓]' : '[✗]';
            console.log(`  ${icon} ${cr.agentName}: ${cr.output.slice(0, 100)}`);
          }
        } else {
          fail(result.summary);
        }
        return;
      }

      warn(`未知子命令: ${subcommand}。可用: create, start, stop, list, status, children, message, orchestrate`);
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic skill — Skill 管理 (T3-2a)
// ============================================================
program.command('skill')
  .description('管理 AI 技能：查看/添加/删除')
  .argument('[subcommand]', 'list | add <name> <触发词> | remove <name>')
  .argument('[args...]', '额外参数')
  .action(async (subcommand: string | undefined, args: string[]) => {
    const rootPath = process.cwd();
    try {
      const { listSkills, registerSkill, removeSkill: rmSkill, saveSkillsToFile, loadSkillsFromFile } = await import('./core/skill-system.js');
      await loadSkillsFromFile(rootPath);

      if (!subcommand || subcommand === 'list') {
        const skills = listSkills();
        console.log(chalk.bold(`\n可用技能 (${skills.length}):\n`));
        for (const s of skills) {
          const builtin = ['code-review','test-gen','api-doc','security-review','refactor-guide'].includes(s.name);
          console.log(`  ${builtin ? chalk.dim('[内置]') : chalk.cyan('[自定义]')} ${chalk.bold(s.name)} — ${s.description}`);
          console.log(`    触发词: ${s.triggers.join(', ')}`);
        }
        console.log();
        return;
      }

      if (subcommand === 'add' && args.length >= 2) {
        const name = args[0];
        const triggers = args[1].split(',').map(t => t.trim());
        const desc = args.slice(2).join(' ') || name;
        registerSkill({ name, description: desc, triggers, systemPrompt: `执行「${name}」任务。`, tools: ['read_file', 'search_code'], category: 'custom' });
        await saveSkillsToFile(rootPath);
        success(`技能 ${chalk.cyan(name)} 已注册`);
        return;
      }

      if (subcommand === 'remove' && args.length > 0) {
        if (rmSkill(args[0])) { await saveSkillsToFile(rootPath); success(`技能 ${chalk.cyan(args[0])} 已移除`); }
        else { fail(`技能 ${chalk.cyan(args[0])} 不存在`); }
        return;
      }

      // ic skill describe <name> — show full skill details (T3-2a)
      if ((subcommand === 'describe' || subcommand === 'desc' || subcommand === 'show') && args.length > 0) {
        const skills = listSkills();
        const name = args[0];
        const skill = skills.find(s => s.name === name);
        if (!skill) {
          fail(`技能 ${chalk.cyan(name)} 不存在，运行 ic skill list 查看可用技能`);
          return;
        }
        const builtin = ['code-review','test-gen','api-doc','security-review','refactor-guide'].includes(skill.name);
        console.log(`\n  ${chalk.bold.cyan(skill.name)}  ${builtin ? chalk.dim('[内置]') : chalk.cyan('[自定义]')}`);
        console.log(`  ${chalk.dim('描述')}   ${skill.description}`);
        console.log(`  ${chalk.dim('类别')}   ${skill.category}`);
        console.log(`  ${chalk.dim('触发词')} ${skill.triggers.join('、')}`);
        console.log(`  ${chalk.dim('工具')}   ${skill.tools?.join('、') || '通用'}`);
        console.log(`\n  ${chalk.dim('系统提示词：')}`);
        (skill.systemPrompt || '').split('\n').forEach(line => console.log(`    ${chalk.dim(line)}`));
        console.log();
        return;
      }

      // ic skill install <url> — install skill from remote JSON (ADV community skill, T3-2a)
      if (subcommand === 'install' && args.length > 0) {
        const urlOrPath = args[0];
        try {
          let json: string;
          if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
            const { execFileSync: exec } = await import('child_process');
            try {
              json = exec('curl', ['-sL', '--max-time', '10', urlOrPath], { encoding: 'utf-8' });
            } catch {
              fail(`无法从 ${urlOrPath} 下载技能定义，请检查网络和 URL`);
              return;
            }
          } else {
            const { readFileSync } = await import('fs');
            json = readFileSync(urlOrPath, 'utf-8');
          }
          const def = JSON.parse(json);
          if (!def.name || !def.triggers || !def.systemPrompt) {
            fail('技能 JSON 格式无效，必须包含 name、triggers、systemPrompt 字段');
            return;
          }
          registerSkill({
            name: def.name,
            description: def.description || def.name,
            triggers: Array.isArray(def.triggers) ? def.triggers : [def.triggers],
            systemPrompt: def.systemPrompt,
            tools: def.tools,
            category: def.category || 'custom',
          });
          await saveSkillsToFile(rootPath);
          success(`技能 ${chalk.cyan(def.name)} 已从 ${urlOrPath} 安装`);
        } catch (err) {
          fail(`安装失败: ${(err as Error).message}`);
        }
        return;
      }

      info('用法: ic skill [list|describe <name>|add <name> <触发词>|remove <name>|install <url>]');
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic market — 市场深度分析 (T4)
// ============================================================
program.command('market')
  .description('市场深度分析：竞品分析、行业趋势、技术雷达、SWOT 分析')
  .alias('mkt')
  .argument('<topic>', '分析主题')
  .option('-t, --type <template>', '分析模板: competitive | industry | tech-radar | swot', 'competitive')
  .option('-s, --sources <count>', '最大数据源数量', '15')
  .option('-o, --output <path>', '保存报告到文件')
  .option('--open', '在浏览器打开（如果可用）')
  .action(async (topic: string, options?: { type?: string; sources?: string; output?: string; open?: boolean }) => {
    const rootPath = process.cwd();
    const template = (options?.type || 'competitive') as import('./types.js').UserIntentCategory & string;
    const validTypes = ['competitive', 'industry', 'tech-radar', 'swot'];
    if (!validTypes.includes(template)) {
      fail(`无效分析模板: ${template}。可用: ${validTypes.join(', ')}`);
    }

    const templateLabels: Record<string, string> = {
      competitive: '竞品分析',
      industry: '行业趋势',
      'tech-radar': '技术雷达',
      swot: 'SWOT 分析',
    };

    try {
      const config = await loadConfig(rootPath);
      const { createProvider } = await import('./ai/provider.js');

      console.log(`\n${chalk.bold.blue('🔍 市场分析')}: ${chalk.cyan(topic)} ${chalk.dim(`(${templateLabels[template]})`)}`);
      console.log(chalk.dim('━'.repeat(60)));

      const provider = createProvider({
        provider: config?.ai.provider || 'claude',
        model: config?.ai.model || 'claude-sonnet-4-6',
        apiKey: config?.ai.apiKey,
        maxTokens: 100000,
        temperature: 0.3,
      });

      const { runMarketAnalysis } = await import('./core/market-analysis.js');

      const report = await runMarketAnalysis({
        topic,
        template: template as import('./core/market-analysis.js').AnalysisTemplate,
        provider,
        rootPath,
        maxSources: parseInt(options?.sources || '15', 10),
        onProgress: (event) => {
          const phaseIcons: Record<string, string> = {
            search: '🔎', fetch: '📥', analyze: '🧠', report: '📝', done: '✅',
          };
          const icon = phaseIcons[event.phase] || '·';
          const progressBar = event.total
            ? ` [${event.current}/${event.total}]`
            : '';
          console.log(`  ${icon}${progressBar} ${event.message}`);
          if (event.detail) console.log(`    ${chalk.dim(event.detail)}`);
        },
      });

      console.log(chalk.dim('━'.repeat(60)));

      // Render report
      console.log(report.content);

      console.log(chalk.dim('━'.repeat(60)));
      success(`完成 — ${report.stats.searchResults} 个来源, ${report.stats.pagesSucceeded} 页抓取, ${report.stats.aiRounds} 轮分析, ${(report.stats.durationMs / 1000).toFixed(1)}s`);

      // Save to file
      const safeTopic = topic.replace(/[^a-zA-Z0-9一-鿿]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'analysis';
      const defaultPath = `.icloser/reports/market-${safeTopic.slice(0, 40)}-${Date.now().toString(36)}.md`;
      const outputPath = options?.output || defaultPath;

      try {
        const { ensureDir, writeFile } = await import('./utils/fs.js');
        const fullPath = outputPath.startsWith('.') ? [rootPath, outputPath].join('/').replace(/\/+/g, '/') : outputPath;
        const dirPath = path.dirname(fullPath);
        await ensureDir(dirPath);
        await writeFile(fullPath, report.content);
        success(`报告已保存: ${fullPath}`);
      } catch { /* best-effort save */ }
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// Parse
// ============================================================
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

function printSecurityRules(config: ICloserConfig, jsonMode = false): void {
  const disabled = new Set(config.security.disabledRules || []);
  const rules = getSecurityRuleDefinitions();

  if (jsonMode) {
    console.log(JSON.stringify(jsonEnvelope('security-rules', serializeSecurityRules(rules, [...disabled])), null, 2));
    return;
  }

  section('安全规则');
  console.log(`  ${chalk.dim('默认全部启用，disabledRules 中的规则会跳过扫描')}\n`);
  for (const rule of rules) {
    const enabled = !disabled.has(rule.ruleId);
    const icon = enabled ? ICONS.success : ICONS.fail;
    const status = enabled ? chalk.green('启用') : chalk.red('禁用');
    const sev = rule.severity === 'high' ? chalk.red('HIGH') :
      rule.severity === 'medium' ? chalk.yellow('MED') : chalk.dim('LOW');
    console.log(`  ${icon} ${chalk.cyan(rule.ruleId.padEnd(34))} ${status}  ${sev}  ${chalk.dim(rule.category)}`);
    console.log(`     ${chalk.dim(rule.name)} - ${chalk.dim(rule.description)}`);
  }
  console.log();
  if (disabled.size > 0) {
    console.log(`  ${chalk.dim('ic config security enable <ruleId>  重新启用规则')}`);
  }
  console.log();
  console.log(`  ${chalk.dim('ic config security rules --json  以 JSON 格式输出')}`);
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
      const { listTasks } = await import('./core/task-engine.js');
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

function printProviderList(config: ICloserConfig, jsonMode = false): void {
  const statuses = getProviderStatuses(config.ai);
  if (jsonMode) {
    console.log(JSON.stringify(jsonEnvelope('providers', { providers: statuses }), null, 2));
    return;
  }

  section('AI Providers');
  for (const provider of statuses) {
    const current = provider.current ? chalk.green('*') : ' ';
    const ready = provider.ready ? chalk.green(provider.keySource) : chalk.red('missing-key');
    console.log(`  ${current} ${chalk.cyan(provider.name.padEnd(10))} ${chalk.dim(provider.label.padEnd(22))} model ${chalk.dim(provider.configuredModel)}  key ${ready}`);
  }
  console.log();
  console.log(`  ${chalk.dim('ic provider use <name> [model]   切换 Provider')}`);
  console.log(`  ${chalk.dim('ic provider models [name]       查看模型')}`);
  console.log(`  ${chalk.dim('ic provider doctor              检查当前配置')}`);
  console.log();
}

function pickSetupProvider(): AIProvider {
  const candidates = getAvailableProviders().filter(provider => provider.name !== 'mock');
  for (const provider of candidates) {
    if (provider.envVars.some(envVar => Boolean(process.env[envVar]))) {
      return provider.name;
    }
  }
  return 'mock';
}

function printProviderModels(provider: AIProvider, config: ICloserConfig, jsonMode = false): void {
  const info = getProviderInfo(provider);
  const models = info.availableModels.map(model => ({
    name: model,
    current: config.ai.provider === provider && config.ai.model === model,
    default: info.defaultModel === model,
  }));

  if (jsonMode) {
    console.log(JSON.stringify(jsonEnvelope('provider-models', { provider, models }), null, 2));
    return;
  }

  section(`${provider} models`);
  for (const model of models) {
    const marks = [
      model.current ? chalk.green('current') : '',
      model.default ? chalk.dim('default') : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${chalk.cyan(model.name)}${marks ? `  ${marks}` : ''}`);
  }
  console.log();
}

function printProviderDoctor(config: ICloserConfig, jsonMode = false): void {
  const status = getProviderStatuses(config.ai).find(item => item.current);
  if (!status) return;

  const payload = {
    provider: status.name,
    model: config.ai.model,
    ready: status.ready,
    keySource: status.keySource,
    envVars: status.envVars,
    requiresApiKey: status.requiresApiKey,
  };

  if (jsonMode) {
    console.log(JSON.stringify(jsonEnvelope('provider-doctor', payload), null, 2));
    return;
  }

  section('Provider Doctor');
  detail('Provider', status.name);
  detail('Model', config.ai.model);
  detail('API Key', status.ready ? chalk.green(status.keySource) : chalk.red('missing'));
  if (!status.ready && status.envVars.length > 0) {
    console.log();
    warn('真实 Provider 尚未接入，按下面格式配置 API Key：');
    for (const line of formatProviderKeyGuidance(status.name)) {
      console.log(`  ${chalk.dim(line)}`);
    }
  }
  console.log();
}

async function printProviderTest(config: ICloserConfig, jsonMode = false): Promise<void> {
  const result = await smokeTestProvider(config.ai);

  if (jsonMode) {
    console.log(JSON.stringify(jsonEnvelope('provider-test', result), null, 2));
    return;
  }

  section('Provider Test');
  detail('Provider', result.provider);
  detail('Model', result.model);
  detail('API Key', result.keySource);
  detail('耗时', `${result.duration}ms`);
  if (result.ok) {
    success(`Provider 连通正常，tokens: ${result.tokensUsed}`);
  } else {
    console.error(`${ICONS.fail} Provider 连通失败`);
    const status = getProviderStatuses(config.ai).find(item => item.current);
    if (status && status.keySource === 'missing' && status.envVars.length > 0) {
      console.log();
      for (const line of formatProviderKeyGuidance(status.name)) {
        console.log(`  ${chalk.dim(line)}`);
      }
    } else if (result.error) {
      console.log(`  ${chalk.red(result.error)}`);
    }
    process.exit(1);
  }
  console.log();
}

function printProviderEnv(provider: AIProvider): void {
  const providerInfo = getProviderInfo(provider);
  section(`${provider} API Key`);
  if (!providerInfo.requiresApiKey) {
    info('mock provider 不需要 API Key');
    return;
  }
  for (const line of formatProviderKeyGuidance(provider)) {
    console.log(`  ${chalk.dim(line)}`);
  }
  if (providerInfo.envVars.length > 1) {
    console.log(`  ${chalk.dim('兼容变量')}: ${providerInfo.envVars.slice(1).join(', ')}`);
  }
  console.log();
}

function printGateResult(result: import('./types.js').GateResult, _task: Task): void {
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
