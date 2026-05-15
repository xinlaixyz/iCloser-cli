// Project Scanner — deep codebase analysis
import * as path from 'path';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { findFiles, readFile, isTextFile, estimateTokens, relativePath, readJson, writeJson, fileExists, getFileSize, listDir } from '../utils/fs.js';
import type {
  ProjectIdentity, ProjectIndex, ModuleInfo, ApiEndpoint,
  DbSchemaInfo, DependencyInfo, StyleFingerprint, ExportInfo, ImportInfo,
} from '../types.js';
import { detectProject } from '../utils/detect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Parallel batch utility — controlled concurrency for large file sets
// ============================================================
async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 16
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        // Preserve thrown errors for callers that check
        results[idx] = undefined as unknown as R;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface ScanOptions {
  rootPath: string;
  deep: boolean;          // deep scan with AST parsing
  includeTests: boolean;
  maxFileSize: number;    // bytes, skip larger files
}

export interface ScanResult {
  identity: ProjectIdentity;
  index: ProjectIndex;
  fileCount: number;
  moduleCount: number;
  apiCount: number;
  totalTokens: number;
  duration: number;       // ms
}

type SerializedProjectIndex = Omit<ProjectIndex, 'dependencyGraph'> & {
  dependencyGraph: Record<string, string[]>;
};

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const startTime = Date.now();
  const { rootPath } = options;

  // Phase 1: Identity detection
  const identity = await detectProject(rootPath);

  // Phase 2: File discovery
  const sourcePatterns = getSourceFilePatterns(identity.language);
  const sourceFiles = await findFiles(rootPath, sourcePatterns);
  if (sourceFiles.length > 500) process.stdout.write(`  发现 ${sourceFiles.length} 个源文件，正在分析...\n`);
  const filteredFiles = await filterBySize(rootPath, sourceFiles, options.maxFileSize);

  // Phase 2.5: Incremental scan — compute fingerprints, skip unchanged files
  const oldFingerprints = await loadPreviousFingerprints(rootPath);
  const { currentFingerprints, changedFiles, skippedCount } = await computeFingerprints(filteredFiles, oldFingerprints);
  if (skippedCount > 100) process.stdout.write(`  增量扫描：跳过 ${skippedCount} 个未变更文件\n`);

  const isIncremental = changedFiles.length > 0 && changedFiles.length < filteredFiles.length * 0.8;

  // Phase 3: Module extraction (incremental or full)
  let modules: ModuleInfo[];
  if (isIncremental) {
    // Load old index to merge unchanged module data
    const oldIndex = await loadProjectIndex(rootPath);
    const oldModules = oldIndex?.modules || [];
    // Only re-scan changed files; merge with old module data for unchanged files
    const newModules = await extractModules(rootPath, changedFiles);
    modules = mergeModules(oldModules, newModules, changedFiles, filteredFiles);
  } else {
    modules = await extractModules(rootPath, filteredFiles);
  }

  // Phase 4: API endpoint detection
  const apis = await extractApiEndpoints(rootPath, identity, filteredFiles);

  // Phase 5: Database schema detection
  const database = await extractDbSchema(rootPath, identity);

  // Phase 6: Dependency analysis
  const dependencies = await extractDependencies(rootPath, identity);

  // Phase 7: Style fingerprint
  const styleFingerprint = await extractStyleFingerprint(rootPath, filteredFiles);

  // Phase 8: Build dependency graph
  const dependencyGraph = buildDependencyGraph(modules);

  // Phase 8.5: Cross-file call graph (S11)
  let callGraph: import('../types.js').CrossFileCallEdge[] | undefined;
  try {
    callGraph = await buildCrossFileCallGraph(rootPath, modules);
  } catch { /* best effort, non-blocking */ }

  // Phase 8.6: TS Compiler API type-level data flow (T1.1 enhanced, deep scan only)
  let tsDataFlow: import('../types.js').ProjectIndex['tsDataFlow'];
  if (options.deep) {
    try {
      const { analyzeTSProject } = await import('./ts-dataflow.js');
      const dfResult = await Promise.race([
        (async () => analyzeTSProject(rootPath))(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
      ]);
      if (dfResult && dfResult.stats.definitions > 0) {
        tsDataFlow = {
          totalEdges: dfResult.edges.length,
          totalUses: dfResult.stats.uses,
          crossFileFlows: dfResult.stats.crossFileFlows,
          topFlows: [...dfResult.edges]
            .sort((a, b) => b.uses.length - a.uses.length)
            .slice(0, 20)
            .map(e => ({ name: e.def.name, type: e.def.type, useCount: e.uses.length })),
        };
      }
    } catch { /* TS data flow is optional */ }
  }

  // Phase 9: Architecture pattern detection
  const architecturePattern = detectArchitecturePattern(rootPath, modules, identity);

  // Phase 10: Token estimation (parallelized)
  const tokenCounts = await pMap(filteredFiles, async (file) => {
    try {
      const content = await readFile(file);
      return estimateTokens(content);
    } catch { return 0; }
  }, 32);
  const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0);

  const index: ProjectIndex = {
    identity,
    modules,
    apis,
    database,
    dependencies,
    dependencyGraph,
    styleFingerprint,
    architecturePattern,
    rootPath,
    lastScan: new Date().toISOString(),
    callGraph,
    fileFingerprints: currentFingerprints,
    tsDataFlow,
  };

  return {
    identity,
    index,
    fileCount: filteredFiles.length,
    moduleCount: modules.length,
    apiCount: apis.length,
    totalTokens,
    duration: Date.now() - startTime,
  };
}

