// Deterministic Tool Orchestrator — bridges natural-language tasks to tool chains.

import * as fs from 'fs/promises';
import * as path from 'path';
import { executeToolCall } from './tool-executor.js';
import { ExecutionMemory, summarizeToolResult, type ExecutionMemorySnapshot } from './execution-memory.js';
import { detectProjectStartInfo, scanForSubProjects, type ProjectStartInfo, type SubProjectInfo } from '../cli/startup.js';

export type OrchestratorIntent = 'launch' | 'bugfix' | 'feature' | 'explain' | 'release' | 'memory' | 'general';
export type OrchestratorStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export type FailureCategory =
  | 'none'
  | 'command-not-found'
  | 'wrong-shell'
  | 'missing-env'
  | 'missing-sdk'
  | 'test-failed'
  | 'build-failed'
  | 'permission-denied'
  | 'network-failed'
  | 'timeout'
  | 'tool-failed';

export interface ToolPlanStep {
  id: string;
  title: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  status: OrchestratorStepStatus;
  required?: boolean;
  recoveryOf?: string;
  result?: string;
  failureCategory?: FailureCategory;
}

export interface ToolOrchestratorOptions {
  rootPath: string;
  task: string;
  executeCommands?: boolean;
  maxSteps?: number;
  onProgress?: (event: ToolOrchestratorEvent) => void;
}

export interface ToolOrchestratorEvent {
  phase: 'plan' | 'step_start' | 'step_result' | 'recover' | 'done';
  message: string;
  step?: ToolPlanStep;
  intent?: OrchestratorIntent;
  memory?: ExecutionMemorySnapshot;
}

export interface ToolOrchestratorResult {
  intent: OrchestratorIntent;
  success: boolean;
  summary: string;
  plan: ToolPlanStep[];
  memory: ExecutionMemorySnapshot;
  executedSteps: number;
}

export function classifyOrchestratorIntent(task: string): OrchestratorIntent {
  const text = task.toLowerCase();
  if (/(启动|运行|跑起来|启动项目|运行项目|launch|start|serve|run project)/i.test(task)) return 'launch';
  if (/(修复|bug|报错|失败|fix|error|failed|failure)/i.test(task)) return 'bugfix';
  if (/(添加|新增|实现|feature|add|implement)/i.test(task)) return 'feature';
  if (/(解释|说明|review|审查|diff|影响|impact|explain)/i.test(task)) return 'explain';
  if (/(发布|release|上线|trust|ci|门禁|质量)/i.test(task)) return 'release';
  if (/(记忆|memory|mem|agents\.md|规则|偏好)/i.test(task)) return 'memory';
  if (text.trim()) return 'general';
  return 'general';
}

