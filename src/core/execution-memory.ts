// Per-task execution memory for deterministic tool orchestration.

export type ExecutionFactKind = 'fact' | 'failure' | 'verified' | 'decision';

export interface ExecutionMemoryRecord {
  kind: ExecutionFactKind;
  text: string;
  source: string;
  createdAt: string;
}

export interface ExecutionMemorySnapshot {
  facts: string[];
  failures: string[];
  verified: string[];
  decisions: string[];
  records: ExecutionMemoryRecord[];
}

export class ExecutionMemory {
  private records: ExecutionMemoryRecord[] = [];
  private seen = new Set<string>();

  add(kind: ExecutionFactKind, text: string, source = 'orchestrator'): void {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const key = `${kind}:${normalized.toLowerCase()}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.records.push({
      kind,
      text: normalized,
      source,
      createdAt: new Date().toISOString(),
    });
  }

  addFact(text: string, source?: string): void { this.add('fact', text, source); }
  addFailure(text: string, source?: string): void { this.add('failure', text, source); }
  addVerified(text: string, source?: string): void { this.add('verified', text, source); }
  addDecision(text: string, source?: string): void { this.add('decision', text, source); }

  hasText(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    return [...this.seen].some(key => key.endsWith(`:${normalized}`));
  }

  snapshot(): ExecutionMemorySnapshot {
    const pick = (kind: ExecutionFactKind) => this.records.filter(r => r.kind === kind).map(r => r.text);
    return {
      facts: pick('fact'),
      failures: pick('failure'),
      verified: pick('verified'),
      decisions: pick('decision'),
      records: [...this.records],
    };
  }
}

export function summarizeToolResult(result: string, limit = 180): string {
  const oneLine = result.replace(/\s+/g, ' ').trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 3)}...` : oneLine;
}

