// Coverage for src/core/ts-dataflow.ts
// Targets: formatDataFlowSummary (323-354), analyzeImpactWithTSC (358-419)
import { describe, it, expect } from 'vitest';
import {
  analyzeTSProject,
  formatDataFlowSummary,
  analyzeImpactWithTSC,
} from '../src/core/ts-dataflow.js';
import type { TSDataFlowEdge, TSCrossFileFlow } from '../src/core/ts-dataflow.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ts-df-'));
  dirs.push(d);
  return d;
}

// Clean up after all tests
import { afterAll } from 'vitest';
afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// analyzeTSProject — early return path (no tsconfig)
// ============================================================
describe('analyzeTSProject', () => {
  it('returns empty result when no tsconfig found', () => {
    const dir = tmpDir();
    const result = analyzeTSProject(dir);
    expect(result.edges).toEqual([]);
    expect(result.crossFile).toEqual([]);
    expect(result.stats.files).toBe(0);
    expect(result.stats.definitions).toBe(0);
    expect(result.stats.uses).toBe(0);
    expect(result.stats.crossFileFlows).toBe(0);
  });
});

// ============================================================
// formatDataFlowSummary — empty analysis
// ============================================================
describe('formatDataFlowSummary — empty', () => {
  it('formats empty analysis summary', () => {
    const emptyAnalysis = {
      edges: [],
      crossFile: [],
      stats: { files: 0, definitions: 0, uses: 0, crossFileFlows: 0 },
    };
    const result = formatDataFlowSummary(emptyAnalysis);
    expect(typeof result).toBe('string');
    expect(result).toContain('数据流分析');
    expect(result).toContain('0 文件');
  });
});

// ============================================================
// formatDataFlowSummary — with data (covers topDefs and crossFile sections)
// ============================================================
describe('formatDataFlowSummary — with data', () => {
  function makeEdge(name: string, numUses: number): TSDataFlowEdge {
    const uses = Array.from({ length: numUses }, (_, i) => ({
      name,
      file: `src/consumer-${i}.ts`,
      line: i + 1,
      usageKind: 'call_arg' as const,
      type: 'string',
      context: `${name}(x)`,
    }));
    return {
      def: {
        name,
        file: 'src/def.ts',
        line: 1,
        kind: 'function',
        type: 'string',
        isExported: true,
      },
      uses,
    };
  }

  it('shows top 10 definitions with most uses', () => {
    // Create 12 edges so we have more than 10 (covers slice(0, 10))
    const edges: TSDataFlowEdge[] = [
      makeEdge('authLogin', 8),
      makeEdge('getUser', 7),
      makeEdge('createPost', 6),
      makeEdge('updateProfile', 5),
      makeEdge('deleteComment', 4),
      makeEdge('searchItems', 3),
      makeEdge('validateToken', 3),
      makeEdge('formatDate', 2),
      makeEdge('parseConfig', 2),
      makeEdge('sendEmail', 1),
      makeEdge('hashPassword', 1),
      makeEdge('logEvent', 1),
    ];

    const crossFile: TSCrossFileFlow[] = [
      {
        source: {
          name: 'authLogin',
          file: 'src/auth.ts',
          line: 10,
          kind: 'function',
          type: '() => void',
          isExported: true,
        },
        sinks: [
          {
            file: 'src/routes/login.ts',
            line: 25,
            functionName: 'handleLogin',
            paramName: '<param of handleLogin>',
            chain: ['authLogin@auth.ts', 'handleLogin@login.ts'],
          },
          {
            file: 'src/middleware/auth.ts',
            line: 15,
            functionName: 'authMiddleware',
            paramName: '<param of authMiddleware>',
            chain: ['authLogin@auth.ts', 'authMiddleware@auth.ts'],
          },
          {
            file: 'src/services/user.ts',
            line: 42,
            functionName: 'getUserSession',
            paramName: '<param of getUserSession>',
            chain: ['authLogin@auth.ts', 'getUserSession@user.ts'],
          },
        ],
      },
    ];

    const result = formatDataFlowSummary({
      edges,
      crossFile,
      stats: { files: 5, definitions: 12, uses: 43, crossFileFlows: 1 },
    });

    expect(result).toContain('高频数据流');
    expect(result).toContain('authLogin');
    expect(result).toContain('跨文件数据流');
    expect(result).toContain('handleLogin');
  });

  it('handles analysis with only edges and no cross-file flows', () => {
    const edges: TSDataFlowEdge[] = [
      makeEdge('helperFn', 3),
      makeEdge('utilFn', 2),
    ];

    const result = formatDataFlowSummary({
      edges,
      crossFile: [],
      stats: { files: 2, definitions: 2, uses: 5, crossFileFlows: 0 },
    });

    expect(result).toContain('高频数据流');
    expect(result).not.toContain('跨文件数据流');
  });

  it('handles analysis with cross-file flows truncated to 10', () => {
    const crossFiles: TSCrossFileFlow[] = Array.from({ length: 15 }, (_, i) => ({
      source: {
        name: `func${i}`,
        file: `src/module${i}.ts`,
        line: i + 1,
        kind: 'function',
        type: 'void',
        isExported: true,
      },
      sinks: [
        {
          file: `src/consumer${i}.ts`,
          line: 10,
          functionName: `handler${i}`,
          paramName: '<param>',
          chain: [`func${i}@module${i}.ts`, `handler${i}@consumer${i}.ts`],
        },
        {
          file: `src/service${i}.ts`,
          line: 20,
          functionName: `service${i}`,
          paramName: '<param>',
          chain: [`func${i}@module${i}.ts`, `service${i}@service${i}.ts`],
        },
        {
          file: `src/extra${i}.ts`,
          line: 30,
          functionName: `extra${i}`,
          paramName: '<param>',
          chain: [`func${i}@module${i}.ts`, `extra${i}@extra${i}.ts`],
        },
      ],
    }));

    const result = formatDataFlowSummary({
      edges: [],
      crossFile: crossFiles,
      stats: { files: 15, definitions: 15, uses: 30, crossFileFlows: 15 },
    });

    // Should still produce valid output (sliced to 10)
    expect(result).toContain('跨文件数据流');
  });
});

// ============================================================
// analyzeImpactWithTSC — no tsconfig (empty analysis path)
// ============================================================
describe('analyzeImpactWithTSC', () => {
  it('returns empty impact when no tsconfig found', () => {
    const dir = tmpDir();
    const result = analyzeImpactWithTSC(dir, 'someFunction');
    expect(Array.isArray(result.directlyAffected)).toBe(true);
    expect(Array.isArray(result.indirectlyAffected)).toBe(true);
    expect(Array.isArray(result.filesToCheck)).toBe(true);
    expect(typeof result.assessment).toBe('string');
    expect(result.directlyAffected).toHaveLength(0);
    expect(result.indirectlyAffected).toHaveLength(0);
  });

  it('returns minimal impact assessment for unknown symbol', () => {
    const dir = tmpDir();
    const result = analyzeImpactWithTSC(dir, 'unknownSymbol123');
    expect(result.assessment).toContain('unknownSymbol123');
    expect(result.assessment).toContain('影响面极小');
  });

  it('handles multiple entry symbols gracefully', () => {
    const dir = tmpDir();
    const result1 = analyzeImpactWithTSC(dir, 'funcA');
    const result2 = analyzeImpactWithTSC(dir, 'funcB');
    expect(result1.assessment).toBeTruthy();
    expect(result2.assessment).toBeTruthy();
  });
});
