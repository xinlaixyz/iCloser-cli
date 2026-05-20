// Memory Kernel v1.0 — CLI handler functions (ic mem <verb>)
// Called from src/index.ts via dynamic import
import chalk from 'chalk';
import type { MemoryRuntime } from './runtime.js';

const { section, detail, divider, success, warn, info, progress } = await import('../../cli/output.js');

async function getMemoryRuntimeForCLI(rootPath: string): Promise<MemoryRuntime> {
  // Use shared singleton — the same instance that REPL and TaskEngine use
  const { getMemoryRuntime } = await import('./integration.js');
  return getMemoryRuntime(rootPath);
}

export async function printMemoryKernelStatus(rootPath: string): Promise<void> {
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const status = runtime.getStatus();
    const { memdbg } = await import('./debug.js');
    const dbgSummary = memdbg.summary();
    const { isMemoryActive } = await import('./integration.js');

    // ── Top-line status ──
    const active = isMemoryActive();
    const statusIcon = active ? chalk.green('● 已激活') : chalk.yellow('○ 待激活');
    section(`Memory Kernel ${statusIcon}`);

    if (!active) {
      console.log(`  ${chalk.dim('Memory Kernel 尚未完成初始化。运行一次任务后自动激活。')}`);
      if (dbgSummary.lastError) {
        console.log(`  ${chalk.red('最近错误:')} ${chalk.dim(dbgSummary.lastError)}`);
      }
      console.log();
      return;
    }

    // ── Memory stores ──
    console.log(`  ${chalk.bold('存储')}`);
    const epCount = status.episodic.totalEvents;
    const semCount = status.semantic.totalRules;
    const highConf = status.semantic.highConfidenceCount;
    const epLabel = epCount > 0 ? chalk.green(`${epCount} 条`) : chalk.dim(`${epCount} 条`);
    const semLabel = semCount > 0 ? chalk.green(`${semCount} 条`) : chalk.dim(`${semCount} 条`);
    console.log(`    情景记忆: ${epLabel}  语义规则: ${semLabel}  (高置信: ${highConf})`);

    // ── Recall effectiveness ──
    console.log(`  ${chalk.bold('Recall 检索')}`);
    const totalRecall = status.metrics.recallHits + status.metrics.recallMisses;
    const hitRate = totalRecall > 0 ? (status.metrics.recallHits / totalRecall * 100).toFixed(0) : '—';
    console.log(`    命中率: ${chalk.cyan(hitRate + '%')}  (${status.metrics.recallHits} 命中 / ${totalRecall} 次)`);

    // ── Working memory ──
    console.log(`  ${chalk.bold('工作记忆')}`);
    const wmPct = (status.workingMemory.usageRatio * 100).toFixed(0);
    const wmColor = status.workingMemory.status === 'critical' ? chalk.red : status.workingMemory.status === 'warn' ? chalk.yellow : chalk.green;
    console.log(`    用量: ${wmColor(wmPct + '%')}  (${status.workingMemory.tokenCount} tokens)`);

    // ── Lifecycle ──
    console.log(`  ${chalk.bold('生命周期')}`);
    const consLabel = status.lastConsolidation
      ? chalk.dim(status.lastConsolidation.slice(0, 19).replace('T', ' '))
      : chalk.dim('尚未执行');
    const forgLabel = status.lastForgetting
      ? chalk.dim(status.lastForgetting.slice(0, 19).replace('T', ' '))
      : chalk.dim('尚未执行');
    console.log(`    上次固化: ${consLabel}  上次遗忘: ${forgLabel}`);
    console.log(`    任务处理: ${status.metrics.tasksProcessed}  创建规则: ${status.metrics.rulesCreated}  记录事件: ${status.metrics.episodesRecorded}`);

    // ── Diagnostics (only if errors) ──
    if (dbgSummary.errorCount > 0) {
      console.log(`  ${chalk.yellow('诊断')}`);
      console.log(`    ${chalk.yellow(`${dbgSummary.errorCount} 个内部错误`)}${dbgSummary.lastError ? `  最近: ${chalk.dim(dbgSummary.lastError.slice(0, 120))}` : ''}`);
      console.log(`    ${chalk.dim('设置 ICLOSER_MEMORY_DEBUG=info 查看详细日志')}`);
    }

    // ── Hint for new users ──
    if (epCount === 0 && semCount === 0) {
      console.log();
      console.log(`  ${chalk.cyan('💡 Memory Kernel 已激活，将自动学习你的偏好和项目规则。')}`);
      console.log(`  ${chalk.dim('每次对话结束后自动记录情景事件，每 5 次任务触发规则固化。')}`);
      console.log(`  ${chalk.dim('运行 ic mem recall "关键词" 搜索记忆，ic mem rule add "规则" 手动添加规则。')}`);
    }

    console.log();
  } catch (err) {
    warn('Memory Kernel 未激活。运行 ic init 初始化项目。');
    detail('原因', (err as Error).message);
    console.log(`  ${chalk.dim('提示: 设置 ICLOSER_MEMORY_DEBUG=info 查看初始化日志')}`);
  }
}