export function serializeProjectIndex(index: ProjectIndex): SerializedProjectIndex {
  return {
    ...index,
    dependencyGraph: Object.fromEntries(index.dependencyGraph),
  };
}

export function deserializeProjectIndex(raw: SerializedProjectIndex): ProjectIndex {
  return {
    ...raw,
    dependencyGraph: new Map(Object.entries(raw.dependencyGraph || {})),
  };
}

export async function saveProjectIndex(rootPath: string, index: ProjectIndex): Promise<void> {
  await writeJson(path.join(rootPath, '.icloser', 'index.json'), serializeProjectIndex(index));
}

export async function loadProjectIndex(rootPath: string): Promise<ProjectIndex | null> {
  const indexPath = path.join(rootPath, '.icloser', 'index.json');
  if (!(await fileExists(indexPath))) return null;
  const raw = await readJson(indexPath) as unknown as SerializedProjectIndex;
  return deserializeProjectIndex(raw);
}

// ============================================================
// File patterns — always scan for ALL common source types, not just primary language
// This ensures full-stack projects (Go+React, Python+Vue) don't miss frontend files
// ============================================================
const ALL_SOURCE_PATTERNS: string[] = [
  '**/*.ts', '**/*.tsx', '!**/*.d.ts',
  '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs',
  '**/*.go',
  '**/*.py',
  '**/*.rs',
  '**/*.java', '**/*.kt', '**/*.kts',
  '**/*.swift', '**/*.m', '**/*.mm', '**/*.h',
  // Extensionless project files
  '**/Podfile', '**/Makefile', '**/Dockerfile', '**/Cartfile', '**/Gemfile',
  '**/Rakefile', '**/Package.swift', '**/Brewfile',
  // iOS bundle directories are nested, but their contents can be globbed
  '**/*.xcdatamodeld/*', '**/*.xcodeproj/*', '**/*.xcworkspace/*',
  '**/*.storyboard', '**/*.xib', '**/*.plist',
  '**/*.sql',
  '**/*.cs',
  '**/*.php',
  '**/*.rb',
  '**/*.css', '**/*.scss', '**/*.less',
  '**/*.vue', '**/*.svelte',
  '**/*.proto',
  '**/*.yaml', '**/*.yml',
  '**/*.toml',
  '**/*.xml',
  '**/*.json',
];
const TEST_PATTERNS: RegExp[] = [
  /\.test\.\w+$/, /\.spec\.\w+$/, /_test\.\w+$/,
  /\/test_\w+\.\w+$/, /\/\w+_test\.\w+$/, /\/\w+Test\.\w+$/,
  /\/__tests__\//, /\/tests\//, /\/test\//,
];
const GENERATED_PATTERNS: RegExp[] = [
  /\.d\.ts$/, /\.generated\./, /\.pb\.\w+$/,
  /\/node_modules\//, /\/vendor\//, /\/\.git\//,
  /\/dist\//, /\/build\//, /\/target\//, /\/\.next\//, /\/\.nuxt\//,
  /\/__pycache__\//, /\/\.icloser\//,
];

