// src/commands/search.ts — ic search | ic web commands
// Extracted from src/index.ts (architecture split)
// Registers: search | web (code and web search)

import { Command } from 'commander';
import chalk from 'chalk';
import { jsonEnvelope } from '../cli/json.js';
import { fail, info, section, warn } from '../cli/output.js';
import { formatDegrade, networkFailure, toolUnavailable } from '../core/degradation.js';

export function registerSearchCommands(program: Command): void {
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
          const { searchWeb } = await import('../core/web-search.js');
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
        } catch (err) { warn(formatDegrade(networkFailure((err as Error).message))); }
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
        if (hits.length === 0) warn(formatDegrade(toolUnavailable('ripgrep', '搜索不可用，需要安装 ripgrep')));
      }
    });

  // ic web — web search
  program.command('web')
    .description('网络搜索（DuckDuckGo，免费无 API Key）')
    .argument('<query>', '搜索关键词')
    .option('--json', 'JSON 格式输出')
    .action(async (query: string, options?: { json?: boolean }) => {
      try {
        const { searchWeb } = await import('../core/web-search.js');
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
}
