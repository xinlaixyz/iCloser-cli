// src/commands/impact.ts — 变更影响面分析 (TC-03)
import { Command } from 'commander';
import chalk from 'chalk';
import { section, detail, info, warn, printError } from '../cli/output.js';
import { jsonEnvelope } from '../cli/json.js';

export function registerImpactCommand(program: Command): void {
  program.command('impact')
    .description('变更影响面分析：改文件A → 谁import A → 哪些测试受影响')
    .argument('[files...]', '要分析的文件（留空则自动取 git diff 变更文件）')
    .option('--json', 'JSON 格式输出')
    .action(async (files: string[] = [], options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const { loadProjectIndex } = await import('../core/scanner.js');
        const { getDiff, isGitRepo } = await import('../utils/git.js');
        const path = await import('path');
        const index = await loadProjectIndex(rootPath);
        if (!index) {
          if (options?.json) {
            console.log(JSON.stringify(jsonEnvelope('impact', {
              error: 'project-not-scanned',
              message: '项目未扫描，先运行 ic init',
              targets: [],
              affectedModules: [],
              importers: [],
              callers: [],
              callerCount: 0,
              affectedTests: [],
              riskLevel: 'unknown',
            }), null, 2));
            process.exitCode = 1;
            return;
          }
          warn('项目未扫描，先运行 ic init');
          return;
        }

        let targets: string[] = files;
        if (targets.length === 0 && isGitRepo(rootPath)) {
          const diff = getDiff(rootPath, false);
          const diffFiles = diff.split('\n')
            .filter(l => l.startsWith('diff --git '))
            .map(l => l.split(' ')[2]?.replace(/^b\//, '') || l.split(' ')[3]?.replace(/^b\//, ''))
            .filter(Boolean);
          targets = [...new Set(diffFiles)];
        }
        if (targets.length === 0) {
          if (options?.json) {
            console.log(JSON.stringify(jsonEnvelope('impact', {
              targets: [],
              affectedModules: [],
              importers: [],
              callers: [],
              callerCount: 0,
              affectedTests: [],
              riskLevel: 'none',
              message: '未指定文件且无 git diff。',
            }), null, 2));
            return;
          }
          info('未指定文件且无 git diff。用法：ic impact <file...> 或 git 变更后直接 ic impact');
          return;
        }

        const relTargets = targets.map(t => path.relative(rootPath, path.resolve(rootPath, t)).replace(/\\/g, '/'));
        const affectedModules = index.modules.filter(m =>
          m.files.some(f => relTargets.some(t => f.replace(/\\/g, '/').endsWith(t) || f.replace(/\\/g, '/') === t))
        );

        const importers: string[] = [];
        for (const mod of affectedModules) {
          for (const [moduleName, deps] of (index.dependencyGraph?.entries() || [])) {
            if (deps.includes(mod.name)) importers.push(moduleName);
          }
        }

        const callerInfo: { caller: string; file: string; callee: string }[] = [];
        for (const edge of (index.callGraph || [])) {
          const calleeInTarget = affectedModules.some(m =>
            edge.calleeFile && m.files.some(f => (edge.calleeFile ?? '').includes(f))
          );
          if (calleeInTarget) {
            callerInfo.push({ caller: edge.caller, file: edge.callerFile || '', callee: edge.callee });
          }
        }

        const testHits = index.modules.filter(m =>
          m.name.includes('.test') || m.name.includes('.spec') || m.files.some(f => f.includes('.test.') || f.includes('.spec.'))
        ).filter(testMod => {
          const testDeps = index.dependencyGraph?.get(testMod.name) || [];
          return testDeps.some(dep => affectedModules.some(m => m.name === dep));
        });

        const uniqueImporters = [...new Set(importers)];
        const riskLevel = affectedModules.length > 5 || uniqueImporters.length > 10 ? 'high' : affectedModules.length > 2 ? 'medium' : 'low';

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('impact', {
            targets: relTargets,
            affectedModules: affectedModules.map(m => m.name),
            importers: uniqueImporters,
            callers: callerInfo.slice(0, 50),
            callerCount: callerInfo.length,
            affectedTests: testHits.map(t => t.name),
            riskLevel,
          }), null, 2));
          return;
        }

        section('变更影响面分析');
        console.log();
        detail('变更文件', relTargets.map(t => chalk.cyan(t)).join(', '));

        if (affectedModules.length === 0) {
          info('未在索引中找到匹配模块。运行 ic init 刷新索引。');
          return;
        }

        console.log();
        detail('涉及模块', affectedModules.map(m => `${m.name} (${m.files.length} files)`).join(', '));

        if (uniqueImporters.length > 0) {
          console.log();
          section(`上游依赖 (${uniqueImporters.length} 个模块 import 了变更模块)`);
          for (const imp of uniqueImporters.slice(0, 15)) console.log(`  ${chalk.cyan(imp)}`);
          if (uniqueImporters.length > 15) info(`还有 ${uniqueImporters.length - 15} 个...`);
        } else {
          console.log();
          info('无模块直接 import 变更模块（或依赖关系未在索引中）。');
        }

        if (callerInfo.length > 0) {
          console.log();
          section(`调用者 (${callerInfo.length} 个调用点)`);
          for (const c of callerInfo.slice(0, 10)) console.log(`  ${chalk.cyan(c.caller)} → ${c.callee}  ${chalk.dim(c.file)}`);
          if (callerInfo.length > 10) info(`还有 ${callerInfo.length - 10} 个...`);
        }

        if (testHits.length > 0) {
          console.log();
          section(`受影响的测试 (${testHits.length} 个模块)`);
          for (const t of testHits) console.log(`  ${chalk.cyan(t.name)}`);
        } else {
          console.log();
          warn('未找到直接依赖变更模块的测试。建议全量运行 npm test。');
        }

        const riskLabel = riskLevel === 'high' ? chalk.red('高风险') : riskLevel === 'medium' ? chalk.yellow('中风险') : chalk.green('低风险');
        console.log();
        detail('风险等级', riskLabel);
        console.log();
        const vCommands = [`npx tsc --noEmit`];
        if (testHits.length > 0) vCommands.push(`npx vitest run ${testHits.map(t => t.name).join(' ')}`);
        else vCommands.push('npm test');
        vCommands.push('npm run lint');
        info(`建议验证：${vCommands.join(' / ')}`);
        console.log();
      } catch (err) { printError(err as Error); }
    });
}
