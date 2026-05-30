import { Command } from 'commander';
import chalk from 'chalk';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import { jsonEnvelope } from '../cli/json.js';
import { detail, info, section, success, warn } from '../cli/output.js';
import { getCurrentBranch, getDiff, getGitStatus, isGitRepo } from '../utils/git.js';

export interface IssuePlan {
  title: string;
  summary: string;
  type: 'bug' | 'feature' | 'performance' | 'security' | 'refactor' | 'test' | 'docs' | 'general';
  steps: string[];
  acceptance: string[];
}

export interface PullRequestDraft {
  title: string;
  base: string;
  branch: string;
  changedFiles: string[];
  changedFileCount: number;
  omittedFileCount: number;
  taskId?: string;
  taskReport?: string;
  verificationLog?: string;
  body: string;
}

export interface GitHubPrCreateResult {
  ok: boolean;
  dryRun: boolean;
  command: string;
  draft: PullRequestDraft;
  output?: string;
  error?: string;
}

export interface CommitDraft {
  message: string;
  changedFiles: string[];
  changedFileCount: number;
  omittedFileCount: number;
  stagedFiles: string[];
  body: string;
}

function git(args: string[], rootPath: string): string {
  return execFileSync('git', args, { cwd: rootPath, encoding: 'utf-8', stdio: 'pipe', timeout: 10000 }).trim();
}

function safeGit(args: string[], rootPath: string): string {
  try { return git(args, rootPath); } catch { return ''; }
}

function changedFiles(rootPath: string): string[] {
  if (!isGitRepo(rootPath)) return [];
  const status = getGitStatus(rootPath);
  return [...new Set([...status.staged, ...status.changed, ...status.untracked])];
}

function summarizeDiff(rootPath: string): string {
  const diff = getDiff(rootPath).trim();
  if (!diff) return '当前没有可总结的工作区 diff。';
  const lines = diff.split('\n');
  const files = changedFiles(rootPath);
  return [
    `变更文件：${files.length} 个`,
    `Diff 行数：${lines.length}`,
    '',
    '关键片段：',
    lines.slice(0, 80).join('\n'),
  ].join('\n');
}

function limitFiles(files: string[], limit = 80): { visible: string[]; omitted: number } {
  return {
    visible: files.slice(0, limit),
    omitted: Math.max(0, files.length - limit),
  };
}

function readTextIfExists(filePath: string, limit = 5000): string {
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    return content.length > limit ? `${content.slice(0, limit)}\n...` : content;
  } catch {
    return '';
  }
}