function getSourceFilePatterns(_language: string): string[] {
  return ALL_SOURCE_PATTERNS;
}

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some(p => p.test(filePath));
}
function isGeneratedFile(filePath: string): boolean {
  return GENERATED_PATTERNS.some(p => p.test(filePath));
}

async function filterBySize(
  rootPath: string,
  files: string[],
  maxSize: number
): Promise<string[]> {
  const results = await pMap(files, async (file) => {
    try {
      const size = await getFileSize(file);
      if (size <= maxSize && await isTextFile(file)) {
        return file;
      }
    } catch { /* skip */ }
    return null;
  }, 32);
  return results.filter((f): f is string => f !== null);
}

// ============================================================
// Worker thread pool for parallel regex extraction
// ============================================================
const __scannerWorkerPath = path.join(__dirname, 'scanner-worker.js');

class WorkerPool {
  private workers: Worker[] = [];
  private queue: Array<{ task: unknown; resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  private activeCount = 0;
  private maxWorkers: number;

  constructor(maxWorkers = 2) {
    this.maxWorkers = maxWorkers;
  }

  private getWorker(): Worker | null {
    // Return existing idle worker if available
    if (this.workers.length > 0 && this.activeCount < this.workers.length) {
      return this.workers[this.activeCount];
    }
    // Create new worker if under limit
    if (this.workers.length < this.maxWorkers) {
      try {
        const worker = new Worker(__scannerWorkerPath);
        this.workers.push(worker);
        return worker;
      } catch {
        return null;
      }
    }
    return null;
  }

  async exec<T>(task: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = this.getWorker();
      if (!worker) {
        // Worker not available — reject so caller falls back to main thread
        reject(new Error('No worker available'));
        return;
      }
      this.activeCount++;
      const onMessage = (result: { ok: boolean; data?: unknown; error?: string }) => {
        worker.removeListener('message', onMessage);
        this.activeCount--;
        this.drainQueue();
        if (result.ok) resolve(result.data as T);
        else reject(new Error(result.error));
      };
      worker.on('message', onMessage);
      worker.postMessage(task);
    });
  }

  private drainQueue(): void {
    if (this.queue.length === 0 || !this.getWorker()) return;
    const next = this.queue.shift()!;
    this.exec(next.task).then(next.resolve).catch(next.reject);
  }

  async destroy(): Promise<void> {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.queue = [];
  }
}

let sharedPool: WorkerPool | null = null;
function getWorkerPool(): WorkerPool {
  if (!sharedPool) sharedPool = new WorkerPool(2);
  return sharedPool;
}

// Batch regex extraction using worker threads, falls back to main thread
async function batchExtractWithWorkers<T>(
  tasks: Array<{ type: string; file: string; relativeFile: string; content: string }>
): Promise<(T | null)[]> {
  const pool = getWorkerPool();
  return pMap(tasks, async (task) => {
    try {
      return await pool.exec<T>(task);
    } catch {
      return null; // Worker unavailable — will be retried by caller
    }
  }, 4);
}

async function extractModules(
  rootPath: string,
  files: string[]
): Promise<ModuleInfo[]> {
  const dirMap = new Map<string, string[]>();

  for (const file of files) {
    const rel = relativePath(file, rootPath);
    const parts = rel.split(path.sep);

    // Group by top-level directory
    let moduleName = parts[0];
    // For src/moduleName pattern
    if (['src', 'lib', 'app', 'pkg', 'internal', 'cmd'].includes(moduleName) && parts.length > 1) {
      moduleName = path.extname(parts[1]) ? moduleName : parts.slice(0, 2).join('/');
    }

    if (!dirMap.has(moduleName)) dirMap.set(moduleName, []);
    dirMap.get(moduleName)!.push(rel);
  }

  const modules: ModuleInfo[] = [];

  for (const [name, moduleFiles] of dirMap) {
    // Export extraction (parallelized with pMap)
    const exportResults = await pMap(moduleFiles.slice(0, 50), async (file) => {
      const fullPath = path.join(rootPath, file);
      try {
        return await extractExportsSmart(fullPath, file);
      } catch { return [] as ExportInfo[]; }
    }, 8);
    const exports = exportResults.flat();

    // Import extraction (parallelized with pMap)
    const importResults = await pMap(moduleFiles.slice(0, 20), async (file) => {
      try {
        return await extractImportsSmart(path.join(rootPath, file));
      } catch { return [] as ImportInfo[]; }
    }, 8);
    const imports = importResults.flat();

    modules.push({
      name,
      path: path.join(rootPath, ...name.split('/')),
      files: moduleFiles,
      exports: exports.slice(0, 200),  // limit
      imports: imports.slice(0, 200),
      dependencies: [],
      dependents: [],
      responsibility: '',
    });
  }

  return modules;
}

