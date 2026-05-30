// src/commands/plan.ts — ic plan command
// Extracted from src/index.ts (architecture split)

import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../config.js';
import { success, fail, progress, warn, info, detail, printError } from '../cli/output.js';
import type { ICloserConfig, Task, ProjectIndex } from '../types.js';

type ExecuteTaskFn = (task: Task, config: ICloserConfig, rootPath: string, index: ProjectIndex | null) => Promise<void>;

// Plan state (moved from index.ts)
let activePlan: import('../core/task-planner.js').DevPlan | null = null;
let activePlanFile: string | null = null;

async function saveActivePlan(rootPath: string) {
  if (!activePlan || !activePlanFile) return;
  try {
    const plansDir = path.join(rootPath, '.icloser', 'plans');
    const { ensureDir, writeFile } = await import('../utils/fs.js');
    await ensureDir(plansDir);
    await writeFile(activePlanFile, JSON.stringify(activePlan, null, 2));
  } catch { /* best-effort */ }
}

async function loadLatestPlan(rootPath: string) {
  try {
    const plansDir = path.join(rootPath, '.icloser', 'plans');
    const fs = await import('fs/promises');
    const entries = await fs.readdir(plansDir).catch(() => [] as string[]);
    const plans = entries.filter(e => e.startsWith('PLAN-') && e.endsWith('.json')).sort().reverse();
    if (plans.length > 0) {
      activePlanFile = path.join(plansDir, plans[0]);
      activePlan = JSON.parse(await fs.readFile(activePlanFile, 'utf-8'));
      return true;
    }
  } catch { return false; }
  return false;
}

