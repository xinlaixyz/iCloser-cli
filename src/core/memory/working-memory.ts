// Working Memory — PRD §4.2: dynamic task workspace, 16k-32k tokens
// Manages current task state, reasoning, recall injections, errors, diffs
// Lifecycle: init → update → compress → snapshot → clear
import { estimateTokens } from '../../utils/fs.js';

export interface WorkingMemoryLayer {
  type: 'task' | 'reasoning' | 'recall' | 'error' | 'diff' | 'conclusion';
  content: string;
  priority: number;    // 0-100, higher = keep longer
  addedAt: string;
  tokenEstimate: number;
}

export interface WorkingMemorySnapshot {
  layers: WorkingMemoryLayer[];
  taskId?: string;
  savedAt: string;
  totalTokens: number;
}

export interface WorkingMemoryOptions {
  maxTokens: number;        // default 24000
  warnThreshold: number;    // default 0.7
  criticalThreshold: number; // default 0.9
  maxLayersPerType: number;  // default 20
}

const DEFAULT_OPTIONS: WorkingMemoryOptions = {
  maxTokens: 24000,
  warnThreshold: 0.7,
  criticalThreshold: 0.9,
  maxLayersPerType: 20,
};

const TYPE_PRIORITY: Record<WorkingMemoryLayer['type'], number> = {
  task: 100,
  error: 90,
  conclusion: 80,
  recall: 60,
  diff: 50,
  reasoning: 30,   // oldest reasoning expires first
};

export class WorkingMemory {
  private layers: WorkingMemoryLayer[] = [];
  private options: WorkingMemoryOptions;
  private taskId: string | undefined;

