// src/commands/gen.ts — ic gen command
// Extracted from src/index.ts (architecture split)
// Registers: gen (new | fix | complete | refactor)

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { success, fail, info, progress, printError } from '../cli/output.js';
import { loadConfig } from '../config.js';

export function registerGenCommands(program: Command): void {
  // ic gen (C1-C6) — AI code generation and fix (uses code-writer.ts)
  program.command('gen')
    .alias('generate')
    .description('AI 代码操作：生成/修复/补全')
    .argument('[action...]', 'new <描述> | fix | complete <文件> | refactor <文件> <指令>')
    .action(async (args: string[]) => {
      const rootPath = process.cwd();
      const [action, ...rest] = args;
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化'); }
        const { createProvider } = await import('../ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const isMock = config.ai.provider === 'mock';
        const { runGenNew, runGenFix, runGenComplete } = await import('../core/task-pipeline.js');

        if (action === 'new' && rest.length > 0) {
          progress('AI 代码生成: ' + rest.join(' '));
          const changes = await runGenNew(rootPath, rest.join(' '), config, provider, isMock);
          for (const c of changes) {
            const fp = path.join(rootPath, c.file);
            const { writeFile, ensureDir } = await import('../utils/fs.js');
            await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
            success(c.file);
          }
          return;
        }

        if (action === 'fix') {
          progress('AI 修复错误...');
          const changes = await runGenFix(rootPath, config, provider);
          for (const c of changes) {
            await (await import('../utils/fs.js')).writeFile(path.join(rootPath, c.file), c.content);
            success(c.file + ' 已修复');
          }
          return;
        }

        if (action === 'complete' && rest.length > 0) {
          const filePath = path.resolve(rootPath, rest[0]);
          progress('AI 智能补全: ' + rest[0]);
          const changes = await runGenComplete(rootPath, filePath, config, provider);
          for (const c of changes) {
            const fp = path.join(rootPath, c.file);
            const { writeFile, ensureDir } = await import('../utils/fs.js');
            await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
            success(c.file + ' 已补全');
          }
          return;
        }

        if (action === 'refactor' && rest.length >= 1) {
          const filePath = path.resolve(rootPath, rest[0]);
          const instruction = rest.slice(1).join(' ') || '优化代码结构';
          if (!(await import('../utils/fs.js')).fileExists(filePath)) { fail('文件不存在: ' + rest[0]); return; }
          progress(`AI 重构: ${rest[0]} — ${instruction}`);
          const index = await (await import('../core/scanner.js')).loadProjectIndex(rootPath).catch(() => null);
          const { refactorCode } = await import('../core/code-writer.js');
          const result = await refactorCode(filePath, instruction, rootPath, index, provider);
          if (result.refactored !== result.original) {
            const { filesToDiff } = await import('../cli/diff-renderer.js');
            const diff = filesToDiff([{ path: filePath, content: result.refactored, previousContent: result.original }]);
            if (diff) console.log(diff);
            console.log(`\n  ${chalk.cyan('说明')}: ${result.explanation}`);
            const { writeFile } = await import('../utils/fs.js');
            await writeFile(filePath, result.refactored);
            success(rest[0] + ' 已重构');
          } else {
            info('AI 未建议修改或解析失败');
          }
          return;
        }

        info('用法: ic gen new <描述> | fix | complete <文件> | refactor <文件> <指令>');
      } catch (err) { printError(err as Error); }
    });
}
