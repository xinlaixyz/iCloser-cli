// iCloser Agent Shell — Core Type Definitions

// ============================================================
// Project Identity (auto-detected)
// ============================================================
export type LanguageType =
  | 'typescript' | 'javascript' | 'go' | 'rust' | 'python'
  | 'java' | 'kotlin' | 'csharp' | 'php' | 'ruby' | 'swift'
  | 'c' | 'cpp' | 'unknown';

export type FrameworkType =
  | 'react' | 'vue' | 'nextjs' | 'nuxt' | 'svelte' | 'angular'
  | 'django' | 'flask' | 'fastapi' | 'spring-boot' | 'gin'
  | 'actix' | 'express' | 'nestjs' | 'laravel' | 'rails'
  | 'swiftui' | 'uikit'
  | 'unknown';

export type DatabaseType =
  | 'postgresql' | 'mysql' | 'sqlite' | 'mongodb'
  | 'redis' | 'elasticsearch' | 'dynamodb' | 'unknown';

export type BuildSystem =
  | 'npm' | 'yarn' | 'pnpm' | 'cargo' | 'go-mod' | 'gradle'
  | 'maven' | 'pip' | 'poetry'
  | 'xcode' | 'cocoapods' | 'spm' | 'carthage'
  | 'unknown';

export type TestFramework =
  | 'jest' | 'vitest' | 'pytest' | 'go-test' | 'junit'
  | 'cypress' | 'playwright' | 'xctest'
  | 'unknown';

// ============================================================
// Project Identity
// ============================================================
export interface ProjectIdentity {
  language: LanguageType;
  framework: FrameworkType;
  database: DatabaseType;
  buildSystem: BuildSystem;
  testFramework: TestFramework;
  runtime: string;
  deploymentType: 'docker' | 'kubernetes' | 'serverless' | 'monolith' | 'microservices' | 'ios-app' | 'unknown';
  packageManager: string;
  languageVersion: string;
}

// ============================================================
// Project Index
// ============================================================
export interface ModuleInfo {
  name: string;
  path: string;
  files: string[];
  exports: ExportInfo[];
  imports: ImportInfo[];
  dependencies: string[];       // module names this module depends on
  dependents: string[];          // module names that depend on this
  responsibility: string;        // AI-generated one-line description
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'unknown';
  signature: string;
  file: string;
  line: number;
  // AST-enhanced fields (S8)
  parameters?: string[];
  returnType?: string;
  isDefault?: boolean;
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  isExternal: boolean;
  // AST-enhanced fields (S8)
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly?: boolean;
}

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: string;        // function name or file:line
  requestType?: string;
  responseType?: string;
  authRequired: boolean;
}

export interface DbSchemaInfo {
  tables: TableInfo[];
  migrations: string[];
  orm?: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
  type: 'runtime' | 'dev' | 'peer' | 'optional';
}

export interface ProjectIndex {
  identity: ProjectIdentity;
  modules: ModuleInfo[];
  apis: ApiEndpoint[];
  database: DbSchemaInfo;
  dependencies: DependencyInfo[];
  dependencyGraph: Map<string, string[]>;
  styleFingerprint: StyleFingerprint;
  architecturePattern: string;
  rootPath: string;
  lastScan: string;       // ISO timestamp
  callGraph?: CrossFileCallEdge[];  // S11: project-wide function call graph
  fileFingerprints?: Record<string, string>;  // S11: filePath → mtimeMs:size for incremental scan
  tsDataFlow?: {  // TS Compiler API type-level data flow (T1.1)
    totalEdges: number;
    totalUses: number;
    crossFileFlows: number;
    topFlows: { name: string; type: string; useCount: number }[];
  };
}

export interface CrossFileCallEdge {
  caller: string;      // "moduleName/functionName"
  callee: string;      // "moduleName/functionName" or "external:name"
  callerFile: string;
  calleeFile?: string;
  line: number;
}

// Data flow tracking — variable definition → usage chains
export interface VariableDef {
  name: string;
  kind: 'const' | 'let' | 'var' | 'param' | 'return';
  file: string;
  line: number;
  functionName?: string;  // enclosing function
  typeAnnotation?: string;
}

