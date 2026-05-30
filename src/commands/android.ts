import { Command } from 'commander';
import chalk from 'chalk';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { jsonEnvelope } from '../cli/json.js';
import { detail, info, printError, section, success, warn } from '../cli/output.js';
import { detectProjectStartInfo } from '../cli/startup.js';

export interface AndroidDoctorReport {
  sdkDir: string;
  sdkSource: 'env' | 'local.properties' | 'missing';
  adbPath?: string;
  emulatorPath?: string;
  avds: string[];
  systemImages: string[];
  devices: string[];
  bootCompleted?: string;
  packageManagerReady: boolean;
  applicationId?: string;
  status: 'ready' | 'partial' | 'blocked';
  issues: string[];
  actions: string[];
}

function readLocalSdkDir(rootPath: string): string {
  try {
    const raw = fs.readFileSync(path.join(rootPath, 'local.properties'), 'utf-8');
    const line = raw.split(/\r?\n/).find(l => /^sdk\.dir\s*=/.test(l));
    if (!line) return '';
    return line.replace(/^sdk\.dir\s*=\s*/, '').replace(/\\:/g, ':').replace(/\\\\/g, '\\').trim();
  } catch {
    return '';
  }
}

function tryExec(file: string, args: string[], cwd: string, timeout = 15000): string {
  try {
    return execFileSync(file, args, { cwd, encoding: 'utf-8', stdio: 'pipe', timeout }).trim();
  } catch (err: any) {
    const stdout = String(err?.stdout || '').trim();
    const stderr = String(err?.stderr || '').trim();
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }
}

function listSystemImages(sdkDir: string): string[] {
  const root = path.join(sdkDir, 'system-images');
  const results: string[] = [];
  try {
    const walk = (dir: string, depth: number) => {
      if (depth > 3 || results.length >= 40) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        results.push(full);
        walk(full, depth + 1);
      }
    };
    walk(root, 0);
  } catch { /* best-effort */ }
  return results;
}