export async function buildToolPlan(rootPath: string, task: string, executeCommands = false): Promise<ToolPlanStep[]> {
  const intent = classifyOrchestratorIntent(task);
  const steps: ToolPlanStep[] = [];
  const add = (step: Omit<ToolPlanStep, 'id' | 'status'>) => {
    steps.push({ ...step, id: `S${steps.length + 1}`, status: 'pending' });
  };

  add({
    title: '获取项目画像',
    tool: 'get_project_overview',
    args: { deep: intent !== 'launch' },
    reason: '先建立项目类型、模块、构建与测试入口的全局认识。',
    required: true,
  });

  if (intent === 'launch') {
    const startInfo = await detectProjectStartInfo(rootPath, fs, path);
    await addLaunchDiscoverySteps(rootPath, add);
    if (startInfo) {
      add({
        title: '准备启动命令',
        tool: 'run_command',
        args: { command: commandLine(startInfo), dryRun: !executeCommands, timeoutMs: /android/i.test(startInfo.type) ? 240000 : undefined, reason: `启动 ${startInfo.type}` },
        reason: `检测到 ${startInfo.type}，使用已识别启动命令进行${executeCommands ? '执行' : '预演'}。`,
        required: true,
      });
      addLaunchVerificationStep(startInfo, add, executeCommands);
    } else {
      const subProjects = await scanForSubProjects(rootPath, fs, path);
      if (subProjects.length > 0) {
        addSubProjectLaunchSteps(subProjects, add, executeCommands);
        return steps;
      }
      add({
        title: '搜索启动线索',
        tool: 'search_code',
        args: { pattern: 'scripts|dev|start|serve|bootRun|installDebug|uvicorn|flask|main\\(' },
        reason: '未检测到标准启动入口，改用代码/配置搜索寻找启动线索。',
        required: false,
      });
    }
    return steps;
  }

  if (intent === 'bugfix') {
    add({ title: '定位失败信息', tool: 'search_code', args: { pattern: 'TODO|FIXME|throw new Error|console\\.error|failed|error' }, reason: '先找错误处理、失败日志和显式 TODO。' });
    add({ title: '运行测试预演', tool: 'run_command', args: { command: 'npm test', dryRun: !executeCommands, reason: '验证当前失败面' }, reason: '用测试结果驱动修复路径。' });
    add({ title: '查看变更状态', tool: 'git_status', args: { action: 'diff' }, reason: '确认已有变更，避免覆盖用户工作。' });
    return steps;
  }

  if (intent === 'feature') {
    add({ title: '搜索相关实现', tool: 'search_code', args: { pattern: extractSearchPattern(task) }, reason: '寻找相邻功能和本地约定。' });
    add({ title: '查看 Git 状态', tool: 'git_status', args: { action: 'status' }, reason: '确认工作区是否已有改动。' });
    add({ title: '测试命令预演', tool: 'run_command', args: { command: 'npm test', dryRun: !executeCommands, reason: '确认功能交付验证方式' }, reason: '提前绑定验证命令。' });
    return steps;
  }

  if (intent === 'explain') {
    add({ title: '读取 Git diff', tool: 'git_status', args: { action: 'diff' }, reason: '解释变更前先读取当前 diff 统计。' });
    add({ title: '搜索测试线索', tool: 'search_code', args: { pattern: 'describe\\(|it\\(|test\\(' }, reason: '找到相关测试入口，辅助风险评估。' });
    return steps;
  }

  if (intent === 'release') {
    add({ title: '类型检查预演', tool: 'run_command', args: { command: 'npx tsc --noEmit', dryRun: !executeCommands, reason: '发布前类型门禁' }, reason: '发布信任首先看类型检查。' });
    add({ title: 'lint 预演', tool: 'run_command', args: { command: 'npm run lint', dryRun: !executeCommands, reason: '发布前 warning/error 门禁' }, reason: '确认 warning budget 和 lint 状态。' });
    add({ title: '发布报告预演', tool: 'run_command', args: { command: 'npm run release:trust', dryRun: !executeCommands, reason: '生成发布信任报告' }, reason: '汇总质量门禁证据。' });
    return steps;
  }

  if (intent === 'memory') {
    add({ title: '查看记忆文件', tool: 'search_code', args: { pattern: 'AGENTS\\.md|CLAUDE\\.md|memory|rule|preference' }, reason: '定位现有记忆和规则入口。' });
    add({ title: '查看项目规则', tool: 'run_command', args: { command: 'node dist/index.js mem used "当前任务"', dryRun: !executeCommands, reason: '展示本次采用记忆' }, reason: '验证记忆摘要能否被任务前引用。' });
    return steps;
  }

  add({ title: '搜索任务关键词', tool: 'search_code', args: { pattern: extractSearchPattern(task) }, reason: '通用任务先定位相关代码。' });
  add({ title: '查看 Git 状态', tool: 'git_status', args: { action: 'status' }, reason: '确认工作区状态。' });
  return steps;
}

