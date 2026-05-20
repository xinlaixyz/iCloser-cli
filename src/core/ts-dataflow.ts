// TS Compiler API data flow analyzer — type-level def-use chains
// Pushes data flow beyond AST name-matching by using the TS type checker
import * as ts from 'typescript';
import * as path from 'path';
import { existsSync, statSync } from 'fs';

export interface TSDataFlowDef {
  name: string;
  file: string;
  line: number;
  kind: string;         // 'param' | 'const' | 'let' | 'var' | 'function' | 'class' | 'method'
  type: string;         // resolved type string from TS type checker
  isExported: boolean;
}

export interface TSDataFlowUse {
  name: string;
  file: string;
  line: number;
  usageKind: 'read' | 'write' | 'call_arg' | 'return' | 'assign_to';
  type: string;
  context: string;
  /** Resolved callee info (set by TS type checker during Pass 2, avoids regex in Pass 3) */
  calleeName?: string;
  calleeFile?: string;
}

export interface TSDataFlowEdge {
  def: TSDataFlowDef;
  uses: TSDataFlowUse[];
}

export interface TSCrossFileFlow {
  source: TSDataFlowDef;
  sinks: { file: string; line: number; functionName: string; paramName: string; chain: string[] }[];
}

// LRU cache for TS Program results — avoids full rebuild on repeated calls
const CACHE_TTL_MS = 30_000;
interface CacheEntry { result: ReturnType<typeof buildAnalysisResult>; ts: number; tsconfigMtime: number; }
const analysisCache = new Map<string, CacheEntry>();

function getCachedOrNew(rootPath: string, tsconfigPath: string, srcFiles: string[], options: any): ReturnType<typeof buildAnalysisResult> {
  try {
    const tsconfigStat = existsSync(tsconfigPath) ? statSync(tsconfigPath) : null;
    const tsconfigMtime = tsconfigStat?.mtimeMs || 0;
    const key = `${rootPath}::${tsconfigMtime}`;
    const cached = analysisCache.get(key);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.result;
  } catch { /* proceed without cache */ }

  const result = buildAnalysisResult(srcFiles, options);
  try {
    const tsconfigMtime = existsSync(tsconfigPath) ? statSync(tsconfigPath)?.mtimeMs || 0 : 0;
    analysisCache.set(`${rootPath}::${tsconfigMtime}`, { result, ts: Date.now(), tsconfigMtime });
    if (analysisCache.size > 8) {
      const oldest = [...analysisCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) analysisCache.delete(oldest[0]);
    }
  } catch { /* cache set failure non-blocking */ }
  return result;
}

// Main entry: analyze project data flow using TS compiler
export function analyzeTSProject(rootPath: string): {
  edges: TSDataFlowEdge[];
  crossFile: TSCrossFileFlow[];
  stats: { files: number; definitions: number; uses: number; crossFileFlows: number };
} {
  const tsconfigPath = findTsConfig(rootPath);
  if (!tsconfigPath) return { edges: [], crossFile: [], stats: { files: 0, definitions: 0, uses: 0, crossFileFlows: 0 } };

  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(tsconfigPath));

  // Filter to src files only, exclude tests and node_modules
  const srcFiles = fileNames.filter(f =>
    !f.includes('node_modules') && !f.includes('.test.') && !f.includes('.spec.') &&
    (f.endsWith('.ts') || f.endsWith('.tsx'))
  );

  if (srcFiles.length === 0) return { edges: [], crossFile: [], stats: { files: 0, definitions: 0, uses: 0, crossFileFlows: 0 } };

  return getCachedOrNew(rootPath, tsconfigPath, srcFiles, options);
}

