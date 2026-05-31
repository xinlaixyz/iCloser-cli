// src/commands/project.ts — ic setup | ic init | ic scan commands
// Extracted from src/index.ts (architecture split)
// Registers: setup | init | scan

import { Command } from 'commander';
import chalk from 'chalk';
import { detectProject } from '../utils/detect.js';
import { loadConfig, saveConfig, defaultConfig, saveGlobalConfig } from '../config.js';
import { isGitRepo } from '../utils/git.js';
import { jsonEnvelope } from '../cli/json.js';
import {
  getAvailableProviders, getProviderInfo, getProviderStatus,
  inferProviderFromApiKey, isAIProvider, formatProviderKeyGuidance, smokeTestProvider,
} from '../ai/provider.js';
import {
  success, fail, warn, info, detail, divider, printProjectIdentity, printError,
} from '../cli/output.js';
import { formatDegrade, providerUnavailable } from '../core/degradation.js';
import { pickSetupProvider } from './provider.js';
import type { AIProvider } from '../types.js';

export function registerProjectCommands(program: Command): void {
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
        console.log(`\n${chalk.bold.blue('icloser Agent Shell')} ${chalk.dim('v0.1.0')} — 首次安装向导\n`);
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
              warn(formatDegrade(providerUnavailable(smoke.error || undefined)));
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
          console.log(`  ${chalk.cyan('ic t "你的任务描述"')}`);
          console.log(chalk.dim(`\n  提示：如果 ic 命令不可用，运行 ${chalk.cyan('npm link')} 注册全局命令，或用 ${chalk.cyan('npx ic')} 代替。\n`));
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
    .action(async (options: { force?: boolean; json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        if (!options.json) info('正在分析项目...');
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
          const { scanProject, saveProjectIndex } = await import('../core/scanner.js');
          const result = await scanProject({ rootPath, deep: true, includeTests: true, maxFileSize: 500 * 1024, quiet: !!options.json });
          if (!options.json) info(`索引完成：${result.fileCount} 文件，${result.moduleCount} 模块，${result.apiCount} 接口`);
          await saveProjectIndex(rootPath, result.index);
        } catch { /* best effort */ }

        // Init memory (legacy + Memory Kernel v1.0)
        try {
          const { loadProjectMemory, saveProjectMemory } = await import('../core/memory.js');
          await saveProjectMemory(rootPath, await loadProjectMemory(rootPath));
        } catch { /* best effort */ }
        try {
          const { ensureMemoryStore } = await import('../core/memory/store.js');
          await ensureMemoryStore(rootPath);
          // Bootstrap Memory Kernel from git history + code patterns
          try {
            const { getMemoryRuntime } = await import('../core/memory/integration.js');
            const runtime = await getMemoryRuntime(rootPath);
            const { bootstrapMemoryKernel } = await import('../core/memory/bootstrap.js');
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
    .action(async (options: { json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化，请先运行 ic init'); }
        const spin = options.json ? null : (await import('ora')).default('正在扫描项目...').start();
        const identity = await detectProject(rootPath);
        const { scanProject, saveProjectIndex } = await import('../core/scanner.js');
        const result = await scanProject({ rootPath, deep: true, includeTests: true, maxFileSize: 500 * 1024 });
        if (options.json) {
          console.log(JSON.stringify(jsonEnvelope('scan', {
            fileCount: result.fileCount, moduleCount: result.moduleCount, apiCount: result.apiCount,
            identity, architecture: result.index?.architecturePattern,
          })));
        } else {
          spin?.succeed(`扫描完成：${result.fileCount} 文件，${result.moduleCount} 模块，${result.apiCount} 接口`);
          const { section, detail, info } = await import('../cli/output.js');
          console.log();
          section('项目画像');
          detail('语言', identity.language);
          detail('框架', identity.framework || '—');
          detail('构建', identity.buildSystem);
          detail('测试', identity.testFramework || '—');
          detail('数据库', identity.database || '—');
          detail('架构', result.index?.architecturePattern || '—');
          if (result.moduleCount > 0) {
            console.log();
            section('模块概览');
            const mods = result.index?.modules || [];
            for (const m of mods.slice(0, 10)) {
              detail(m.name, `${m.files.length} 文件 ${m.responsibility ? '· ' + m.responsibility : ''}`);
            }
            if (mods.length > 10) info(`... 还有 ${mods.length - 10} 个模块`);
          }
          console.log();
          info(`运行 ${chalk.cyan('ic overview')} 查看完整项目健康仪表盘`);
          console.log();
        }
        await saveProjectIndex(rootPath, result.index);
        config.project.identity = identity;
        await saveConfig(config);
      } catch (err) { printError(err as Error); if (!options.json) process.exit(1); }
    });
}
