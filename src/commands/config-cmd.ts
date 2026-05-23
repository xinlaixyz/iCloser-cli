// src/commands/config-cmd.ts — ic config command
// Extracted from src/index.ts (architecture split)
// Registers: config (provider / model / mode / security)
// Includes: printSecurityRules helper (only used by this command)

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, setAIProvider } from '../config.js';
import { getSecurityRuleDefinitions } from '../core/security.js';
import { jsonEnvelope, serializeConfig, serializeSecurityRules } from '../cli/json.js';
import {
  success, fail, warn, info, section, detail, printError, ICONS,
} from '../cli/output.js';
import type { ICloserConfig } from '../types.js';

// ── Helper ───────────────────────────────────────────────────

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

// ── Command ──────────────────────────────────────────────────

export function registerConfigCommands(program: Command): void {
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
              const { disableSecurityRule } = await import('../config.js');
              disableSecurityRule(config, extra);
              await saveConfig(config);
              success(`安全规则已禁用: ${chalk.cyan(extra)}`);
            } else {
              const { enableSecurityRule } = await import('../config.js');
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

        // Security disable/enable (top-level shorthand)
        if (key === 'disable' && value && config) {
          const { disableSecurityRule } = await import('../config.js');
          disableSecurityRule(config, value);
          await saveConfig(config);
          success(`安全规则已禁用: ${chalk.cyan(value)}`);
          return;
        }
        if (key === 'enable' && value && config) {
          const { enableSecurityRule } = await import('../config.js');
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
}