export async function buildAndroidDoctorReport(rootPath: string, env: NodeJS.ProcessEnv = process.env): Promise<AndroidDoctorReport> {
  const localSdk = readLocalSdkDir(rootPath);
  const envSdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || '';
  const sdkDir = envSdk || localSdk;
  const sdkSource: AndroidDoctorReport['sdkSource'] = envSdk ? 'env' : localSdk ? 'local.properties' : 'missing';
  const issues: string[] = [];
  const actions: string[] = [];
  const startInfo = await detectProjectStartInfo(rootPath, fs.promises, path);
  const commandText = startInfo ? [startInfo.command, ...startInfo.args].join(' ') : '';
  const applicationId = commandText.match(/(?:-p|resolve-activity --brief)\s+'?([a-zA-Z0-9_.]+)'?/)?.[1]
    || commandText.match(/Android launch requested:\s*([a-zA-Z0-9_.]+)/)?.[1];

  if (!sdkDir) {
    issues.push('Android SDK not found');
    actions.push('Set ANDROID_HOME or add sdk.dir to local.properties');
    return { sdkDir: '', sdkSource, avds: [], systemImages: [], devices: [], packageManagerReady: false, applicationId, status: 'blocked', issues, actions };
  }

  const adbPath = path.join(sdkDir, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const emulatorPath = path.join(sdkDir, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
  if (!fs.existsSync(adbPath)) {
    issues.push(`adb not found: ${adbPath}`);
    actions.push('Install Android SDK platform-tools');
  }
  if (!fs.existsSync(emulatorPath)) {
    issues.push(`emulator not found: ${emulatorPath}`);
    actions.push('Install Android Emulator');
  }

  const avds = fs.existsSync(emulatorPath) ? tryExec(emulatorPath, ['-list-avds'], rootPath).split(/\r?\n/).filter(Boolean) : [];
  const systemImages = listSystemImages(sdkDir);
  if (avds.length === 0) {
    issues.push('No Android AVD found');
    actions.push('Create an AVD with avdmanager or Android Studio');
  }
  if (systemImages.length === 0) {
    issues.push('No Android system image found');
    actions.push('Install a system image, e.g. system-images;android-35;google_apis;x86_64');
  }

  let devices: string[] = [];
  let bootCompleted = '';
  let packageManagerReady = false;
  if (fs.existsSync(adbPath)) {
    const adbDevices = tryExec(adbPath, ['devices', '-l'], rootPath);
    devices = adbDevices.split(/\r?\n/).filter(line => /\bdevice\b/.test(line) && !/^List of devices/.test(line));
    if (devices.length > 0) {
      bootCompleted = tryExec(adbPath, ['shell', 'getprop', 'sys.boot_completed'], rootPath, 5000);
      packageManagerReady = Boolean(tryExec(adbPath, ['shell', 'pm', 'path', 'android'], rootPath, 5000));
    } else {
      actions.push('Start an emulator or connect a device');
    }
  }

  const status: AndroidDoctorReport['status'] = issues.some(i => /not found|No Android system image|Android SDK/.test(i))
    ? 'blocked'
    : devices.length > 0 && bootCompleted.trim() === '1' && packageManagerReady
      ? 'ready'
      : 'partial';

  if (status !== 'ready' && !actions.includes('Run ic android start after fixing the listed issues')) {
    actions.push('Run ic android start after fixing the listed issues');
  }

  return { sdkDir, sdkSource, adbPath, emulatorPath, avds, systemImages, devices, bootCompleted, packageManagerReady, applicationId, status, issues, actions };
}

function printDoctor(report: AndroidDoctorReport): void {
  section('Android Doctor');
  detail('状态', report.status === 'ready' ? chalk.green('ready') : report.status === 'partial' ? chalk.yellow('partial') : chalk.red('blocked'));
  detail('SDK', report.sdkDir || chalk.red('missing'));
  detail('SDK 来源', report.sdkSource);
  detail('AVD', report.avds.length ? report.avds.join(', ') : chalk.yellow('none'));
  detail('设备', report.devices.length ? report.devices.join(' | ') : chalk.yellow('none'));
  detail('PackageManager', report.packageManagerReady ? chalk.green('ready') : chalk.yellow('not ready'));
  if (report.applicationId) detail('应用包名', report.applicationId);
  if (report.issues.length) {
    console.log();
    warn('问题');
    report.issues.forEach(i => console.log(`  - ${i}`));
  }
  if (report.actions.length) {
    console.log();
    info('下一步');
    report.actions.forEach(a => console.log(`  - ${a}`));
  }
}

export function registerAndroidCommands(program: Command): void {
  const android = program.command('android').description('Android 项目诊断与启动');

  android.command('doctor')
    .description('诊断 Android SDK / AVD / ADB / PackageManager')
    .option('--json', 'JSON 格式输出')
    .action(async (options?: { json?: boolean }) => {
      try {
        const report = await buildAndroidDoctorReport(process.cwd());
        if (options?.json) console.log(JSON.stringify(jsonEnvelope('android-doctor', report), null, 2));
        else printDoctor(report);
        if (report.status === 'blocked') process.exitCode = 1;
      } catch (err) { printError(err as Error); }
    });

  android.command('start')
    .description('构建、安装并启动 Android 应用')
    .option('--json', 'JSON 格式输出')
    .action(async (options?: { json?: boolean }) => {
      const rootPath = process.cwd();
      try {
        const before = await buildAndroidDoctorReport(rootPath);
        const infoStart = await detectProjectStartInfo(rootPath, fs.promises, path);
        if (!infoStart || !/android/i.test(infoStart.type)) {
          const payload = { ok: false, reason: 'not-android-project', doctor: before };
          if (options?.json) console.log(JSON.stringify(jsonEnvelope('android-start', payload), null, 2));
          else warn('当前目录未识别为 Android Gradle 项目');
          process.exitCode = 1;
          return;
        }
        if (!options?.json) section('Android Start');
        const run = spawnSync(infoStart.command, infoStart.args, { cwd: rootPath, encoding: 'utf-8', timeout: 10 * 60 * 1000, windowsHide: true });
        const after = await buildAndroidDoctorReport(rootPath);
        const ok = (run.status ?? 1) === 0 && after.devices.length > 0;
        const payload = {
          ok,
          command: `${infoStart.command} ${infoStart.args.join(' ')}`,
          exitCode: run.status,
          stdout: (run.stdout || '').slice(-4000),
          stderr: (run.stderr || '').slice(-2000),
          doctor: after,
        };
        if (options?.json) console.log(JSON.stringify(jsonEnvelope('android-start', payload), null, 2));
        else {
          if (ok) success('Android 应用已构建、安装并请求启动');
          else warn('Android 启动未完成');
          printDoctor(after);
        }
        if (!ok) process.exitCode = 1;
      } catch (err) { printError(err as Error); }
    });
}