export function registerPlanCommand(program: Command, executeTask: ExecuteTaskFn): void {
  program.command('plan')
    .description('结构化开发规划：分析需求→分解任务→编号确认→逐任务开发（持久化到 .icloser/plans/')
    .argument('[action]', 'create <描述> | status | next | start <任务ID> | accept | list | load <planId>')
    .action(async (action?: string) => {
      const rootPath = process.cwd();
      try {
        const config = await loadConfig(rootPath);
        if (!config) { fail('项目未初始化'); }

        if (action === 'list') {
          const plansDir = path.join(rootPath, '.icloser', 'plans');
          const fs = await import('fs/promises');
          const entries = await fs.readdir(plansDir).catch(() => [] as string[]);
          const plans = entries.filter(e => e.endsWith('.json')).sort().reverse();
          if (plans.length === 0) { info('无已保存的计划'); return; }
          for (const pf of plans) {
            const p = JSON.parse(await fs.readFile(path.join(plansDir, pf), 'utf-8'));
            const done = p.tasks.filter((t: { status: string }) => t.status === 'done').length;
            console.log(`  ${pf.replace('.json', '')} — ${p.requirement.slice(0, 50)} [${done}/${p.tasks.length}]`);
          }
          return;
        }

        if (action === 'load') {
          const planId = process.argv[process.argv.indexOf('load') + 1] || '';
          if (!planId) { info('用法: ic plan load <planId>'); return; }
          const plansDir = path.join(rootPath, '.icloser', 'plans');
          const fs = await import('fs/promises');
          const planFile = path.join(plansDir, planId.includes('.json') ? planId : planId + '.json');
          try {
            activePlan = JSON.parse(await fs.readFile(planFile, 'utf-8'));
            activePlanFile = planFile;
            const loaded = activePlan!;
            const { formatPlanForDisplay } = await import('../core/task-planner.js');
            console.log(formatPlanForDisplay(loaded));
            success('已加载: ' + loaded.requirement);
          } catch { fail('计划不存在: ' + planId); }
          return;
        }

        if (!activePlan && action !== 'create') {
          const loaded = await loadLatestPlan(rootPath);
          if (!loaded) { info('无活跃计划。运行 ic plan create <描述>'); return; }
        }

        const { createProvider } = await import('../ai/provider.js');
        const provider = createProvider({ ...config.ai, apiKey: config.ai.apiKey || '' });

        if (!action || action === 'create') {
          const desc = process.argv.slice(process.argv.indexOf('create') + 1).join(' ') || process.argv.slice(3).join(' ') || '新功能';
          progress('分析需求: ' + desc);
          const resp = await provider.chat({
            systemPrompt: '你是项目规划专家。分析需求后输出JSON: {"analysis":"需求分析(2-3句)","tasks":[{"seq":1,"title":"任务标题","desc":"任务描述","files":["文件路径"],"deps":[],"est":"2h"}]}。分解为3-7个任务。',
            task: desc,
            context: { projectMeta: '', relevantCode: [], relevantMemory: '', totalTokens: 0, budgetUsed: 0 }, history: '',
          });
          try {
            const j = JSON.parse((resp.content.match(/\{[\s\S]*\}/)?.[0] || '{}'));
            const { createDevPlan, formatPlanForDisplay } = await import('../core/task-planner.js');
            activePlan = createDevPlan(desc, j.analysis || '', (j.tasks || []).map((t: Record<string, unknown>, i: number) => ({
              id: `task-${Date.now().toString(36)}-${i}`, seq: (t.seq as number) || i + 1,
              title: (t.title as string) || (t.desc as string)?.slice(0, 40) || `任务${i + 1}`,
              description: (t.desc as string) || '', files: (t.files as string[]) || [],
              dependencies: (t.deps as number[]) || [], estimated: (t.est as string) || '2h', status: 'pending' as const,
            })));
            const plansDir = path.join(rootPath, '.icloser', 'plans');
            const { ensureDir, writeFile } = await import('../utils/fs.js');
            await ensureDir(plansDir);
            activePlanFile = path.join(plansDir, `PLAN-${activePlan.planId}.json`);
            await writeFile(activePlanFile, JSON.stringify(activePlan, null, 2));
            console.log(formatPlanForDisplay(activePlan));
            detail('已保存', activePlanFile);
            return;
          } catch { info('AI 规划失败，请重试'); return; }
        }

        if (!activePlan) { info('无活跃计划。运行 ic plan create <描述>'); return; }

        if (action === 'status') {
          const { formatPlanForDisplay } = await import('../core/task-planner.js');
          console.log(formatPlanForDisplay(activePlan));
          return;
        }

        if (action === 'next') {
          const { getNextPendingTask } = await import('../core/task-planner.js');
          const t = getNextPendingTask(activePlan);
          if (!t) { success('全部任务已完成！运行 ic plan accept 验收'); return; }
          info(`下一个任务: Task-${t.seq} — ${t.title}`);
          info(`描述: ${t.description}`);
          info(`预估: ${t.estimated} | 文件: ${t.files.join(', ') || '待定'}`);
          info('输入 ic plan start ' + t.seq + ' 开始此任务');
          return;
        }

        if (action === 'start') {
          const seq = parseInt(process.argv[process.argv.indexOf('start') + 1] || '1');
          const task = activePlan.tasks.find(t => t.seq === seq);
          if (!task) { fail('任务不存在: Task-' + seq); }
          task.status = 'in_progress';
          await saveActivePlan(rootPath);
          progress(`开始 Task-${seq}: ${task.title}`);
          const { createTask: ct } = await import('../core/task-engine.js');
          const newTask = ct(task.title + ': ' + task.description, { priority: 'high' });
          await executeTask(newTask, config, rootPath, null);
          task.status = 'done';
          await saveActivePlan(rootPath);
          success(`Task-${seq} 完成`);
          const { getNextPendingTask } = await import('../core/task-planner.js');
          const next = getNextPendingTask(activePlan);
          if (next) info(`下一步: ic plan start ${next.seq} — ${next.title}`);
          else success('全部任务完成！运行 ic plan accept 验收');
          return;
        }

        if (action === 'accept') {
          const { allTasksDone } = await import('../core/task-planner.js');
          if (!allTasksDone(activePlan)) { warn('还有未完成任务。运行 ic plan status 查看'); return; }
          success('验收通过！计划完成: ' + activePlan.requirement);
          if (activePlanFile) {
            try {
              const completedFile = activePlanFile.replace('.json', '-DONE.json');
              await (await import('fs/promises')).rename(activePlanFile, completedFile);
            } catch { /* best-effort */ }
          }
          activePlan = null; activePlanFile = null;
          return;
        }

        if (action === 'dag') {
          const { getDAGLevels } = await import('../core/task-planner.js');
          const levels = await getDAGLevels(activePlan);
          for (const level of levels) {
            const names = level.tasks.map(t => `Task-${t.seq} ${t.status === 'done' ? '✅' : '·'}`);
            console.log(`  层 ${level.level} [${level.estimatedTime}]  ${names.join(' ⏺ ')}`);
            if (level.tasks.length > 1) console.log(`    ↳ ${level.tasks.length} 任务可并行执行`);
          }
          return;
        }

        if (action === 'run-all') {
          const { getDAGLevels, validatePlanDAG } = await import('../core/task-planner.js');
          const cycleCheck = await validatePlanDAG(activePlan);
          if (cycleCheck) { fail(`DAG 循环: ${cycleCheck}`); return; }

          const { executeDAG, calculateParallelSavings } = await import('../core/dag-scheduler.js');
          const levels = await getDAGLevels(activePlan);
          const savings = calculateParallelSavings(levels);
          detail('DAG', `${levels.length} 层 / ${levels.reduce((s, l) => s + l.tasks.length, 0)} 任务 / 并行节省 ${savings} 步`);

          const isolated = process.argv.includes('--isolated');
          const pendingTasks = levels.flatMap(l => l.tasks.filter(t => t.status !== 'done'));
          const result = await executeDAG(pendingTasks, async (t) => {
            t.status = 'in_progress';
            await saveActivePlan(rootPath);
            const { createTask: ct } = await import('../core/task-engine.js');
            const newTask = ct(t.title + ': ' + t.description, { priority: 'high' });

            let worktree: import('../utils/git.js').WorktreeInfo | null = null;
            if (isolated) {
              const { createWorktree: cw } = await import('../utils/git.js');
              const wt = cw(rootPath, `icloser/task-${newTask.id.slice(-8)}`, `.icloser/worktrees/${newTask.id}`);
              if (wt) { worktree = { path: `.icloser/worktrees/${newTask.id}`, branch: `icloser/task-${newTask.id.slice(-8)}` }; detail('隔离', worktree.branch); }
            }

            await executeTask(newTask, config, rootPath, null);

            if (worktree) {
              const { removeWorktree: rw } = await import('../utils/git.js');
              rw(rootPath, worktree.path);
            }

            t.status = 'done';
            await saveActivePlan(rootPath);
            return t;
          });
          success(`DAG 执行完成: ${result.results.length} 个任务 / ${(result.totalTime / 1000).toFixed(1)}s`);
          return;
        }

        info('用法: ic plan [create|status|next|start|accept|dag|run-all|list|load]');
      } catch (err) { printError(err as Error); }
    });
}
