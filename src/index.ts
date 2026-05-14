#!/usr/bin/env node
// iCloser Agent Shell — CLI Entry Point

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { detectProject } from './utils/detect.js';
import { loadConfig, saveConfig, defaultConfig, setAIProvider, saveGlobalConfig } from './config.js';
import { fileExists, readFile } from './utils/fs.js';
import { isGitRepo, getDiff } from './utils/git.js';
import { formatGateSummary } from './cli/format.js';
import { jsonEnvelope, serializeConfig, serializeGateResult, serializeSecurityRules, serializeTask, serializeTaskList } from './cli/json.js';
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
import type { AgentStatus, AgentType, AIProvider, ICloserConfig, MemoryCandidate, ProjectMemory, Task, VerifyStage } from './types.js';

const program = new Command();
program.name('ic').description('iCloser Agent Shell — AI 工程执行 CLI').version('0.1.0');

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
          } else {
            warn('Provider 尚不可用：' + (smoke.error || '连接失败'));
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
      progress('正在分析项目...');
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
        const result = await scanProject({ rootPath, deep: true, includeTests: true, maxFileSize: 500 * 1024 });
        info(`索引完成：${result.fileCount} 文件，${result.moduleCount} 模块，${result.apiCount} 接口`);
        await saveProjectIndex(rootPath, result.index);
      } catch { /* best effort */ }

      // Init memory
      try {
        const { loadProjectMemory, saveProjectMemory } = await import('./core/memory.js');
        await saveProjectMemory(rootPath, await loadProjectMemory(rootPath));
      } catch { /* best effort */ }

      success('项目初始化完成\n');
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
  .action(async (mode: string, options?: { json?: boolean; go?: boolean; yes?: boolean; module?: string }) => {
    const rootPath = process.cwd();
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

      const description = descriptions.join(' ');
      progress(`解析任务：${chalk.cyan(description)}`);

      const { createTask, generatePlan, persistTask } =
        await import('./core/task-engine.js');
      const { recordUserInputEvent } = await import('./core/memory.js');

      // Create task
      const task = createTask(description, { priority: options.priority as 'high' | 'normal' | 'low' });
      await recordUserInputEvent(rootPath, description, { kind: 'task-description', taskId: task.id });
      const { appendAuditEvent: auditTaskCreated } = await import('./core/audit.js');
      await auditTaskCreated(rootPath, 'user', 'task-created', task.id, 'success', { taskId: task.id, payload: { description: description.substring(0, 100) } });
      progress(`任务 ${chalk.cyan(task.id)} 已创建`);

      // Load or build index (use loadProjectIndex to properly deserialize Map fields)
      let index: import('./types.js').ProjectIndex | null = null;
      try {
        const { loadProjectIndex } = await import('./core/scanner.js');
        index = await loadProjectIndex(rootPath);
      } catch {}
      if (!index) {
        try {
          const { scanProject, saveProjectIndex } = await import('./core/scanner.js');
          const r = await scanProject({ rootPath, deep: true, includeTests: false, maxFileSize: 500 * 1024 });
          index = r.index;
          await saveProjectIndex(rootPath, index);
        } catch {}
      }

      // Generate plan
      progress('生成修改方案...');
      if (index) {
        task.plan = generatePlan(task, description, config.project.identity, index);
      }

      // Preview mode
      if (!options.go && config.execution.defaultMode === 'preview') {
        printTaskPlan(task);
        await persistTask(rootPath, task);
        console.log();
        info(`使用 ${chalk.cyan(`ic y ${task.id}`)} 确认执行，${chalk.cyan(`ic n ${task.id}`)} 取消`);
        return;
      }

      // Execute mode
      await executeTask(task, config, rootPath, index);
    } catch (err) { printError(err as Error); }
  });

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
      const { listTasks, loadTask } = await import('./core/task-engine.js');
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
// ic d — diff
// ============================================================
program.command('d')
  .alias('diff')
  .description('查看代码 diff')
  .argument('[task-id]', '任务 ID（不指定则显示工作区 diff）')
  .action(async (taskId?: string) => {
    const rootPath = process.cwd();
    try {
      const { parseDiff, renderDiff } = await import('./cli/diff-renderer.js');
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
// ic y / ic n — Accept / Reject
// ============================================================
program.command('y')
  .alias('accept')
  .description('确认并执行任务')
  .argument('<task-id>', '任务 ID')
  .action(async (taskId: string) => {
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

      let index: import('./types.js').ProjectIndex | null = null;
      try {
        const { loadProjectIndex } = await import('./core/scanner.js');
        index = await loadProjectIndex(rootPath);
      } catch {}
      await executeTask(task, config, rootPath, index);
    } catch (err) { printError(err as Error); }
  });

program.command('n')
  .alias('reject')
  .description('拒绝并取消任务')
  .argument('<task-id>', '任务 ID')
  .action(async (taskId: string) => {
    const rootPath = process.cwd();
    try {
      const { loadTask, updateTaskStatus, releaseFileLocks, persistTask } =
        await import('./core/task-engine.js');
      const task = await loadTask(rootPath, taskId);
      if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }

      if (task.changes.length > 0 && isGitRepo(rootPath)) {
        try {
          const { execSync } = await import('child_process');
          execSync('git checkout -- .', { cwd: rootPath, timeout: 10000 });
          info('已回滚工作区变更');
        } catch {}
      }
      updateTaskStatus(taskId, 'cancelled');
      releaseFileLocks(task);
      await persistTask(rootPath, task);
      warn(`任务 ${chalk.cyan(taskId)} 已取消`);
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
      } catch {}

      if (options.json) {
        console.log(JSON.stringify(jsonEnvelope('gate-result', serializeGateResult(result)), null, 2));
      } else {
        printGateResult(result, task);
      }
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic log / ic r — real task history & report
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
          const { loadTask } = await import('./core/task-engine.js');
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
        const { listTasks } = await import('./core/task-engine.js');
        const tasks = await listTasks(rootPath);
        if (tasks.length === 0) { info('暂无历史任务'); return; }
        printTaskList(tasks);
      }
    } catch (err) { printError(err as Error); }
  });