function buildAnalysisResult(srcFiles: string[], options: any): {
  edges: TSDataFlowEdge[];
  crossFile: TSCrossFileFlow[];
  stats: { files: number; definitions: number; uses: number; crossFileFlows: number };
} {
  const program = ts.createProgram(srcFiles.slice(0, 500), options);
  const checker = program.getTypeChecker();

  const allEdges: TSDataFlowEdge[] = [];
  const defMap = new Map<string, TSDataFlowDef>(); // key = "name@file@line"

  // Pass 1: collect all definitions with types
  for (const sf of srcFiles) {
    const sourceFile = program.getSourceFile(sf);
    if (!sourceFile) continue;

    const defs = collectDefinitions(sourceFile, checker);
    for (const def of defs) {
      const key = `${def.name}@${def.file}@${def.line}`;
      defMap.set(key, def);
    }
  }

  // Pass 2: collect uses and build edges
  for (const sf of srcFiles) {
    const sourceFile = program.getSourceFile(sf);
    if (!sourceFile) continue;

    const fileEdges = collectUsesAndBuildEdges(sourceFile, checker, defMap);
    allEdges.push(...fileEdges);
  }

  // Pass 3: cross-file flow via call graph
  const crossFile = buildCrossFileFlow(allEdges, defMap);

  return {
    edges: allEdges,
    crossFile,
    stats: {
      files: srcFiles.length,
      definitions: defMap.size,
      uses: allEdges.reduce((s, e) => s + e.uses.length, 0),
      crossFileFlows: crossFile.length,
    },
  };
}

// Pass 1: Walk AST with type checker to collect definitions
function collectDefinitions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): TSDataFlowDef[] {
  const defs: TSDataFlowDef[] = [];
  const fileName = sourceFile.fileName;

  function visit(node: ts.Node) {
    // Function/method declarations
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const symbol = checker.getSymbolAtLocation(node.name || node);
      if (symbol) {
        const decl = symbol.valueDeclaration || symbol.declarations?.[0];
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        defs.push({
          name: symbol.getName(),
          file: fileName,
          line: ts.getLineAndCharacterOfPosition(sourceFile, (decl || node).getStart()).line + 1,
          kind: ts.isMethodDeclaration(node) ? 'method' : 'function',
          type: checker.typeToString(type),
          isExported: isNodeExported(node),
        });
      }
      // Parameters
      for (const param of node.parameters) {
        const paramSymbol = checker.getSymbolAtLocation(param.name);
        if (paramSymbol) {
          const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, param.name);
          defs.push({
            name: paramSymbol.getName(),
            file: fileName,
            line: ts.getLineAndCharacterOfPosition(sourceFile, param.getStart()).line + 1,
            kind: 'param',
            type: checker.typeToString(paramType),
            isExported: false,
          });
        }
      }
    }

    // Variable declarations
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node.name);
        const kind = (node.parent?.parent && ts.isVariableStatement(node.parent.parent) &&
          (node.parent.parent as ts.VariableStatement).declarationList?.flags !== undefined)
          ? 'const' : 'let';
        defs.push({
          name: symbol.getName(),
          file: fileName,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
          kind: kind as 'const' | 'let',
          type: checker.typeToString(type),
          isExported: node.parent?.parent ? isNodeExported(node.parent.parent) : false,
        });
      }
    }

    // Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        defs.push({
          name: symbol.getName(),
          file: fileName,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
          kind: 'class',
          type: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node.name)),
          isExported: isNodeExported(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return defs;
}