const AST_FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.py', '.pyw', '.pyi', '.java', '.kt', '.kts', '.swift', '.m', '.mm', '.h', '.sql', '.mysql', '.psql']);

async function extractExportsSmart(fullPath: string, relativeFile: string): Promise<ExportInfo[]> {
  const ext = path.extname(fullPath).toLowerCase();
  if (!AST_FILE_EXTS.has(ext)) {
    const content = await readFileSilent(fullPath);
    return content ? extractExportsFromContent(content, relativeFile) : [];
  }

  try {
    const { parseSourceFile } = await import('./ast-parser.js');
    const parsed = await parseSourceFile(fullPath);
    if (parsed.error) throw new Error(parsed.error);

    return parsed.exports.map(e => {
      const matched = e.kind === 'function'
        ? parsed.functions.find(f => f.name === e.name && f.isExported)
        : null;
      return {
        name: e.name,
        kind: e.kind,
        signature: e.signature,
        file: relativeFile,
        line: e.line,
        isDefault: e.isDefault,
        parameters: matched?.params ?? undefined,
        returnType: matched?.returnType ?? undefined,
      };
    });
  } catch {
    // Fallback to regex on AST failure
    const content = await readFileSilent(fullPath);
    return content ? extractExportsFromContent(content, relativeFile) : [];
  }
}

async function extractImportsSmart(fullPath: string): Promise<ImportInfo[]> {
  const ext = path.extname(fullPath).toLowerCase();
  if (!AST_FILE_EXTS.has(ext)) {
    const content = await readFileSilent(fullPath);
    return content ? extractImportsFromContent(content) : [];
  }

  try {
    const { parseSourceFile } = await import('./ast-parser.js');
    const parsed = await parseSourceFile(fullPath);
    if (parsed.error) throw new Error(parsed.error);

    return parsed.imports.map(imp => ({
      source: imp.source,
      symbols: imp.symbols,
      isExternal: imp.isExternal,
      defaultImport: imp.defaultImport || undefined,
      namespaceImport: imp.namespaceImport || undefined,
      isTypeOnly: imp.isTypeOnly,
    }));
  } catch {
    const content = await readFileSilent(fullPath);
    return content ? extractImportsFromContent(content) : [];
  }
}

async function readFileSilent(fullPath: string): Promise<string | null> {
  try { return await readFile(fullPath); } catch { return null; }
}

function extractExportsFromContent(
  content: string,
  file: string
): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split('\n');
  const exportRegex = /^export\s+(async\s+)?(function|class|const|interface|type|enum)\s+(\w+)/;
  const tsExportRegex = /^export\s+\{\s*(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(exportRegex);
    if (match) {
      const kind = match[2] as ExportInfo['kind'];
      exports.push({
        name: match[3],
        kind: kind === 'enum' ? 'const' : kind,
        signature: line.substring(0, 100),
        file,
        line: i + 1,
      });
    }
    const reMatch = line.match(tsExportRegex);
    if (reMatch && !line.match(exportRegex)) {
      const symbols = line.match(/\b(\w+)\b/g)?.slice(1) || [];
      for (const sym of symbols) {
        if (sym !== 'export' && sym !== 'type' && sym !== 'from') {
          exports.push({ name: sym, kind: 'unknown', signature: line.substring(0, 100), file, line: i + 1 });
        }
      }
    }
  }
  return exports;
}

function extractImportsFromContent(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimLine = line.trim();
    const esMatch = trimLine.match(/^import\s+.*\s+from\s+['"]([^'"]+)['"]/);
    if (esMatch) {
      const source = esMatch[1];
      imports.push({ source, symbols: [], isExternal: !source.startsWith('.') && !source.startsWith('/') });
    }
  }
  return imports;
}

