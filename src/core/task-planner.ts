// Task Planner — structured dev workflow: analyze → plan → decompose → confirm → execute → test → accept
import type { ProjectIndex } from '../types.js';

export interface PlanTask {
  id: string;
  seq: number;
  title: string;
  description: string;
  files: string[];
  dependencies: number[];
  estimated: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface DevPlan {
  planId: string;
  requirement: string;
  analysis: string;
  tasks: PlanTask[];
  createdAt: string;
}

export function createDevPlan(requirement: string, analysis: string, tasks: PlanTask[]): DevPlan {
  return {
    planId: `plan-${Date.now().toString(36)}`,
    requirement,
    analysis,
    tasks,
    createdAt: new Date().toISOString(),
  };
}

export function formatPlanForDisplay(plan: DevPlan): string {
  let out = `# 开发计划: ${plan.requirement.slice(0, 60)}\n\n`;
  out += `## 分析\n${plan.analysis}\n\n`;
  out += '## 任务分解\n\n';
  out += '| # | 任务 | 预估 | 依赖 | 状态 |\n';
  out += '|---|------|------|------|------|\n';
  for (const t of plan.tasks) {
    const deps = t.dependencies.length > 0 ? t.dependencies.map(d => `Task-${d}`).join(', ') : '—';
    const status = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '▶' : '·';
    out += `| Task-${t.seq} | ${t.title} | ${t.estimated} | ${deps} | ${status} |\n`;
  }
  out += `\n## 操作\n`;
  out += `输入 "开始 Task-N" 启动任务\n`;
  out += `输入 "跳过 Task-N" 跳过任务\n`;
  out += `输入 "验收" 运行全部测试\n`;
  return out;
}

export function getNextPendingTask(plan: DevPlan): PlanTask | null {
  for (const t of plan.tasks) {
    if (t.status === 'pending' && t.dependencies.every(d => plan.tasks.find(pt => pt.seq === d)?.status === 'done')) {
      return t;
    }
  }
  return null;
}

export function allTasksDone(plan: DevPlan): boolean {
  return plan.tasks.every(t => t.status === 'done');
}
