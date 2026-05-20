// Semantic Memory — PRD §4.3.2: abstracted rules, preferences, architecture constraints
// Tree-organized rule store: domain/platform/area hierarchy
// Storage: rules.json (structured) + tree.md (human-readable) + SQLite index
import { randomUUID } from 'node:crypto';
import type { MemoryStore } from './store.js';
import { readFile, fileExists } from '../../utils/fs.js';

export interface SemanticRule {
  id: string;
  path: string;           // hierarchical path, e.g. "iOS/UI/修改规则"
  domain: string;         // top-level: iOS, Android, Backend, Frontend, DevOps, General
  platform?: string;      // e.g. Swift, Kotlin, React, Node.js
  area?: string;          // e.g. UI, API, Auth, Database, Config
  content: string;        // the rule content (1-3 sentences)
  scope: 'project' | 'global';
  confidence: number;     // 0-1, increases with each verification
  verificationCount: number; // times this rule was verified correct
  sourceEpisodeIds: string[]; // trace back to episodic events that generated this rule
  tags: string[];
  isPermanent: boolean;   // user explicitly marked as immutable
  created_at: string;
  updated_at: string;
}

export interface SemanticQuery {
  path?: string;        // prefix match, e.g. "iOS/UI"
  domain?: string;
  tags?: string[];
  minConfidence?: number;
  scope?: 'project' | 'global';
  searchText?: string;
  limit?: number;
}

export class SemanticMemory {
  private store: MemoryStore;
  private rules: SemanticRule[] = [];
  private dirty = false;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /** Load rules from disk */
  async load(): Promise<void> {
    // Load from JSON
    if (await fileExists(this.store.semanticRulesPath)) {
      try {
        const data = await readFile(this.store.semanticRulesPath);
        this.rules = JSON.parse(data) as SemanticRule[];
      } catch { this.rules = []; }
    }

    // Also load from SQLite (reconciliation)
    if (this.store.sqlite.isOpen) {
      const rows = this.store.sqlite.query('semantic', { limit: 10000 });
      for (const row of rows) {
        const rule = JSON.parse(row.data) as SemanticRule;
        if (!this.rules.find(r => r.id === rule.id)) {
          this.rules.push(rule);
        }
      }
    }
  }

  /** Save rules to disk */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const { writeJson } = await import('../../utils/fs.js');

    // Write JSON
    await writeJson(this.store.semanticRulesPath, this.rules);

    // Write human-readable tree
    await this.writeTree();

    // Sync to SQLite
    if (this.store.sqlite.isOpen) {
      for (const rule of this.rules) {
        try {
          this.store.sqlite.insert('semantic', {
            type: 'rule',
            key: rule.id,
            data: JSON.stringify(rule),
            tags: rule.tags.join(','),
            importance: rule.confidence,
            created_at: rule.created_at,
            updated_at: rule.updated_at,
          });
        } catch { /* skip duplicates */ }
      }
    }

