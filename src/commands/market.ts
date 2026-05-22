// src/commands/market.ts — ic market command
// Extracted from src/index.ts (architecture split)
// Registers: market (competitive | industry | tech-radar | swot analysis)

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../config.js';
import { success, fail, printError } from '../cli/output.js';

export function registerMarketCommands(program: Command): void {
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
      const template = (options?.type || 'competitive') as import('../types.js').UserIntentCategory & string;
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
        const { createProvider } = await import('../ai/provider.js');

        console.log(`\n${chalk.bold.blue('🔍 市场分析')}: ${chalk.cyan(topic)} ${chalk.dim(`(${templateLabels[template]})`)}`);
        console.log(chalk.dim('━'.repeat(60)));

        const provider = createProvider({
          provider: config?.ai.provider || 'claude',
          model: config?.ai.model || 'claude-sonnet-4-6',
          apiKey: config?.ai.apiKey,
          maxTokens: 100000,
          temperature: 0.3,
        });

        const { runMarketAnalysis } = await import('../core/market-analysis.js');

        const report = await runMarketAnalysis({
          topic,
          template: template as import('../core/market-analysis.js').AnalysisTemplate,
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
          const { ensureDir, writeFile } = await import('../utils/fs.js');
          const fullPath = outputPath.startsWith('.') ? [rootPath, outputPath].join('/').replace(/\/+/g, '/') : outputPath;
          const dirPath = path.dirname(fullPath);
          await ensureDir(dirPath);
          await writeFile(fullPath, report.content);
          success(`报告已保存: ${fullPath}`);
        } catch { /* best-effort save */ }
      } catch (err) { printError(err as Error); }
    });
}
