// src/commands/docs.ts — ic docs command
// Extracted from src/index.ts (architecture split)
// Registers: docs (status | generate | check | edit | diff | history | section | sync |
//                   search | link | check-consistency | toc | template | translate |
//                   relate | format | diff-review | ask | summarize | rewrite | review)

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { fileExists } from '../utils/fs.js';
import { loadConfig } from '../config.js';
import { jsonEnvelope } from '../cli/json.js';
import {
  success, fail, warn, info, progress, section, detail,
  printError, ICONS,
} from '../cli/output.js';

export function registerDocsCommands(program: Command): void {
  // ic docs (D1-D4) — document generation and management
  program.command('docs')
    .description('产品文档管理：检测缺口、生成文档、质量检查')
    .argument('[action...]', 'status / generate [type] / check')
    .option('--json', 'JSON 格式')
    .action(async (args: string[], options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      const [action, ...rest] = args;
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化，请先运行 ic init'); }
        const { loadProjectIndex } = await import('../core/scanner.js');
        const index = await loadProjectIndex(rootPath);
        if (!index) { fail('项目未扫描，先运行 ic scan'); }
        const { detectDocGaps, DOC_TEMPLATES } = await import('../core/docs-generator.js');

        // ic docs status — show doc gaps
        if (!action || action === 'status') {
          const { existing, missing } = await detectDocGaps(rootPath, index);
          if (options?.json) { console.log(JSON.stringify(jsonEnvelope('docs-status', { existing, missing, total: DOC_TEMPLATES.length }), null, 2)); return; }
          section('文档状态');
          const pct = Math.round((existing.length / DOC_TEMPLATES.length) * 100);
          const bar = '█'.repeat(pct / 5) + '░'.repeat(20 - pct / 5);
          detail('完整度', `${bar} ${pct}% (${existing.length}/${DOC_TEMPLATES.length})`);
          console.log();
          for (const t of DOC_TEMPLATES) {
            const exists = existing.includes(t.type);
            console.log(`  ${exists ? ICONS.success : ICONS.warn} ${t.filename} — ${t.description}${t.required ? ' *必填' : ''}`);
          }
          if (missing.length > 0) {
            console.log(`\n  ${chalk.yellow(`缺失 ${missing.length} 个文档。运行 ic docs generate 自动生成`)}`);
          }
          console.log();
          return;
        }

        // ic docs generate [type] — generate documents
        if (action === 'generate') {
          const { existing: _existing, missing } = await detectDocGaps(rootPath, index);
          const targets = rest.length > 0
            ? DOC_TEMPLATES.filter(t => rest.includes(t.type))
            : DOC_TEMPLATES.filter(t => missing.includes(t.type));

          if (targets.length === 0) { success('文档完整，无需生成'); return; }

          progress(`准备生成 ${targets.length} 个文档...`);
          const { assembleDocsContext, buildDocGenerationPrompt, checkDocumentQuality } = await import('../core/docs-generator.js');
          const docsCtx = await assembleDocsContext(rootPath, index);

          if (options?.json) {
            console.log(JSON.stringify(jsonEnvelope('docs-gen', { targets: targets.map(t => t.type), contextSize: docsCtx.features.length }), null, 2));
            return;
          }

          // Generate docs using Agent orchestration (D3)
          const { AgentManager } = await import('../agent/manager.js');
          const mgr = new AgentManager(config.ai, targets.length);
          const results: import('../types.js').DocGenerationResult[] = [];

          for (const tpl of targets) {
            const { task } = buildDocGenerationPrompt(tpl.type, docsCtx);
            const agent = mgr.create({
              name: `生成${tpl.title}`,
              type: 'explore',
              context: { projectMeta: task, relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 },
            });
            const started = await mgr.start(agent.id, task);
            if (!started) { results.push({ type: tpl.type, filename: tpl.filename, status: 'failed', error: 'Agent 未启动' }); continue; }
            await mgr.waitForAgent(agent.id, 120000);
            const done = mgr.get(agent.id);
            if (done?.result?.output) {
              const qc = checkDocumentQuality(done.result.output);
              results.push({
                type: tpl.type, filename: tpl.filename, status: 'generated',
                content: done.result.output, qualityScore: qc.score,
              });
            } else {
              results.push({ type: tpl.type, filename: tpl.filename, status: 'failed', error: done?.result?.error || '无输出' });
            }
          }

          // Display results
          section('文档生成结果');
          let written = 0;
          for (const r of results) {
            const icon = r.status === 'generated' ? ICONS.success : ICONS.fail;
            const qc = r.qualityScore ? ` (质量: ${r.qualityScore}/100)` : '';
            console.log(`  ${icon} ${r.filename} — ${r.status}${qc}`);
            if (r.error) console.log(`    ${chalk.red(r.error)}`);
            if (r.content) {
              const { writeFile, ensureDir } = await import('../utils/fs.js');
              await ensureDir(path.join(rootPath, 'docs'));
              await writeFile(path.join(rootPath, 'docs', r.filename), r.content);
              written++;
            }
          }
          console.log(`\n  ${chalk.green(`${written} 个文档已写入 docs/`)}`);
          console.log();
          return;
        }

        // ic docs check — quality check existing docs
        if (action === 'check') {
          const { checkDocumentQuality } = await import('../core/docs-generator.js');
          const { readFile } = await import('../utils/fs.js');
          section('文档质量检查');
          for (const tpl of DOC_TEMPLATES) {
            const p = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            const fp = await fileExists(p) ? p : await fileExists(rp) ? rp : '';
            if (!fp) { console.log(`  ${ICONS.warn} ${tpl.filename} — 缺失`); continue; }
            const content = await readFile(fp);
            const qc = checkDocumentQuality(content);
            const icon = qc.pass ? ICONS.success : ICONS.warn;
            console.log(`  ${icon} ${tpl.filename} — ${qc.score}/100${qc.issues.length > 0 ? ' (' + qc.issues.join('/') + ')' : ''}`);
          }
          console.log();
          return;
        }

        // DM1: ic docs edit — AI incremental edit with visual diff
        if (action === 'edit' && rest.length >= 1) {
          const docType = rest[0].toUpperCase();
          const editPrompt = rest.slice(1).join(' ') || '更新文档';
          const tpl = DOC_TEMPLATES.find(t => t.type === docType);
          if (!tpl) { fail(`未知文档类型: ${docType}`); }
          const docPath = path.join(rootPath, 'docs', tpl.filename);
          const altPath = path.join(rootPath, tpl.filename);
          const fp = await fileExists(docPath) ? docPath : await fileExists(altPath) ? altPath : '';
          if (!fp) { fail(`${tpl.filename} 不存在，先运行 ic docs generate`); }
          progress(`编辑 ${tpl.filename}: ${editPrompt}`);
          const { editDocumentSection, saveDocSnapshot, showDocumentDiff } = await import('../core/docs-generator.js');
          const { createProvider: cp } = await import('../ai/provider.js');
          const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const { original, modified } = await editDocumentSection(fp, editPrompt, provider);
          await saveDocSnapshot(rootPath, tpl.filename, original);
          console.log(await showDocumentDiff(fp, original, modified));
          const { writeFile } = await import('../utils/fs.js');
          await writeFile(fp, modified);
          success(`${tpl.filename} 已更新`);
          return;
        }

        // DM1: ic docs diff — visual diff display
        if (action === 'diff' && rest.length >= 1) {
          const docType = rest[0].toUpperCase();
          const tpl = DOC_TEMPLATES.find(t => t.type === docType);
          if (!tpl) { fail(`未知文档类型: ${docType}`); }
          const docPath = path.join(rootPath, 'docs', tpl.filename);
          const altPath = path.join(rootPath, tpl.filename);
          const fp = await fileExists(docPath) ? docPath : await fileExists(altPath) ? altPath : '';
          if (!fp) { fail(`${tpl.filename} 不存在`); }
          const { readFile } = await import('../utils/fs.js');
          const content = await readFile(fp);
          const { listDocSnapshots, loadDocSnapshot, showDocumentDiff } = await import('../core/docs-generator.js');
          const snaps = await listDocSnapshots(rootPath, tpl.filename);
          if (snaps.length > 0) {
            const oldContent = await loadDocSnapshot(rootPath, snaps[0]);
            console.log(await showDocumentDiff(fp, oldContent, content));
          } else {
            info('无历史版本，显示最新变更');
            section(tpl.filename);
            console.log(content.slice(0, 2000));
          }
          return;
        }

        // DM2: ic docs history — version history
        if (action === 'history' && rest.length >= 1) {
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
          const { listDocSnapshots } = await import('../core/docs-generator.js');
          const snaps = await listDocSnapshots(rootPath, tpl.filename);
          if (snaps.length === 0) { info('无历史版本'); return; }
          section(`${tpl.filename} 版本历史`);
          for (const s of snaps.slice(0, 10)) console.log(`  ${chalk.dim('•')} ${s}`);
          console.log();
          return;
        }

        // DM2: ic docs section — section-level management
        if (action === 'section' && rest.length >= 2) {
          const { extractDocSections } = await import('../core/docs-generator.js');
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
          const docPath = path.join(rootPath, 'docs', tpl.filename);
          const fp = await fileExists(docPath) ? docPath : '';
          if (!fp) { fail(`${tpl.filename} 不存在`); }
          const { readFile } = await import('../utils/fs.js');
          const sections = extractDocSections(await readFile(fp));
          const headingFilter = rest[1];
          section(`${tpl.filename} 章节`);
          for (const s of sections) {
            if (!headingFilter || s.heading.includes(headingFilter)) {
              console.log(`  ${chalk.cyan('## ' + s.heading)}  ${chalk.dim(`(${s.body.split('\\n').length} 行)`)}`);
            }
          }
          console.log();
          return;
        }

        // DM2: ic docs sync — code changes → doc update
        if (action === 'sync') {
          const { detectDocAffectedFiles } = await import('../core/docs-generator.js');
          const affected = detectDocAffectedFiles(index);
          section('代码变更 → 文档影响');
          for (const [doc, modules] of Object.entries(affected)) {
            console.log(`  ${chalk.cyan(doc)} ← ${(modules as string[]).slice(0, 5).join(', ')}`);
          }
          if (Object.keys(affected).length === 0) info('无文档需要更新');
          console.log();
          return;
        }

        // DM3#9: ic docs search — full-text search
        if (action === 'search' && rest.length >= 1) {
          const query = rest.join(' ');
          const docs: Record<string, string> = {};
          for (const tpl of DOC_TEMPLATES) {
            const fp = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            try { docs[tpl.filename] = await (await import('../utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
          }
          const { searchDocs } = await import('../core/docs-generator.js');
          const results = searchDocs(docs, query);
          section(`搜索: ${query} (${results.length} 条)`);
          for (const r of results) console.log(`  ${chalk.cyan(r.file)}  ${chalk.dim(r.line)}`);
          console.log();
          return;
        }

        // DM3#5: ic docs link — cross-reference index
        if (action === 'link') {
          const docs: Record<string, string> = {};
          for (const tpl of DOC_TEMPLATES) {
            const fp = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            try { docs[tpl.filename] = await (await import('../utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
          }
          const { buildDocLinkIndex } = await import('../core/docs-generator.js');
          const links = buildDocLinkIndex(rootPath, docs);
          section('文档交叉引用');
          for (const [file, refs] of Object.entries(links)) {
            if ((refs as string[]).length > 0) console.log(`  ${chalk.cyan(file)} → ${(refs as string[]).join(', ')}`);
          }
          if (Object.values(links).every(r => (r as string[]).length === 0)) info('未发现文档间引用');
          console.log();
          return;
        }

        // DM3#12: ic docs check-consistency
        if (action === 'check-consistency') {
          const docs: Record<string, string> = {};
          for (const tpl of DOC_TEMPLATES) {
            const fp = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            try { docs[tpl.filename] = await (await import('../utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
          }
          const { checkDocsConsistency } = await import('../core/docs-generator.js');
          const issues = checkDocsConsistency(docs);
          section('文档一致性检查');
          if (issues.length === 0) success('文档一致，未发现问题');
          else for (const i of issues) console.log(`  ${ICONS.warn} ${chalk.cyan(i.file)} — ${i.issue}`);
          console.log();
          return;
        }

        // DM3#11: ic docs toc — generate table of contents
        if (action === 'toc' && rest.length >= 1) {
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail(`未知文档类型: ${rest[0]}`); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(`${tpl.filename} 不存在`); }
          const { readFile } = await import('../utils/fs.js');
          const { generateTOC } = await import('../core/docs-generator.js');
          const toc = generateTOC(await readFile(docPath));
          section(`${tpl.filename} 目录`);
          console.log(toc || '  (无标题)');
          console.log();
          return;
        }

        // DM3#13: ic docs template
        if (action === 'template') {
          const { getCustomTemplates, DOC_TEMPLATES: DT } = await import('../core/docs-generator.js');
          const custom = getCustomTemplates();
          section('文档模板');
          console.log('  默认 (9 类): ' + DT.map((t: { type: string }) => t.type).join(', '));
          if (custom.length > 0) console.log('  自定义: ' + custom.join(', '));
          else console.log('  自定义模板: (无)');
          console.log();
          return;
        }

        // D4: ic docs translate <type> --lang en
        if (action === 'translate' && rest.length >= 1) {
          const langIdx = rest.indexOf('--lang');
          const targetLang = langIdx >= 0 ? rest[langIdx + 1] || 'en' : 'en';
          const docName = langIdx >= 0 ? rest.slice(0, langIdx).join(' ') : rest.join(' ');
          const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
          if (!tpl) { fail('未知文档: ' + docName); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const { createProvider } = await import('../ai/provider.js');
          const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          const { translateDocument } = await import('../core/docs-generator.js');
          section(`翻译: ${tpl.filename} → ${targetLang}`);
          const translated = await translateDocument(content, targetLang, tpl.filename, provider);
          const langSuffix = targetLang === 'zh' ? '-zh' : targetLang === 'ja' ? '-ja' : '-en';
          const outPath = docPath.replace('.md', `${langSuffix}.md`);
          await (await import('../utils/fs.js')).writeFile(outPath, translated);
          success('已生成 ' + outPath);
          return;
        }

        // D3: ic docs relate <关键词> — cross-document relation analysis
        if (action === 'relate' && rest.length >= 1) {
          const { createProvider: cp } = await import('../ai/provider.js');
          const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const docs: Record<string, string> = {};
          for (const tpl of DOC_TEMPLATES) {
            const fp = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            try { docs[tpl.filename] = await (await import('../utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
          }
          if (Object.keys(docs).length === 0) { info('无文档可分析，先运行 ic docs generate'); return; }
          progress('跨文档关联: ' + rest.join(' '));
          const { relateDocuments } = await import('../core/docs-generator.js');
          section('跨文档关联分析');
          console.log(await relateDocuments(docs, rest.join(' '), provider));
          console.log();
          return;
        }

        // D5: ic docs format <type> --to html|json-outline
        if (action === 'format' && rest.length >= 1) {
          const toIdx = rest.indexOf('--to');
          const targetFormat = toIdx >= 0 ? rest[toIdx + 1] : 'html';
          const docName = toIdx >= 0 ? rest.slice(0, toIdx).join(' ') : rest.join(' ');
          const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
          if (!tpl) { fail('未知文档: ' + docName); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          const { convertDocFormat } = await import('../core/docs-generator.js');
          try {
            const from = docPath.endsWith('.html') ? 'html' : 'md';
            const converted = convertDocFormat(content, from, targetFormat);
            const ext = targetFormat === 'json-outline' ? '.json' : '.html';
            const outPath = docPath.replace(/\.\w+$/, ext);
            await (await import('../utils/fs.js')).writeFile(outPath, converted);
            success(`${outPath} (${from} → ${targetFormat})`);
          } catch (e) { warn((e as Error).message); }
          return;
        }

        // D10: ic docs diff-review <type> — AI compares current vs last snapshot
        if (action === 'diff-review' && rest.length >= 1) {
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail('未知文档: ' + rest[0]); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          const { listDocSnapshots, loadDocSnapshot, diffReviewDocuments } = await import('../core/docs-generator.js');
          const snaps = await listDocSnapshots(rootPath, tpl.filename);
          if (snaps.length === 0) { info('无历史快照。运行 ic docs edit 后自动保存快照。'); return; }
          progress(`AI 差异审查: ${tpl.filename}`);
          const oldContent = await loadDocSnapshot(rootPath, snaps[0]);
          const { createProvider: cp } = await import('../ai/provider.js');
          const provider = cp({ ...config.ai, apiKey: config.ai.apiKey || '' });
          section(tpl.filename + ' 版本差异审查');
          console.log(await diffReviewDocuments(oldContent, content, tpl.filename, provider));
          console.log();
          return;
        }

        // D1: ic docs ask — Q&A over all documents
        if (action === 'ask' && rest.length >= 1) {
          const { createProvider } = await import('../ai/provider.js');
          const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const docs: Record<string, string> = {};
          for (const tpl of DOC_TEMPLATES) {
            const fp = path.join(rootPath, 'docs', tpl.filename);
            const rp = path.join(rootPath, tpl.filename);
            try { docs[tpl.filename] = await (await import('../utils/fs.js')).readFile(await fileExists(fp) ? fp : rp); } catch { /* best-effort */ }
          }
          const { askDocuments } = await import('../core/docs-generator.js');
          const answer = await askDocuments(docs, rest.join(' '), provider);
          section('文档问答');
          console.log(answer);
          console.log();
          return;
        }

        // D2: ic docs summarize [file]
        if (action === 'summarize' && rest.length >= 1) {
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail('未知文档: ' + rest[0]); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const { createProvider } = await import('../ai/provider.js');
          const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const { summarizeDocument } = await import('../core/docs-generator.js');
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          section(tpl.filename + ' 摘要');
          console.log(await summarizeDocument(content, tpl.filename, provider));
          console.log();
          return;
        }

        // D8: ic docs rewrite [file] --for [role]
        if (action === 'rewrite' && rest.length >= 1) {
          const forIdx = rest.indexOf('--for');
          const targetRole = forIdx >= 0 ? rest[forIdx + 1] : 'beginner';
          const docName = forIdx >= 0 ? rest.slice(0, forIdx).join(' ') : rest.join(' ');
          const tpl = DOC_TEMPLATES.find(t => t.type === docName.toUpperCase());
          if (!tpl) { fail('未知文档: ' + docName); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const { createProvider } = await import('../ai/provider.js');
          const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const { rewriteDocument } = await import('../core/docs-generator.js');
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          const rewritten = await rewriteDocument(content, targetRole, provider);
          const outPath = path.join(path.dirname(docPath), tpl.filename.replace('.md', '-' + targetRole + '.md'));
          await (await import('../utils/fs.js')).writeFile(outPath, rewritten);
          success('已生成 ' + outPath);
          return;
        }

        // D9: ic docs review [file]
        if (action === 'review' && rest.length >= 1) {
          const tpl = DOC_TEMPLATES.find(t => t.type === rest[0].toUpperCase());
          if (!tpl) { fail('未知文档: ' + rest[0]); }
          const fp = path.join(rootPath, 'docs', tpl.filename);
          const rp = path.join(rootPath, tpl.filename);
          const docPath = await fileExists(fp) ? fp : await fileExists(rp) ? rp : '';
          if (!docPath) { fail(tpl.filename + ' 不存在'); }
          const { createProvider } = await import('../ai/provider.js');
          const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });
          const { reviewDocument } = await import('../core/docs-generator.js');
          const content = await (await import('../utils/fs.js')).readFile(docPath);
          section(tpl.filename + ' 审查报告');
          console.log(await reviewDocument(content, tpl.filename, provider));
          console.log();
          return;
        }

        info('用法: ic docs [status|generate|check|edit|diff|ask|summarize|review|rewrite|history|section|sync|search|link|check-consistency|toc|template]');
      } catch (err) { printError(err as Error); }
    });
}