export async function runToolOrchestrator(options: ToolOrchestratorOptions): Promise<ToolOrchestratorResult> {
  const intent = classifyOrchestratorIntent(options.task);
  const memory = new ExecutionMemory();
  memory.addFact(`任务意图识别为 ${intent}`, 'intent-router');
  const plan = await buildToolPlan(options.rootPath, options.task, Boolean(options.executeCommands));
  options.onProgress?.({ phase: 'plan', message: `已生成 ${plan.length} 步工具计划`, intent, memory: memory.snapshot() });

  let executedSteps = 0;
  const maxSteps = options.maxSteps ?? 12;
  for (let i = 0; i < plan.length && executedSteps < maxSteps; i++) {
    const step = plan[i];
    step.status = 'running';
    options.onProgress?.({ phase: 'step_start', message: step.title, step, intent, memory: memory.snapshot() });

    const result = await executeToolCall(step.tool, step.args, options.rootPath, `orch-${intent}`);
    step.result = summarizeToolResult(result, 500);
    step.failureCategory = classifyFailure(result);
    step.status = step.failureCategory === 'none' ? 'success' : 'failed';
    executedSteps++;
    absorbResultIntoMemory(memory, step, result);

    options.onProgress?.({ phase: 'step_result', message: step.result, step, intent, memory: memory.snapshot() });

    if (step.status === 'failed') {
      const recovery = buildRecoveryStep(step, options.rootPath, Boolean(options.executeCommands));
      if (recovery) {
        recovery.id = `S${plan.length + 1}`;
        plan.splice(i + 1, 0, recovery);
        memory.addDecision(`失败 ${step.failureCategory} 后追加恢复步骤：${recovery.title}`, 'recover');
        options.onProgress?.({ phase: 'recover', message: recovery.reason, step: recovery, intent, memory: memory.snapshot() });
      }
    }
  }

  const limited = executedSteps >= maxSteps && plan.some(s => s.status === 'pending');
  const attemptedRequired = plan.filter(s => s.required !== false && s.status !== 'pending');
  const pendingRequired = plan.filter(s => s.required !== false && s.status === 'pending');
  const success =
    attemptedRequired.every(s => s.status === 'success' || s.status === 'skipped') &&
    (pendingRequired.length === 0 || limited);
  const summary = renderOrchestratorSummary(intent, success, plan, memory.snapshot(), limited);
  options.onProgress?.({ phase: 'done', message: summary, intent, memory: memory.snapshot() });
  return { intent, success, summary, plan, memory: memory.snapshot(), executedSteps };
}

