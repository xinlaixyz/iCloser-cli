// DAG Scheduler — topological sort + parallel level execution
import type { PlanTask } from './task-planner.js';

export interface DAGLevel {
  level: number;
  tasks: PlanTask[];
  estimatedTime: string;
}

export interface DAGResult {
  levels: DAGLevel[];
  totalTasks: number;
  parallelSavings: number;  // tasks that can run in parallel vs sequential
  cycleError?: string;
}

// Build adjacency list + indegree map from task dependencies
export function buildDAG(tasks: PlanTask[]): {
  adj: Map<number, number[]>;
  indegree: Map<number, number>;
  taskMap: Map<number, PlanTask>;
} {
  const adj = new Map<number, number[]>();
  const indegree = new Map<number, number>();
  const taskMap = new Map<number, PlanTask>();

  for (const t of tasks) {
    taskMap.set(t.seq, t);
    if (!adj.has(t.seq)) adj.set(t.seq, []);
    if (!indegree.has(t.seq)) indegree.set(t.seq, 0);
  }

  for (const t of tasks) {
    for (const depSeq of (t.dependencies || [])) {
      if (!adj.has(depSeq)) adj.set(depSeq, []);
      adj.get(depSeq)!.push(t.seq);
      indegree.set(t.seq, (indegree.get(t.seq) || 0) + 1);
    }
  }

  return { adj, indegree, taskMap };
}

// Detect cycles via DFS
export function detectCycle(tasks: PlanTask[]): number[][] | null {
  const { adj } = buildDAG(tasks);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>();
  const parent = new Map<number, number>();

  for (const t of tasks) color.set(t.seq, WHITE);

  function dfs(node: number, path: number[]): number[][] | null {
    color.set(node, GRAY);
    for (const neighbor of (adj.get(node) || [])) {
      if (color.get(neighbor) === GRAY) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        return [path.slice(cycleStart).concat(neighbor)];
      }
      if (color.get(neighbor) === WHITE) {
        const result = dfs(neighbor, [...path, neighbor]);
        if (result) return result;
      }
    }
    color.set(node, BLACK);
    return null;
  }

  for (const t of tasks) {
    if (color.get(t.seq) === WHITE) {
      const cycle = dfs(t.seq, [t.seq]);
      if (cycle) return cycle;
    }
  }
  return null;
}

// Kahn's algorithm — returns tasks grouped by parallel level
export function topologicalLevels(tasks: PlanTask[]): DAGLevel[] {
  const cycle = detectCycle(tasks);
  if (cycle) {
    return [{ level: 0, tasks: [], estimatedTime: `循环依赖: ${cycle[0].join('→')}` }];
  }

  const { adj, indegree, taskMap } = buildDAG(tasks);
  const levels: DAGLevel[] = [];
  const queue: number[] = [];

  // Start with tasks that have no dependencies
  for (const t of tasks) {
    if ((indegree.get(t.seq) || 0) === 0) queue.push(t.seq);
  }

  let levelNum = 0;
  while (queue.length > 0) {
    const levelSize = queue.length;
    const levelTasks: PlanTask[] = [];
    let maxEstMin = 0;

    for (let i = 0; i < levelSize; i++) {
      const seq = queue.shift()!;
      levelTasks.push(taskMap.get(seq)!);

      // Estimate: parse "2h" → 120min, "30m" → 30min
      const est = taskMap.get(seq)!.estimated || '';
      const minMatch = est.match(/(\d+)\s*m/i);
      const hrMatch = est.match(/(\d+)\s*h/i);
      const minutes = minMatch ? parseInt(minMatch[1]) : hrMatch ? parseInt(hrMatch[1]) * 60 : 30;
      if (minutes > maxEstMin) maxEstMin = minutes;

      for (const neighbor of (adj.get(seq) || [])) {
        indegree.set(neighbor, (indegree.get(neighbor) || 1) - 1);
        if (indegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }

    const estStr = maxEstMin >= 60 ? `${Math.round(maxEstMin / 60)}h` : `${maxEstMin}m`;
    levels.push({ level: levelNum, tasks: levelTasks, estimatedTime: estStr });
    levelNum++;
  }

  return levels;
}

// Execute tasks level by level, parallel within each level
export async function executeDAG<T>(
  tasks: PlanTask[],
  executor: (task: PlanTask) => Promise<T>,
): Promise<{ results: T[]; levels: DAGLevel[]; totalTime: number }> {
  const levels = topologicalLevels(tasks);
  const results: T[] = [];
  const startTime = Date.now();

  for (const level of levels) {
    if (level.tasks.length === 0) continue;
    const levelResults = await Promise.all(level.tasks.map(t => executor(t)));
    results.push(...levelResults);
  }

  return { results, levels, totalTime: Date.now() - startTime };
}

// Calculate parallelism savings
export function calculateParallelSavings(levels: DAGLevel[]): number {
  const totalTasks = levels.reduce((s, l) => s + l.tasks.length, 0);
  const sequentialTime = totalTasks; // 1 unit per task if sequential
  const parallelTime = levels.length; // 1 unit per level
  return sequentialTime - parallelTime; // tasks saved by parallelism
}
