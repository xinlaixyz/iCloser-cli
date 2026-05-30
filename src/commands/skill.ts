// src/commands/skill.ts — ic skill command
// Extracted from src/index.ts (architecture split)
// Registers: skill (list | describe | add | remove | install)

import { Command } from 'commander';
import chalk from 'chalk';
import { success, fail, info, printError } from '../cli/output.js';

export function registerSkillCommands(program: Command): void {
  program.command('skill')
    .description('管理 AI 技能：查看/添加/删除/安装')
    .argument('[subcommand]', 'list | describe <name> | add <name> <触发词> | remove <name> | install <url|path>')
    .argument('[args...]', '额外参数')
    .action(async (subcommand: string | undefined, args: string[]) => {
      const rootPath = process.cwd();
      try {
        const { listSkills, registerSkill, removeSkill: rmSkill, saveSkillsToFile, loadSkillsFromFile } = await import('../core/skill-system.js');
        await loadSkillsFromFile(rootPath);

        if (!subcommand || subcommand === 'list') {
          const skills = listSkills();
          console.log(chalk.bold(`\n可用技能 (${skills.length}):\n`));
          for (const s of skills) {
            const builtin = ['project-index', 'code-review', 'test-generator', 'security-review', 'local-tools', 'api-doc', 'refactor-guide', 'pypdf2'].includes(s.name);
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
          const builtin = ['project-index', 'code-review', 'test-generator', 'security-review', 'local-tools', 'api-doc', 'refactor-guide', 'pypdf2'].includes(skill.name);
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

        // ic skill install <url|path> — install skill from remote JSON (T3-2a)
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
}