function latestTaskId(rootPath: string): string | undefined {
  const tasksDir = path.join(rootPath, '.icloser', 'tasks');
  try {
    const entries = readdirSync(tasksDir)
      .map(name => ({ name, fullPath: path.join(tasksDir, name) }))
      .filter(entry => statSync(entry.fullPath).isDirectory())
      .map(entry => ({ ...entry, mtime: statSync(entry.fullPath).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.name;
  } catch {
    return undefined;
  }
}

function loadTaskArtifacts(rootPath: string, taskId?: string): { taskId?: string; report?: string; verifyLog?: string } {
  const resolvedTaskId = taskId || latestTaskId(rootPath);
  if (!resolvedTaskId) return {};
  const taskDir = path.join(rootPath, '.icloser', 'tasks', resolvedTaskId);
  const report = readTextIfExists(path.join(taskDir, 'report.md'), 3500);
  const verifyLog = readTextIfExists(path.join(taskDir, 'verify.log'), 2500);
  if (!report && !verifyLog) return { taskId: resolvedTaskId };
  return { taskId: resolvedTaskId, report, verifyLog };
}

export function buildIssuePlan(text: string): IssuePlan {
  const title = text.trim().split(/\r?\n/)[0].slice(0, 80) || '未命名 Issue';
  const lower = text.toLowerCase();

  // Issue type detection
  const isBug = /\b(bug|fix|error|crash|fail|broken|not working)\b|不工作|不能|报错|问题|异常|无法|修复|崩溃|失败/.test(lower);
  const isPerf = /\b(slow|performance|optimize|memory leak|timeout)\b|速度慢|性能|优化|卡顿/.test(lower);
  const isSecurity = /\b(security|vulnerability|xss|sql.injection|cve|exploit)\b|安全|漏洞|注入/.test(lower);
  const isRefactor = /\b(refactor|clean|restructure|simplify)\b|重构|拆分|整理代码/.test(lower);
  const isTest = /\b(test|spec|coverage)\b|测试|覆盖率/.test(lower);
  const isDocs = /\b(doc|document|readme|guide|wiki)\b|文档|说明/.test(lower);
  const isFeature = !isBug && !isPerf && !isSecurity && !isRefactor && !isTest && !isDocs
    && /\b(add|implement|new|create|support|feature)\b|功能|需求|添加|支持|实现|新增/.test(lower);

  // Tech area detection
  const isMobile = /\b(mobile|ios|android|safari|iphone|ipad)\b|移动端|手机/.test(lower);
  const isFE = /\b(ui|css|button|click|html|react|vue|frontend|component)\b|前端|页面|样式/.test(lower);
  const isBE = /\b(api|endpoint|server|backend|database|db|model)\b|后端|接口|数据库/.test(lower);

  let type: IssuePlan['type'];
  let steps: string[];
  let acceptance: string[];

  if (isBug) {
    type = 'bug';
    steps = [
      isMobile
        ? '在目标设备/模拟器上稳定复现，记录 OS 版本、浏览器版本和具体触发步骤。'
        : isFE
          ? '在浏览器中复现，打开控制台记录 JS 错误、网络请求和 DOM 状态。'
          : isBE
            ? '在开发环境中复现，记录服务器日志、错误堆栈和 API 请求响应。'
            : '在开发环境中稳定复现，记录完整错误日志和最小复现步骤。',
      '扫描受影响代码模块，定位根因（不只处理症状）。',
      '先写能触发该 Bug 的测试用例（先红后绿），防止回归。',
      `修复根因并验证有效；检查${isMobile ? '其他移动端浏览器' : isBE ? '所有相关 API 路由' : '类似代码路径'}是否有同类问题。`,
      '运行完整测试套件确认无回归；更新 CHANGELOG。',
    ];
    acceptance = [
      'Bug 已可对比验证：修复前可复现、修复后不可复现。',
      '新增/更新测试用例覆盖该 Bug 的触发场景。',
      '无回归：所有其他测试通过。',
      'PR 描述含复现步骤、根因分析、修复说明和影响范围。',
    ];
  } else if (isPerf) {
    type = 'performance';
    steps = [
      '建立性能基线：记录当前响应时间、内存占用或耗时分布。',
      '使用 Profiler 或日志定位热点：找出最耗时的函数、SQL 或网络调用。',
      isBE
        ? '优化：添加索引、缓存查询结果、减少 N+1 查询、异步化阻塞操作。'
        : '优化：减少 re-render、懒加载资源、合并网络请求、优化关键渲染路径。',
      '对比优化前后指标，确认达到目标提升幅度。',
      '确认无功能回归；记录优化方案和量化数据。',
    ];
    acceptance = [
      '量化改进：提供优化前后的性能指标对比数据。',
      '无功能回归：所有测试通过。',
      '新增性能基准测试或更新已有测试。',
      'PR 描述含问题定位、优化方案和数据对比。',
    ];
  } else if (isSecurity) {
    type = 'security';
    steps = [
      '评估漏洞影响范围：哪些用户、数据和接口受影响；确认 CVSS 等级。',
      '在开发环境中验证漏洞是否可被利用（不在生产）。',
      '实施修复：优先使用经审计的安全库，避免自实现加密/验证逻辑。',
      '添加安全测试用例（注入攻击、越权访问等）。',
      '审计相关代码路径确认无同类漏洞；更新安全文档。',
    ];
    acceptance = [
      '漏洞已修复并通过安全测试验证。',
      '修复不引入新漏洞；相关代码已经过安全审查。',
      'Changelog 标注安全修复；有 CVE 编号时已记录。',
      'PR 走完整安全审批流程。',
    ];
  } else if (isRefactor) {
    type = 'refactor';
    steps = [
      '明确重构目标：降低复杂度、提升可读性或改善可测试性。',
      '写测试锁定现有行为（若没有），确保重构后可对比验证。',
      '小步重构：每步完成后运行测试，绿灯后再继续下一步。',
      '检查接口兼容性：重构不改变对外契约（除非有迁移方案）。',
      '更新注释和文档以反映新结构；运行完整验证。',
    ];
    acceptance = [
      '所有测试通过（功能未改变）。',
      '代码复杂度或可读性指标可量化改善（行数、圈复杂度等）。',
      'PR 描述解释重构动机和每一步改变的原因。',
    ];
  } else if (isTest) {
    type = 'test';
    steps = [
      '分析当前测试覆盖情况，找出缺口（函数、分支或集成路径）。',
      '补写单元测试或集成测试，优先覆盖核心逻辑和边界条件。',
      '确保新增测试在 CI 中绿灯（不只是本地通过）。',
      '如发现因测试缺失而存在的隐藏 Bug，记录并提出 fix Issue。',
      '更新覆盖率报告，记录基线变化。',
    ];
    acceptance = [
      '覆盖率按 PR 描述中的目标提升。',
      '所有新增测试通过；无空断言或无效测试。',
      'CI 绿灯。',
    ];
  } else if (isDocs) {
    type = 'docs';
    steps = [
      '明确文档目标受众（新用户、开发者、运维）和覆盖范围。',
      '核对现有文档与代码的一致性，找出过时或缺失内容。',
      '起草文档：保持简洁、有示例、可操作。',
      '在实际环境中验证文档中的命令和步骤可正常执行。',
      '确认格式、链接和图片均正确显示。',
    ];
    acceptance = [
      '文档中所有命令和示例已经过实测验证。',
      '无过时信息；链接有效。',
      '覆盖 Issue 中提到的所有场景。',
    ];
  } else if (isFeature) {
    type = 'feature';
    steps = [
      '拆解用户故事为可交付的最小功能单元（MVP）。',
      isBE
        ? '设计 API 接口（路由、请求/响应结构、鉴权要求）并给出接口草稿。'
        : isFE
          ? '设计组件树、交互状态机和 API 调用点。'
          : '设计模块接口和数据流，确认对现有功能的影响。',
      '按设计实现，保持小提交，每步都可测试。',
      '编写测试覆盖主要路径和边界条件。',
      '更新文档（API、README 或用户指南），运行完整验证套件。',
    ];
    acceptance = [
      '满足 Issue 中描述的所有用户故事和验收条件。',
      '有测试覆盖核心路径。',
      '文档已更新，包括接口说明或使用示例。',
      'PR 描述含设计决策、接口变更和截图（如适用）。',
    ];
  } else {
    type = 'general';
    steps = [
      '明确任务范围：用一句话描述预期的交付物。',
      '扫描项目上下文，确认受影响的模块和现有逻辑。',
      '制定变更计划，先预览（diff/设计稿）再执行。',
      '运行编译、lint、单元测试和必要的集成验证。',
      '输出 diff、验证结果、风险评估和回滚方式。',
    ];
    acceptance = [
      '用户目标已明确映射到代码或文档变更。',
      '所有修改文件有可解释的原因。',
      '验证命令通过；失败时有修复记录。',
      '最终报告可直接用于 PR 描述或交付说明。',
    ];
  }

  return { title, summary: text.trim(), type, steps, acceptance };
}

export function buildPullRequestDraft(rootPath: string, options: { title?: string; base?: string; taskId?: string } = {}): PullRequestDraft {
  const branch = isGitRepo(rootPath) ? getCurrentBranch(rootPath) : 'unknown';
  const base = options.base || 'main';
  const files = changedFiles(rootPath);
  const limited = limitFiles(files);
  const title = options.title || `Update from ${branch}`;
  const log = isGitRepo(rootPath) ? safeGit(['log', '--oneline', `${base}..HEAD`], rootPath) : '';
  const artifacts = loadTaskArtifacts(rootPath, options.taskId);
  const body = [
    '## Summary',
    files.length ? limited.visible.map(f => `- ${f}`).join('\n') : '- No working tree changes detected.',
    limited.omitted ? `- ... ${limited.omitted} more files omitted from draft preview` : '',
    artifacts.taskId ? `\n## Task Evidence\n- Task: ${artifacts.taskId}` : '',
    artifacts.report ? `\n### Report Excerpt\n${artifacts.report}` : '',
    artifacts.verifyLog ? `\n### Verification Log\n\`\`\`\n${artifacts.verifyLog}\n\`\`\`` : '',
    '',
    '## Verification',
    '- [ ] npm run lint',
    '- [ ] npm test',
    '- [ ] npm run smoke:tools',
    '',
    '## Commit range',
    log || '(no local commits ahead of base, or base branch unavailable)',
  ].filter(line => line !== '').join('\n');
  return {
    title,
    base,
    branch,
    changedFiles: limited.visible,
    changedFileCount: files.length,
    omittedFileCount: limited.omitted,
    taskId: artifacts.taskId,
    taskReport: artifacts.report,
    verificationLog: artifacts.verifyLog,
    body,
  };
}

export function buildCommitDraft(rootPath: string, explicitMessage?: string): CommitDraft {
  const status = isGitRepo(rootPath) ? getGitStatus(rootPath) : { staged: [], changed: [], untracked: [] } as any;
  const files = changedFiles(rootPath);
  const limited = limitFiles(files);
  const message = explicitMessage?.trim() || inferCommitMessage(files);
  const body = [
    message,
    '',
    '变更摘要：',
    files.length ? limited.visible.map(f => `- ${f}`).join('\n') : '- 当前没有检测到变更文件。',
    limited.omitted ? `- ... 另有 ${limited.omitted} 个文件未在草稿预览中展开` : '',
    '',
    '验证建议：',
    '- npx tsc --noEmit',
    '- npm run lint',
    '- npm test',
    '',
    'Diff 摘要：',
    summarizeDiff(rootPath),
  ].filter(line => line !== '').join('\n');
  const stagedFiles = Array.isArray(status.staged) ? status.staged.slice(0, 80) : [];
  return { message, changedFiles: limited.visible, changedFileCount: files.length, omittedFileCount: limited.omitted, stagedFiles, body };
}

export function buildGitHubPrCreateCommand(draft: PullRequestDraft): string[] {
  return [
    'pr', 'create',
    '--base', draft.base,
    '--title', draft.title,
    '--body', draft.body,
  ];
}

export function createGitHubPr(rootPath: string, options: { title?: string; base?: string; taskId?: string; dryRun?: boolean } = {}): GitHubPrCreateResult {
  const draft = buildPullRequestDraft(rootPath, { title: options.title, base: options.base, taskId: options.taskId });
  const args = buildGitHubPrCreateCommand(draft);
  const command = `gh ${args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`;
  if (options.dryRun) return { ok: true, dryRun: true, command, draft };
  try {
    const output = execFileSync('gh', args, { cwd: rootPath, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }).trim();
    return { ok: true, dryRun: false, command, draft, output };
  } catch (err: any) {
    return { ok: false, dryRun: false, command, draft, error: String(err?.stderr || err?.message || err) };
  }
}

function inferCommitMessage(files: string[]): string {
  const src = files.filter(f => f.startsWith('src/'));
  const tests = files.filter(f => f.startsWith('tests/') || /\.(test|spec)\.[jt]sx?$/.test(f));
  const docs = files.filter(f => f.startsWith('doc/') || f.startsWith('docs/') || /\.md$/i.test(f));
  const config = files.filter(f => /package\.json$|\.github\/|eslint\.config|tsconfig/.test(f));
  const scripts = files.filter(f => f.startsWith('scripts/') || f.startsWith('.github/'));

  // Pure doc/test/config changes
  if (src.length === 0 && tests.length === 0 && docs.length > 0) return 'docs: update documentation';
  if (src.length === 0 && tests.length > 0) return 'test: improve test coverage';
  if (src.length === 0 && scripts.length > 0) return 'ci: update build scripts';
  if (src.length === 0 && config.length > 0) return 'chore: update configuration';

  // Source changes — infer fix vs feat from path patterns
  const srcLower = src.map(f => f.toLowerCase()).join(' ');
  if (/\/fix|error|repair|patch/.test(srcLower)) return 'fix: repair reported issues';
  if (/\/commands\//.test(srcLower)) return 'feat: add command capabilities';
  if (/\/core\//.test(srcLower) && /\/cli\//.test(srcLower)) return 'feat: enhance core and CLI';
  if (/\/core\//.test(srcLower)) return 'feat: enhance core execution engine';
  if (/\/cli\//.test(srcLower)) return 'feat: improve CLI experience';
  if (/\/ai\//.test(srcLower)) return 'feat: update AI provider layer';
  if (/\/utils\//.test(srcLower)) return 'refactor: improve utility helpers';
  return 'feat: update agent capabilities';
}

const ISSUE_TYPE_LABEL: Record<IssuePlan['type'], string> = {
  bug: 'Bug 修复',
  feature: '功能实现',
  performance: '性能优化',
  security: '安全修复',
  refactor: '代码重构',
  test: '测试补齐',
  docs: '文档更新',
  general: '通用任务',
};

function printIssuePlan(plan: IssuePlan): void {
  section('Issue Plan');
  console.log(`  ${chalk.bold(plan.title)}`);
  console.log(`  ${chalk.dim('类型')}  ${chalk.cyan(ISSUE_TYPE_LABEL[plan.type] || plan.type)}`);
  console.log();
  console.log(chalk.cyan('执行步骤'));
  plan.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log();
  console.log(chalk.cyan('验收标准'));
  plan.acceptance.forEach(item => console.log(`  - ${item}`));
}

function printPrDraft(draft: PullRequestDraft): void {
  section('PR Draft');
  console.log(`  Title: ${chalk.bold(draft.title)}`);
  console.log(`  Base:  ${draft.base}`);
  console.log(`  Head:  ${draft.branch}`);
  console.log();
  console.log(draft.body);
}

function printCommitDraft(draft: CommitDraft): void {
  section('Commit Draft');
  console.log(`  ${chalk.bold(draft.message)}`);
  console.log();
  console.log(draft.body);
}

export function registerCollaborationCommands(program: Command): void {
  const collab = program
    .command('collab')
    .description('团队协作工作流：Issue 计划、PR 草稿、提交草稿');

  collab.command('issue')
    .description('从 issue/需求文本生成本地执行计划')
    .argument('<text...>', 'issue 或需求文本')
    .option('--json', 'JSON 格式输出')
    .action((textParts: string[], options?: { json?: boolean }) => {
      const plan = buildIssuePlan(textParts.join(' '));
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('issue-plan', plan), null, 2));
      else printIssuePlan(plan);
    });

  collab.command('pr')
    .description('生成本地 PR 草稿（不推送、不调用 GitHub API）')
    .option('--title <title>', 'PR 标题')
    .option('--base <branch>', '目标分支', 'main')
    .option('--task <taskId>', '附加指定任务报告；默认使用最近任务')
    .option('--json', 'JSON 格式输出')
    .action((options?: { title?: string; base?: string; task?: string; json?: boolean }) => {
      const rootPath = process.cwd();
      if (!isGitRepo(rootPath) && !options?.json) warn('当前目录不是 Git 仓库，将生成无分支信息的草稿。');
      const draft = buildPullRequestDraft(rootPath, { title: options?.title, base: options?.base, taskId: options?.task });
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('pr-draft', draft), null, 2));
      else printPrDraft(draft);
    });

  collab.command('commit')
    .description('生成提交说明草稿（不执行 git commit）')
    .argument('[message]', '可选提交标题')
    .option('--json', 'JSON 格式输出')
    .action((message?: string, options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      if (!isGitRepo(rootPath) && !options?.json) {
        warn('当前目录不是 Git 仓库，无法读取 diff，只生成通用提交草稿。');
      }
      const draft = buildCommitDraft(rootPath, message);
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('commit-draft', draft), null, 2));
      else {
        printCommitDraft(draft);
        info('确认无误后可使用现有 git 流程提交；本命令不会自动提交或推送。');
      }
    });

  program.command('issue')
    .description('快捷入口：从 issue/需求文本生成执行计划')
    .argument('<text...>', 'issue 或需求文本')
    .option('--json', 'JSON 格式输出')
    .action((textParts: string[], options?: { json?: boolean }) => {
      const plan = buildIssuePlan(textParts.join(' '));
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('issue-plan', plan), null, 2));
      else printIssuePlan(plan);
    });

  program.command('pr')
    .description('快捷入口：生成本地 PR 草稿')
    .option('--title <title>', 'PR 标题')
    .option('--base <branch>', '目标分支', 'main')
    .option('--task <taskId>', '附加指定任务报告；默认使用最近任务')
    .option('--json', 'JSON 格式输出')
    .action((options?: { title?: string; base?: string; task?: string; json?: boolean }) => {
      const draft = buildPullRequestDraft(process.cwd(), { title: options?.title, base: options?.base, taskId: options?.task });
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('pr-draft', draft), null, 2));
      else printPrDraft(draft);
    });

  program.command('pr-create')
    .description('使用 GitHub CLI 创建 PR；默认 --dry-run 只展示命令')
    .option('--title <title>', 'PR 标题')
    .option('--base <branch>', '目标分支', 'main')
    .option('--task <taskId>', '附加指定任务报告；默认使用最近任务')
    .option('--go', '真正调用 gh pr create')
    .option('--json', 'JSON 格式输出')
    .action((options?: { title?: string; base?: string; task?: string; go?: boolean; json?: boolean }) => {
      const result = createGitHubPr(process.cwd(), { title: options?.title, base: options?.base, taskId: options?.task, dryRun: !options?.go });
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('github-pr-create', result), null, 2));
      else {
        section(result.dryRun ? 'GitHub PR Dry Run' : 'GitHub PR Create');
        detail('命令', chalk.cyan(result.command));
        if (result.output) success(result.output);
        if (result.error) warn(result.error);
        if (result.dryRun) info('加 --go 后才会真正调用 gh pr create。');
      }
      if (!result.ok) process.exitCode = 1;
    });

  // TC-04: ic collab audit — 审计日志聚合
  collab.command('audit')
    .description('审计日志：汇总最近任务的 who/when/what/verify/rollback 记录')
    .option('--json', 'JSON 格式输出')
    .option('--limit <n>', '最近 N 条', '20')
    .action(async (options?: { json?: boolean; limit?: string }) => {
      const rootPath = process.cwd();
      const limit = parseInt(options?.limit || '20', 10) || 20;
      try {
        const tasksDir = path.join(rootPath, '.icloser', 'tasks');
        let entries: { taskId: string; mtime: number; report: string; verifyLog: string }[] = [];
        try {
          entries = readdirSync(tasksDir)
            .map(name => ({ name, fullPath: path.join(tasksDir, name) }))
            .filter(e => statSync(e.fullPath).isDirectory())
            .map(e => {
              const report = readTextIfExists(path.join(e.fullPath, 'report.md'), 2000);
              const verifyLog = readTextIfExists(path.join(e.fullPath, 'verify.log'), 1000);
              return { taskId: e.name, mtime: statSync(e.fullPath).mtimeMs, report, verifyLog };
            })
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit);
        } catch { /* no tasks yet */ }

        if (entries.length === 0) {
          if (options?.json) {
            console.log(JSON.stringify(jsonEnvelope('audit', { entries: [], total: 0 })));
            return;
          }
          info('暂无任务审计记录。运行 ic t 执行任务后自动生成。');
          return;
        }

        const gitLog = safeGit(['log', '--oneline', `-${limit}`], rootPath);
        const gitCommits = gitLog ? gitLog.split('\n').filter(Boolean) : [];

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('audit', {
            total: entries.length,
            entries: entries.map(e => ({
              taskId: e.taskId,
              mtime: new Date(e.mtime).toISOString(),
              hasReport: !!e.report,
              hasVerify: !!e.verifyLog,
            })),
            recentCommits: gitCommits,
          }), null, 2));
          return;
        }

        section('审计日志');
        console.log();
        for (const [i, entry] of entries.entries()) {
          const time = new Date(entry.mtime).toISOString().replace('T', ' ').substring(0, 19);
          const reportDigest = entry.report ? entry.report.split('\n').slice(0, 3).join(' | ') : '(无报告)';
          const verifyDigest = entry.verifyLog ? entry.verifyLog.split('\n').slice(0, 2).join(' | ') : '(无验证)';
          console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${chalk.dim(time)}  ${entry.taskId.substring(0, 14)}`);
          console.log(`      ${reportDigest.substring(0, 120)}`);
          if (entry.verifyLog) console.log(`      verify: ${verifyDigest.substring(0, 100)}`);
        }
        if (gitCommits.length > 0) {
          console.log();
          section(`最近提交 (${gitCommits.length})`);
          for (const commit of gitCommits.slice(0, 5)) console.log(`  ${chalk.dim(commit)}`);
        }
        console.log();
      } catch (err) { if (!options?.json) warn((err as Error).message); }
    });

  // TC-05: ic collab review — code review 输入
  collab.command('review')
    .description('生成 code review 输入：diff explain + verify + impact 三合一')
    .option('--json', 'JSON 格式输出')
    .option('--task <taskId>', '指定任务 ID')
    .action(async (options?: { json?: boolean; task?: string }) => {
      const rootPath = process.cwd();
      try {
        const { buildDiffExplanation } = await import('./diff.js');
        const diffExplanation = buildDiffExplanation(rootPath);
        const artifacts = loadTaskArtifacts(rootPath, options?.task);
        const prDraft = buildPullRequestDraft(rootPath, { taskId: options?.task });

        // Try impact analysis
        let impactData: any = null;
        try {
          const { loadProjectIndex } = await import('../core/scanner.js');
          const index = await loadProjectIndex(rootPath);
          if (index && diffExplanation.files.length > 0) {
            const changedFilePaths = diffExplanation.files.map(f => f.file);
            const affectedModules = index.modules.filter(m =>
              m.files.some(f => changedFilePaths.some(t => f.includes(t)))
            );
            const importers: string[] = [];
            for (const mod of affectedModules) {
              for (const [modName, deps] of (index.dependencyGraph?.entries() || [])) {
                if (deps.includes(mod.name)) importers.push(modName);
              }
            }
            const testHits = index.modules.filter(m =>
              m.name.includes('.test') || m.name.includes('.spec')
            ).filter(tm => {
              const deps = index.dependencyGraph?.get(tm.name) || [];
              return deps.some(d => affectedModules.some(m => m.name === d));
            });
            impactData = {
              affectedModules: affectedModules.map(m => m.name),
              importers: [...new Set(importers)],
              affectedTests: testHits.map(t => t.name),
              riskLevel: affectedModules.length > 5 ? 'high' : affectedModules.length > 2 ? 'medium' : 'low',
            };
          }
        } catch { /* impact best-effort */ }

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('collab-review', {
            diff: diffExplanation,
            taskId: artifacts.taskId,
            report: artifacts.report,
            verifyLog: artifacts.verifyLog,
            impact: impactData,
            prDraft: { title: prDraft.title, changedFileCount: prDraft.changedFileCount },
          }), null, 2));
          return;
        }

        section('Code Review 输入');
        console.log();

        // 1. Diff summary
        detail('变更文件', `${diffExplanation.changedFileCount} 个，+${diffExplanation.additions}/-${diffExplanation.deletions}`);
        if (diffExplanation.files.length > 0) {
          for (const f of diffExplanation.files.slice(0, 10)) {
            const risk = f.risk === 'high' ? chalk.red('高') : f.risk === 'medium' ? chalk.yellow('中') : chalk.green('低');
            console.log(`  ${chalk.cyan(f.file)}  +${f.additions}/-${f.deletions}  风险:${risk}  ${f.likelyIntent}`);
          }
          if (diffExplanation.files.length > 10) info(`还有 ${diffExplanation.files.length - 10} 个文件...`);
        }

        // 2. Verification evidence
        console.log();
        section('验证证据');
        if (artifacts.verifyLog) {
          const vLines = artifacts.verifyLog.split('\n').filter(Boolean).slice(0, 8);
          for (const line of vLines) console.log(`  ${chalk.dim(line)}`);
        } else {
          info('暂无验证日志。建议先运行验证再提交审查。');
        }

        // 3. Impact
        if (impactData) {
          console.log();
          section('影响面');
          detail('涉及模块', impactData.affectedModules.join(', ') || '无');
          if (impactData.importers.length > 0) detail('上游依赖', `${impactData.importers.length} 个模块`);
          if (impactData.affectedTests.length > 0) detail('受影响测试', impactData.affectedTests.join(', '));
          const riskLabel = impactData.riskLevel === 'high' ? chalk.red('高风险') : impactData.riskLevel === 'medium' ? chalk.yellow('中风险') : chalk.green('低风险');
          detail('风险等级', riskLabel);
        }

        // 4. Recommended checks
        console.log();
        section('建议审查前验证');
        for (const check of diffExplanation.nextChecks) console.log(`  - ${check}`);

        // 5. Report excerpt
        if (artifacts.report) {
          console.log();
          section('任务报告摘要');
          const reportLines = artifacts.report.split('\n').filter(Boolean).slice(0, 10);
          for (const line of reportLines) console.log(`  ${chalk.dim(line)}`);
        }

        console.log();
        info('将以上内容作为 code review 的输入，审查者可以快速理解变更意图、验证结果和风险。');
        console.log();
      } catch (err) { if (!options?.json) warn((err as Error).message); }
    });

  // TC-06: ic collab status — 团队视角
  collab.command('status')
    .description('团队视角：当前分支、任务摘要、待确认记忆、最近变更')
    .option('--json', 'JSON 格式输出')
    .action(async (options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const branch = isGitRepo(rootPath) ? getCurrentBranch(rootPath) : 'N/A';
        const gitLog = safeGit(['log', '--oneline', '-5'], rootPath);
        const recentCommits = gitLog ? gitLog.split('\n').filter(Boolean) : [];

        const tasksDir = path.join(rootPath, '.icloser', 'tasks');
        let taskSummary = { total: 0, completed: 0, failed: 0, running: 0 };
        let recentTasks: { id: string; desc: string; status: string }[] = [];
        try {
          const entries = readdirSync(tasksDir)
            .filter(e => statSync(path.join(tasksDir, e)).isDirectory())
            .sort((a, b) => statSync(path.join(tasksDir, b)).mtimeMs - statSync(path.join(tasksDir, a)).mtimeMs);
          for (const e of entries.slice(0, 5)) {
            const report = readTextIfExists(path.join(tasksDir, e, 'report.md'), 500);
            const desc = report ? report.split('\n')[0]?.replace(/^# /, '') || e : e;
            const statusLine = report?.split('\n').find(l => l.includes('状态')) || '';
            const status = statusLine.includes('completed') ? 'completed' : statusLine.includes('failed') ? 'failed' : 'running';
            recentTasks.push({ id: e.slice(0, 14), desc: desc.slice(0, 60), status });
          }
          taskSummary = {
            total: entries.length,
            completed: entries.filter(e => {
              const r = readTextIfExists(path.join(tasksDir, e, 'report.md'), 200);
              return r.includes('completed') || r.includes('完成');
            }).length,
            failed: entries.filter(e => {
              const r = readTextIfExists(path.join(tasksDir, e, 'report.md'), 200);
              return r.includes('failed') || r.includes('失败');
            }).length,
            running: 0,
          };
        } catch { /* no tasks */ }

        // Memory candidates pending review
        let pendingMemory = 0;
        try {
          const { loadProjectMemory } = await import('../core/memory.js');
          const memory = await loadProjectMemory(rootPath);
          pendingMemory = (memory.memoryCandidates || []).filter(c => c.reviewStatus === 'proposed').length;
        } catch { /* best effort */ }

        // Changed files
        const changed = isGitRepo(rootPath) ? changedFiles(rootPath) : [];

        if (options?.json) {
          console.log(JSON.stringify(jsonEnvelope('collab-status', {
            branch,
            recentCommits,
            taskSummary,
            recentTasks,
            pendingMemory,
            changedFileCount: changed.length,
            changedFiles: changed.slice(0, 20),
            isGitRepo: isGitRepo(rootPath),
          }), null, 2));
          return;
        }

        section('团队协作状态');
        console.log();

        detail('分支', chalk.cyan(branch));
        if (!isGitRepo(rootPath)) {
          warn('当前目录不是 Git 仓库，部分功能受限。');
        }

        if (changed.length > 0) {
          console.log();
          detail('工作区变更', `${changed.length} 个文件`);
          for (const f of changed.slice(0, 5)) console.log(`  ${chalk.dim(f)}`);
          if (changed.length > 5) console.log(`  ${chalk.dim(`... 还有 ${changed.length - 5} 个`)}`);
        }

        console.log();
        section('任务');
        if (recentTasks.length > 0) {
          detail('总计', `${taskSummary.total} 个 (完成 ${taskSummary.completed}, 失败 ${taskSummary.failed})`);
          for (const t of recentTasks) {
            const icon = t.status === 'completed' ? chalk.green('✓') : t.status === 'failed' ? chalk.red('✗') : chalk.yellow('○');
            console.log(`  ${icon} ${chalk.dim(t.id)}  ${t.desc}`);
          }
        } else {
          info('暂无任务记录。运行 ic t <描述> 创建任务。');
        }

        if (pendingMemory > 0) {
          console.log();
          detail('待确认记忆', chalk.yellow(`${pendingMemory} 条 (ic mem review 审查)`));
        }

        if (recentCommits.length > 0) {
          console.log();
          section('最近提交');
          for (const c of recentCommits) console.log(`  ${chalk.dim(c)}`);
        }

        console.log();
        const actions = [
          isGitRepo(rootPath) && changed.length > 0 ? 'ic collab review' : null,
          pendingMemory > 0 ? 'ic mem review' : null,
          recentTasks.length > 0 ? 'ic collab audit' : null,
        ].filter(Boolean);
        if (actions.length > 0) {
          info(`建议下一步：${actions.join(' / ')}`);
        }
        console.log();
      } catch (err) { if (!options?.json) warn((err as Error).message); }
    });

  program.command('commit-draft')
    .description('生成提交说明草稿（不执行 git commit）')
    .argument('[message]', '可选提交标题')
    .option('--json', 'JSON 格式输出')
    .action((message?: string, options?: { json?: boolean }) => {
      const draft = buildCommitDraft(process.cwd(), message);
      if (options?.json) console.log(JSON.stringify(jsonEnvelope('commit-draft', draft), null, 2));
      else {
        printCommitDraft(draft);
        success('提交草稿已生成');
      }
    });
}
