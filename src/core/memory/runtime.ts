// Memory Runtime — PRD §5.1: cognitive scheduler for the Memory Kernel
// Orchestrates all memory subsystems: Sensory → Working → Recall → Consolidation → Forgetting
// Hooks into Task Engine lifecycle: onTaskStart / onTaskProgress / onTaskError / onTaskComplete
import type { MemoryStore } from './store.js';
import { SensoryBuffer } from './sensory-buffer.js';
import { WorkingMemory } from './working-memory.js';
import { EpisodicMemory, createEpisode, type Episode } from './episodic.js';
import { SemanticMemory } from './semantic.js';
import { SalienceEngine } from './salience.js';
import { ForgettingEngine } from './forgetting.js';
import { ConsolidationEngine } from './consolidation.js';
import { RecallEngine, type RecallResult } from './recall.js';

export interface MemoryRuntimeConfig {
  workingMemory: { maxTokens: number; warnThreshold: number; criticalThreshold: number };
  recall: { topK: number; maxTokens: number };
  consolidation: { triggerTaskCount: number; lookbackDays: number };
  forgetting: { highHalfLifeDays: number; mediumHalfLifeDays: number; lowHalfLifeDays: number };
}

const DEFAULT_RUNTIME_CONFIG: MemoryRuntimeConfig = {
  workingMemory: { maxTokens: 24000, warnThreshold: 0.7, criticalThreshold: 0.9 },
  recall: { topK: 5, maxTokens: 2000 },
  consolidation: { triggerTaskCount: 5, lookbackDays: 30 },
  forgetting: { highHalfLifeDays: 90, mediumHalfLifeDays: 30, lowHalfLifeDays: 7 },
};

export interface RuntimeStatus {
  initialized: boolean;
  workingMemory: {
    tokenCount: number;
    status: 'ok' | 'warn' | 'critical';
    usageRatio: number;
    layerSummary: Record<string, number>;
  };
  sensory: { total: number; errors: number; bySource: Record<string, number> };
  episodic: { totalEvents: number; recentCount: number };
  semantic: { totalRules: number; highConfidenceCount: number };
  lastConsolidation: string | null;
  lastForgetting: string | null;
  metrics: RuntimeMetrics;
}

export interface RuntimeMetrics {
  tasksProcessed: number;
  recallHits: number;        // times recall returned useful results
  recallMisses: number;      // times recall returned nothing
  consolidationsRun: number;
  forgettingsRun: number;
  rulesCreated: number;
  episodesRecorded: number;
}

export class MemoryRuntime {
  readonly sensory: SensoryBuffer;
  readonly working: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly salience: SalienceEngine;
  readonly recall: RecallEngine;
  readonly forgetting: ForgettingEngine;
  readonly consolidation: ConsolidationEngine;

  private store: MemoryStore;
  private config: MemoryRuntimeConfig;
  private initialized = false;
  private metrics: RuntimeMetrics = {
    tasksProcessed: 0, recallHits: 0, recallMisses: 0,
    consolidationsRun: 0, forgettingsRun: 0, rulesCreated: 0, episodesRecorded: 0,
  };
  private lastConsolidation: string | null = null;
  private lastForgetting: string | null = null;

  constructor(store: MemoryStore, config: Partial<MemoryRuntimeConfig> = {}) {
    this.store = store;
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };

    this.sensory = new SensoryBuffer();
    this.working = new WorkingMemory(this.config.workingMemory);
    this.episodic = new EpisodicMemory(store);
    this.semantic = new SemanticMemory(store);
    this.salience = new SalienceEngine();
    this.forgetting = new ForgettingEngine(this.config.forgetting);
    this.consolidation = new ConsolidationEngine(this.config.consolidation, this.salience);
    this.recall = new RecallEngine(this.episodic, this.semantic, this.salience, this.config.recall);