export async function printMemoryRecall(rootPath: string, query: string): Promise<void> {
  if (!query) { warn('请提供查询关键词，例如: ic mem recall "钱包 UI 修改"'); return; }
  try {
    progress(`正在检索: ${query}`);
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const results = await runtime.recall.recall(query);
    if (results.length === 0) { info('未找到相关记忆'); return; }
    section(`Recall 结果 (${results.length} 条)`);
    for (const [i, r] of results.entries()) {
      const typeLabel = r.type === 'semantic' ? '规则' : r.type === 'emotion' ? '重要' : '历史';
      console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${chalk.yellow(`[${typeLabel}]`)} ${(r.score * 100).toFixed(0)}%`);
      console.log(`      ${r.content.slice(0, 250)}`);
      console.log();
    }
  } catch (err) {
    warn('Recall 失败');
    detail('错误', (err as Error).message);
  }
}

export async function runMemoryConsolidate(rootPath: string): Promise<void> {
  try {
    progress('正在固化记忆...');
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const count = await runtime.runConsolidation();
    if (count > 0) { success(`固化完成: ${count} 条新语义规则`); }
    else { info('固化完成: 未发现新模式（事件不足或未满足最小出现次数）'); }
  } catch (err) {
    warn('固化失败');
    detail('错误', (err as Error).message);
  }
}

export async function runMemoryForget(rootPath: string): Promise<void> {
  try {
    progress('正在清理低分记忆...');
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const result = await runtime.runForgetting();
    const total = result.archived + result.deleted;
    if (total > 0) { success(`遗忘清理完成: ${result.archived} 归档, ${result.deleted} 删除`); }
    else { info('遗忘清理完成: 当前记忆不需要清理'); }
  } catch (err) {
    warn('遗忘清理失败');
    detail('错误', (err as Error).message);
  }
}

export async function printMemoryInspect(rootPath: string, type: string): Promise<void> {
  if (!type) {
    console.log(`  ${chalk.cyan('ic mem inspect working')}     查看当前工作记忆`);
    console.log(`  ${chalk.cyan('ic mem inspect semantic')}    查看语义规则库`);
    console.log(`  ${chalk.cyan('ic mem inspect episodic')}   查看情景记忆(近30天)`);
    return;
  }
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    if (type === 'working') {
      const wm = runtime.working;
      section(`工作记忆 (${wm.tokenCount} tokens, ${wm.status})`);
      const layers = (wm as any).layers as Array<{ type: string; content: string; priority: number }>;
      if (layers.length === 0) { info('当前工作记忆为空'); return; }
      for (const l of layers.slice(-15).reverse()) {
        const preview = l.content.length > 120 ? l.content.slice(0, 120) + '...' : l.content;
        console.log(`  ${chalk.dim(`[${l.type}]`)} p=${l.priority} ${preview}`);
      }
    } else if (type === 'semantic') {
      const tree = runtime.semantic.getTree();
      if (tree.size === 0) { info('暂无语义规则。固化后自动生成。'); return; }
      section(`语义规则 (${runtime.semantic.totalRules} 条)`);
      for (const [prefix, domainRules] of tree) {
        console.log(`  ${chalk.cyan(prefix)} (${domainRules.length} 条)`);
        for (const r of domainRules.slice(0, 5)) {
          const flag = r.isPermanent ? 'P' : r.confidence >= 0.7 ? 'V' : r.confidence >= 0.4 ? ' ' : '?';
          console.log(`    ${flag} [${(r.confidence * 100).toFixed(0)}%] ${r.content.slice(0, 100)}`);
        }
      }
    } else if (type === 'episodic') {
      const episodes = runtime.episodic.recent(30, 30);
      if (episodes.length === 0) { info('暂无情景事件。执行任务后自动记录。'); return; }
      section(`情景记忆 — 近30天 (${episodes.length} 条)`);
      for (const ep of episodes.slice(-20).reverse()) {
        const ts = ep.timestamp.slice(0, 19).replace('T', ' ');
        const imp = ep.importance >= 0.7 ? chalk.red('!') : ep.importance >= 0.4 ? chalk.yellow('*') : chalk.dim('.');
        console.log(`  ${imp} ${chalk.dim(ts)} [${ep.type}] ${ep.summary.slice(0, 100)}`);
      }
    } else {
      warn(`未知类型: ${type}. 可用: working | semantic | episodic`);
    }
  } catch (err) {
    warn('查看失败');
    detail('错误', (err as Error).message);
  }
}

export async function printMemoryStats(rootPath: string): Promise<void> {
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const status = runtime.getStatus();
    const store = (runtime as any).store;
    const sqliteStats = store.sqlite.getStats();
    section('Memory Kernel 统计');
    detail('情景事件', `${status.episodic.totalEvents}`);
    detail('语义规则', `${status.semantic.totalRules}`);
    detail('数据库大小', sqliteStats.dbSize);
    divider();
    const totalRecall = status.metrics.recallHits + status.metrics.recallMisses;
    detail('Recall 命中率', totalRecall > 0 ? `${(status.metrics.recallHits / totalRecall * 100).toFixed(0)}%` : 'N/A');
    detail('固化次数', `${status.metrics.consolidationsRun}`);
    detail('创建规则', `${status.metrics.rulesCreated}`);
    detail('工作记忆', `${(status.workingMemory.usageRatio * 100).toFixed(0)}%`);
  } catch {
    warn('Memory Kernel 未激活');
  }
}

export async function memoryManifestImport(rootPath: string, files: string[] = []): Promise<void> {
  try {
    progress('正在导入 Agent 记忆文件...');
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const { importAgentMemoryManifests } = await import('./manifest.js');
    const result = await importAgentMemoryManifests(rootPath, runtime.semantic, files.length > 0 ? files : undefined);
    if (result.rulesAdded === 0) {
      info('未发现可导入的 Agent 记忆规则');
      return;
    }
    success(`已导入 ${result.rulesAdded} 条规则，来源 ${result.filesImported}/${result.filesScanned} 个文件`);
    for (const source of result.sources) {
      detail(source.file, `${source.rules} 条`);
    }
  } catch (err) {
    warn('导入 Agent 记忆失败');
    detail('错误', (err as Error).message);
  }
}

export async function memoryManifestExport(rootPath: string, file = 'AGENTS.md'): Promise<void> {
  try {
    progress(`正在导出项目记忆到 ${file}...`);
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const { exportAgentMemoryManifest } = await import('./manifest.js');
    const result = await exportAgentMemoryManifest(rootPath, runtime.semantic, file);
    success(`已导出 ${result.rulesExported} 条规则到 ${result.file}`);
  } catch (err) {
    warn('导出 Agent 记忆失败');
    detail('错误', (err as Error).message);
  }
}

export async function printMemoryManifestFiles(rootPath: string): Promise<void> {
  const { listAgentMemoryManifests } = await import('./manifest.js');
  const files = await listAgentMemoryManifests(rootPath);
  section('Agent 记忆文件');
  for (const file of files) {
    const mark = file.exists ? chalk.green('exists') : chalk.dim('missing');
    console.log(`  ${mark}  ${file.file}`);
  }
}

export async function memoryRuleAdd(rootPath: string, description: string): Promise<void> {
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const rule = runtime.semantic.add({
      path: '手动规则/用户定义', domain: 'General', content: description,
      scope: 'project', confidence: 0.5, verificationCount: 0,
      sourceEpisodeIds: [], tags: ['manual'], isPermanent: false,
    });
    await runtime.semantic.save();
    success(`规则已添加: ${rule.id}`);
    console.log(`  ${chalk.cyan('内容')}: ${rule.content}`);
  } catch { warn('添加规则失败'); }
}

export async function memoryRuleList(rootPath: string): Promise<void> {
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    const tree = runtime.semantic.getTree();
    if (tree.size === 0) { info('暂无语义规则'); return; }
    section(`语义规则 (${runtime.semantic.totalRules} 条)`);
    for (const [prefix, rules] of tree) {
      console.log(`  ${chalk.cyan(prefix)}`);
      for (const r of rules) {
        const flag = r.isPermanent ? 'P' : r.confidence >= 0.7 ? 'V' : r.confidence >= 0.4 ? ' ' : '?';
        console.log(`    ${flag} ${chalk.dim(r.id.slice(0, 12))} ${r.content.slice(0, 100)}`);
      }
    }
  } catch { warn('列出规则失败'); }
}

export async function memoryRuleDelete(rootPath: string, id: string): Promise<void> {
  try {
    const runtime = await getMemoryRuntimeForCLI(rootPath);
    if (runtime.semantic.delete(id)) {
      await runtime.semantic.save();
      success(`规则已删除: ${id}`);
    } else { warn(`未找到规则: ${id}`); }
  } catch { warn('删除规则失败'); }
}