export interface VariableUse {
  name: string;
  file: string;
  line: number;
  usageKind: 'read' | 'write' | 'call_arg' | 'return';
  context?: string;  // surrounding expression snippet
}

export interface DataFlowEdge {
  def: VariableDef;
  uses: VariableUse[];
}

// Cross-file data flow: how data passes through function calls across files
export interface CrossFileDataFlow {
  sourceDef: VariableDef;
  propagatedTo: {
    file: string;
    functionName: string;
    paramName: string;
    line: number;
    callChain: string[];  // ordered chain of function names
  }[];
}

export interface StyleFingerprint {
  namingConvention: 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case';
  indentStyle: 'spaces' | 'tabs';
  indentSize: number;
  quoteStyle: 'single' | 'double';
  semicolons: boolean;
  errorHandling: 'try-catch' | 'result-type' | 'panic' | 'mixed';
}

// ============================================================
// Task System
// ============================================================
export type TaskStatus =
  | 'queued' | 'scheduled' | 'running' | 'verifying'
  | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'paused';

export type TaskPriority = 'high' | 'normal' | 'low';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  plan?: TaskPlan;
  changes: FileChange[];
  diffs: string[];
  verifyResult?: VerifyResult;
  reasoning: ChangeReasoning[];
  gateResult?: GateResult;
  reportPath?: string;
  rollbackPoint?: string;
  errorLog: string[];
  retryCount: number;
  maxRetries: number;
  loopState?: import('./core/task-loop.js').TaskLoopState;
  agentExecutions: AgentExecutionRecord[];
  milestone?: string;           // PM1: version milestone (e.g. "V0.7", "V1.0")
  storyPoints?: number;         // PM7: complexity estimate
  blockedBy?: string[];         // PM6: task IDs that block this one
}

export interface TaskPlan {
  subGoals: SubGoal[];
  affectedFiles: string[];
  estimatedImpact: 'low' | 'medium' | 'high';
  dependencies: string[];      // task IDs this depends on
  lockedFiles: string[];       // files to lock during execution
}

export interface SubGoal {
  id: string;
  description: string;
  files: string[];
  status: 'pending' | 'done' | 'failed';
}

export interface FileChange {
  file: string;
  intent: string;        // why this change
  reasoning: string;     // why this approach
  added: number;
  removed: number;
}

export interface ChangeReasoning {
  file: string;
  intent: string;
  reasoning: string;
  impact: ImpactAnalysis;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ImpactAnalysis {
  directlyAffected: string[];
  indirectlyAffected: string[];
  notAffected: string[];
}

// ============================================================
// Verification
// ============================================================
export type VerifyStage = 'compile' | 'lint' | 'unit-test' | 'integration-test' | 'e2e' | 'coverage';

export interface CoverageSummary {
  lines: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
}

export interface CoverageBaseline {
  projectName: string;
  updatedAt: string;
  summary: CoverageSummary;
  threshold: { lines: number; branches: number; functions: number };  // minimum percentages
}

export interface VerifyResult {
  stages: StageResult[];
  overall: 'pass' | 'fail';
  totalTests: number;
  passedTests: number;
  coverage?: CoverageResult;
  duration: number;          // ms
  attempts: number;          // how many repair attempts
  errorSummary?: string;
}

export interface StageResult {
  stage: VerifyStage;
  status: 'pass' | 'fail' | 'skipped';
  output: string;
  duration: number;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  errorDetails?: string;
}

export interface CoverageResult {
  lineCoverage: number;      // percentage
  branchCoverage: number;    // percentage
  coveredLines: number;
  totalLines: number;
}

// ============================================================
// Gate / Quality Gate
// ============================================================
export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  blocking: GateCheck[];
  suggestions: GateCheck[];
  prDescription?: string;
  commitMessage?: string;
}

export interface SecurityIssue {
  file: string;
  severity: 'low' | 'medium' | 'high';
  category: 'sensitive-file' | 'secret' | 'dangerous-command' | 'sql-injection';
  ruleId: string;
  line?: number;
  evidence?: string;
  message: string;
}

