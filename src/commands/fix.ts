// src/commands/fix.ts — ic fix command
// AI error-driven code repair: paste compile/test/lint errors, get targeted fixes

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../config.js';
import { jsonEnvelope } from '../cli/json.js';
import { fail, progress, info, detail, printError } from '../cli/output.js';

export function registerFixCommand(program: Command): void {
  program.command('fix')
    .description('根据错误信息自动定位源码并修复。直接粘贴编译/测试/lint 错误。')
    .argument('<error...>', '错误信息文本')
    .option('--go', '跳过预览，直接应用修复')
    .option('--json', 'JSON 格式输出修复结果')
    .action(async (errorParts: string[], options?: { go?: boolean; json?: boolean }) => {
      const rootPath = process.cwd();
      const errorText = errorParts.join(' ').trim();
      if (!errorText || errorText.length < 5) { fail('请提供错误信息。用法: ic fix "error message"'); return; }
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化，运行 ic init'); }

        const { createProvider } = await import('../ai/provider.js');
        const { parseAIOutput } = await import('../ai/output-contract.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });

        if (!options?.json) progress('AI 错误驱动修复...');

        const { parseErrorOutput } = await import('../core/code-writer.js');
        const errors = parseErrorOutput(errorText);
        let contextBlock = '';
        if (errors.length > 0) {
          const files = new Set(errors.map(e => e.file));
          if (!options?.json) detail('定位文件', [...files].join(', '));
          for (const f of [...files].slice(0, 3)) {
            try {
              const { readFile: rf } = await import('../utils/fs.js');
              const content = await rf(path.join(rootPath, f));
              contextBlock += `\n### ${f}\n${content.slice(0, 1500)}`;
            } catch { /* file may not exist */ }
          }
        }

        const resp = await provider.chat({
          systemPrompt: `你是代码修复专家。根据错误信息分析和修复代码。
只输出一个 JSON 代码块: {"summary":"修复说明","changes":[{"file":"路径","operation":"write","content":"完整文件内容","reasoning":"修复原因"}]}
规则: content 必须是完整文件内容，不能只给 diff。只修改报错相关代码，不改无关部分。`,
          task: `错误信息:\n\`\`\`\n${errorText.slice(0, 3000)}\n\`\`\`\n\n现有代码:${contextBlock || '\n（错误中未识别到具体文件路径）'}`,
          context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
        });

        let changes: { file: string; content: string; reasoning: string }[] = [];
        let summary = '';
        try {
          const parsed = parseAIOutput(resp.content);
          changes = parsed.changes || [];
          summary = parsed.summary || '';
        } catch {
          if (options?.json) console.log(JSON.stringify(jsonEnvelope('fix', { fixed: 0, summary: 'AI 输出无法解析' })));
          else info('AI 返回格式异常。Mock Provider 不支持代码修复，请配置真实 API Key。');
          return;
        }
        if (changes.length === 0) {
          if (options?.json) console.log(JSON.stringify(jsonEnvelope('fix', { fixed: 0, summary: 'AI 无法生成修复' })));
          else info('AI 无法生成修复方案。请确认错误信息中包含文件路径和行号。');
          return;
        }

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('fix', {
            fixed: changes.length, summary,
            changes: changes.map(c => ({ file: c.file, reasoning: c.reasoning })),
          })));
          return;
        }

        const { section: sec, detail: det, info: inf, success: suc } = await import('../cli/output.js');
        sec('修复方案');
        det('摘要', summary || 'AI 错误驱动修复');
        for (const c of changes) det(`  ${c.file}`, c.reasoning?.slice(0, 100) || '');

        if (!options?.go) {
          console.log();
          inf(`使用 ${chalk.cyan('ic fix --go "error"')} 直接应用修复`);
          return;
        }

        for (const c of changes) {
          const fp = path.join(rootPath, c.file);
          const { ensureDir, writeFile } = await import('../utils/fs.js');
          await ensureDir(path.dirname(fp));
          await writeFile(fp, c.content);
          suc(c.file + ` ${chalk.dim(`+${c.content.split('\n').length} 行`)}`);
        }
        console.log();
        inf(`运行 ${chalk.cyan('ic verify')} 验证修复结果`);
      } catch (err) { printError(err as Error); }
    });
}