async function addLaunchDiscoverySteps(rootPath: string, add: (step: Omit<ToolPlanStep, 'id' | 'status'>) => void): Promise<void> {
  const candidates = ['package.json', 'settings.gradle.kts', 'build.gradle.kts', 'app/build.gradle.kts', 'pom.xml', 'pyproject.toml', 'go.mod'];
  for (const file of candidates) {
    if (!(await exists(path.join(rootPath, file)))) continue;
    add({
      title: `读取 ${file}`,
      tool: 'read_file',
      args: { path: file },
      reason: `启动任务需要确认 ${file} 中的构建/运行配置；文件不存在时工具会返回可观察结果。`,
      required: false,
    });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function addSubProjectLaunchSteps(
  subProjects: SubProjectInfo[],
  add: (step: Omit<ToolPlanStep, 'id' | 'status'>) => void,
  executeCommands: boolean,
): void {
  for (const project of subProjects.slice(0, 4)) {
    const configFile = project.type.includes('Node.js') ? `${project.dir}/package.json`
      : project.type.includes('Maven') ? `${project.dir}/pom.xml`
        : project.type.includes('Docker Compose') ? `${project.dir}/docker-compose.yml`
          : `${project.dir}/build.gradle.kts`;
    add({
      title: `读取子项目 ${configFile}`,
      tool: 'read_file',
      args: { path: configFile },
      reason: `多模块项目需要先确认 ${project.dir} 的启动配置。`,
      required: false,
    });
    add({
      title: `准备启动子项目 ${project.dir}`,
      tool: 'run_command',
      args: { command: subProjectCommandLine(project), dryRun: !executeCommands, reason: `启动 ${project.type}` },
      reason: `检测到子项目 ${project.dir} (${project.type})，使用对应目录启动命令。`,
      required: true,
    });
  }
}

function addLaunchVerificationStep(
  info: ProjectStartInfo,
  add: (step: Omit<ToolPlanStep, 'id' | 'status'>) => void,
  executeCommands: boolean,
): void {
  if (/android/i.test(info.type)) {
    add({
      title: '诊断 Android SDK/AVD/ADB',
      tool: 'run_command',
      args: { command: androidDiagnosticCommand(), dryRun: !executeCommands, timeoutMs: 120000, reason: '确认 Android SDK、AVD、系统镜像、ADB 和系统服务状态' },
      reason: 'Android 启动必须看到 SDK/AVD/ADB/PackageManager 证据，缺镜像或系统服务未 ready 时要给出可行动原因。',
      required: false,
    });
    return;
  }
  add({
    title: '检查运行状态',
    tool: 'run_command',
    args: { command: process.platform === 'win32' ? 'netstat -ano' : 'lsof -i -P -n | head', dryRun: !executeCommands, reason: '确认服务是否监听端口' },
    reason: '启动后需要有进程/端口观察证据。',
    required: false,
  });
}

function buildRecoveryStep(step: ToolPlanStep, rootPath: string, executeCommands: boolean): ToolPlanStep | null {
  void rootPath;
  const category = step.failureCategory || 'tool-failed';
  if (category === 'wrong-shell') {
    const command = process.platform === 'win32' ? 'powershell -NoProfile -Command "Get-Location"' : '/bin/sh -lc "pwd"';
    return recover(step, '切换 Shell 验证', 'run_command', { command, dryRun: !executeCommands }, '检测到 shell 不匹配，改用当前平台 shell 做最小验证。');
  }
  if (category === 'command-not-found') {
    const command = process.platform === 'win32' ? 'where node && where npm' : 'command -v node; command -v npm';
    return recover(step, '检查基础命令路径', 'run_command', { command, dryRun: !executeCommands }, '命令不可用时先检查 PATH 中的基础工具。');
  }
  if (category === 'missing-sdk') {
    const command = process.platform === 'win32' ? 'powershell -NoProfile -Command "$env:ANDROID_HOME; $env:ANDROID_SDK_ROOT; adb devices"' : 'printf "%s\\n" "$ANDROID_HOME" "$ANDROID_SDK_ROOT"; adb devices';
    return recover(step, '检查 Android SDK/ADB', 'run_command', { command, dryRun: !executeCommands }, 'Android SDK 缺失时检查环境变量和 adb。');
  }
  if (category === 'test-failed' || category === 'build-failed') {
    return recover(step, '搜索失败日志关键字', 'search_code', { pattern: 'error|failed|exception|TODO|FIXME' }, '测试/构建失败后先定位错误线索。');
  }
  if (category === 'permission-denied') {
    return recover(step, '查看目录权限线索', 'list_dir', { path: '.' }, '权限失败后先观察当前目录内容和可访问性。');
  }
  return null;
}

function recover(
  failed: ToolPlanStep,
  title: string,
  tool: string,
  args: Record<string, unknown>,
  reason: string,
): ToolPlanStep {
  return { id: '', title, tool, args, reason, status: 'pending', required: false, recoveryOf: failed.id };
}

export function classifyFailure(result: string): FailureCategory {
  const text = result.toLowerCase();
  if (/^##\s*项目画像/.test(result.trim())) return 'none';
  if (/^\[dry-run\]/i.test(result.trim()) && /安全策略通过/.test(result)) return 'none';
  const clearFailure =
    !text ||
    /^(错误|命令执行失败|搜索错误|工具执行|解析错误)/i.test(result.trim()) ||
    /command not found|not recognized|无法将|不是内部或外部命令|exit code|fatal|eperm|permission denied|access is denied|timed out|timeout|etimedout|econn/i.test(result) ||
    /build failed|test failed|tests? failed|failed \d+ tests?/i.test(result) ||
    /broken avd|android sdk not found|check (your )?android_sdk_root|set android_home|no initial system image|system image.*(missing|not found)|not a valid directory|sdk root/i.test(result);
  if (clearFailure) {
    if (/command not found|not recognized|无法将|不是内部或外部命令/.test(text)) return 'command-not-found';
    if (/get-childitem: command not found|powershell.*not found|bash.*not found|wrong shell/.test(text)) return 'wrong-shell';
    if (/android sdk not found|check (your )?android_sdk_root|set android_home|broken avd|no initial system image|system image.*(missing|not found)|not a valid directory|sdk root/.test(text)) return 'missing-sdk';
    if (/permission denied|access is denied|eperm|eacces/.test(text)) return 'permission-denied';
    if (/timeout|timed out|etimedout/.test(text)) return 'timeout';
    if (/network|econn|dns|fetch/.test(text)) return 'network-failed';
    if (/test|vitest|jest|pytest/.test(text)) return 'test-failed';
    if (/build|compile|tsc|gradle|maven/.test(text)) return 'build-failed';
    return 'tool-failed';
  }
  return 'none';
}

function absorbResultIntoMemory(memory: ExecutionMemory, step: ToolPlanStep, result: string): void {
  const category = step.failureCategory || 'none';
  if (category === 'none') {
    memory.addVerified(`${step.title} 成功：${summarizeToolResult(result, 120)}`, step.tool);
  } else {
    memory.addFailure(`${step.title} 失败(${category})：${summarizeToolResult(result, 120)}`, step.tool);
  }
  if (!/^错误：/.test(result.trim()) && /Android \(Gradle\)|installDebug|adb devices|Broken AVD|ANDROID_HOME|ANDROID_SDK_ROOT/i.test(result)) memory.addFact('检测到 Android/Gradle/ADB 相关启动线索', step.tool);
  if (!/^错误：/.test(result.trim()) && /"scripts"\s*:|npm run|pnpm run|yarn .*start|package\.json/i.test(result)) memory.addFact('检测到 Node.js 包管理或 package.json 线索', step.tool);
  if (/build successful|tests? passed|eslint ok|命令执行成功/i.test(result)) memory.addVerified('工具结果包含成功验证信号', step.tool);
}

function renderOrchestratorSummary(
  intent: OrchestratorIntent,
  success: boolean,
  plan: ToolPlanStep[],
  memory: ExecutionMemorySnapshot,
  limited = false,
): string {
  const done = plan.filter(s => s.status === 'success').length;
  const failed = plan.filter(s => s.status === 'failed').length;
  const lines = [
    `工具编排完成：${intent}，${success ? (limited ? '部分完成，等待继续' : '主路径通过') : '存在未完成步骤'}`,
    `步骤：${done} 成功 / ${failed} 失败 / ${plan.length} 总计`,
  ];
  if (limited) lines.push(`限步执行：剩余 ${plan.filter(s => s.status === 'pending').length} 步未执行，可去掉 --max-steps 或提高步数继续。`);
  if (memory.facts.length) lines.push(`事实：${memory.facts.slice(0, 3).join('；')}`);
  if (memory.failures.length) lines.push(`失败：${memory.failures.slice(0, 3).join('；')}`);
  if (memory.verified.length) lines.push(`验证：${memory.verified.slice(0, 3).join('；')}`);
  return lines.join('\n');
}

function extractSearchPattern(task: string): string {
  const words = task.match(/[a-zA-Z_][a-zA-Z0-9_]{2,}|[\u4e00-\u9fff]{2,4}/g) || [];
  return words.slice(0, 4).join('|') || 'TODO|FIXME|main|index';
}

function commandLine(info: ProjectStartInfo): string {
  const quote = (s: string) => /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  return [quote(info.command), ...info.args.map(quote)].join(' ');
}

function subProjectCommandLine(info: SubProjectInfo): string {
  if (info.type.includes('Node.js')) {
    const script = info.args[1] || info.args[0] || 'dev';
    return `${info.command} --prefix ${info.dir} run ${script}`;
  }
  if (info.type.includes('Maven')) {
    const wrapper = process.platform === 'win32' ? `${info.dir}\\mvnw.cmd` : `${info.dir}/mvnw`;
    return `${wrapper} -f ${info.dir}/pom.xml ${info.args.join(' ')}`;
  }
  if (info.type.includes('Gradle') && !info.type.includes('Android')) {
    const wrapper = process.platform === 'win32' ? `${info.dir}\\gradlew.bat` : `${info.dir}/gradlew`;
    return `${wrapper} -p ${info.dir} ${info.args.join(' ')}`;
  }
  if (info.type.includes('Docker Compose')) {
    return `${info.command} -f ${info.dir}/docker-compose.yml ${info.args.join(' ')}`;
  }
  return commandLine(info);
}

function androidDiagnosticCommand(): string {
  if (process.platform === 'win32') {
    return [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command',
      '"$sdk=$env:ANDROID_HOME; if(-not $sdk){ $sdk=$env:ANDROID_SDK_ROOT };',
      "if(-not $sdk -and (Test-Path 'local.properties')){ $line=Get-Content 'local.properties' | Where-Object { $_ -match '^sdk\\.dir\\s*=' } | Select-Object -First 1; if($line){ $sdk=($line -replace '^sdk\\.dir\\s*=\\s*','').Replace('\\:',':').Replace('\\\\','\\') } };",
      "Write-Host ('ANDROID_HOME=' + $env:ANDROID_HOME);",
      "Write-Host ('ANDROID_SDK_ROOT=' + $env:ANDROID_SDK_ROOT);",
      "if(-not $sdk){ throw 'Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.' };",
      "$adb=Join-Path $sdk 'platform-tools\\adb.exe';",
      "$emu=Join-Path $sdk 'emulator\\emulator.exe';",
      "if(Test-Path $emu){ Write-Host 'AVD list:'; & $emu -list-avds } else { Write-Host 'emulator.exe missing' };",
      "$sys=Join-Path $sdk 'system-images'; if(Test-Path $sys){ Write-Host 'System images:'; Get-ChildItem $sys -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 20 -ExpandProperty FullName } else { Write-Host 'system-images missing' };",
      "if(!(Test-Path $adb)){ throw ('adb not found: ' + $adb) };",
      '& $adb devices -l;',
      "$online=((& $adb devices) -match '\\tdevice');",
      "if($online){ Write-Host 'boot_completed:'; & $adb shell getprop sys.boot_completed; Write-Host 'package_manager:'; & $adb shell pm path android }\"",
    ].join(' ');
  }
  return [
    '/bin/sh -lc',
    '"sdk=${ANDROID_HOME:-$ANDROID_SDK_ROOT};',
    'printf \"ANDROID_HOME=%s\\nANDROID_SDK_ROOT=%s\\n\" \"$ANDROID_HOME\" \"$ANDROID_SDK_ROOT\";',
    'if [ -z \"$sdk\" ]; then echo \"Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.\"; exit 1; fi;',
    'adb=\"$sdk/platform-tools/adb\"; emu=\"$sdk/emulator/emulator\";',
    'if [ -x \"$emu\" ]; then echo \"AVD list:\"; \"$emu\" -list-avds; else echo \"emulator missing\"; fi;',
    'if [ -d \"$sdk/system-images\" ]; then echo \"System images:\"; find \"$sdk/system-images\" -maxdepth 4 -type d | head -20; else echo \"system-images missing\"; fi;',
    'if [ ! -x \"$adb\" ]; then echo \"adb not found: $adb\"; exit 1; fi;',
    '\"$adb\" devices -l;',
    'if \"$adb\" devices | grep -q \"device$\"; then echo \"boot_completed:\"; \"$adb\" shell getprop sys.boot_completed; echo \"package_manager:\"; \"$adb\" shell pm path android; fi"',
  ].join(' ');
}