// ============================================================
// API detection
// ============================================================
async function extractApiEndpoints(
  rootPath: string,
  identity: ProjectIdentity,
  files: string[]
): Promise<ApiEndpoint[]> {
  const apis: ApiEndpoint[] = [];

  const routeIndicators = ['route', 'router', 'handler', 'controller', 'api', 'endpoint', 'view'];

  const relevantFiles = files.filter(f => {
    const lower = f.toLowerCase();
    return routeIndicators.some(ind => lower.includes(ind));
  });

  for (const file of relevantFiles.slice(0, 30)) {
    try {
      const content = await readFile(file);
      const lines = content.split('\n');

      for (let i = 0; i < Math.min(lines.length, 200); i++) {
        const line = lines[i].trim();

        // Express-style: app.get('/path', handler)
        const exprMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/);
        if (exprMatch) {
          apis.push({
            method: exprMatch[1].toUpperCase() as ApiEndpoint['method'],
            path: exprMatch[2],
            handler: `${file}:${i + 1}`,
            authRequired: line.includes('auth') || line.includes('middleware'),
          });
        }

        // Decorator-style: @Get('/path'), @Post('/path')
        const decoratorMatch = line.match(/@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]+)['"]/);
        if (decoratorMatch) {
          apis.push({
            method: decoratorMatch[1].toUpperCase() as ApiEndpoint['method'],
            path: decoratorMatch[2],
            handler: `${file}:${i + 1}`,
            authRequired: false,
          });
        }

        // Go-style: r.GET("/path", handler)
        const goMatch = line.match(/\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"]([^'"]+)['"]/);
        if (goMatch && identity.language === 'go') {
          apis.push({
            method: goMatch[1] as ApiEndpoint['method'],
            path: goMatch[2],
            handler: `${file}:${i + 1}`,
            authRequired: line.includes('Auth') || line.includes('Middleware'),
          });
        }
      }
    } catch { /* skip */ }
  }

  return apis;
}

// ============================================================
// DB Schema detection
// ============================================================
async function extractDbSchema(
  rootPath: string,
  identity: ProjectIdentity
): Promise<DbSchemaInfo> {
  const schema: DbSchemaInfo = { tables: [], migrations: [] };

  // Look for migration directories
  const migrationDirs = ['migrations', 'migration', 'db/migrations', 'prisma/migrations', 'alembic'];
  for (const dir of migrationDirs) {
    const fullPath = path.join(rootPath, dir);
    if (await fileExists(fullPath)) {
      const files = await listDir(fullPath);
      schema.migrations = files.filter((f: string) => f.endsWith('.sql') || f.endsWith('.ts') || f.endsWith('.py'));
    }
  }

  // Detect ORM usage
  const packageJsonPath = path.join(rootPath, 'package.json');
  if (await fileExists(packageJsonPath)) {
    const pkg = await readJson(packageJsonPath) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
    if (deps.prisma) schema.orm = 'prisma';
    else if (deps.typeorm) schema.orm = 'typeorm';
    else if (deps.drizzle) schema.orm = 'drizzle';
    else if (deps.knex) schema.orm = 'knex';
  }

  return schema;
}

// ============================================================
// Dependency extraction
// ============================================================
async function extractDependencies(
  rootPath: string,
  identity: ProjectIdentity
): Promise<DependencyInfo[]> {
  const deps: DependencyInfo[] = [];

  // package.json
  const packagePath = path.join(rootPath, 'package.json');
  if (await fileExists(packagePath)) {
    const pkg = await readJson(packagePath);
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      deps.push({ name, version: String(version), isDev: false, type: 'runtime' });
    }
    for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
      deps.push({ name, version: String(version), isDev: true, type: 'dev' });
    }
  }

  // go.mod
  const goModPath = path.join(rootPath, 'go.mod');
  if (await fileExists(goModPath)) {
    const content = await readFile(goModPath);
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s+(\S+)\s+(v[\d.]+(\S*))/);
      if (match) {
        deps.push({
          name: match[1],
          version: match[2],
          isDev: line.includes('// indirect'),
          type: line.includes('// indirect') ? 'dev' : 'runtime',
        });
      }
    }
  }

  // requirements.txt
  const reqPath = path.join(rootPath, 'requirements.txt');
  if (await fileExists(reqPath)) {
    const content = await readFile(reqPath);
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([^=<>!]+)([=<>!]+.*)?$/);
        if (match) {
          deps.push({
            name: match[1].trim(),
            version: match[2]?.trim() || '*',
            isDev: false,
            type: 'runtime',
          });
        }
      }
    }
  }

  return deps;
}