  constructor(options: Partial<WorkingMemoryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get tokenCount(): number {
    return this.layers.reduce((sum, l) => sum + l.tokenEstimate, 0);
  }

  get layerSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const l of this.layers) {
      summary[l.type] = (summary[l.type] || 0) + 1;
    }
    return summary;
  }

  get status(): 'ok' | 'warn' | 'critical' {
    const ratio = this.tokenCount / this.options.maxTokens;
    if (ratio >= this.options.criticalThreshold) return 'critical';
    if (ratio >= this.options.warnThreshold) return 'warn';
    return 'ok';
  }

  get usageRatio(): number {
    return this.tokenCount / this.options.maxTokens;
  }

  // ── Writing ──

  /** Set the current task description (replaces existing task layer) */
  setTask(taskId: string, description: string): void {
    this.taskId = taskId;
    this.removeType('task');
    this.addLayer('task', description, TYPE_PRIORITY.task);
  }

  /** Add a reasoning step */
  addReasoning(step: string): void {
    this.addLayer('reasoning', step, TYPE_PRIORITY.reasoning);
  }

  /** Add recalled memory context (from Recall Pipeline) */
  addRecall(content: string, priority = TYPE_PRIORITY.recall): void {
    this.addLayer('recall', content, priority);
  }

  /** Record an error */
  addError(error: string): void {
    this.addLayer('error', error, TYPE_PRIORITY.error);
  }

  /** Add a diff snippet */
  addDiff(diff: string): void {
    this.addLayer('diff', diff, TYPE_PRIORITY.diff);
  }

  /** Add a conclusion / key takeaway */
  addConclusion(conclusion: string): void {
    this.addLayer('conclusion', conclusion, TYPE_PRIORITY.conclusion);
  }

  // ── Reading ──

  /** Get layers of a specific type */
  getByType(type: WorkingMemoryLayer['type']): WorkingMemoryLayer[] {
    return this.layers.filter(l => l.type === type);
  }

  /** Get all reasoning steps concatenated */
  getReasoningChain(): string {
    return this.layers
      .filter(l => l.type === 'reasoning')
      .map(l => l.content)
      .join('\n');
  }

  /** Get all error messages */
  getErrorSummary(): string {
    return this.layers
      .filter(l => l.type === 'error')
      .map(l => l.content)
      .join('\n');
  }

  /** Get the assembled context for LLM injection */
  assembleContext(): string {
    // Priority-sorted layers, compressed to fit budget
    const sorted = [...this.layers].sort((a, b) => b.priority - a.priority);

    const parts: string[] = [];
    let tokens = 0;
    const budget = this.options.maxTokens;

    for (const layer of sorted) {
      if (tokens + layer.tokenEstimate > budget) {
        // Compress remaining layers
        const compressed = this.compressLayer(layer);
        parts.push(compressed);
        tokens += estimateTokens(compressed);
      } else {
        parts.push(layer.content);
        tokens += layer.tokenEstimate;
      }
    }

    return parts.join('\n\n');
  }

  /** Get all conclusions (for episodic memory extraction) */
  extractConclusions(): string[] {
    return this.layers
      .filter(l => l.type === 'conclusion')
      .map(l => l.content);
  }

  // ── Lifecycle ──

  /** Compress layers to free token space */
  compress(): { before: number; after: number; removed: number } {
    const before = this.tokenCount;

    // 1. Deduplicate similar layers
    this.deduplicate();

    // 2. Summarize old reasoning
    this.summarizeOldReasoning();

    // 3. Merge consecutive errors of same type
    this.mergeErrors();

    // 4. If still over budget, drop lowest-priority oldest layers
    if (this.tokenCount > this.options.maxTokens * this.options.criticalThreshold) {
      this.dropLowPriority();
    }

    const after = this.tokenCount;
    return { before, after, removed: before - after };
  }

  /** Save a snapshot for later restore */
  snapshot(): WorkingMemorySnapshot {
    return {
      layers: [...this.layers],
      taskId: this.taskId,
      savedAt: new Date().toISOString(),
      totalTokens: this.tokenCount,
    };
  }

  /** Restore from a snapshot */
  restore(snap: WorkingMemorySnapshot): void {
    this.layers = snap.layers.map(l => ({ ...l }));
    this.taskId = snap.taskId;
  }

  /** Clear working memory (after task completes) */
  clear(): void {
    this.layers.length = 0;
    this.taskId = undefined;
  }

  /** Keep only conclusions and errors (for episodic record) */
  extractForEpisodic(): { taskId?: string; conclusions: string[]; errors: string[]; reasoningSummary: string } {
    return {
      taskId: this.taskId,
      conclusions: this.getByType('conclusion').map(l => l.content),
      errors: this.getByType('error').map(l => l.content),
      reasoningSummary: this.summarizeChain(),
    };
  }

  // ── Private helpers ──

  private addLayer(type: WorkingMemoryLayer['type'], content: string, priority: number): void {
    const trimmed = content.trim();
    if (!trimmed) return;

    this.layers.push({
      type,
      content: trimmed.length > 3000 ? trimmed.slice(0, 3000) + '...(truncated)' : trimmed,
      priority,
      addedAt: new Date().toISOString(),
      tokenEstimate: estimateTokens(trimmed),
    });

    // Enforce per-type layer limit
    const typeLayers = this.layers.filter(l => l.type === type);
    while (typeLayers.length > this.options.maxLayersPerType) {
      const oldest = typeLayers.shift()!;
      this.layers = this.layers.filter(l => l !== oldest);
    }
  }

  private removeType(type: WorkingMemoryLayer['type']): void {
    this.layers = this.layers.filter(l => l.type !== type);
  }

  private compressLayer(layer: WorkingMemoryLayer): string {
    if (layer.content.length <= 200) return layer.content;
    return `[${layer.type}] ${layer.content.slice(0, 200)}...`;
  }

  private deduplicate(): void {
    const seen = new Set<string>();
    this.layers = this.layers.filter(l => {
      const key = `${l.type}:${l.content.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private summarizeOldReasoning(): void {
    const reasonings = this.getByType('reasoning');
    if (reasonings.length <= 5) return;

    // Keep last 3, summarize the rest into one
    const toSummarize = reasonings.slice(0, -3);
    const toKeep = reasonings.slice(-3);

    const summary = toSummarize.map(r => r.content.slice(0, 100)).join(' → ');
    this.layers = this.layers.filter(l => l.type !== 'reasoning' || toKeep.includes(l));
    if (summary) {
      this.addLayer('reasoning', `[摘要] ${summary}`, TYPE_PRIORITY.reasoning - 5);
    }
  }

  private mergeErrors(): void {
    const errors = this.getByType('error');
    if (errors.length <= 3) return;

    // Merge oldest errors into one
    const toMerge = errors.slice(0, -2);
    const toKeep = errors.slice(-2);

    const merged = toMerge.map(e => e.content.slice(0, 150)).join(' | ');
    this.layers = this.layers.filter(l => l.type !== 'error' || toKeep.includes(l));
    if (merged) {
      this.addLayer('error', `[合并 ${toMerge.length} 个历史错误] ${merged}`, TYPE_PRIORITY.error - 5);
    }
  }

  private dropLowPriority(): void {
    // Sort by priority (ascending), drop oldest low-priority
    this.layers.sort((a, b) => a.priority - b.priority || a.addedAt.localeCompare(b.addedAt));
    while (this.tokenCount > this.options.maxTokens * 0.85 && this.layers.length > 0) {
      this.layers.shift();
    }
  }

  private summarizeChain(): string {
    const tasks = this.getByType('task').map(l => l.content);
    const errors = this.getByType('error').map(l => l.content.slice(0, 80));
    const conclusions = this.getByType('conclusion').map(l => l.content.slice(0, 100));

    return [
      tasks.length > 0 ? `任务: ${tasks.join('; ')}` : '',
      conclusions.length > 0 ? `结论: ${conclusions.join('; ')}` : '',
      errors.length > 0 ? `错误: ${errors.join('; ')}` : '',
    ].filter(Boolean).join(' | ').slice(0, 500);
  }

  // ── Persistence (via MemoryStore paths) ──

  async saveToDisk(workingDir: string): Promise<string> {
    const { join } = await import('path');
    const { writeFileSync } = await import('fs');
    const { ensureDir } = await import('../../utils/fs.js');

    const snap = this.snapshot();
    const filePath = join(workingDir, `wm-${this.taskId || 'unknown'}-${Date.now().toString(36)}.json`);
    await ensureDir(workingDir);
    writeFileSync(filePath, JSON.stringify(snap, null, 2), 'utf-8');
    return filePath;
  }

  static async loadFromDisk(filePath: string): Promise<WorkingMemory> {
    const { readFileSync } = await import('fs');
    const data = readFileSync(filePath, 'utf-8');
    const snap = JSON.parse(data) as WorkingMemorySnapshot;
    const wm = new WorkingMemory();
    wm.restore(snap);
    return wm;
  }
}
