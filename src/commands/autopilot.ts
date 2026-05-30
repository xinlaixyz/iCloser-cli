// src/commands/autopilot.ts — ic autopilot / ic auto command
// Extracted from src/index.ts (architecture split)

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../config.js';
import { jsonEnvelope } from '../cli/json.js';
import { success, progress, warn, info, section, printError } from '../cli/output.js';

interface AutopilotWrittenFile { file: string; fullPath: string; }

type RepairLoopFn = (options: {
  rootPath: string; kind: 'docs' | 'tests';
  written: AutopilotWrittenFile[]; testCommand?: string;
  jsonMode: boolean; autoRollback?: boolean;
}) => Promise<{ finalStatus: 'pass' | 'fail' | 'rolled-back'; attempts: number }>;

export function registerAutopilotCommand(program: Command, runRepairLoop: RepairLoopFn): void {
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
      if (options && options.auto === undefined) {
        const cfg = await loadConfig(rootPath);
        options.auto = cfg?.execution?.autoRollbackOnFailure ?? false;
      }
      try {
        const normalizedMode = mode.toLowerCase();

        // ═══ autopilot docs — generate missing documentation ═══
        if (['docs', 'doc', 'document', 'documentation'].includes(normalizedMode)) {
          const { analyzeProjectAutopilot } = await import('../core/autopilot.js');
          const { buildDocWritePlan, writeDocs } = await import('../core/autodoc.js');
          const report = await analyzeProjectAutopilot(rootPath);
          const plan = await buildDocWritePlan(rootPath, report);

          if (options?.json && !options.go) {
            console.log(JSON.stringify(jsonEnvelope('autopilot-docs', {
              rootPath: plan.rootPath, totalNew: plan.totalNew, totalExisting: plan.totalExisting,
              docs: plan.docs.map(d => ({ file: d.file, title: d.title, exists: d.exists, action: d.exists ? 'skip-existing' : 'write-new' })),
            }), null, 2));
            return;
          }

          if (options?.json && options.go) {
            const written = await writeDocs(rootPath, plan, { overwrite: options.yes || false });
            const { verifyAutopilotDocs } = await import('../core/autopilot-verify.js');
            let verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
            let repairResult = null;

            if (verification.status === 'fail') {
              repairResult = await runRepairLoop({
                rootPath, kind: 'docs',
                written: written.map(d => ({ file: d.file, fullPath: d.fullPath })),
                jsonMode: true, autoRollback: options?.auto ?? false,
              });
              if (repairResult.finalStatus === 'pass') {
                verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
              }
            }

            console.log(JSON.stringify(jsonEnvelope('autopilot-docs-written', {
              rootPath, docsDir: path.join(rootPath, 'docs'), overwrite: options.yes || false,
              written: written.map(d => ({ file: d.file, fullPath: d.fullPath, verified: d.verified, bytes: d.bytes, lines: d.lines })),
              verification,
              ...(repairResult ? { repair: { attempts: repairResult.attempts, finalStatus: repairResult.finalStatus } } : {}),
            }), null, 2));
            return;
          }

          section('自动文档生成');
          if (plan.totalNew === 0) {
            success(`全部 ${plan.docs.length} 个文档已存在。运行 ${chalk.cyan('ic auto docs --go --yes')} 强制覆盖。`);
            console.log(); return;
          }

          progress(`发现 ${plan.totalNew} 个缺失文档，${plan.totalExisting} 个已存在`);

          const { renderChoicePanel } = await import('../cli/choice-panel.js');
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

          progress('正在生成文档...');
          const written = await writeDocs(rootPath, plan, { overwrite: options?.yes || false });

          if (written.length === 0) { warn('未写入任何文件（可能因为文档已存在，使用 --yes 覆盖）。'); console.log(); return; }

          for (const d of written) {
            success(`${d.file} ${chalk.dim(`+${d.lines} 行，${d.bytes} bytes`)}`);
            info(`  ${chalk.dim('路径')} ${chalk.cyan(d.fullPath)}`);
            info(`  ${chalk.dim('磁盘确认')} ${d.verified ? chalk.green('已确认存在') : chalk.red('未确认')}`);
          }
          const { verifyAutopilotDocs, formatAutopilotVerification } = await import('../core/autopilot-verify.js');
          const verification = await verifyAutopilotDocs(rootPath, written.map(d => d.file));
          console.log();
          success(`已写入 ${written.length} 个文档到 ${chalk.cyan(path.join(rootPath, 'docs'))}`);
          info(formatAutopilotVerification(verification));

          if (verification.status === 'fail') {
            await runRepairLoop({
              rootPath, kind: 'docs',
              written: written.map(d => ({ file: d.file, fullPath: d.fullPath })),
              jsonMode: false, autoRollback: options?.auto ?? false,
            });
          }

          console.log();
          info('下次可以问「刚才写到哪里了」查看文件路径。');
          return;
        }

        // ═══ autopilot tests — generate test plan or safe starter tests ═══
        if (['tests', 'test', 'plan-tests'].includes(normalizedMode)) {
          if (!options?.json) progress(options?.go ? '正在生成安全测试写入计划...' : '正在生成自动测试规划...');
          const { planProjectTests, renderAutopilotTestPlan } = await import('../core/autopilot.js');
          const plan = await planProjectTests(rootPath);

          if (options?.go) {
            const { buildTestWritePlan, renderTestWritePlan, writeTests } = await import('../core/autotest.js');
            const writePlan = await buildTestWritePlan(rootPath, plan, { module: options.module });

            if (options?.json) {
              const written = await writeTests(rootPath, writePlan, { overwrite: options.yes || false });
              const { verifyAutopilotTests } = await import('../core/autopilot-verify.js');
              let verification = written.length > 0
                ? await verifyAutopilotTests(rootPath, writePlan.testCommand)
                : { status: 'skipped', kind: 'tests' as const, duration: 0, summary: '没有新写入测试文件，跳过验证' };
              let repairResult = null;

              if (verification.status === 'fail') {
                repairResult = await runRepairLoop({
                  rootPath, kind: 'tests',
                  written: written.map(w => ({ file: w.file, fullPath: w.fullPath })),
                  testCommand: writePlan.testCommand, jsonMode: true, autoRollback: options?.auto ?? false,
                });
                if (repairResult.finalStatus === 'pass') {
                  verification = await verifyAutopilotTests(rootPath, writePlan.testCommand);
                }
              }

              console.log(JSON.stringify(jsonEnvelope('autopilot-tests-written', {
                rootPath, testCommand: writePlan.testCommand, target: writePlan.target?.module || null,
                overwrite: options.yes || false,
                written: written.map(item => ({ file: item.file, sourceFile: item.sourceFile, fullPath: item.fullPath, verified: item.verified, bytes: item.bytes, lines: item.lines })),
                verification,
                ...(repairResult ? { repair: { attempts: repairResult.attempts, finalStatus: repairResult.finalStatus } } : {}),
              }), null, 2));
              return;
            }

            section('Project Autopilot / Safe Test Writer');
            console.log(renderTestWritePlan(writePlan));
            console.log();

            if (writePlan.tests.length === 0) { success('暂未发现需要自动补测的模块。'); console.log(); return; }

            const written = await writeTests(rootPath, writePlan, { overwrite: options.yes || false });
            if (written.length === 0) { warn('未写入任何测试文件（可能已存在，使用 --yes 覆盖）。'); console.log(); return; }

            for (const item of written) {
              success(`${item.file} ${chalk.dim(`+${item.lines} 行，${item.bytes} bytes`)}`);
              info(`  ${chalk.dim('来源')} ${chalk.cyan(item.sourceFile)}`);
              info(`  ${chalk.dim('路径')} ${chalk.cyan(item.fullPath)}`);
              info(`  ${chalk.dim('磁盘确认')} ${item.verified ? chalk.green('已确认存在') : chalk.red('未确认')}`);
            }
            const { verifyAutopilotTests, formatAutopilotVerification } = await import('../core/autopilot-verify.js');
            const verification = await verifyAutopilotTests(rootPath, writePlan.testCommand);
            console.log();
            info(formatAutopilotVerification(verification));

            if (verification.status === 'fail') {
              await runRepairLoop({
                rootPath, kind: 'tests',
                written: written.map(w => ({ file: w.file, fullPath: w.fullPath })),
                testCommand: writePlan.testCommand, jsonMode: false, autoRollback: options?.auto ?? false,
              });
            }
            return;
          }

          if (options?.json) { console.log(JSON.stringify(jsonEnvelope('autopilot-test-plan', plan), null, 2)); return; }

          section('Project Autopilot / Tests');
          console.log(renderAutopilotTestPlan(plan));
          console.log();
          info(`使用 ${chalk.cyan('ic auto tests --go')} 为最高优先级模块生成 1 个最小测试文件。`);
          return;
        }

        // ═══ autopilot chain — execution pipeline ═══
        if (['chain', 'flow', 'workflow', 'execute-chain'].includes(normalizedMode)) {
          if (!options?.json) progress('正在生成自动执行链...');
          const { buildExecutionChain, renderExecutionChain } = await import('../core/execution-chain.js');
          const { buildTaskThinkingLoop, renderTaskThinkingLoop } = await import('../core/task-loop.js');
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
        const { analyzeProjectAutopilot, renderAutopilotReport } = await import('../core/autopilot.js');
        const report = await analyzeProjectAutopilot(rootPath);

        if (options?.json) { console.log(JSON.stringify(jsonEnvelope('autopilot-report', report), null, 2)); return; }

        section('Project Autopilot');
        console.log(renderAutopilotReport(report));
        console.log();
        info('当前阶段只做分析和计划，不会自动写代码。后续执行会进入中文确认面板。');
      } catch (err) { printError(err as Error); }
    });
}