// Pass 2: Collect identifier uses with type information and resolve to definitions
function collectUsesAndBuildEdges(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  defMap: Map<string, TSDataFlowDef>,
): TSDataFlowEdge[] {
  const fileName = sourceFile.fileName;
  const edges = new Map<string, TSDataFlowEdge>();

  function visit(node: ts.Node) {
    // Identifier nodes — resolve to definition
    if (ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node.parent) && !ts.isParameter(node.parent)) {
      // Skip import/export specifiers, type annotations
      if (ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent)) {
        ts.forEachChild(node, visit);
        return;
      }

      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
        const decl = symbol.valueDeclaration || symbol.declarations?.[0];
        if (decl && ts.isSourceFile(decl) === false) {
          const declFile = decl.getSourceFile().fileName;
          const declLine = ts.getLineAndCharacterOfPosition(decl.getSourceFile(), decl.getStart()).line + 1;
          const symbolName = symbol.getName();

          // Find the matching definition
          for (const [key, def] of defMap) {
            if (def.name === symbolName && (def.file === declFile || def.file === fileName)) {
              const useLine = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
              const usageKind = detectUsageKind(node);
              const useType = checker.typeToString(checker.getTypeAtLocation(node));

              if (!edges.has(key)) {
                edges.set(key, { def, uses: [] });
              }
              const edge = edges.get(key)!;
              if (!edge.uses.some(u => u.line === useLine)) {
                // T6: Resolve callee via TS type checker for call_arg usages (avoids regex in Pass 3)
                let calleeName: string | undefined;
                let calleeFile: string | undefined;
                if (usageKind === 'call_arg') {
                  try {
                    let callNode: ts.Node | undefined = node.parent;
                    while (callNode && !ts.isCallExpression(callNode)) {
                      callNode = callNode.parent;
                    }
                    if (callNode && ts.isCallExpression(callNode)) {
                      const calleeSymbol = checker.getSymbolAtLocation(callNode.expression);
                      if (calleeSymbol) {
                        calleeName = calleeSymbol.getName();
                        const calleeDecl = calleeSymbol.valueDeclaration || calleeSymbol.declarations?.[0];
                        if (calleeDecl) {
                          calleeFile = calleeDecl.getSourceFile().fileName;
                        }
                      }
                    }
                  } catch { /* callee resolution best-effort */ }
                }

                edge.uses.push({
                  name: symbolName,
                  file: fileName,
                  line: useLine,
                  usageKind,
                  type: useType,
                  context: sourceFile.text.slice(Math.max(0, node.getStart() - 20), Math.min(sourceFile.text.length, node.getEnd() + 20)),
                  calleeName,
                  calleeFile,
                });
              }
              break;
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...edges.values()].filter(e => e.uses.length > 0);
}

// Pass 3: Cross-file data flow through call chains
function buildCrossFileFlow(
  edges: TSDataFlowEdge[],
  defMap: Map<string, TSDataFlowDef>,
): TSCrossFileFlow[] {
  const results: TSCrossFileFlow[] = [];

  for (const edge of edges) {
    const callArgUses = edge.uses.filter(u => u.usageKind === 'call_arg');
    if (callArgUses.length === 0) continue;

    const sinks: TSCrossFileFlow['sinks'] = [];

    for (const use of callArgUses) {
      // T6: Use TS type checker resolved callee when available; fall back to regex
      let calleeName = use.calleeName;
      if (!calleeName) {
        const calleeMatch = use.context.match(/([\w.]+)\s*\(/);
        if (!calleeMatch) continue;
        calleeName = calleeMatch[1].split('.').pop()!;
      }
      const calleeFile = use.calleeFile; // exact file from type checker, if available

      // Find callee definition across files (prefer exact file match from type checker)
      for (const [key, def] of defMap) {
        const nameMatches = def.name === calleeName;
        const crossFile = def.file !== edge.def.file;
        const exactFile = calleeFile ? def.file === calleeFile : true; // if type checker gave file, require match
        if (nameMatches && crossFile && exactFile) {
          sinks.push({
            file: def.file,
            line: def.line,
            functionName: def.name,
            paramName: `<param of ${def.name}>`,
            chain: [`${edge.def.name}@${edge.def.file.split('/').pop()}`, `${calleeName}@${def.file.split('/').pop()}`],
          });
          break;
        }
      }
    }

    if (sinks.length > 0) {
      results.push({ source: edge.def, sinks });
    }
  }

  return results;
}

// Helpers
function findTsConfig(rootPath: string): string | null {
  const candidates = [
    path.join(rootPath, 'tsconfig.json'),
    path.join(rootPath, 'tsconfig.base.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function isNodeExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers ? modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) : false;
}

function detectUsageKind(node: ts.Identifier): TSDataFlowUse['usageKind'] {
  const parent = node.parent;
  if (!parent) return 'read';

  // Assignment target: x = ...
  if (ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return 'assign_to';
  }
  // Call argument: foo(x)
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return 'call_arg';
  }
  // Return statement: return x
  if (ts.isReturnStatement(parent)) {
    return 'return';
  }
  // Property assignment: obj.prop = x (x is the value being assigned)
  if (ts.isBinaryExpression(parent) && parent.right === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return 'write';
  }

  return 'read';
}

// Convenience: analyze and format as readable summary
export function formatDataFlowSummary(
  analysis: ReturnType<typeof analyzeTSProject>,
): string {
  const { edges, crossFile, stats } = analysis;
  const lines: string[] = [];
  lines.push(`数据流分析: ${stats.files} 文件, ${stats.definitions} 定义, ${stats.uses} 使用, ${stats.crossFileFlows} 跨文件流`);
  lines.push('');

  // Top 10 definitions with most uses
  const topDefs = [...edges].sort((a, b) => b.uses.length - a.uses.length).slice(0, 10);
  if (topDefs.length > 0) {
    lines.push('## 高频数据流 (定义→使用次数)');
    for (const e of topDefs) {
      lines.push(`- \`${e.def.name}\` (${e.def.type}) → ${e.uses.length} 处使用 [${e.uses.map(u => u.usageKind).filter((v, i, a) => a.indexOf(v) === i).join(', ')}]`);
    }
    lines.push('');
  }

  // Cross-file flows
  if (crossFile.length > 0) {
    lines.push('## 跨文件数据流');
    for (const cf of crossFile.slice(0, 10)) {
      const srcFile = cf.source.file.split('/').pop() || cf.source.file;
      lines.push(`- \`${cf.source.name}\` (${srcFile}:${cf.source.line}) → ${cf.sinks.length} 个跨文件接收方`);
      for (const sink of cf.sinks.slice(0, 3)) {
        lines.push(`  → ${sink.functionName}@${sink.file.split('/').pop() || sink.file}:${sink.line}`);
      }
    }
  }

  return lines.join('\n');
}

// Impact analysis using real type information
export function analyzeImpactWithTSC(
  rootPath: string,
  entrySymbol: string,
): { directlyAffected: string[]; indirectlyAffected: string[]; filesToCheck: string[]; assessment: string } {
  const analysis = analyzeTSProject(rootPath);
  const directlyAffected = new Set<string>();
  const indirectlyAffected = new Set<string>();
  const filesToCheck = new Set<string>();

  // BFS from entry symbol through data flow edges
  const visited = new Set<string>();
  const queue: { name: string; depth: number }[] = [{ name: entrySymbol, depth: 0 }];

  while (queue.length > 0) {
    const { name, depth } = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);

    if (depth === 0) { /* entry */ }
    else if (depth <= 2) directlyAffected.add(name);
    else indirectlyAffected.add(name);

    // Follow data flow edges
    for (const edge of analysis.edges) {
      if (edge.def.name === name) {
        filesToCheck.add(edge.def.file);
        for (const use of edge.uses) {
          if (use.usageKind === 'call_arg' && !visited.has(use.name)) {
            queue.push({ name: use.name, depth: depth + 1 });
          }
        }
      }
    }

    // Follow cross-file flows
    for (const cf of analysis.crossFile) {
      if (cf.source.name === name) {
        for (const sink of cf.sinks) {
          filesToCheck.add(sink.file);
          if (!visited.has(sink.functionName)) {
            queue.push({ name: sink.functionName, depth: depth + 1 });
          }
        }
      }
    }

    if (queue.length > 100) break; // Safety limit
  }

  directlyAffected.delete(entrySymbol);

  const totalAffected = directlyAffected.size + indirectlyAffected.size;
  return {
    directlyAffected: [...directlyAffected],
    indirectlyAffected: [...indirectlyAffected],
    filesToCheck: [...filesToCheck],
    assessment: totalAffected === 0
      ? `修改 \`${entrySymbol}\` 的影响面极小（未检测到下游数据流）`
      : totalAffected <= 5
        ? `修改 \`${entrySymbol}\` 影响 ${directlyAffected.size} 个直接依赖 + ${indirectlyAffected.size} 个间接依赖，范围可控`
        : `修改 \`${entrySymbol}\` 影响 ${directlyAffected.size} 个直接依赖 + ${indirectlyAffected.size} 个间接依赖，涉及 ${filesToCheck.size} 个文件，建议分批修改`,
  };
}