    // Attach sensory JSONL log
    this.sensory.attachLog(store.createSensoryLog('current'));
  }

  /** Initialize: load semantic rules from disk, open SQLite */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.semantic.load();
      if (!this.store.sqlite.isOpen) this.store.sqlite.open();
      this.initialized = true;
    } catch (err) {
      this.initialized = false;
      // Don't leave a partially-open SQLite handle
      try { this.store.sqlite.close(); } catch { /* nothing to close */ }
      throw err;
    }
  }

  /** Shutdown: flush buffers, close connections. Each step is isolated. */
  async shutdown(): Promise<void> {
    const errors: Error[] = [];
    try { await this.sensory.flush(); } catch (err) { errors.push(err as Error); }
    try { await this.semantic.save(); } catch (err) { errors.push(err as Error); }
    try { this.store.close(); } catch (err) { errors.push(err as Error); }
    this.initialized = false;
    if (errors.length > 0) {
      const { memdbg } = await import('./debug.js');
      memdbg.warn('runtime', `shutdown 完成但有 ${errors.length} 个错误`);
    }
  }

  // ── Task Lifecycle Hooks (PRD §6.1) ──

  /** Called when a task starts */
  async onTaskStart(taskId: string, description: string): Promise<void> {
    // 1. Clear sensory buffer
    this.sensory.clear();

    // 2. Initialize working memory
    this.working.setTask(taskId, description);

    // 3. Trigger Recall Pipeline
    const recalled = await this.recall.recall(description);

    if (recalled.length > 0) {
      this.metrics.recallHits++;
      for (const r of recalled) {
        this.working.addRecall(this.formatRecallForWM(r), Math.round(r.score * 100));
      }
    } else {
      this.metrics.recallMisses++;
    }

    // 4. Record episode
    await this.recordEpisode('task_started', taskId, `开始任务: ${description}`, {
      details: `Recall 找到 ${recalled.length} 条相关记忆`,
      importance: 0.4,
      tags: ['task', recalled.length > 0 ? 'recall-hit' : 'recall-miss'],
    });

    this.metrics.tasksProcessed++;
    this.metrics.episodesRecorded++;
  }

  /** Called on task progress update */
  async onTaskProgress(taskId: string, step: string, data?: Record<string, unknown>): Promise<void> {
    this.working.addReasoning(step);
    if (data) {
      const details = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
      if (details) this.working.addReasoning(details);
    }
  }

  /** Called when an error occurs during task execution */
  async onTaskError(taskId: string, error: Error | string, context?: string): Promise<void> {
    const errorMsg = typeof error === 'string' ? error : error.message;
    this.working.addError(errorMsg);

    // Ingest into sensory as high-importance
    this.sensory.ingest('shell_stderr', errorMsg);

    // Emotion recall: find similar past errors
    const similarErrors = await this.recall.recall(`错误: ${errorMsg.slice(0, 100)}`);
    for (const r of similarErrors.slice(0, 3)) {
      this.working.addRecall(`[相关历史错误] ${r.content.slice(0, 200)}`, 85);
    }

    await this.recordEpisode('error_occurred', taskId, `任务错误: ${errorMsg.slice(0, 150)}`, {
      details: context || errorMsg,
      importance: 0.8,
      tags: ['error', ...similarErrors.length > 0 ? ['has-similar-history'] : []],
    });

    this.metrics.episodesRecorded++;
  }

  /** Called when a task completes successfully */
  async onTaskComplete(taskId: string, result: { filesChanged?: string[]; verifyPassed?: boolean; summary?: string } = {}): Promise<void> {
    // Extract conclusions from working memory
    const episodic = this.working.extractForEpisodic();
    const conclusion = result.summary || episodic.conclusions.join('; ') || '任务已完成';

    if (result.filesChanged && result.filesChanged.length > 0) {
      for (const file of result.filesChanged) {
        await this.recordEpisode('file_changed', taskId, `修改文件: ${file}`, {
          importance: 0.3,
          tags: ['file-change', file.split('.').pop() || 'unknown'],
          changedFiles: [file],
        });
        this.metrics.episodesRecorded++;
      }
    }

    await this.recordEpisode('task_completed', taskId, conclusion, {
      details: [
        episodic.errors.length > 0 ? `错误: ${episodic.errors.slice(0, 3).join('; ')}` : '',
        result.verifyPassed !== undefined ? `验证: ${result.verifyPassed ? '通过' : '失败'}` : '',
      ].filter(Boolean).join(' | '),
      importance: result.verifyPassed !== false ? 0.4 : 0.6,
      tags: ['task', 'completed', result.verifyPassed ? 'verified' : 'unverified'],
      changedFiles: result.filesChanged,
    });

    this.metrics.episodesRecorded++;

    // Trigger consolidation if threshold reached
    if (this.consolidation.onTaskComplete()) {
      await this.runConsolidation();
    }

    // Trigger forgetting periodically
    if (this.metrics.tasksProcessed % 10 === 0) {
      await this.runForgetting();
    }

    // Save working memory snapshot
    await this.working.saveToDisk(this.store.paths.working);

    // Clear working memory
    this.working.clear();
    this.sensory.clear();
  }

  /** Called when user provides feedback/correction */
  async onUserFeedback(taskId: string | undefined, feedback: string): Promise<void> {
    const isCorrection = /错|不对|不行|错误|不要|不能|no|wrong|incorrect/i.test(feedback);

    await this.recordEpisode(
      isCorrection ? 'user_correction' : 'user_feedback',
      taskId,
      feedback.slice(0, 200),
      { importance: isCorrection ? 0.75 : 0.5, tags: [isCorrection ? 'correction' : 'feedback'] }
    );

    this.metrics.episodesRecorded++;

    if (isCorrection) {
      // Correlate with recent task to weaken wrong rules
      this.salience.recordOccurrence('user_correction');
    }
  }

  /** Called when an autopilot rollback is executed */
  async onRollback(taskId: string | undefined, result: {
    reason: string;
    filesRestored: number;
    filesDeleted: number;
    totalFiles: number;
    receipts: Array<{ file: string; action: string; ok: boolean }>;
  }): Promise<void> {
    const { reason, filesRestored, filesDeleted, totalFiles, receipts } = result;
    const summary = `回滚已执行: 恢复 ${filesRestored} 个文件, 删除 ${filesDeleted} 个文件 (共 ${totalFiles} 个)`;
    const details = [
      `原因: ${reason}`,
      ...receipts.map(r => `${r.ok ? '✓' : '✗'} ${r.file}: ${r.action}`),
    ].join('\n');

    await this.recordEpisode('rollback_executed', taskId, summary, {
      details,
      importance: 0.85,
      tags: ['rollback', 'autopilot', filesRestored > 0 ? 'files-restored' : '',
             filesDeleted > 0 ? 'files-deleted' : ''].filter(Boolean),
      changedFiles: receipts.map(r => r.file),
    });

    this.metrics.episodesRecorded++;

    this.sensory.ingest('system_event', `回滚: ${summary}`);
    this.salience.recordOccurrence('rollback');
  }

  // ── Manual triggers ──

  /** Run consolidation manually */
  async runConsolidation(): Promise<number> {
    const result = await this.consolidation.consolidate(this.episodic, this.semantic);
    this.metrics.consolidationsRun++;
    this.metrics.rulesCreated += result.rulesCreated.length;
    this.lastConsolidation = new Date().toISOString();
    await this.semantic.save();

    await this.recordEpisode('memory_consolidated', undefined, `固化: ${result.rulesCreated.length} 规则`, {
      importance: 0.3, tags: ['system', 'consolidation'],
    });

    return result.rulesCreated.length;
  }

  /** Run forgetting manually */
  async runForgetting(): Promise<{ archived: number; deleted: number }> {
    const episodes = this.episodic.query({ limit: 1000 });
    const rules = this.semantic.query({ limit: 1000 });

    const result = await this.forgetting.cleanup(this.store, episodes, rules);
    this.metrics.forgettingsRun++;
    this.lastForgetting = new Date().toISOString();

    return {
      archived: result.episodic.archived + result.semantic.archived,
      deleted: result.episodic.deleted + result.semantic.deleted,
    };
  }

  /** Get current runtime status for UI/CLI display */
  getStatus(): RuntimeStatus {
    const recent = this.episodic.recent(7);
    const highConfRules = this.semantic.getHighConfidence(0.7);
    const totalEvents = this.store.sqlite.isOpen
      ? this.store.sqlite.count('episodic')
      : Object.values(this.episodic.countByType()).reduce((sum, count) => sum + count, 0);

    return {
      initialized: this.initialized,
      workingMemory: {
        tokenCount: this.working.tokenCount,
        status: this.working.status,
        usageRatio: this.working.usageRatio,
        layerSummary: this.working.layerSummary,
      },
      sensory: this.sensory.summary(),
      episodic: {
        totalEvents,
        recentCount: recent.length,
      },
      semantic: {
        totalRules: this.semantic.totalRules,
        highConfidenceCount: highConfRules.length,
      },
      lastConsolidation: this.lastConsolidation,
      lastForgetting: this.lastForgetting,
      metrics: { ...this.metrics },
    };
  }

  /** Format recall results for display */
  formatRecallForDisplay(results: RecallResult[]): string {
    if (results.length === 0) return '无相关记忆';
    return results.map((r, i) =>
      `${i + 1}. [${r.type}] 分数 ${(r.score * 100).toFixed(0)}% — ${r.content.slice(0, 200)}`
    ).join('\n');
  }

  // ── Private ──

  private async recordEpisode(
    type: Episode['type'],
    taskId: string | undefined,
    summary: string,
    options: { details?: string; importance?: number; tags?: string[]; changedFiles?: string[] } = {}
  ): Promise<Episode> {
    return this.episodic.record(createEpisode(type, summary, options.details || summary, {
      taskId,
      importance: options.importance,
      tags: options.tags,
      changedFiles: options.changedFiles,
    }));
  }

  private formatRecallForWM(r: RecallResult): string {
    switch (r.type) {
      case 'semantic':
        return `[记忆·规则] ${r.content.replace(/^\[规则.*?\]\s*/, '')}`;
      case 'emotion':
        return `[记忆·重要] ${r.content.replace(/^\[重要记忆.*?\]\s*/, '')}`;
      case 'timeline':
        return `[记忆·历史] ${r.content.replace(/^\[时间轴记忆.*?\]\s*/, '')}`;
    }
  }
}
