// src/commands/code.ts — ic code command
// Extracted from src/index.ts (architecture split)
// Registers: code (new | fix | complete | refactor | scaffold | review | lint-fix | refactor-files)

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { fileExists, readFile } from '../utils/fs.js';
import { loadConfig } from '../config.js';
import { parseAIOutput } from '../ai/output-contract.js';
import { applyCompileGate, runCodeGenerationPipeline } from '../core/task-pipeline.js';
import {
  success, fail, warn, info, progress, section, detail, printError,
} from '../cli/output.js';

export function registerCodeCommands(program: Command): void {
  // ic code — code intelligence (C1-C9 via code-writer.ts)
  // ============================================================
  program.command('code')
    .description('AI 代码智能：新建/修复/补全/重构/审查/lint修复')
    .argument('[subcommand]', 'new | fix | complete | refactor [--safe] | scaffold | review [文件] | lint-fix [--go]')
    .argument('[args...]', '额外参数')
    .action(async (subcommand: string | undefined, args: string[]) => {
      const rootPath = process.cwd();
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化'); }
        const { createProvider } = await import('../ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
        const isMock = config.ai.provider === 'mock';

        const withTests = args.includes('--with-tests');
        const cleanArgs = args.filter(a => a !== '--with-tests');

        if (subcommand === 'new' && cleanArgs.length > 0) {
          const desc = cleanArgs.join(' ');
          progress('AI 上下文感知代码生成: ' + desc + (withTests ? ' (含测试)' : ''));
          let styleConstraint = '';
          let codePatterns = '';
          if (!isMock) {
            try {
              const index = await (await import('../core/scanner.js')).loadProjectIndex(rootPath);
              if (index?.styleFingerprint) {
                const { buildStyleConstraints } = await import('../core/code-writer.js');
                styleConstraint = buildStyleConstraints(index.styleFingerprint);
              }
              if (index) {
                const { readCodePatterns } = await import('../core/code-writer.js');
                codePatterns = await readCodePatterns(rootPath, index);
              }
            } catch { /* best-effort */ }
          }
          // Improve-1: Use unified pipeline for non-mock; raw chat for mock
          const ctxPkg = {
            projectMeta: codePatterns ? `现有代码模式:\n${codePatterns.slice(0, 2000)}` : '',
            relevantCode: [], relevantMemory: styleConstraint, totalTokens: 0, budgetUsed: 0,
          };
          const codeChanges = isMock
            ? parseAIOutput((await provider.chat({
                systemPrompt: '你是代码生成专家。只输出JSON变更契约。',
                task: desc + (codePatterns ? '\n\n现有代码模式参考:\n' + codePatterns.slice(0, 2000) : ''),
                context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
              })).content).changes
            : await runCodeGenerationPipeline(desc, rootPath, provider, config.project.identity, ctxPkg, 'code new');

          for (const c of codeChanges) {
            const fp = path.join(rootPath, c.file);
            const { writeFile, ensureDir } = await import('../utils/fs.js');
            await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
            success(c.file);
          }
          // C4+C7: Generate tests + auto-verify-repair when --with-tests
          if (withTests && !isMock) {
            try {
              const index = await (await import('../core/scanner.js')).loadProjectIndex(rootPath);
              if (index) {
                const { generateWithVerifyLoop } = await import('../core/code-writer.js');
                progress('生成测试 + 自动验证修复...');
                const verifyResult = await generateWithVerifyLoop(desc, rootPath, index, provider);
                for (const s of verifyResult.source) success(s.file);
                for (const t of verifyResult.tests) success(t.file + ' (测试)');
                if (verifyResult.verifyPassed) {
                  success(`验证通过 (${verifyResult.verifyRounds} 轮)`);
                } else if (verifyResult.diagnostics) {
                  warn(`验证未通过 (${verifyResult.verifyRounds} 轮): ${verifyResult.diagnostics.slice(0, 200)}`);
                }
              } else {
                // No index, fall back to simple test generation using already-written code
                const sourceFiles = codeChanges.map(c => ({ file: c.file, content: c.content }));
                if (sourceFiles.length > 0) {
                  progress('生成测试...');
                  const testResp = await provider.chat({
                    systemPrompt: '你是测试专家。只输出JSON变更契约。为源码生成单元测试。',
                    task: '为以下文件生成测试:\n' + sourceFiles.map((s: { file: string; content: string }) => `## ${s.file}\n${s.content.slice(0, 1000)}`).join('\n\n'),
                    context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
                  });
                  for (const c of parseAIOutput(testResp.content).changes) {
                    const fp = path.join(rootPath, c.file);
                    const { writeFile: wf, ensureDir: ed } = await import('../utils/fs.js');
                    await ed(path.dirname(fp)); await wf(fp, c.content);
                    success(c.file + ' (测试)');
                  }
                }
              }
            } catch { /* verify loop failed, keep generated source */ }
          }
          return;
        }

        if (subcommand === 'fix') {
          const tasks = await (await import('../core/task-engine.js')).listTasks(rootPath);
          const last = tasks.find(t => t.status === 'failed');
          if (!last?.verifyResult?.errorSummary) { info('无失败验证记录'); return; }
          progress('AI 错误驱动修复...');
          const { parseErrorOutput } = await import('../core/code-writer.js');
          const errors = parseErrorOutput(last.verifyResult.errorSummary);
          const errList = errors.map(e => `  ${e.file}:${e.line} — ${e.message}`).join('\n');
          detail('错误定位', errList || '无精确位置');
          const resp = await provider.chat({
            systemPrompt: '你是代码修复专家。只输出JSON变更契约。仅修复列出的错误，不改无关代码。',
            task: '错误摘要:\n' + last.verifyResult.errorSummary.slice(0, 2000) + '\n\n精确错误位置:\n' + errList,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          const fixChanges = parseAIOutput(resp.content).changes;
          const validated = await applyCompileGate(fixChanges, rootPath, config.project.identity, provider, 'code fix');
          for (const c of validated) {
            await (await import('../utils/fs.js')).writeFile(path.join(rootPath, c.file), c.content);
            success(c.file + ' 已修复');
          }
          return;
        }

        if (subcommand === 'complete' && args.length > 0) {
          const filePath = path.resolve(rootPath, args[0]);
          const { fileExists: fe } = await import('../utils/fs.js');
          if (!fe(filePath)) { fail('文件不存在: ' + args[0]); return; }
          const content = await readFile(filePath);
          const { findIncompleteCode } = await import('../core/code-writer.js');
          const incomplete = findIncompleteCode(content);
          if (incomplete.length === 0) { info('未发现未完成代码（TODO/FIXME/空函数体）'); return; }
          progress(`AI 补全 ${incomplete.length} 处未完成代码...`);
          detail('未完成', incomplete.map(i => `  L${i.line}: ${i.signature}`).join('\n'));
          const resp = await provider.chat({
            systemPrompt: '你是代码补全专家。只输出JSON变更契约。补全所有未完成代码，匹配现有风格。',
            task: '文件: ' + args[0] + '\n未完成位置:\n' + incomplete.map(i => `L${i.line}: ${i.signature}`).join('\n') + '\n\n文件内容:\n' + content.slice(0, 3000),
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          const completeChanges = parseAIOutput(resp.content).changes;
          const validated = await applyCompileGate(completeChanges, rootPath, config.project.identity, provider, 'code complete');
          for (const c of validated) {
            const fp = path.join(rootPath, c.file);
            const { writeFile, ensureDir } = await import('../utils/fs.js');
            await ensureDir(path.dirname(fp)); await writeFile(fp, c.content);
            success(c.file + ' 已补全');
          }
          return;
        }

        if (subcommand === 'refactor' && args.length > 0) {
          const desc = args.filter(a => a !== '--safe').join(' ');
          const safeMode = args.includes('--safe');
          progress('AI 多文件重构' + (safeMode ? ' (安全模式)' : '') + ': ' + desc);

          // C12: Cross-file impact analysis — search all references, build dependency graph
          const index = await (await import('../core/scanner.js')).loadProjectIndex(rootPath).catch(() => null);
          let refsInfo = '';
          let impactedFiles: string[] = [];
          if (index) {
            const { findSymbolReferences } = await import('../core/code-writer.js');
            // Extract multiple symbols from description
            const symbols = desc.match(/["'""]?(\w{3,})["'""]?/g)?.map(s => s.replace(/["'""]/g, '')) || [];
            const allRefs = new Set<string>();
            for (const symbol of symbols.slice(0, 3)) {
              const refs = findSymbolReferences(index, symbol);
              for (const r of refs) {
                const file = r.split(':')[0];
                if (file) { allRefs.add(r); impactedFiles.push(file); }
              }
            }
            impactedFiles = [...new Set(impactedFiles)];
            if (allRefs.size > 0) {
              refsInfo = '\n## 引用分析 (C12 跨文件影响)\n' +
                `影响 ${impactedFiles.length} 个文件, ${allRefs.size} 处引用:\n` +
                [...allRefs].slice(0, 20).map(r => '  - ' + r).join('\n');
              detail('跨文件影响', `${impactedFiles.length} 文件, ${allRefs.size} 引用`);
            }
          }

          // C9: Safe mode — snapshot affected files first, verify after each step
          const backups: Map<string, string> = new Map();
          if (safeMode && impactedFiles.length > 0) {
            const { readFile: rf, fileExists: fe } = await import('../utils/fs.js');
            for (const f of impactedFiles.slice(0, 10)) {
              const fp = path.resolve(rootPath, f);
              if (await fe(fp)) backups.set(f, await rf(fp));
            }
            detail('安全模式', `已备份 ${backups.size} 个文件`);
          }

          const resp = await provider.chat({
            systemPrompt: [
              '你是代码重构专家。输出所有需要修改的文件的JSON变更契约。',
              '保持API兼容，不破坏现有测试，不改变外部行为。',
              safeMode ? '安全模式: 如果测试失败则回滚，每次只改一个文件。' : '',
            ].filter(Boolean).join(' '),
            task: desc + refsInfo,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          const refactorChanges = parseAIOutput(resp.content).changes;
          const validated = await applyCompileGate(refactorChanges, rootPath, config.project.identity, provider, 'code refactor');

          // C9: In safe mode, verify after each file write; rollback on failure
          for (const c of validated) {
            const fp = path.join(rootPath, c.file);
            const { writeFile: wf, ensureDir: ed } = await import('../utils/fs.js');
            await ed(path.dirname(fp));
            // Backup before write
            const { readFile: rf, fileExists: fe } = await import('../utils/fs.js');
            const prev = (await fe(fp)) ? await rf(fp) : '';
            await wf(fp, c.content);
            // Verify
            const { runCompileCheck } = await import('../core/code-writer.js');
            const check = await runCompileCheck([], rootPath, config.project.identity);
            if (check.passed) {
              success(c.file);
            } else if (safeMode) {
              // Rollback on failure in safe mode
              if (prev) { await wf(fp, prev); } else { try { await import('fs/promises').then(m => m.unlink(fp)); } catch {} }
              warn(c.file + ' 编译失败，已回滚 — ' + check.errors.slice(0, 200));
            } else {
              warn(c.file + ' (编译警告，检查 ic code fix)');
            }
          }
          return;
        }

        if (subcommand === 'scaffold' && cleanArgs.length >= 2) {
          const scaffoldType = cleanArgs[0] as 'crud' | 'middleware' | 'route' | 'component';
          const name = cleanArgs[1];
          const validTypes = ['crud', 'middleware', 'route', 'component'];
          if (!validTypes.includes(scaffoldType)) { fail('类型: crud | middleware | route | component'); return; }
          const index = await (await import('../core/scanner.js')).loadProjectIndex(rootPath);
          const lang = config.project?.identity?.language || 'typescript';
          // C8: Use AI-enhanced scaffold — auto-completes TODO stubs
          const { generateScaffoldWithAI } = await import('../core/code-writer.js');
          progress(`AI 脚手架: ${scaffoldType} ${name}`);
          const result = isMock
            ? await import('../core/code-writer.js').then(m => m.generateScaffold(scaffoldType, name, lang, index?.styleFingerprint))
            : await generateScaffoldWithAI(scaffoldType, name, lang, rootPath, index, provider, index?.styleFingerprint);
          const { writeFile, ensureDir } = await import('../utils/fs.js');
          let aiCompleted = 0;
          for (const f of result.files) {
            const fp = path.join(rootPath, f.path);
            await ensureDir(path.dirname(fp));
            await writeFile(fp, f.content);
            if (!/\/\/\s*TODO/i.test(f.content)) aiCompleted++;
            success(f.path + (aiCompleted > 0 ? '' : ' (骨架)'));
          }
          if (!isMock && aiCompleted > 0) detail('AI 补全', `${aiCompleted} 个文件的 TODO 已自动实现`);
          return;
        }

        // T4b: Structured code review — 4-dimension scoring + issues list
        if (subcommand === 'review' && args.length > 0) {
          const targetPath = path.resolve(rootPath, args[0]);
          if (!(await fileExists(targetPath))) { fail('文件不存在: ' + args[0]); return; }
          const content = await readFile(targetPath);
          progress(`AI 代码审查: ${args[0]} (安全/风格/bug/性能)`);
          // Load style fingerprint for context-aware review
          let styleFp: import('../types.js').StyleFingerprint | undefined;
          try { const idx = await (await import('../core/scanner.js')).loadProjectIndex(rootPath); styleFp = idx?.styleFingerprint; } catch { /* best-effort */ }
          const { reviewCode, formatCodeReview } = await import('../core/code-writer.js');
          const review = await reviewCode(args[0], content, provider, styleFp);
          section('代码审查: ' + args[0]);
          console.log(formatCodeReview(review));
          console.log();
          return;
        }

        if (subcommand === 'review' && args.length === 0) {
          const { isGitRepo, getDiff } = await import('../utils/git.js');
          if (!isGitRepo(rootPath)) { fail('非 Git 仓库，请指定文件: ic code review <文件>'); return; }
          const diff = getDiff(rootPath, false);
          if (!diff.trim()) { info('工作区无变更'); return; }
          progress('AI 增量代码审查 (git diff)...');
          const { reviewDiff, formatCodeReview } = await import('../core/code-writer.js');
          const review = await reviewDiff(diff, provider);
          section('增量代码审查');
          console.log(formatCodeReview(review));
          console.log();
          return;
        }

        // C10: Batch lint fix — read lint output, AI fixes file by file with verification
        if (subcommand === 'lint-fix' || subcommand === 'lintfix') {
          const _autoApply = args.includes('--go');
          progress('AI 批量 lint 修复...');
          // Run lint first
          const { resolveVerificationCommand } = await import('../core/verifier.js');
          const lintCmd = await resolveVerificationCommand(rootPath, config.project.identity, 'lint');
          let lintOutput = '';
          if (lintCmd) {
            try {
              const { execSync } = await import('child_process');
              lintOutput = execSync(lintCmd.command, { cwd: rootPath, timeout: 30000, encoding: 'utf-8', stdio: 'pipe' });
            } catch (e: any) {
              lintOutput = (e.stdout || '') + (e.stderr || '');
            }
          }
          if (!lintOutput.trim()) { info('无 lint 问题'); return; }
          detail('lint 输出', lintOutput.slice(0, 500));
          // Group errors by file
          const errorsByFile = new Map<string, string[]>();
          for (const line of lintOutput.split('\n')) {
            const match = line.match(/^(.+?):(\d+):(\d+)?\s*(.+)/);
            if (match) {
              const file = match[1].trim();
              if (!errorsByFile.has(file)) errorsByFile.set(file, []);
              errorsByFile.get(file)!.push(line.trim());
            }
          }
          if (errorsByFile.size === 0) { info('无法解析 lint 输出'); return; }
          const targets = [...errorsByFile.entries()].slice(0, 5); // max 5 files
          const { writeFile, ensureDir } = await import('../utils/fs.js');
          for (const [file, errors] of targets) {
            const fp = path.resolve(rootPath, file);
            if (!(await fileExists(fp))) continue;
            const content = await readFile(fp);
            progress(`修复 lint: ${file} (${errors.length} 问题)`);
            const resp = await provider.chat({
              systemPrompt: '你是代码风格修复专家。只输出该文件的 JSON 变更契约。仅修复 lint 问题，不改逻辑。',
              task: `文件: ${file}\nlint 错误:\n${errors.slice(0, 10).join('\n')}\n\n当前内容:\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\`\n\n输出 { "content": "修复后的完整文件内容" }`,
              context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
            });
            try {
              const json = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
              if (json.content && json.content !== content) {
                await ensureDir(path.dirname(fp));
                await writeFile(fp, json.content);
                success(file + ` (${errors.length} 项修复)`);
              } else { info(file + ' (无需修改)'); }
            } catch { warn(file + ' (AI 响应解析失败)'); }
          }
          // Run lint again to verify
          if (lintCmd) {
            try {
              const { execSync } = await import('child_process');
              const after = execSync(lintCmd.command, { cwd: rootPath, timeout: 30000, encoding: 'utf-8', stdio: 'pipe' });
              const remaining = (after.match(/\berror\b|\bwarning\b/gi) || []).length;
              success(`验证: ${remaining > 0 ? `剩余 ${remaining} 个问题` : '无 lint 问题'}`);
            } catch (e: any) {
              const after = (e.stdout || '') + (e.stderr || '');
              const remaining = (after.match(/\berror\b|\bwarning\b/gi) || []).length;
              info(remaining > 0 ? `剩余 ${remaining} 个问题` : 'lint 通过');
            }
          }
          return;
        }

        // C12: Cross-file refactoring — AI reads multiple files, refactors coherently
        if (subcommand === 'refactor-files' && cleanArgs.length >= 2) {
          const instruction = cleanArgs.pop()!;
          const filePaths = cleanArgs.map(f => path.resolve(rootPath, f));
          const { fileExists: fe } = await import('../utils/fs.js');
          for (const fp of filePaths) {
            if (!(await fe(fp))) { fail('文件不存在: ' + fp); return; }
          }
          progress(`AI 跨文件重构 (${filePaths.length} 文件): ${instruction}`);
          const { refactorCrossFile } = await import('../core/code-writer.js');
          const idx = await (await import('../core/scanner.js')).loadProjectIndex(rootPath).catch(() => null);
          const result = await refactorCrossFile(filePaths, instruction, rootPath, idx, provider);
          if (result.files.length === 0) { info('AI 未建议修改'); return; }
          section(`跨文件重构 — ${result.files.length} 文件`);
          console.log(`  ${chalk.dim(result.explanation)}`);
          const { writeFile, ensureDir } = await import('../utils/fs.js');
          for (const f of result.files) {
            await ensureDir(path.dirname(f.path));
            await writeFile(f.path, f.refactored);
            const { filesToDiff } = await import('../cli/diff-renderer.js');
            const diff = filesToDiff([{ path: f.path, content: f.refactored, previousContent: f.original }]);
            if (diff) console.log(`\n${chalk.cyan(f.path)}\n${diff.slice(0, 800)}`);
            success(f.path);
          }
          return;
        }

        info('用法: ic code new <描述> [--with-tests] | fix | complete <文件> | refactor <描述> | scaffold <类型> <名称> | review [文件] | lint-fix [--go] | refactor-files <文件1 文件2...> <指令>');
      } catch (err) { printError(err as Error); }
    });
}
