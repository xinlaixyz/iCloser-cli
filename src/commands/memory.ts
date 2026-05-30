// src/commands/memory.ts — Memory & intelligence commands
// Extracted from src/index.ts (P3#22)
// Registers: mem, overview, loop, intel

import { Command } from 'commander';
import chalk from 'chalk';
import { success, fail, warn, info, section, detail, progress, printError } from '../cli/output.js';
import { jsonEnvelope } from '../cli/json.js';
import type { ProjectMemory, MemoryCandidate } from '../types.js';

// ════════════════════════════════════════════════════════════
// Private helpers
// ════════════════════════════════════════════════════════════

async function printMemoryEvents(rootPath: string): Promise<void> {
  const { loadUserInputEvents } = await import('../core/memory.js');
  const events = await loadUserInputEvents(rootPath);
  if (events.length === 0) {
    info('暂无用户输入事件。运行 ic init 和 ic t 后会开始记录。');
    return;
  }
  section(`用户输入事件 (最近 ${Math.min(events.length, 10)} 条)`);
  const recent = events.slice(-10).reverse();
  for (const e of recent) {
    const kindLabel = e.kind === 'task-description' ? '任务' :
      e.kind === 'rule' ? '约束' :
      e.kind === 'slash-command' ? '命令' :
      e.kind === 'api-key' ? 'API Key' :
      e.kind === 'chat' ? '对话' :
      e.kind === 'approval' ? '审批' :
      e.kind === 'rejection' ? '拒绝' :
      e.kind === 'correction' ? '修正' : '其他';
    const icon = e.redacted ? chalk.yellow('▸') : chalk.green('▸');
    const created = e.createdAt.substring(0, 19).replace('T', ' ');
    const preview = e.content.length > 80 ? e.content.substring(0, 80) + '...' : e.content;
    const flags = [
      e.redacted ? chalk.yellow('已脱敏') : '',
      e.taskId ? chalk.dim(`task:${e.taskId.substring(0, 10)}`) : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${icon} ${chalk.dim(`[${created}]`)} ${chalk.cyan(`[${kindLabel}]`)} ${preview}`);
    if (flags) console.log(`    ${chalk.dim(flags)}`);
  }
}

function getPendingMemoryCandidates(memory: ProjectMemory): MemoryCandidate[] {
  return (memory.memoryCandidates || []).filter(candidate => candidate.reviewStatus === 'proposed');
}

function resolveMemoryCandidate(memory: ProjectMemory, selector: string): MemoryCandidate | null {
  const pending = getPendingMemoryCandidates(memory);
  const asNumber = Number(selector);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= pending.length) {
    return pending[asNumber - 1];
  }
  return pending.find(candidate => candidate.id === selector || candidate.id.startsWith(selector)) || null;
}

async function printMemoryReview(rootPath: string): Promise<void> {
  const { loadProjectMemory } = await import('../core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const pending = getPendingMemoryCandidates(memory);
  if (pending.length === 0) {
    success('没有需要你确认的记忆。系统会继续自动整理低风险内容。');
    return;
  }

  section(`需要确认的记忆 (${pending.length} 条)`);
  for (const [index, candidate] of pending.slice(0, 5).entries()) {
    const n = index + 1;
    const riskLabel = candidate.riskLevel === 'high' ? chalk.red('高风险') :
      candidate.riskLevel === 'medium' ? chalk.yellow('中风险') :
      chalk.green('低风险');
    console.log(`  ${chalk.cyan(`[${n}]`)} ${candidate.summary}`);
    console.log(`      ${riskLabel} ${chalk.dim('|')} ${candidate.reason}`);
  }
  console.log();
  console.log(`  ${chalk.green('[1]')} 保存第 1 条到项目记忆`);
  console.log(`      ${chalk.cyan('ic mem approve 1')}`);
  console.log(`  ${chalk.yellow('[2]')} 暂不保存第 1 条`);
  console.log(`      ${chalk.cyan('ic mem reject 1')}`);
  console.log(`  ${chalk.dim('[3]')} 以后再说`);
  console.log();
}

async function updateMemoryCandidateReview(
  rootPath: string,
  selector: string,
  status: 'approved' | 'archived',
): Promise<void> {
  if (!selector) {
    warn(`请告诉我要处理第几条，例如：${chalk.cyan(`ic mem ${status === 'approved' ? 'approve' : 'reject'} 1`)}`);
    return;
  }

  const { loadProjectMemory, saveProjectMemory } = await import('../core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const match = resolveMemoryCandidate(memory, selector);
  if (!match) {
    warn(`没有找到待确认记忆：${chalk.cyan(selector)}。先运行 ${chalk.cyan('ic mem review')} 查看序号。`);
    return;
  }

  const now = new Date().toISOString();
  match.reviewStatus = status;
  match.updatedAt = now;
  match.metadata.reviewStatus = status;
  match.metadata.updatedAt = now;
  await saveProjectMemory(rootPath, memory);

  if (status === 'approved') {
    success(`已保存到项目记忆：${match.summary}`);
    try {
      const { ensureAgentMemoryManifest } = await import('../core/memory-experience.js');
      const manifest = await ensureAgentMemoryManifest(rootPath, 'AGENTS.md', { force: true });
      detail('已同步', manifest.path);
    } catch { /* manifest sync best-effort */ }
  } else {
    warn(`已暂不保存：${match.summary}`);
  }
}

async function printMemoryCandidates(rootPath: string): Promise<void> {
  const { loadProjectMemory } = await import('../core/memory.js');
  const memory = await loadProjectMemory(rootPath);
  const candidates = memory.memoryCandidates || [];
  if (candidates.length === 0) {
    info('暂无自动整理的记忆。你直接使用任务和规则命令后，系统会自动归纳。');
    return;
  }

  const approved = candidates.filter(c => c.reviewStatus === 'approved').length;
  const proposed = candidates.filter(c => c.reviewStatus === 'proposed').length;
  const archived = candidates.filter(c => c.reviewStatus === 'archived').length;
  section('记忆处理');
  detail('自动保存', `${approved} 条`);
  detail('待确认', `${proposed} 条`);
  detail('已归档', `${archived} 条`);
  console.log();

  const recent = candidates.slice(-10).reverse();
  for (const c of recent) {
    const statusLbl = c.reviewStatus === 'approved' ? chalk.green('已自动保存') :
      c.reviewStatus === 'proposed' ? chalk.yellow(c.suggestedAction === 'ask-now' ? '需要确认' : '待确认') :
      c.reviewStatus === 'archived' ? chalk.dim('已归档') :
      chalk.dim('草稿');
    const riskLabel = c.riskLevel === 'high' ? chalk.red('高风险') :
      c.riskLevel === 'medium' ? chalk.yellow('中风险') :
      chalk.green('低风险');
    const kindLabel = c.kind === 'preference' ? '偏好' :
      c.kind === 'rule' ? '规则' :
      c.kind === 'template' ? '模板' :
      c.kind === 'fact' ? '事实' :
      c.kind === 'sensitive' ? '敏感输入' : '其他';
    const created = c.createdAt.substring(0, 19).replace('T', ' ');
    console.log(`  ${chalk.cyan(`[${kindLabel}]`)} ${c.summary}`);
    console.log(`    ${statusLbl} ${chalk.dim('|')} ${riskLabel} ${chalk.dim('|')} ${chalk.dim(created)}`);
    if (c.reason) console.log(`    ${chalk.dim(c.reason)}`);
  }
}

// ════════════════════════════════════════════════════════════
// registerMemoryCommands — called from src/index.ts
// ════════════════════════════════════════════════════════════

export function registerMemoryCommands(program: Command): void {
  // ============================================================
  // ic mem — real memory
  // ============================================================
  program.command('mem')
    .alias('memory')
    .description('查看和管理项目记忆')
    .argument('[args...]', 'status / recall <q> / import/export/manifests / bootstrap / consolidate / forget / inspect <type> / rule add/list / 搜索关键词')
    .action(async (args: string[] = []) => {
      const rootPath = process.cwd();
      try {
        const [verb, ...rest] = args;
        const query = args.join(' ').trim();
        if (!verb || verb === 'help') {
          console.log(`\n${chalk.bold('ic mem — 项目记忆管理')}\n`);
          console.log(`  ${chalk.cyan('ic mem')}                      查看记忆摘要`);
          console.log(`  ${chalk.cyan('ic mem events')}              查看用户输入事件`);
          console.log(`  ${chalk.cyan('ic mem candidates')}          查看记忆候选`);
          console.log(`  ${chalk.cyan('ic mem review')}              待确认记忆审查`);
          console.log(`  ${chalk.cyan('ic mem edit [file]')}          创建/查看 Agent 记忆文件`);
          console.log(`  ${chalk.cyan('ic mem edit add <规则>')}      添加项目规则并写回 AGENTS.md`);
          console.log(`  ${chalk.cyan('ic mem edit delete <id>')}     删除项目规则并写回 AGENTS.md`);
          console.log(`  ${chalk.cyan('ic mem edit list')}            查看项目规则`);
          console.log(`  ${chalk.cyan('ic mem why <id|关键词>')}      解释某条记忆为什么会被使用`);
          console.log(`  ${chalk.cyan('ic mem used <任务描述>')}      预览任务执行前会采用的记忆`);
          console.log(`  ${chalk.cyan('ic mem import [file...]')}     导入 AGENTS.md / CLAUDE.md 等 Agent 记忆文件`);
          console.log(`  ${chalk.cyan('ic mem export [file]')}        导出项目规则到 AGENTS.md`);
          console.log(`  ${chalk.cyan('ic mem manifests')}            查看可识别的 Agent 记忆文件`);
          console.log(`  ${chalk.cyan('ic mem approve <序号|id>')}    批准记忆候选`);
          console.log(`  ${chalk.cyan('ic mem reject <序号|id>')}     拒绝记忆候选`);
          console.log(`  ${chalk.cyan('ic mem global')}              查看全局记忆`);
          console.log(`  ${chalk.cyan('ic mem <关键词>')}             搜索记忆\n`);
          return;
        }
        if (verb === 'events') {
          await printMemoryEvents(rootPath);
        } else if (verb === 'candidates') {
          await printMemoryCandidates(rootPath);
        } else if (verb === 'review') {
          await printMemoryReview(rootPath);
        } else if (verb === 'edit') {
          const sub = rest[0];
          if (sub === 'add' || sub === '--rule' || sub === 'rule') {
            const { addProjectMemoryRule } = await import('../core/memory-experience.js');
            const content = rest.slice(1).join(' ').trim();
            if (!content) {
              warn(`请提供规则内容，例如：${chalk.cyan('ic mem edit add "默认先跑 tsc"')}`);
              return;
            }
            const rule = await addProjectMemoryRule(rootPath, content);
            success(`已添加项目规则：${rule.id}`);
            detail('规则', rule.description);
            detail('已同步', 'AGENTS.md');
            return;
          }
          if (sub === 'delete' || sub === 'remove' || sub === 'rm') {
            const { deleteProjectMemoryRule } = await import('../core/memory-experience.js');
            const selector = rest.slice(1).join(' ').trim();
            if (!selector) {
              warn(`请提供规则 id 或关键词，例如：${chalk.cyan('ic mem edit delete rule-abc')}`);
              return;
            }
            const removed = await deleteProjectMemoryRule(rootPath, selector);
            if (!removed) warn(`没有找到项目规则：${chalk.cyan(selector)}`);
            else {
              success(`已删除项目规则：${removed.id}`);
              detail('已同步', 'AGENTS.md');
            }
            return;
          }
          if (sub === 'list' || sub === 'ls') {
            const { loadProjectMemory } = await import('../core/memory.js');
            const memory = await loadProjectMemory(rootPath);
            section('项目规则');
            if (memory.rules.length === 0) info('暂无项目规则。');
            for (const rule of memory.rules) console.log(`  ${chalk.cyan(rule.id)} ${rule.description} ${chalk.dim(rule.scope)}`);
            return;
          }
          const { ensureAgentMemoryManifest } = await import('../core/memory-experience.js');
          const manifest = await ensureAgentMemoryManifest(rootPath, rest[0] || 'AGENTS.md');
          if (manifest.created) success(`已创建 Agent 记忆文件：${manifest.path}`);
          else success(`Agent 记忆文件已存在：${manifest.path}`);
          console.log();
          console.log(manifest.content);
        } else if (verb === 'why') {
          const { explainMemoryUse } = await import('../core/memory-experience.js');
          const selector = rest.join(' ').trim();
          if (!selector) {
            warn(`请提供记忆 id 或关键词，例如：${chalk.cyan('ic mem why memory')}`);
            return;
          }
          const result = await explainMemoryUse(rootPath, selector);
          if (!result) {
            info(`未找到可解释的记忆：${chalk.cyan(selector)}`);
            return;
          }
          section('记忆解释');
          detail('来源', `${result.source} ${result.status ? `(${result.status})` : ''}`);
          detail('标题', result.title);
          detail('原因', result.reason);
          if (result.riskLevel) detail('风险', result.riskLevel);
          if (result.taskId) detail('任务', result.taskId);
          if (result.updatedAt) detail('更新时间', result.updatedAt);
          if (result.content) {
            console.log();
            console.log(chalk.cyan('内容'));
            console.log(`  ${result.content}`);
          }
          if (result.evidence.length > 0) {
            console.log();
            console.log(chalk.cyan('证据'));
            for (const item of result.evidence) console.log(`  - ${item}`);
          }
        } else if (verb === 'used') {
          const { buildTaskMemorySummary, renderTaskMemorySummary } = await import('../core/memory-experience.js');
          const taskText = rest.join(' ').trim();
          if (!taskText) {
            warn(`请提供任务描述，例如：${chalk.cyan('ic mem used "修复登录测试"')}`);
            return;
          }
          const summary = await buildTaskMemorySummary(rootPath, taskText, 8);
          const rendered = renderTaskMemorySummary(summary);
          if (!rendered) {
            info('当前任务没有命中长期记忆。');
            return;
          }
          console.log(rendered);
        } else if (verb === 'import') {
          const { memoryManifestImport } = await import('../core/memory/cli-handlers.js');
          await memoryManifestImport(rootPath, rest);
        } else if (verb === 'export') {
          const { memoryManifestExport } = await import('../core/memory/cli-handlers.js');
          await memoryManifestExport(rootPath, rest[0] || 'AGENTS.md');
        } else if (verb === 'manifests') {
          const { printMemoryManifestFiles } = await import('../core/memory/cli-handlers.js');
          await printMemoryManifestFiles(rootPath);
        } else if (verb === 'approve' || verb === 'accept') {
          await updateMemoryCandidateReview(rootPath, rest.join(' ').trim(), 'approved');
        } else if (verb === 'reject' || verb === 'archive') {
          await updateMemoryCandidateReview(rootPath, rest.join(' ').trim(), 'archived');
        } else if (verb === 'status') {
          const { printMemoryKernelStatus } = await import('../core/memory/cli-handlers.js');
          await printMemoryKernelStatus(rootPath);
        } else if (verb === 'recall') {
          const { printMemoryRecall } = await import('../core/memory/cli-handlers.js');
          await printMemoryRecall(rootPath, rest.join(' ').trim());
        } else if (verb === 'consolidate') {
          const { runMemoryConsolidate } = await import('../core/memory/cli-handlers.js');
          await runMemoryConsolidate(rootPath);
        } else if (verb === 'forget') {
          const { runMemoryForget } = await import('../core/memory/cli-handlers.js');
          await runMemoryForget(rootPath);
        } else if (verb === 'inspect') {
          const { printMemoryInspect } = await import('../core/memory/cli-handlers.js');
          await printMemoryInspect(rootPath, rest[0] || '');
        } else if (verb === 'rule') {
          const sub = rest[0]; const ruleContent = rest.slice(1).join(' ').trim();
          const { memoryRuleAdd, memoryRuleList, memoryRuleDelete } = await import('../core/memory/cli-handlers.js');
          if (sub === 'add' && ruleContent) { await memoryRuleAdd(rootPath, ruleContent); }
          else if (sub === 'list') { await memoryRuleList(rootPath); }
          else if (sub === 'delete' && ruleContent) { await memoryRuleDelete(rootPath, ruleContent); }
          else { console.log(`  ${chalk.cyan('ic mem rule add <描述>')} / ${chalk.cyan('list')} / ${chalk.cyan('delete <id>')}`); }
        } else if (verb === 'bootstrap') {
          progress('正在从项目历史引导 Memory Kernel...');
          try {
            const { getMemoryRuntime } = await import('../core/memory/integration.js');
            const runtime = await getMemoryRuntime(rootPath);
            const { bootstrapMemoryKernel } = await import('../core/memory/bootstrap.js');
            const result = await bootstrapMemoryKernel(rootPath, runtime);
            success(`Bootstrap 完成: ${result.episodesCreated} 事件, ${result.rulesCreated} 规则, ${result.patternsFound.length} 模式`);
            if (result.errors.length > 0) {
              for (const err of result.errors) warn(err);
            }
          } catch (err) { warn(`Bootstrap 失败: ${(err as Error).message}`); }
        } else if (verb === 'stats') {
          const { printMemoryStats } = await import('../core/memory/cli-handlers.js');
          await printMemoryStats(rootPath);
        } else if (verb === 'global') {
          const { loadGlobalMemory } = await import('../core/memory.js');
          const gm = await loadGlobalMemory();
          section('全局记忆');
          detail('技术栈', `${gm.techStacks.size} 个`);
          detail('模式', `${gm.patterns.size} 个`);
          detail('踩坑', `${gm.pitfalls.length} 条`);
          detail('Skill 历史', `${gm.skillHistory.length} 条`);
          detail('偏好 AI', gm.preferences.preferredAI);
          detail('并发数', `${gm.preferences.maxParallelTasks}`);
        } else if (query) {
          const { loadProjectMemory, searchMemory } = await import('../core/memory.js');
          const memory = await loadProjectMemory(rootPath);
          const results = await searchMemory(memory, query);
          if (results.length === 0) {
            info(`未找到匹配 "${chalk.cyan(query)}" 的记忆`);
          } else {
            section(`搜索结果 (${results.length} 条)`);
            for (const r of results.slice(0, 10)) {
              if ('decision' in r) console.log(`  ${chalk.cyan('[决策]')} ${(r as import('../types.js').DecisionRecord).decision.substring(0, 80)}`);
              else if ('scope' in r) console.log(`  ${chalk.cyan('[约束]')} ${(r as import('../types.js').ArchitectureRule).description}`);
              else if ('content' in r) console.log(`  ${chalk.cyan('[反馈]')} ${(r as import('../types.js').FeedbackRecord).content.substring(0, 80)}`);
              else if ('taskId' in r) console.log(`  ${chalk.cyan('[任务]')} ${(r as import('../types.js').TaskRecord).summary.substring(0, 80)}`);
            }
          }
        } else {
          const { loadProjectMemory } = await import('../core/memory.js');
          const { loadConfig } = await import('../config.js');
          const config = await loadConfig(rootPath);
          const memory = await loadProjectMemory(rootPath);
          section('项目记忆');
          if (config) {
            detail('项目', config.project.name);
            detail('语言', config.project.identity.language);
            detail('框架', config.project.identity.framework || '无');
          }
          detail('任务记录', `${memory.taskHistory.length} 条`);
          detail('架构约束', `${memory.rules.length} 条`);
          detail('决策记录', `${memory.decisions.length} 条`);
          detail('用户反馈', `${memory.feedbacks.length} 条`);
        }
        console.log();
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic overview — project health dashboard
  // ============================================================
  program.command('overview')
    .alias('info')
    .description('项目健康总览：初始化状态、Provider、任务、Agent、工具、记忆、Git')
    .option('--json', 'JSON 格式输出')
    .action(async (options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const { loadConfig } = await import('../config.js');
        const { loadProjectIndex } = await import('../core/scanner.js');
        const { listTasks } = await import('../core/task-engine.js');
        const { getProviderStatus } = await import('../ai/provider.js');
        const { buildToolCapabilitySnapshot } = await import('../core/tool-registry.js');
        const { isGitRepo, getCurrentBranch, getGitStatus } = await import('../utils/git.js');

        const config = await loadConfig(rootPath);
        const index = await loadProjectIndex(rootPath);
        const tasks = await listTasks(rootPath);
        const providerStatus = getProviderStatus(config?.ai || { provider: 'mock', model: 'mock-offline', maxTokens: 100000, temperature: 0.3 });
        const toolSnapshot = buildToolCapabilitySnapshot();

        // Memory status
        let memRules = 0, memCandidates = 0, memPending = 0;
        try {
          const { loadProjectMemory } = await import('../core/memory.js');
          const mem = await loadProjectMemory(rootPath);
          memRules = mem.rules.length;
          memCandidates = (mem.memoryCandidates || []).length;
          memPending = (mem.memoryCandidates || []).filter(c => c.reviewStatus === 'proposed').length;
        } catch { /* best-effort */ }

        // Git status
        const inGit = isGitRepo(rootPath);
        const branch = inGit ? getCurrentBranch(rootPath) : null;
        const gitClean = inGit ? getGitStatus(rootPath).clean : null;

        const completed = tasks.filter(t => t.status === 'completed').length;
        const failedT = tasks.filter(t => t.status === 'failed').length;
        const running = tasks.filter(t => t.status === 'running').length;
        const availableTools = toolSnapshot.capabilities.filter(c => c.status === 'available').length;
        const degradedTools = toolSnapshot.capabilities.filter(c => c.status !== 'available').length;
        const fileCount = index?.modules.reduce((s, m) => s + m.files.length, 0) || 0;

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('overview', {
            rootPath,
            initialized: !!config,
            language: index?.identity.language || 'unknown',
            framework: index?.identity.framework || 'unknown',
            architecture: index?.architecturePattern || 'unknown',
            provider: providerStatus.name,
            providerReady: providerStatus.ready,
            keySource: providerStatus.keySource,
            model: config?.ai.model || 'unknown',
            modules: index?.modules.length || 0,
            files: fileCount,
            tasks: { total: tasks.length, completed, failed: failedT, running },
            tools: { total: toolSnapshot.capabilities.length, available: availableTools, degraded: degradedTools },
            memory: { rules: memRules, candidates: memCandidates, pending: memPending },
            git: inGit ? { branch, clean: gitClean } : null,
            lastScan: index?.lastScan || null,
          }), null, 2));
          return;
        }

        section('项目健康总览');
        console.log();

        if (!config) { warn('项目未初始化，运行 ic init'); console.log(); return; }

        // Row 1: Project identity
        const langLabel = index?.identity.language || '—';
        const fwLabel = index?.identity.framework || '—';
        const archLabel = index?.architecturePattern || '—';
        info(`项目身份    ${chalk.cyan(langLabel)}  ${chalk.dim('·')}  ${chalk.cyan(fwLabel)}  ${chalk.dim('·')}  ${archLabel}`);
        detail('规模', `${index?.modules.length || 0} 个模块 / ${fileCount} 个文件`);

        // Row 2: AI Provider
        const providerIcon = providerStatus.ready ? chalk.green('✓') : chalk.red('✗');
        const keyInfo = providerStatus.keySource ? chalk.dim(`(${providerStatus.keySource})`) : '';
        info(`AI Provider  ${providerIcon} ${providerStatus.name} ${keyInfo}  ${chalk.dim('·')}  ${config?.ai.model || '—'}`);

        // Row 3: Memory
        const memParts: string[] = [];
        if (memRules > 0) memParts.push(`${chalk.cyan(String(memRules))} 规则`);
        if (memCandidates > 0) memParts.push(`${memCandidates} 候选`);
        if (memPending > 0) memParts.push(chalk.yellow(`${memPending} 待确认`));
        info(`长期记忆    ${memParts.length > 0 ? memParts.join('  ') : chalk.dim('暂无记忆')}`);

        // Row 4: Tasks
        const taskParts: string[] = [];
        if (tasks.length > 0) taskParts.push(`${chalk.cyan(String(tasks.length))} 个任务`);
        if (completed > 0) taskParts.push(chalk.green(`${completed} 完成`));
        if (failedT > 0) taskParts.push(chalk.red(`${failedT} 失败`));
        if (running > 0) taskParts.push(chalk.yellow(`${running} 运行中`));
        info(`任务状态    ${taskParts.length > 0 ? taskParts.join('  ') : chalk.dim('暂无任务')}`);

        // Row 5: Tools
        const toolIcon = degradedTools === 0 ? chalk.green('✓') : chalk.yellow('⚠');
        const degradedInfo = degradedTools > 0 ? chalk.yellow(` ${degradedTools} 降级`) : '';
        info(`工具能力    ${toolIcon} ${availableTools} 可用${degradedInfo}`);

        // Row 6: Git
        if (inGit) {
          const gitIcon = gitClean ? chalk.green('✓') : chalk.yellow('•');
          const cleanLabel = gitClean ? chalk.dim('clean') : chalk.yellow('dirty');
          info(`Git         ${gitIcon} ${branch || '—'}  ${cleanLabel}`);
        } else {
          info(`Git         ${chalk.dim('非 Git 仓库')}`);
        }

        // Row 7: Last scan
        if (index?.lastScan) detail('最后扫描', index.lastScan);

        // Recent task activity
        const recentTasks = tasks.filter(t => t.completedAt).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).slice(0, 3);
        if (recentTasks.length > 0) {
          console.log();
          section('最近任务');
          for (const t of recentTasks) {
            const sIcon = t.status === 'completed' ? chalk.green('✓') : chalk.red('✗');
            const desc = t.description.length > 50 ? t.description.slice(0, 47) + '...' : t.description;
            detail(`${sIcon} ${t.id.slice(-6)}`, desc);
          }
        }

        // Degraded tools
        if (degradedTools > 0) {
          console.log();
          const degList = toolSnapshot.capabilities.filter(c => c.status !== 'available');
          for (const d of degList) detail(`${chalk.yellow('⚠')} ${d.name}`, d.fallback || '不可用');
        }

        console.log();
        info(`运行 ${chalk.cyan('ic overview --json')} 获取 JSON 格式`);
        console.log();
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic loop — task loop status & visualization
  // ============================================================
  program.command('loop')
    .description('查看三步任务循环状态和工具能力矩阵')
    .option('--json', 'JSON 格式输出')
    .action(async (options?: { json?: boolean }) => {
      try {
        const { buildTaskThinkingLoop, renderTaskThinkingLoop } = await import('../core/task-loop.js');
        const loop = buildTaskThinkingLoop();

        if (options?.json) {
          const { buildToolCapabilitySnapshot } = await import('../core/tool-registry.js');
          const snapshot = buildToolCapabilitySnapshot();
          console.log(JSON.stringify(jsonEnvelope('loop-status', {
            steps: loop.steps.map(s => ({
              id: s.id, name: s.name, owner: s.owner,
              tools: s.requiredToolCategories,
              rule: s.userVisibleRule,
            })),
            tools: snapshot.capabilities.map(c => ({
              id: c.id, name: c.name, status: c.status,
              fallback: c.status !== 'available' ? c.fallback : null,
            })),
            policy: loop.policy,
          }), null, 2));
        } else {
          section('任务循环');
          console.log(renderTaskThinkingLoop(loop));
          console.log();
          info('运行 ic loop --json 获取 JSON 格式');
        }
      } catch (err) { printError(err as Error); }
    });

  // ============================================================
  // ic intel — code intelligence queries
  // ============================================================
  program.command('intel')
    .alias('ci')
    .description('代码智能查询：符号定义、调用关系、模块导出、依赖分析')
    .argument('[query...]', '查询内容，例如：谁调用了 scanProject / 模块 src/core 的导出')
    .option('--json', 'JSON 格式输出')
    .option('--callers', '仅显示调用者')
    .option('--dataflow', '类型级数据流分析 (TS Compiler API)')
    .option('--impact', '影响面分析 (TS Compiler API)')
    .action(async (args: string[] = [], options?: { json?: boolean; callers?: boolean; dataflow?: boolean; impact?: boolean }) => {
      const rootPath = process.cwd();
      const query = args.join(' ').trim();
      if (!query) { info('用法：ic intel <符号名 | 函数名 | 文件名 | 模块名>'); info('自然语言：ic intel 谁调用了 scanProject'); return; }
      try {
        const { loadProjectIndex } = await import('../core/scanner.js');
        const index = await loadProjectIndex(rootPath);
        if (!index) { fail('项目未扫描，先运行 ic scan'); }

        // Symbol search
        const symbolHits = index.modules.flatMap(m =>
          m.exports.filter(e => e.name === query || e.name.toLowerCase().includes(query.toLowerCase())).map(e => ({ mod: m.name, exp: e }))
        );

        // Callers-only mode
        if (options?.callers && index.callGraph) {
          const callers = index.callGraph.filter(e => e.callee.includes(query));
          if (options?.json) {
            console.log(JSON.stringify(jsonEnvelope('intel-callers', { symbol: query, count: callers.length, callers: callers.map(c => ({ caller: c.caller, file: c.callerFile, line: c.line })) }), null, 2));
          } else {
            section(`调用者: ${chalk.cyan(query)} (${callers.length})`);
            for (const c of callers.slice(0, 15)) console.log(`  ${chalk.cyan(c.caller)} ${chalk.dim('L' + c.line + '  ' + c.callerFile)}`);
            if (callers.length > 15) info(`还有 ${callers.length - 15} 条...`);
          }
          console.log();
          return;
        }

        // JSON output
        if (options?.json) {
          const callers = index.callGraph?.filter(e => e.callee.includes(query)) || [];
          console.log(JSON.stringify(jsonEnvelope('intel', {
            query,
            symbols: symbolHits.map(h => ({ name: h.exp.name, kind: h.exp.kind, module: h.mod, signature: h.exp.signature, file: h.exp.file, line: h.exp.line })),
            callers: callers.map(c => ({ caller: c.caller, file: c.callerFile, line: c.line })),
          }), null, 2));
          return;
        }

        if (symbolHits.length > 0) {
          section(`代码智能: ${chalk.cyan(query)}`);
          console.log();
          for (const h of symbolHits.slice(0, 10)) {
            detail(h.exp.name, `${h.exp.kind}  ${chalk.dim('→')} ${chalk.cyan(h.mod)}  ${chalk.dim(h.exp.signature?.substring(0, 60) || '')}`);
          }
          // Callers from call graph
          if (index.callGraph) {
            const callers = index.callGraph.filter(e => e.callee.includes(query));
            if (callers.length > 0) {
              console.log();
              info(`调用者 (${callers.length}):`);
              for (const c of callers.slice(0, 8)) {
                console.log(`  ${chalk.cyan(c.caller)} ${chalk.dim('→ L' + c.line + '  ' + c.callerFile)}`);
              }
            }
          }
        } else {
          // Module/file search
          const mod = index.modules.find(m => m.name.includes(query) || m.files.some(f => f.includes(query)));
          if (mod) {
            section(`模块 ${chalk.cyan(mod.name)} (${mod.exports.length} 导出, ${mod.imports.length} 导入)`);
            if (mod.exports.length > 0) {
              for (const e of mod.exports.slice(0, 15)) {
                detail(e.name, `${e.kind}  ${chalk.dim(e.signature?.substring(0, 50) || '')}`);
              }
            }
            const deps = index.dependencyGraph.get(mod.name) || [];
            if (deps.length > 0) {
              console.log();
              info(`依赖: ${deps.map(d => chalk.cyan(d)).join(', ')}`);
            }
          } else {
            warn(`未找到符号或模块: ${query}`);
            info('试试 ic intel <函数名> 或 ic intel <模块名>');
          }
        }
        // TS Compiler API data flow analysis (type-level, cross-file)
        if (options?.dataflow || options?.impact) {
          try {
            const { analyzeTSProject, analyzeImpactWithTSC, formatDataFlowSummary } = await import('../core/ts-dataflow.js');
            progress('类型级数据流分析...');
            const result = analyzeTSProject(rootPath);
            if (options?.impact) {
              const impact = analyzeImpactWithTSC(rootPath, query || 'main');
              section(`影响面: ${chalk.cyan(query || 'main')}`);
              console.log(`  直接: ${impact.directlyAffected.length}  间接: ${impact.indirectlyAffected.length}  文件: ${impact.filesToCheck.length}`);
              if (impact.directlyAffected.length > 0) console.log(`  直接: ${impact.directlyAffected.map(s => chalk.cyan(s)).join(', ')}`);
              if (impact.indirectlyAffected.length > 0) console.log(`  间接: ${impact.indirectlyAffected.slice(0, 10).map(s => chalk.cyan(s)).join(', ')}`);
              console.log(`  ${impact.assessment}`);
            } else {
              console.log(formatDataFlowSummary(result));
            }
          } catch (err) { warn(`TS 数据流分析失败: ${(err as Error).message.slice(0, 200)}`); }
        }

        console.log();
      } catch (err) { printError(err as Error); }
    });
}