program.command('r')
  .alias('report')
  .description('查看最近一次任务报告')
  .option('--regenerate', '强制重新生成报告')
  .option('--json', 'JSON 格式输出任务数据')
  .action(async (options) => {
    const rootPath = process.cwd();
    const { jsonEnvelope } = await import('./cli/json.js');
    try {
      const { listTasks } = await import('./core/task-engine.js');
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

      if (options.regenerate || !hasReport) {
        // Regenerate report
        const config = await loadConfig(rootPath);
        if (config) {
          progress('重新生成报告...');
          const { generateTaskReport, generateReasoningFile } = await import('./report/generator.js');
          await generateTaskReport(rootPath, latest, config);
          await generateReasoningFile(rootPath, latest);
          success(`报告已生成: ${chalk.cyan(reportPath)}`);
        }
      }

      if (await fileExists(reportPath)) {
        console.log(await readFile(reportPath));
      } else {
        warn('报告文件不存在，使用 --regenerate 重新生成');
      }
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic mem — real memory
// ============================================================
program.command('mem')
  .alias('memory')
  .description('查看和管理项目记忆')
  .argument('[args...]', 'events / candidates / review / approve <序号|id> / reject <序号|id> / global / 搜索关键词')
  .action(async (args: string[] = []) => {
    const rootPath = process.cwd();
    try {
      const [verb, ...rest] = args;
      const query = args.join(' ').trim();
      if (!verb || verb === 'help') {
        console.log(`\n${chalk.bold('ic mem — 项目记忆管理')}\n`);
        console.log(`  ${chalk.cyan('ic mem')}                      查看记忆摘要`);
        console.log(`  ${chalk.cyan('ic mem events')}              查看用户输入事件`);
        console.log(`  ${chalk.cyan('ic mem candidates')}          查看记忆候选`);
        console.log(`  ${chalk.cyan('ic mem review')}              待确认记忆审查`);
        console.log(`  ${chalk.cyan('ic mem approve <序号|id>')}    批准记忆候选`);
        console.log(`  ${chalk.cyan('ic mem reject <序号|id>')}     拒绝记忆候选`);
        console.log(`  ${chalk.cyan('ic mem global')}              查看全局记忆`);
        console.log(`  ${chalk.cyan('ic mem <关键词>')}             搜索记忆\n`);
        return;
      }
      if (verb === 'events') {
        await printMemoryEvents(rootPath);
      } else if (verb === 'candidates') {
        await printMemoryCandidates(rootPath);
      } else if (verb === 'review') {
        await printMemoryReview(rootPath);
      } else if (verb === 'approve' || verb === 'accept') {
        await updateMemoryCandidateReview(rootPath, rest.join(' ').trim(), 'approved');
      } else if (verb === 'reject' || verb === 'archive') {
        await updateMemoryCandidateReview(rootPath, rest.join(' ').trim(), 'archived');
      } else if (verb === 'global') {
        const { loadGlobalMemory } = await import('./core/memory.js');
        const gm = await loadGlobalMemory();
        section('全局记忆');
        detail('技术栈', `${gm.techStacks.size} 个`);
        detail('模式', `${gm.patterns.size} 个`);
        detail('踩坑', `${gm.pitfalls.length} 条`);
        detail('Skill 历史', `${gm.skillHistory.length} 条`);
        detail('偏好 AI', gm.preferences.preferredAI);
        detail('并发数', `${gm.preferences.maxParallelTasks}`);
      } else if (query) {
        const { loadProjectMemory, searchMemory } = await import('./core/memory.js');
        const memory = await loadProjectMemory(rootPath);
        const results = await searchMemory(memory, query);
        if (results.length === 0) {
          info(`未找到匹配 "${chalk.cyan(query)}" 的记忆`);
        } else {
          section(`搜索结果 (${results.length} 条)`);
          for (const r of results.slice(0, 10)) {
            if ('decision' in r) console.log(`  ${chalk.cyan('[决策]')} ${(r as import('./types.js').DecisionRecord).decision.substring(0, 80)}`);
            else if ('scope' in r) console.log(`  ${chalk.cyan('[约束]')} ${(r as import('./types.js').ArchitectureRule).description}`);
            else if ('content' in r) console.log(`  ${chalk.cyan('[反馈]')} ${(r as import('./types.js').FeedbackRecord).content.substring(0, 80)}`);
            else if ('taskId' in r) console.log(`  ${chalk.cyan('[任务]')} ${(r as import('./types.js').TaskRecord).summary.substring(0, 80)}`);
          }
        }
      } else {
        const { loadProjectMemory } = await import('./core/memory.js');
        const config = await loadConfig(rootPath);
        const memory = await loadProjectMemory(rootPath);
        section('项目记忆');
        if (config) {
          detail('项目', config.project.name);
          detail('语言', config.project.identity.language);
          detail('框架', config.project.identity.framework || '无');
        }
        detail('任务记录', `${memory.taskHistory.length} 条`);
        detail('架构约束', `${memory.rules.length} 条`);
        detail('决策记录', `${memory.decisions.length} 条`);
        detail('用户反馈', `${memory.feedbacks.length} 条`);
      }
      console.log();
    } catch (err) { printError(err as Error); }
  });

async function printMemoryEvents(rootPath: string): Promise<void> {
  const { loadUserInputEvents } = await import('./core/memory.js');
  const events = await loadUserInputEvents(rootPath);
  if (events.length === 0) {
    info('暂无用户输入事件。运行 ic init 和 ic t 后会开始记录。');
    return;
  }
  section(`用户输入事件 (最近 ${Math.min(events.length, 10)} 条)`);
  const recent = events.slice(-10).reverse();
  for (const e of recent) {
    const kindLabel = e.kind === 'task-description' ? '任务' :
      e.kind === 'rule' ? '约束' :
      e.kind === 'slash-command' ? '命令' :
      e.kind === 'api-key' ? 'API Key' :
      e.kind === 'chat' ? '对话' :
      e.kind === 'approval' ? '审批' :
      e.kind === 'rejection' ? '拒绝' :
      e.kind === 'correction' ? '修正' : '其他';
    const icon = e.redacted ? chalk.yellow('▸') : chalk.green('▸');
    const created = e.createdAt.substring(0, 19).replace('T', ' ');
    const preview = e.content.length > 80 ? e.content.substring(0, 80) + '...' : e.content;
    const flags = [
      e.redacted ? chalk.yellow('已脱敏') : '',
      e.taskId ? chalk.dim(`task:${e.taskId.substring(0, 10)}`) : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${icon} ${chalk.dim(`[${created}]`)} ${chalk.cyan(`[${kindLabel}]`)} ${preview}`);
    if (flags) console.log(`    ${chalk.dim(flags)}`);
  }
}

async function printMemoryReview(rootPath: string): Promise<void> {
  const { loadProjectMemory } = await import('./core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const pending = getPendingMemoryCandidates(memory);
  if (pending.length === 0) {
    success('没有需要你确认的记忆。系统会继续自动整理低风险内容。');
    return;
  }

  section(`需要确认的记忆 (${pending.length} 条)`);
  for (const [index, candidate] of pending.slice(0, 5).entries()) {
    const n = index + 1;
    const riskLabel = candidate.riskLevel === 'high' ? chalk.red('高风险') :
      candidate.riskLevel === 'medium' ? chalk.yellow('中风险') :
      chalk.green('低风险');
    console.log(`  ${chalk.cyan(`[${n}]`)} ${candidate.summary}`);
    console.log(`      ${riskLabel} ${chalk.dim('|')} ${candidate.reason}`);
  }
  console.log();
  console.log(`  ${chalk.green('[1]')} 保存第 1 条到项目记忆`);
  console.log(`      ${chalk.cyan('ic mem approve 1')}`);
  console.log(`  ${chalk.yellow('[2]')} 暂不保存第 1 条`);
  console.log(`      ${chalk.cyan('ic mem reject 1')}`);
  console.log(`  ${chalk.dim('[3]')} 以后再说`);
  console.log();
}

async function updateMemoryCandidateReview(
  rootPath: string,
  selector: string,
  status: 'approved' | 'archived'
): Promise<void> {
  if (!selector) {
    warn(`请告诉我要处理第几条，例如：${chalk.cyan(`ic mem ${status === 'approved' ? 'approve' : 'reject'} 1`)}`);
    return;
  }

  const { loadProjectMemory, saveProjectMemory } = await import('./core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const match = resolveMemoryCandidate(memory, selector);
  if (!match) {
    warn(`没有找到待确认记忆：${chalk.cyan(selector)}。先运行 ${chalk.cyan('ic mem review')} 查看序号。`);
    return;
  }

  const now = new Date().toISOString();
  match.reviewStatus = status;
  match.updatedAt = now;
  match.metadata.reviewStatus = status;
  match.metadata.updatedAt = now;
  await saveProjectMemory(rootPath, memory);

  if (status === 'approved') {
    success(`已保存到项目记忆：${match.summary}`);
  } else {
    warn(`已暂不保存：${match.summary}`);
  }
}

function getPendingMemoryCandidates(memory: ProjectMemory): MemoryCandidate[] {
  return (memory.memoryCandidates || []).filter(candidate => candidate.reviewStatus === 'proposed');
}

function resolveMemoryCandidate(memory: ProjectMemory, selector: string): MemoryCandidate | null {
  const pending = getPendingMemoryCandidates(memory);
  const asNumber = Number(selector);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= pending.length) {
    return pending[asNumber - 1];
  }
  return pending.find(candidate => candidate.id === selector || candidate.id.startsWith(selector)) || null;
}

async function printMemoryCandidates(rootPath: string): Promise<void> {
  const { loadProjectMemory } = await import('./core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const candidates = memory.memoryCandidates || [];
  if (candidates.length === 0) {
    info('暂无自动整理的记忆。你直接使用任务和规则命令后，系统会自动归纳。');
    return;
  }

  const approved = candidates.filter(c => c.reviewStatus === 'approved').length;
  const proposed = candidates.filter(c => c.reviewStatus === 'proposed').length;
  const archived = candidates.filter(c => c.reviewStatus === 'archived').length;
  section('记忆处理');
  detail('自动保存', `${approved} 条`);
  detail('待确认', `${proposed} 条`);
  detail('已归档', `${archived} 条`);
  console.log();

  const recent = candidates.slice(-10).reverse();
  for (const c of recent) {
    const statusLabel = c.reviewStatus === 'approved' ? chalk.green('已自动保存') :
      c.reviewStatus === 'proposed' ? chalk.yellow(c.suggestedAction === 'ask-now' ? '需要确认' : '待确认') :
      c.reviewStatus === 'archived' ? chalk.dim('已归档') :
      chalk.dim('草稿');
    const riskLabel = c.riskLevel === 'high' ? chalk.red('高风险') :
      c.riskLevel === 'medium' ? chalk.yellow('中风险') :
      chalk.green('低风险');
    const kindLabel = c.kind === 'preference' ? '偏好' :
      c.kind === 'rule' ? '规则' :
      c.kind === 'template' ? '模板' :
      c.kind === 'fact' ? '事实' :
      c.kind === 'sensitive' ? '敏感输入' : '其他';
    const created = c.createdAt.substring(0, 19).replace('T', ' ');
    console.log(`  ${chalk.cyan(`[${kindLabel}]`)} ${c.summary}`);
    console.log(`    ${statusLabel} ${chalk.dim('|')} ${riskLabel} ${chalk.dim('|')} ${chalk.dim(created)}`);
    if (c.reason) console.log(`    ${chalk.dim(c.reason)}`);
  }
}

// ============================================================
// ============================================================
// ic overview — project health dashboard
// ============================================================
program.command('overview')
  .alias('info')
  .description('项目健康总览：初始化状态、Provider、任务、Agent、工具能力')
  .option('--json', 'JSON 格式输出')
  .action(async (options?: { json?: boolean }) => {
    const rootPath = process.cwd();
    try {
      const { loadConfig } = await import('./config.js');
      const { loadProjectIndex } = await import('./core/scanner.js');
      const { listTasks } = await import('./core/task-engine.js');
      const { getProviderStatus } = await import('./ai/provider.js');
      const { buildToolCapabilitySnapshot } = await import('./core/tool-registry.js');

      const config = await loadConfig(rootPath);
      const index = await loadProjectIndex(rootPath);
      const tasks = await listTasks(rootPath);
      const providerStatus = getProviderStatus(config?.ai || { provider: 'mock', model: 'mock-offline', maxTokens: 100000, temperature: 0.3 });
      const toolSnapshot = buildToolCapabilitySnapshot();

      const completed = tasks.filter(t => t.status === 'completed').length;
      const failed = tasks.filter(t => t.status === 'failed').length;
      const running = tasks.filter(t => t.status === 'running').length;
      const availableTools = toolSnapshot.capabilities.filter(c => c.status === 'available').length;

      if (options?.json) {
        console.log(JSON.stringify(jsonEnvelope('overview', {
          rootPath,
          initialized: !!config,
          language: index?.identity.language || 'unknown',
          framework: index?.identity.framework || 'unknown',
          provider: providerStatus.name,
          providerReady: providerStatus.ready,
          keySource: providerStatus.keySource,
          model: config?.ai.model || 'unknown',
          modules: index?.modules.length || 0,
          files: index?.modules.reduce((s, m) => s + m.files.length, 0) || 0,
          tasks: { total: tasks.length, completed, failed, running },
          tools: { total: toolSnapshot.capabilities.length, available: availableTools },
          toolDetails: toolSnapshot.capabilities.map(c => ({ name: c.name, status: c.status })),
          lastScan: index?.lastScan || null,
        }), null, 2));
        return;
      }

      section('项目健康总览');
      console.log();
      if (!config) { warn('项目未初始化，运行 ic init'); console.log(); return; }

      detail('语言', index?.identity.language || '—');
      detail('框架', index?.identity.framework || '—');
      detail('模块', `${index?.modules.length || 0} 个 / ${index?.modules.reduce((s, m) => s + m.files.length, 0) || 0} 文件`);
      detail('Provider', `${providerStatus.name} ${providerStatus.ready ? chalk.green('✓') : chalk.red('✗')} ${providerStatus.keySource ? chalk.dim('(' + providerStatus.keySource + ')') : ''}`);
      detail('模型', config?.ai.model || '—');
      console.log();
      detail('任务', `${chalk.cyan(String(tasks.length))} 个 ${chalk.dim(`(完成 ${completed}, 失败 ${failed}, 运行中 ${running})`)}`);
      detail('工具', `${availableTools}/${toolSnapshot.capabilities.length} 可用`);
      console.log();
      if (index?.lastScan) detail('最后扫描', index.lastScan);
      info(`运行 ${chalk.cyan('ic overview --json')} 获取 JSON 格式`);
      console.log();
    } catch (err) { printError(err as Error); }
  });

// ic loop — task loop status & visualization
// ============================================================
program.command('loop')
  .description('查看三步任务循环状态和工具能力矩阵')
  .option('--json', 'JSON 格式输出')
  .action(async (options?: { json?: boolean }) => {
    try {
      const { buildTaskThinkingLoop, renderTaskThinkingLoop } = await import('./core/task-loop.js');
      const loop = buildTaskThinkingLoop();

      if (options?.json) {
        const { buildToolCapabilitySnapshot } = await import('./core/tool-registry.js');
        const snapshot = buildToolCapabilitySnapshot();
        console.log(JSON.stringify(jsonEnvelope('loop-status', {
          steps: loop.steps.map(s => ({
            id: s.id, name: s.name, owner: s.owner,
            tools: s.requiredToolCategories,
            rule: s.userVisibleRule,
          })),
          tools: snapshot.capabilities.map(c => ({
            id: c.id, name: c.name, status: c.status,
            fallback: c.status !== 'available' ? c.fallback : null,
          })),
          policy: loop.policy,
        }), null, 2));
      } else {
        section('任务循环');
        console.log(renderTaskThinkingLoop(loop));
        console.log();
        info('运行 ic loop --json 获取 JSON 格式');
      }
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// ic intel — code intelligence queries
// ============================================================
program.command('intel')
  .alias('code')
  .description('代码智能查询：符号定义、调用关系、模块导出、依赖分析')
  .argument('[query...]', '查询内容，例如：谁调用了 scanProject / 模块 src/core 的导出')
  .option('--json', 'JSON 格式输出')
  .option('--callers', '仅显示调用者')
  .action(async (args: string[] = [], options?: { json?: boolean; callers?: boolean }) => {
    const rootPath = process.cwd();
    const query = args.join(' ').trim();
    if (!query) { info('用法：ic intel <符号名 | 函数名 | 文件名 | 模块名>'); info('自然语言：ic intel 谁调用了 scanProject'); return; }
    try {
      const { loadProjectIndex } = await import('./core/scanner.js');
      const index = await loadProjectIndex(rootPath);
      if (!index) { fail('项目未扫描，先运行 ic scan'); }

      // Symbol search
      const symbolHits = index.modules.flatMap(m =>
        m.exports.filter(e => e.name === query || e.name.toLowerCase().includes(query.toLowerCase())).map(e => ({ mod: m.name, exp: e }))
      );

      // Callers-only mode
      if (options?.callers && index.callGraph) {
        const callers = index.callGraph.filter(e => e.callee.includes(query));
        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('intel-callers', { symbol: query, count: callers.length, callers: callers.map(c => ({ caller: c.caller, file: c.callerFile, line: c.line })) }), null, 2));
        } else {
          section(`调用者: ${chalk.cyan(query)} (${callers.length})`);
          for (const c of callers.slice(0, 15)) console.log(`  ${chalk.cyan(c.caller)} ${chalk.dim('L' + c.line + '  ' + c.callerFile)}`);
          if (callers.length > 15) info(`还有 ${callers.length - 15} 条...`);
        }
        console.log();
        return;
      }

      // JSON output
      if (options?.json) {
        const callers = index.callGraph?.filter(e => e.callee.includes(query)) || [];
        console.log(JSON.stringify(jsonEnvelope('intel', {
          query,
          symbols: symbolHits.map(h => ({ name: h.exp.name, kind: h.exp.kind, module: h.mod, signature: h.exp.signature, file: h.exp.file, line: h.exp.line })),
          callers: callers.map(c => ({ caller: c.caller, file: c.callerFile, line: c.line })),
        }), null, 2));
        return;
      }

      if (symbolHits.length > 0) {
        section(`代码智能: ${chalk.cyan(query)}`);
        console.log();
        for (const h of symbolHits.slice(0, 10)) {
          detail(h.exp.name, `${h.exp.kind}  ${chalk.dim('→')} ${chalk.cyan(h.mod)}  ${chalk.dim(h.exp.signature?.substring(0, 60) || '')}`);
        }
        // Callers from call graph
        if (index.callGraph) {
          const callers = index.callGraph.filter(e => e.callee.includes(query));
          if (callers.length > 0) {
            console.log();
            info(`调用者 (${callers.length}):`);
            for (const c of callers.slice(0, 8)) {
              console.log(`  ${chalk.cyan(c.caller)} ${chalk.dim('→ L' + c.line + '  ' + c.callerFile)}`);
            }
          }
        }
      } else {
        // Module/file search
        const mod = index.modules.find(m => m.name.includes(query) || m.files.some(f => f.includes(query)));
        if (mod) {
          section(`模块 ${chalk.cyan(mod.name)} (${mod.exports.length} 导出, ${mod.imports.length} 导入)`);
          if (mod.exports.length > 0) {
            for (const e of mod.exports.slice(0, 15)) {
              detail(e.name, `${e.kind}  ${chalk.dim(e.signature?.substring(0, 50) || '')}`);
            }
          }
          const deps = index.dependencyGraph.get(mod.name) || [];
          if (deps.length > 0) {
            console.log();
            info(`依赖: ${deps.map(d => chalk.cyan(d)).join(', ')}`);
          }
        } else {
          warn(`未找到符号或模块: ${query}`);
          info('试试 ic intel <函数名> 或 ic intel <模块名>');
        }
      }
      console.log();
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
    const [subcommand, value, model] = args;
    const rootPath = process.cwd();
    try {
      const config = await loadConfig(rootPath);
      if (!config) { fail('项目未初始化，请先运行 ic init'); }

      if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
        printProviderList(config, options?.json);
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
        printProviderModels(provider, config, options?.json);
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
        if (options?.json) {
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
        printProviderDoctor(config, options?.json);
        return;
      }

      if (subcommand === 'test') {
        await printProviderTest(config, options?.json);
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
// ic cancel
// ============================================================
// ============================================================
// ic start — launch project dev server
// ============================================================
program.command('start')
  .alias('serve')
  .description('启动项目开发服务（等同于 REPL /start）')
  .action(async () => {
    const cwd = process.cwd();
    try {
      const { readFile } = await import('./utils/fs.js');
      let pkg: Record<string, unknown> = {};
      try { pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'))); } catch { fail('未找到 package.json'); }
      const scripts = (pkg.scripts || {}) as Record<string, string>;
      const scriptName = Object.keys(scripts).find(k => /^(dev|start|serve|preview)$/.test(k));
      if (!scriptName) { fail('未找到 dev/start/serve/preview 脚本'); }

      progress(`启动 npm run ${scriptName}...`);
      const { spawn } = await import('child_process');
      const child = spawn('npm', ['run', scriptName], { cwd, stdio: 'inherit', shell: process.platform === 'win32', detached: true });
      child.unref();
      success(`已启动 ${scriptName}（后台运行）`);
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
      if (process.platform === 'win32') {
        const { execSync } = await import('child_process');
        try { execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq *dev*" 2>nul', { stdio: 'ignore' }); } catch { /* ok */ }
      }
      success('已尝试停止后台进程');
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
      } catch (err) { fail(`网络搜索失败: ${(err as Error).message}`); }
      return;
    }
    // Local code search
    try {
      const { execFileSync } = await import('child_process');
      const out = execFileSync('rg', ['--no-heading', '-n', pattern, '--type-not', 'binary', '-g', '!node_modules', '-g', '!.git', '-g', '!dist', '.'], { cwd: process.cwd(), encoding: 'utf-8', timeout: 10000 });
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
    } catch { info('搜索不可用（需要安装 ripgrep）'); }
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

program.command('cancel')
  .description('取消排队中的任务')
  .argument('<task-id>', '任务 ID')
  .action(async (taskId: string) => {
    const rootPath = process.cwd();
    try {
      const { loadTask, cancelTask, persistTask } = await import('./core/task-engine.js');
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

// ============================================================
// ic rollback
// ============================================================
program.command('rollback')
  .description('回滚任务')
  .argument('<task-id>', '任务 ID')
  .action(async (taskId: string) => {
    const rootPath = process.cwd();
    try {
      if (!isGitRepo(rootPath)) { fail('需要 Git 仓库'); }
      const { loadTask, updateTaskStatus, releaseFileLocks, persistTask } =
        await import('./core/task-engine.js');
      const task = await loadTask(rootPath, taskId);
      if (!task) { warn(`任务 ${chalk.cyan(taskId)} 不存在`); return; }

      progress(`回滚任务 ${chalk.cyan(taskId)}...`);
      try {
        const { execSync } = await import('child_process');
        execSync('git checkout -- .', { cwd: rootPath, timeout: 10000 });
        execSync('git clean -fd', { cwd: rootPath, timeout: 10000 });
      } catch {}
      updateTaskStatus(taskId, 'cancelled');
      releaseFileLocks(task);
      await persistTask(rootPath, task);
      success('回滚完成');
    } catch (err) { printError(err as Error); }
  });

// ============================================================
// Default — REPL
// ============================================================
program.action(async () => {
  if (process.argv.length <= 2) await startRepl();
  else printHelp();
});

// ============================================================
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

async function runAutopilotRepairLoop(options: {
  rootPath: string;
  kind: 'docs' | 'tests';
  written: AutopilotWrittenFile[];
  testCommand?: string;
  jsonMode: boolean;
}): Promise<{ finalStatus: 'pass' | 'fail' | 'rolled-back'; attempts: number }> {
  const { rootPath, kind, written, testCommand, jsonMode } = options;
  const files = written.map(w => w.file);
  let attemptCount = 0;

  const { buildAutopilotRepairPlan } = await import('./core/autopilot-repair.js');
  const { createAutopilotRollbackPlan, rollbackAutopilotChanges, renderAutopilotRollbackPlan } = await import('./core/autopilot-rollback.js');

  // Build rollback snapshot before any repair
  const rollbackPlan = await createAutopilotRollbackPlan(rootPath, files, `autopilot ${kind} 验证失败，进入自动修复`);

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

  // Max attempts reached — offer rollback
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

  // 5. AI call with tool-calling loop (S18) — Agent drives execution
  let aiContent = '';
  let aiOutput: ReturnType<typeof parseAIOutput> | null = null;
  const aiCallStarted = Date.now();
  let totalTokensUsed = 0;
  try {
    const { buildToolDefinitions } = await import('./core/tool-executor.js');
    const tools = provider.supportsToolUse ? buildToolDefinitions() : undefined;

    // Tool-calling loop: AI → call tools → get results → AI thinks again
    let currentTask = task.description;
    let toolRound = 0;
    const isAnalysis = isAnalysisOnlyTask(task.description);
    const MAX_TOOL_ROUNDS = isAnalysis ? 10 : 5;
    const allToolResults: string[] = [];

    while (toolRound < MAX_TOOL_ROUNDS) {
      const roundLabel = toolRound === 0 ? '' : chalk.dim(` (第 ${toolRound + 1}/${MAX_TOOL_ROUNDS} 轮)`);
      progress(`AI 执行中...${roundLabel}`);
      const response = await provider.chat({
        systemPrompt: buildSystemPrompt(config, index, task.description),
        context: contextPkg || { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
        task: currentTask,
        history: toolRound > 0 ? `上一轮工具结果已注入上下文。` : '',
      }, tools);

      // If AI returned tool calls, execute them and loop
      if (response.toolCalls && response.toolCalls.length > 0 && provider.supportsToolUse) {
        const { executeToolCall } = await import('./core/tool-executor.js');
        const toolResults: string[] = [];
        for (const tc of response.toolCalls) {
          try {
            const result = await executeToolCall(tc.name, tc.arguments, rootPath);
            toolResults.push(`[${tc.name}] ${result}`);
            detail(`工具: ${tc.name}`, '✓');
          } catch (e) {
            toolResults.push(`[${tc.name}] 错误: ${(e as Error).message}`);
          }
        }
        allToolResults.push(...toolResults);
        currentTask = `${task.description}\n\n工具调用结果：\n${toolResults.join('\n')}\n\n请基于这些结果继续分析。`;
        toolRound++;
        continue;
      }

      // No more tool calls — use this response
      aiContent = response.content;
      aiOutput = response.structuredOutput || parseAIOutput(response.content);
      totalTokensUsed += response.tokensUsed;
      break;
    }

    // For analysis tasks that exhausted rounds without final response,
    // synthesize a response from tool results
    if (!aiContent && isAnalysis && allToolResults.length > 0) {
      const summaries = allToolResults.map(r => r.length > 300 ? r.slice(0, 300) + '...' : r);
      aiContent = '基于工具探索的分析结果（共 ' + allToolResults.length + ' 次工具调用）：\n\n' + summaries.join('\n\n');
    } else if (!aiContent) {
      aiContent = 'AI 未返回有效响应（可能超出工具调用轮次）';
    }
    if (!aiOutput) aiOutput = parseAIOutput(aiContent);
    const elapsedSec = ((Date.now() - aiCallStarted) / 1000).toFixed(1);
    success(`AI 执行完成 — ${totalTokensUsed.toLocaleString()} tokens / ${elapsedSec}s${toolRound > 1 ? ` / ${toolRound} 轮工具调用` : ''}`);
    await appendAuditEvent(rootPath, 'agent', 'ai-called', config.ai.provider, 'success', { taskId: task.id, tokensUsed: totalTokensUsed, durationMs: Date.now() - aiCallStarted, payload: { model: config.ai.model } });

    // S15: Record Agent execution in task
    if (mgrAgent && agent) {
      try {
        agent.result = {
          success: !!aiOutput,
          output: aiContent,
          artifacts: aiOutput?.changes?.map(c => c.file) || [],
          tokensUsed: totalTokensUsed,
          duration: Date.now() - aiCallStarted,
        };
        agent.status = 'done';
        agent.completedAt = new Date().toISOString();

        task.agentExecutions.push({
          agentId: agent.id,
          agentName: agent.name,
          agentType: agent.type,
          status: 'done',
          startedAt: agent.startedAt,
          completedAt: agent.completedAt,
          result: agent.result,
          sandboxLevel: agent.sandboxLevel,
          model: agent.model,
          childAgentIds: agent.childIds,
          tree: mgrAgent.getTree(agent.id),
        });
      } catch { /* best-effort */ }
    }
  } catch (err) {
    if (err instanceof AIOutputContractError) {
      // Analysis-only tasks: AI text response without file changes is valid
      if (isAnalysisOnlyTask(task.description) && aiContent) {
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
      task.errorLog.push(`AI 输出协议错误: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`);
      updateTaskStatus(task.id, 'failed');
      await persistTask(rootPath, task);
      releaseFileLocks(task);
      if (err.detail) info(err.detail);
      fail(`AI 输出协议错误: ${err.message}`);
    }
    const ae = err instanceof AICallError
      ? err
      : new AICallError('UNKNOWN', config.ai.provider, (err as Error).message || String(err), '运行 ic provider test 诊断连接问题');
    task.errorLog.push(`AI 调用失败: ${ae.message}`);
    updateTaskStatus(task.id, 'failed');
    await persistTask(rootPath, task);
    releaseFileLocks(task);
    fail(`AI 调用失败:\n${ae.toDisplay()}`);
    if (ae.code === 'MISSING_API_KEY' || ae.code === 'AUTH_FAILED') {
      info(`运行 ic provider env ${ae.provider} 查看 API Key 配置方式`);
    }
    return;
  }

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

  progress(`写入 ${fileBlocks.length} 个文件...`);
  const { writeFile, ensureDir } = await import('./utils/fs.js');
  for (const fb of fileBlocks) {
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
  }

  updateTaskStatus(task.id, vr.overall === 'pass' ? 'completed' : 'failed');

  // 10. Memory update
  try {
    const { loadProjectMemory, saveProjectMemory, recordTask } = await import('./core/memory.js');
    let mem = await loadProjectMemory(rootPath);
    mem = await recordTask(mem, task, config.project.identity);
    await saveProjectMemory(rootPath, mem);
    appendAuditEvent(rootPath, 'memory-updater', 'memory-updated', task.id, 'success', { taskId: task.id }).catch(() => {});
  } catch {}

  // 11. Report
  progress('生成报告...');
  try {
    const { generateTaskReport, generateReasoningFile, generateVerifyLog } = await import('./report/generator.js');
    await generateTaskReport(rootPath, task, config);
    await generateReasoningFile(rootPath, task);
    await generateVerifyLog(rootPath, task);
    appendAuditEvent(rootPath, 'reporter', 'report-generated', task.id, 'success', { taskId: task.id }).catch(() => {});
  } catch {}

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
// Output helpers
// ════════════════════════════════════════════════════════════
function statusLabel(status: string): string {
  const m: Record<string, string> = {
    queued: '排队中', scheduled: '已调度', running: '执行中', verifying: '验证中',
    completed: '已完成', failed: '失败', cancelled: '已取消', blocked: '已阻塞', paused: '已暂停',
  };
  return m[status] || status;
}

function printTaskPlan(task: Task): void {
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

function printTaskDetail(task: Task): void {
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
    } catch {}
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

// Show planned verification commands (when no verifyResult yet)
async function printPlannedVerification(rootPath: string): Promise<void> {
  const config = await loadConfig(rootPath);
  if (!config) return;
  const { resolveVerificationCommand } = await import('./core/verifier.js');
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

function printTaskList(tasks: Task[]): void {
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

function isAnalysisOnlyTask(desc: string): boolean {
  return /(分析|检查|review|扫描|质量|代码质量|是什么|是否完整|当前目录|整个目录|整个项目)/i.test(desc) &&
    !/(修改|创建|写入|生成文件|新增|删除|修复|改成|更新|update|write|create|delete|fix|改|写)/i.test(desc);
}

function buildSystemPrompt(
  config: ICloserConfig,
  index: import('./types.js').ProjectIndex | null,
  taskDescription?: string,
): string {
  const isAnalysis = taskDescription ? isAnalysisOnlyTask(taskDescription) : false;

  let toolSection = '';
  try {
    const { buildToolCapabilitySnapshot } = require('./core/tool-registry.js');
    const snapshot = buildToolCapabilitySnapshot();
    const available = snapshot.capabilities.filter((c: { status: string }) => c.status === 'available');
    const degraded = snapshot.capabilities.filter((c: { status: string }) => c.status !== 'available');
    toolSection = '\n\n## 本地工具能力（S17.1）';
    toolSection += '\n' + available.map((c: { name: string; purpose: string }) => `- ${c.name}：${c.purpose}`).join('\n');
    if (degraded.length > 0) {
      toolSection += '\n\n降级工具：';
      toolSection += '\n' + degraded.map((c: { name: string; fallback: string }) => `- ${c.name} 不可用 → ${c.fallback}`).join('\n');
    }
  } catch { /* non-critical */ }

  const isWin = process.platform === 'win32';
  let p = `你是 iCloser Agent Shell，终端中的 AI 工程助手。

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

  // B2: Analysis-specific instructions — override the JSON contract for analysis tasks
  if (isAnalysis) {
    p += '\n\n## 分析任务特殊规则（覆盖上述 JSON 变更规则）';
    p += '\n你是项目分析专家。当前任务是分析项目，不是修改代码。请按以下策略操作：';
    p += '\n\n**探索策略：**';
    p += '\n1. 先 read_file README.md 了解项目身份和功能概述';
    p += '\n2. read_file 入口文件（main.go / App.js / Makefile）了解技术栈和构建方式';
    p += '\n3. read_file 关键配置（go.mod / package.json / Dockerfile）识别依赖和服务';
    p += '\n4. 用 search_code 搜索功能关键词（handler/route/api/controller/service/feature）发现功能模块';
    p += '\n5. read_file 2-3 个核心业务文件，了解具体实现细节';
    p += '\n6. **最后必须输出分析写入 ANALYSIS.md 文件**，格式为：';
    p += '\n```json';
    p += '\n{';
    p += '\n  "summary": "项目综合分析结论（一句话）",';
    p += '\n  "changes": [{';
    p += '\n    "file": "ANALYSIS.md",';
    p += '\n    "operation": "write",';
    p += '\n    "content": "# 项目名称\\n\\n## 身份\\n...\\n\\n## 技术栈\\n...\\n\\n## 架构\\n...\\n\\n## 已实现功能\\n- ...\\n\\n## 待开发/未完成\\n- ...\\n\\n## 完整度评估\\n...",';
    p += '\n    "reasoning": "基于对 README + 入口文件 + 关键代码的深入分析"';
    p += '\n  }]';
    p += '\n}';
    p += '\n```';
    p += '\n**关键要求：**';
    p += '\n- 功能清单必须从 README 和源码中提取，至少列出 15 项';
    p += '\n- 技术栈必须包含具体的库名和版本号（从 go.mod/package.json 读取）';
    p += '\n- 完整度评估给出百分比并说明理由';
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
// iCloser mock edit: 覆盖率验证