export interface SecurityRuleDefinition {
  ruleId: string;
  category: SecurityIssue['category'];
  severity: SecurityIssue['severity'];
  name: string;
  description: string;
  enabledByDefault: boolean;
}

export interface GateCheckMetadata extends Record<string, unknown> {
  issues?: SecurityIssue[];
}

export interface GateCheck {
  name: string;
  category: 'test' | 'security' | 'reasoning' | 'report' | 'rollback' | 'git';
  status: 'pass' | 'fail' | 'warn' | 'pending';
  detail: string;
  suggestion?: string;
  metadata?: GateCheckMetadata;
}

// ============================================================
// Memory System
// ============================================================
export type MemoryScope = 'short-term' | 'task' | 'project' | 'long-term' | 'external';
export type MemorySource = 'user' | 'agent' | 'verifier' | 'system' | 'external-api';
export type MemoryReviewStatus = 'draft' | 'proposed' | 'approved' | 'rejected' | 'archived';
export type MemoryRiskLevel = 'low' | 'medium' | 'high';
export type MemoryCandidateKind = 'rule' | 'preference' | 'template' | 'fact' | 'sensitive' | 'unknown';
export type MemoryReviewAction = 'auto-archive' | 'auto-approve-project' | 'batch-candidate' | 'ask-now' | 'ignore';
export type UserInputKind =
  | 'chat' | 'slash-command' | 'task-description' | 'approval'
  | 'rejection' | 'correction' | 'rule' | 'api-key' | 'unknown';

export interface MemoryEvidence {
  type: 'user-input' | 'file' | 'report' | 'verify-log' | 'command' | 'diff' | 'summary';
  ref: string;
  summary?: string;
}

export interface MemoryMetadata {
  id: string;
  scope: MemoryScope;
  source: MemorySource;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  rawInputRef?: string;
  createdAt: string;
  updatedAt: string;
  reviewStatus: MemoryReviewStatus;
  version: number;
  evidence: MemoryEvidence[];
  riskLevel: MemoryRiskLevel;
  compressionLevel: 'raw' | 'session-summary' | 'task-summary' | 'rule' | 'template';
  sourceEventIds: string[];
  redacted: boolean;
  redactionReason?: string;
}

export interface UserInputMemoryEvent {
  id: string;
  kind: UserInputKind;
  content: string;
  originalLength: number;
  redacted: boolean;
  redactionReason?: string;
  rootPath: string;
  sessionId?: string;
  taskId?: string;
  command?: string;
  createdAt: string;
  metadata: MemoryMetadata;
}

export interface MemoryCandidate {
  id: string;
  kind: MemoryCandidateKind;
  content: string;
  summary: string;
  suggestedScope: 'project' | 'global' | 'task-only';
  riskLevel: MemoryRiskLevel;
  reviewStatus: MemoryReviewStatus;
  suggestedAction: MemoryReviewAction;
  reason: string;
  sourceEventIds: string[];
  taskId?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: MemoryMetadata;
  // TTL: time-based expiry
  expiresAt?: string;       // ISO timestamp when this entry expires
  lastAccessedAt?: string;  // last time this memory was used
  accessCount?: number;     // number of times retrieved
}

