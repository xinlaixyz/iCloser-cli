// src/commands/provider.ts — ic provider command + provider helpers
// Extracted from src/index.ts (architecture split)
// Registers: provider (list | use | models | model | key | doctor | test | env)
// Exports:   pickSetupProvider  (used by setup command in index.ts)

import { Command } from 'commander';
import chalk from 'chalk';
import {
  formatProviderKeyGuidance,
  getAvailableProviders,
  getProviderInfo,
  getProviderStatuses,
  inferProviderFromApiKey,
  isAIProvider,
  isLikelyApiKey,
  maskApiKey,
  smokeTestProvider,
} from '../ai/provider.js';
import { loadConfig, saveConfig, setAIProvider, saveGlobalConfig } from '../config.js';
import { jsonEnvelope } from '../cli/json.js';
import {
  success, fail, warn, info, section, detail, printError, ICONS,
} from '../cli/output.js';
import type { AIProvider, ICloserConfig } from '../types.js';

// ── Provider helper functions ────────────────────────────────

export function pickSetupProvider(): AIProvider {
  const candidates = getAvailableProviders().filter(provider => provider.name !== 'mock');
  for (const provider of candidates) {
    if (provider.envVars.some(envVar => Boolean(process.env[envVar]))) {
      return provider.name;
    }
  }
  return 'mock';
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

function printProviderModels(provider: AIProvider, config: ICloserConfig, jsonMode = false): void {
  const providerInfo = getProviderInfo(provider);
  const models = providerInfo.availableModels.map(model => ({
    name: model,
    current: config.ai.provider === provider && config.ai.model === model,
    default: providerInfo.defaultModel === model,
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

// ── Command registration ─────────────────────────────────────

export function registerProviderCommands(program: Command): void {
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
          return;
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
}