// ============================================================
// Style fingerprint
// ============================================================
async function extractStyleFingerprint(
  rootPath: string,
  files: string[]
): Promise<StyleFingerprint> {
  let camelCount = 0, pascalCount = 0, snakeCount = 0, kebabCount = 0;
  let spaceIndent = 0, tabIndent = 0;
  let singleQuote = 0, doubleQuote = 0;
  let semicolons = 0, noSemicolons = 0;
  let samples = 0;

  for (const file of files.slice(0, 30)) {
    try {
      const content = await readFile(file);
      const lines = content.split('\n');

      for (let i = 0; i < Math.min(lines.length, 50); i++) {
        const line = lines[i];

        // Indent
        if (line.startsWith('  ') || line.startsWith('    ')) spaceIndent++;
        if (line.startsWith('\t')) tabIndent++;

        // Quotes
        if (line.includes("'")) singleQuote++;
        if (line.includes('"')) doubleQuote++;

        // Semicolons
        if (line.trimEnd().endsWith(';')) semicolons++;
        else if (line.trim().length > 0 && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('#')) {
          noSemicolons++;
        }

        // Naming (very rough)
        const names = line.match(/\b[a-z_][a-zA-Z0-9_]*\b/g) || [];
        for (const name of names) {
          if (name.includes('_')) snakeCount++;
          else if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) camelCount++;
          else if (/^[A-Z]/.test(name)) pascalCount++;
          else if (name.includes('-')) kebabCount++;
        }
        samples++;
      }

      if (samples > 500) break;
    } catch { /* skip */ }
  }

  return {
    namingConvention: snakeCount > camelCount ? 'snake_case' :
      pascalCount > camelCount ? 'PascalCase' : 'camelCase',
    indentStyle: tabIndent > spaceIndent ? 'tabs' : 'spaces',
    indentSize: spaceIndent > 0 ? 2 : 4,
    quoteStyle: singleQuote > doubleQuote ? 'single' : 'double',
    semicolons: semicolons > noSemicolons,
    errorHandling: 'mixed',
  };
}

// ============================================================
// Dependency graph
// ============================================================
function buildDependencyGraph(modules: ModuleInfo[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const mod of modules) {
    const deps: string[] = [];
    for (const imp of mod.imports) {
      if (!imp.isExternal) {
        // Find which module this internal import belongs to
        for (const other of modules) {
          if (other.name !== mod.name && imp.source.includes(other.name)) {
            deps.push(other.name);
          }
        }
      }
    }
    graph.set(mod.name, [...new Set(deps)]);
  }

  return graph;
}

// ============================================================
// Incremental scan fingerprints (S11)
// ============================================================
async function loadPreviousFingerprints(rootPath: string): Promise<Record<string, string>> {
  try {
    const prevIndex = await loadProjectIndex(rootPath);
    return prevIndex?.fileFingerprints || {};
  } catch { return {}; }
}

async function computeFingerprints(
  files: string[],
  oldFingerprints: Record<string, string>
): Promise<{ currentFingerprints: Record<string, string>; changedFiles: string[]; skippedCount: number }> {
  const currentFingerprints: Record<string, string> = {};
  const changedFiles: string[] = [];
  let skippedCount = 0;
  const lock = { skipped: 0 };

  const entries = await pMap(files, async (file) => {
    try {
      const fsPromises = await import('fs/promises');
      const stat = await fsPromises.stat(file);
      const fp = `${Math.floor(stat.mtimeMs)}:${stat.size}`;
      const isUnchanged = oldFingerprints[file] === fp;
      if (isUnchanged) lock.skipped++;
      return { file, fp, changed: !isUnchanged };
    } catch {
      return { file, fp: '', changed: true };
    }
  }, 32);

  for (const entry of entries) {
    currentFingerprints[entry.file] = entry.fp;
    if (entry.changed) changedFiles.push(entry.file);
  }
  skippedCount = lock.skipped;

  return { currentFingerprints, changedFiles, skippedCount };
}