    this.dirty = false;
  }

  /** Add a new rule */
  add(rule: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>): SemanticRule {
    const id = `rule-${Date.now().toString(36)}-${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const full: SemanticRule = {
      ...rule,
      id,
      sourceEpisodeIds: rule.sourceEpisodeIds || [],
      verificationCount: rule.verificationCount || 0,
      isPermanent: rule.isPermanent || false,
      created_at: now,
      updated_at: now,
    };

    // Check for duplicates
    const dup = this.rules.find(r =>
      r.path === full.path &&
      r.content.slice(0, 60) === full.content.slice(0, 60)
    );
    if (dup) {
      dup.verificationCount++;
      dup.confidence = Math.min(1, dup.confidence + 0.1);
      dup.updated_at = now;
      dup.sourceEpisodeIds = [...new Set([...dup.sourceEpisodeIds, ...full.sourceEpisodeIds])];
      this.dirty = true;
      return dup;
    }

    this.rules.push(full);
    this.dirty = true;
    return full;
  }

  /** Merge a rule (upsert by path + content similarity) */
  merge(rule: Omit<SemanticRule, 'id' | 'created_at' | 'updated_at'>): SemanticRule {
    return this.add(rule);
  }

  /** Get a rule by ID */
  get(id: string): SemanticRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  /** Query rules */
  query(options: SemanticQuery = {}): SemanticRule[] {
    let results = [...this.rules];

    if (options.path) {
      results = results.filter(r => r.path.startsWith(options.path!));
    }
    if (options.domain) {
      results = results.filter(r => r.domain === options.domain);
    }
    if (options.scope) {
      results = results.filter(r => r.scope === options.scope);
    }
    if (options.minConfidence !== undefined) {
      results = results.filter(r => r.confidence >= options.minConfidence!);
    }
    if (options.tags && options.tags.length > 0) {
      results = results.filter(r => options.tags!.some(t => r.tags.includes(t)));
    }
    if (options.searchText) {
      const q = options.searchText.toLowerCase();
      results = results.filter(r =>
        r.content.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /** Get all rules under a path prefix */
  getByPath(pathPrefix: string): SemanticRule[] {
    return this.query({ path: pathPrefix });
  }

  /** Get high-confidence rules (verified multiple times) */
  getHighConfidence(minConfidence = 0.7): SemanticRule[] {
    return this.query({ minConfidence });
  }

  /** Get rules relevant to a task description — splits into words, matches any.
   *  For CJK queries without word boundaries, also tries individual characters. */
  searchRelevant(taskDescription: string, limit = 10): SemanticRule[] {
    // Split query by delimiters
    const rawTerms = taskDescription.toLowerCase().split(/[\s,，。.!！?？、/\\]+/).filter(t => t.length >= 1);
    if (rawTerms.length === 0) return this.query({ limit });

    // Expand CJK-only terms into bigram matches (2-char sliding window)
    // Single chars cause too many false positives
    const cjkPattern = /[一-鿿㐀-䶿]/;
    const terms: string[] = [];
    for (const t of rawTerms) {
      terms.push(t); // always include the full term
      // If the term has CJK chars and no word delimiters, also add bigrams
      if (t.length >= 2 && cjkPattern.test(t) && !/[a-z0-9]/i.test(t)) {
        for (let i = 0; i <= t.length - 2; i++) {
          terms.push(t.slice(i, i + 2));
        }
      }
    }

    // Score: count how many search terms match the rule
    const allRules = this.rules.map(rule => {
      const lowerContent = rule.content.toLowerCase();
      const lowerPath = rule.path.toLowerCase();
      const lowerTags = rule.tags.map(t => t.toLowerCase());
      let matchCount = 0;
      const matchedTerms = new Set<string>();
      for (const term of terms) {
        if (matchedTerms.has(term)) continue;
        if (lowerContent.includes(term) || lowerPath.includes(term) || lowerTags.some(t => t.includes(term))) {
          matchCount++;
          matchedTerms.add(term);
        }
      }
      return { rule, matchCount };
    });

    return allRules
      .filter(r => r.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount || b.rule.confidence - a.rule.confidence)
      .slice(0, limit)
      .map(r => r.rule);
  }

  /** Update a rule */
  update(id: string, updates: Partial<Omit<SemanticRule, 'id' | 'created_at'>>): SemanticRule | null {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return null;
    Object.assign(rule, updates, { updated_at: new Date().toISOString() });
    this.dirty = true;
    return rule;
  }

  /** Delete a rule */
  delete(id: string): boolean {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    this.dirty = true;
    if (this.store.sqlite.isOpen) {
      this.store.sqlite.deleteByKey('semantic', id);
    }
    return true;
  }

  /** Decrease confidence of a rule that turned out wrong */
  weaken(id: string): SemanticRule | null {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return null;
    rule.confidence = Math.max(0, rule.confidence - 0.2);
    rule.updated_at = new Date().toISOString();
    this.dirty = true;
    return rule;
  }

  /** Mark a rule as permanent (immune to forgetting) */
  makePermanent(id: string): SemanticRule | null {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return null;
    rule.isPermanent = true;
    rule.confidence = 1.0;
    rule.updated_at = new Date().toISOString();
    this.dirty = true;
    return rule;
  }

  /** Get the semantic tree structure */
  getTree(): Map<string, SemanticRule[]> {
    const tree = new Map<string, SemanticRule[]>();
    for (const rule of this.rules) {
      const prefix = rule.domain + (rule.platform ? `/${rule.platform}` : '');
      if (!tree.has(prefix)) tree.set(prefix, []);
      tree.get(prefix)!.push(rule);
    }
    return tree;
  }

  /** Count rules by domain */
  countByDomain(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const rule of this.rules) {
      counts[rule.domain] = (counts[rule.domain] || 0) + 1;
    }
    return counts;
  }

  get totalRules(): number { return this.rules.length; }

  // ── Private ──

  private async writeTree(): Promise<void> {
    const tree = this.getTree();
    const lines: string[] = [
      '# Semantic Memory Tree',
      `> Generated: ${new Date().toISOString()}`,
      `> Total rules: ${this.rules.length}`,
      '',
    ];

    for (const [prefix, rules] of tree) {
      lines.push(`## ${prefix}`);
      lines.push('');
      for (const rule of rules) {
        const conf = (rule.confidence * 100).toFixed(0);
        const perm = rule.isPermanent ? ' 🔒' : '';
        lines.push(`- [${conf}%]${perm} **${rule.area || rule.path}**: ${rule.content}`);
        if (rule.sourceEpisodeIds && rule.sourceEpisodeIds.length > 0) {
          lines.push(`  → 来源: ${rule.sourceEpisodeIds.slice(0, 3).join(', ')}`);
        }
      }
      lines.push('');
    }

    const { writeFile: wf } = await import('fs/promises');
    await wf(this.store.semanticTreePath, lines.join('\n'), 'utf-8');
  }
}