export interface ProjectMemory {
  projectId: string;
  rules: ArchitectureRule[];
  decisions: DecisionRecord[];
  taskHistory: TaskRecord[];
  feedbacks: FeedbackRecord[];
  inputEvents: UserInputMemoryEvent[];
  memoryCandidates: MemoryCandidate[];
  snapshot: ContextSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalMemory {
  techStacks: Map<string, TechStackMemory>;
  patterns: Map<string, PatternMemory>;
  preferences: UserPreferences;
  pitfalls: PitfallRecord[];
  skillHistory: SkillUsageRecord[];
}

export interface ArchitectureRule {
  id: string;
  description: string;
  scope: string;           // module/wildcard pattern
  createdAt: string;
  permanent: boolean;
}

export interface DecisionRecord {
  id: string;
  taskId: string;
  context: string;
  decision: string;
  alternatives: string[];
  timestamp: string;
}

export interface TaskRecord {
  taskId: string;
  description: string;
  status: TaskStatus;
  summary: string;          // compressed ~500 tokens
  diffDigest: string;       // compact representation
  timestamp: string;
}

export interface FeedbackRecord {
  content: string;
  source: string;
  timestamp: string;
  decayFactor: number;
}

export interface ContextSnapshot {
  modules: string;
  dependencies: string;
  architecture: string;
  timestamp: string;
  compressedSize: number;
}

export interface TechStackMemory {
  tech: string;
  bestPractices: string[];
  commonPatterns: string[];
  preferredLibraries: string[];
  accumulatedAt: string;
  lastUpdated: string;
}

export interface PatternMemory {
  name: string;
  description: string;
  examples: string[];
  applicableTo: string[];
}

export interface UserPreferences {
  codeStyle: Partial<StyleFingerprint>;
  techPreferences: string[];
  commentLanguage: 'chinese' | 'english';
  autoExecute: boolean;
  maxParallelTasks: number;
  preferredAI: string;
}

export interface PitfallRecord {
  description: string;
  tech: string;
  severity: 'low' | 'medium' | 'high';
  encounteredAt: string;
  resolution?: string;
}

export interface SkillUsageRecord {
  skillName: string;
  usageCount: number;
  lastUsed: string;
  effectiveness: number;    // 0-10
}

// ============================================================
// AI Provider
// ============================================================
export type AIProvider = 'claude' | 'deepseek' | 'openai' | 'qwen' | 'mock';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export interface AIPrompt {
  systemPrompt: string;
  context: ContextPackage;
  task: string;
  history: string;
}

export interface ContextPackage {
  projectMeta: string;           // ~1K tokens
  relevantCode: CodeSnippet[];   // ~60-80% budget
  relevantMemory: string;       // ~1-2K tokens
  externalKnowledge?: string;   // S10: web search results, injected as formatted context
  astHints?: string;             // S17.6: AST call graph hints for task-related symbols
  totalTokens: number;
  budgetUsed: number;
}

export interface CodeSnippet {
  file: string;
  content: string;
  relevance: number;      // 0-1 score
  compression: 'full' | 'skeleton' | 'summary' | 'graph';
}

export interface AIResponse {
  content: string;
  structuredOutput?: import('./ai/output-contract.js').AIOutputContract;
  toolCalls?: ToolCall[];
  tokensUsed: number;
  model: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

// ============================================================
// Skill System
// ============================================================
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  triggers: string[];
  requires: string[];
  provider: AIProvider;
  author?: string;
  license?: string;
  type: 'builtin' | 'community' | 'project' | 'auto-generated';
}

export interface Skill {
  manifest: SkillManifest;
  systemPrompt: string;
  tools: string[];
  knowledgeBase: string[];
  installed: boolean;
  enabled: boolean;
  installPath: string;
}

// ============================================================
// Agent System
// ============================================================
export type AgentType = 'task' | 'review' | 'verify' | 'skill' | 'explore' | 'orchestrator';
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'done' | 'failed';

export interface AgentInstance {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  context: ContextPackage;
  tools: string[];
  model: string;
  parentId?: string;
  childIds: string[];
  sandboxLevel: 'none' | 'readonly' | 'isolated';
  budget: { maxTokens: number; maxTime: number };
  result?: AgentResult;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  artifacts: string[];
  tokensUsed: number;
  duration: number;
  error?: string;
}

export interface AgentExecutionRecord {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  status: 'done' | 'failed';
  startedAt?: string;
  completedAt?: string;
  result: AgentResult;
  sandboxLevel: 'none' | 'readonly' | 'isolated';
  model: string;
  parentAgentId?: string;
  childAgentIds: string[];
  tree?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  type: 'command' | 'query' | 'response' | 'notification';
}

// ============================================================
// AI Intent Recognition
// ============================================================
export type UserIntentCategory =
  | 'analysis'        // 分析项目/代码质量/结构
  | 'code_change'     // 修改/创建/删除代码
  | 'code_fix'        // 修复错误/bug
  | 'code_complete'   // 补全代码
  | 'plan'            // 大型多步骤需求 → 先生成开发计划
  | 'security_review' // 安全检查/漏洞扫描
  | 'refactor'        // 重构/优化/拆分
  | 'test_gen'        // 生成/补充测试
  | 'doc_gen'         // 生成/补充文档
  | 'devops'          // 启动/停止/测试/构建
  | 'pm'              // PM视角：发布/路线图/风险/估算
  | 'question'        // 问答/咨询/求助
  | 'config'          // 配置/设置/API Key
  | 'chat'            // 闲聊/无明确工程意图
  | 'unknown';        // 无法识别

export interface UserIntent {
  category: UserIntentCategory;
  confidence: number;            // 0-1
  method: 'regex' | 'ai';       // how was it classified
  reasoning: string;            // why this category
  requiresConfirmation: boolean; // should the system confirm before acting
  suggestedAction?: string;     // e.g. "ic t '...' --go" or "/scan"
  extractedTask?: string;       // the actual task description extracted from input
}

export interface IntentClassifyOptions {
  useAI?: boolean;              // default true — fall back to AI if regex misses
  timeout?: number;             // max ms for AI classification
}

// ============================================================
// Document Generation (D1-D4)
// ============================================================
export type DocType =
  | 'PRD' | 'USER_GUIDE' | 'API' | 'ARCHITECTURE'
  | 'TESTING' | 'DEPLOYMENT' | 'CHANGELOG' | 'FAQ' | 'CONTRIBUTING';

export interface DocTemplate {
  type: DocType;
  filename: string;
  title: string;
  description: string;
  required: boolean;
}

export interface DocGenerationResult {
  type: DocType;
  filename: string;
  status: 'generated' | 'skipped' | 'failed';
  content?: string;
  error?: string;
  qualityScore?: number;
}

export interface DocsContext {
  projectName: string;
  description: string;
  techStack: string[];
  features: string[];
  apiRoutes: { method: string; path: string; handler: string }[];
  configKeys: string[];
  deployInfo: { docker: boolean; makefile: boolean; envVars: string[] };
  errorPatterns: string[];
  existingDocs: DocType[];
  missingDocs: DocType[];
}

// ============================================================
// CLI Config
// ============================================================
export interface ICloserConfig {
  version: string;
  project: {
    name: string;
    rootPath: string;
    identity: ProjectIdentity;
  };
  ai: {
    provider: AIProvider;
    model: string;
    apiKey?: string;
    maxTokens: number;
    temperature: number;
  };
  execution: {
    defaultMode: 'preview' | 'execute';
    maxRetries: number;
    maxParallelTasks: number;
    verifyStages: VerifyStage[];
  };
  security: {
    sensitiveFiles: string[];
    dangerousCommands: string[];
    disabledRules: string[];
    allowGitPush: boolean;
  };
  skills: {
    enabled: string[];
    autoGenerated: boolean;
  };
  memory: {
    maxProjectMemory: number;    // KB
    maxGlobalMemory: number;     // KB
    autoCompressThreshold: number; // number of tasks before compression
  };
}

// ============================================================
// Audit System
// ============================================================
export type AuditActor = 'user' | 'agent' | 'system' | 'verifier' | 'reporter' | 'memory-updater';

export type AuditAction =
  | 'task-created'
  | 'task-started'
  | 'ai-called'
  | 'file-written'
  | 'file-fixed'
  | 'verify-run'
  | 'verify-passed'
  | 'verify-failed'
  | 'report-generated'
  | 'memory-updated';

export type AuditResult = 'success' | 'failure' | 'partial';

export interface AuditEvent {
  id: string;
  actor: AuditActor;
  action: AuditAction;
  target: string;
  taskId?: string;
  sessionId?: string;
  result: AuditResult;
  durationMs?: number;
  tokensUsed?: number;
  payload: Record<string, unknown>;
  createdAt: string;
  redacted: boolean;
  redactionReason?: string;
}