// ============================================================
// Cross-file call graph (S11)
// ============================================================
async function buildCrossFileCallGraph(
  rootPath: string,
  modules: ModuleInfo[]
): Promise<import('../types.js').CrossFileCallEdge[]> {
  const edges: import('../types.js').CrossFileCallEdge[] = [];

  // Index: functionName → moduleName
  const symbolIndex = new Map<string, string>();
  for (const mod of modules) {
    for (const exp of mod.exports) {
      if (exp.kind === 'function' || exp.kind === 'class') {
        symbolIndex.set(exp.name, mod.name);
      }
    }
  }

  // Parse AST for each module's files to get call graphs
  try {
    const { parseSourceFile } = await import('./ast-parser.js');

    for (const mod of modules) {
      const modExports = new Set(mod.exports.map(e => e.name));

      for (const file of mod.files.slice(0, 10)) {
        const fullPath = path.join(rootPath, file);
        try {
          const parsed = await parseSourceFile(fullPath);
          if (parsed.error) continue;

          for (const edge of parsed.callGraph) {
            const callerFull = `${mod.name}/${edge.caller}`;

            if (modExports.has(edge.callee) || edge.callee === '<module>') {
              // Same-module call
              edges.push({
                caller: callerFull,
                callee: `${mod.name}/${edge.callee}`,
                callerFile: file,
                calleeFile: file,
                line: edge.callerLine,
              });
            } else if (symbolIndex.has(edge.callee)) {
              // Cross-module call
              const targetMod = symbolIndex.get(edge.callee)!;
              edges.push({
                caller: callerFull,
                callee: `${targetMod}/${edge.callee}`,
                callerFile: file,
                calleeFile: undefined,
                line: edge.callerLine,
              });
            } else {
              // External/unresolved call
              edges.push({
                caller: callerFull,
                callee: `external:${edge.callee}`,
                callerFile: file,
                line: edge.callerLine,
              });
            }
          }
        } catch { /* skip file */ }
      }
    }
  } catch { /* AST not available */ }

  // Deduplicate
  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.caller}→${e.callee}:${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge incremental scan results with old module data.
 * New modules replace old ones with same name; unchanged modules are kept.
 * Files not in filteredFiles (deleted) are removed from old modules.
 */
function mergeModules(
  oldModules: ModuleInfo[],
  newModules: ModuleInfo[],
  changedFiles: string[],
  allFiles: string[]
): ModuleInfo[] {
  const oldMap = new Map(oldModules.map(m => [m.name, m]));
  const newMap = new Map(newModules.map(m => [m.name, m]));
  const allFileSet = new Set(allFiles);

  // Start with new modules (re-scanned)
  for (const [name, mod] of newMap) {
    oldMap.set(name, mod);
  }

  // Remove deleted files from old modules
  for (const mod of oldMap.values()) {
    mod.files = mod.files.filter(f => allFileSet.has(f));
  }

  return [...oldMap.values()];
}

// ============================================================
// Architecture pattern detection
// ============================================================
function detectArchitecturePattern(
  rootPath: string,
  modules: ModuleInfo[],
  identity: ProjectIdentity
): string {
  const moduleNames = modules.map(m => m.name.toLowerCase());

  // MVC
  const mvcIndicators = ['models', 'views', 'controllers'];
  if (mvcIndicators.every(i => moduleNames.some(m => m.includes(i)))) {
    return 'MVC';
  }

  // Clean Architecture
  const cleanIndicators = ['entities', 'usecases', 'repositories', 'controllers'];
  if (cleanIndicators.filter(i => moduleNames.some(m => m.includes(i))).length >= 3) {
    return 'Clean Architecture';
  }

  // Microservices
  if (modules.length > 15 && moduleNames.some(m => m.includes('service'))) {
    return 'Microservices';
  }

  // Layered
  const layerIndicators = ['domain', 'application', 'infrastructure', 'presentation', 'api', 'core', 'shared'];
  if (layerIndicators.filter(i => moduleNames.some(m => m.includes(i))).length >= 3) {
    return 'Layered Architecture';
  }

  return 'Modular Monolith';
}
