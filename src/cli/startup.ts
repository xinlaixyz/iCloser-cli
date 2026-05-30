// Project startup detection — portability-first project launch logic
// Extracted from repl.ts to reduce module size and enable reuse

async function detectPackageManager(dir: string, fsp: any, path: any): Promise<string> {
  try {
    if (await fsp.stat(path.join(dir, 'yarn.lock')).catch(() => null)) return 'yarn';
    if (await fsp.stat(path.join(dir, 'pnpm-lock.yaml')).catch(() => null)) return 'pnpm';
  } catch { /* best-effort */ }
  return 'npm';
}

export interface ProjectStartInfo {
  type: string;
  command: string;
  args: string[];
  label: string;
  needsInstall: boolean;
  /** Long-running web servers use background mode; one-shot launch flows stay foreground. */
  background?: boolean;
}

export interface SubProjectInfo extends ProjectStartInfo {
  cwd: string;
  dir: string;
}

/** Scan cwd and depth-2 subdirectories for runnable projects */
export async function scanForSubProjects(
  cwd: string, fsp: any, path: any
): Promise<SubProjectInfo[]> {
  const results: SubProjectInfo[] = [];
  try {
    const rootPkg = await fsp.readFile(path.join(cwd, 'package.json'), 'utf-8').catch(() => null);
    if (rootPkg) {
      const pkg = JSON.parse(rootPkg);
      if (Array.isArray(pkg.workspaces) || Array.isArray(pkg.workspaces?.packages)) {
        // workspace root — sub-projects will be discovered individually
      }
    }
  } catch { /* best-effort */ }
  try {
    const entries = await fsp.readdir(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subDir = path.join(cwd, entry.name);
      const info = await detectProjectStartInfo(subDir, fsp, path);
      if (info) { results.push({ ...info, cwd: subDir, dir: entry.name }); continue; }
      try {
        const subEntries = await fsp.readdir(subDir, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (!subEntry.isDirectory() || subEntry.name.startsWith('.') || subEntry.name === 'node_modules') continue;
          const nestedDir = path.join(subDir, subEntry.name);
          const nestedInfo = await detectProjectStartInfo(nestedDir, fsp, path);
          if (nestedInfo) results.push({ ...nestedInfo, cwd: nestedDir, dir: `${entry.name}/${subEntry.name}` });
        }
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
  return results;
}

/** Detect project type, start command, and install status for a single directory */
export async function detectProjectStartInfo(
  dir: string, fsp: any, path: any
): Promise<ProjectStartInfo | null> {
  // 1. npm/Node.js
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf-8'));
    const scripts = pkg.scripts || {};
    const scriptName = ['dev', 'start', 'serve', 'preview'].find((n: string) => scripts[n]);
    if (scriptName) {
      const pm = await detectPackageManager(dir, fsp, path);
      const nmMissing = !(await fsp.stat(path.join(dir, 'node_modules')).catch(() => null));
      const hasDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length > 0;
      const cmd = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : 'npm';
      return { type: `Node.js (${pm})`, command: cmd, args: ['run', scriptName], label: `${cmd} run ${scriptName}`, needsInstall: nmMissing && hasDeps };
    }
  } catch { /* best-effort */ }

  // 2. Java/Maven
  try {
    const pom = await fsp.readFile(path.join(dir, 'pom.xml'), 'utf-8').catch(() => null);
    const mvnw = await fsp.stat(path.join(dir, 'mvnw.cmd')).catch(() => null)
      || await fsp.stat(path.join(dir, 'mvnw')).catch(() => null);
    if (pom) {
      const cmd = mvnw ? (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn';
      return { type: 'Spring Boot (Maven)', command: cmd, args: ['spring-boot:run'], label: `${cmd} spring-boot:run`, needsInstall: false };
    }
  } catch { /* best-effort */ }

  // 3. Java/Gradle
  try {
    const gradle = await fsp.stat(path.join(dir, 'build.gradle')).catch(() => null)
      || await fsp.stat(path.join(dir, 'build.gradle.kts')).catch(() => null);
    const gradlew = await fsp.stat(path.join(dir, 'gradlew')).catch(() => null);
    if (gradle) {
      const androidInfo = await detectAndroidStartInfo(dir, fsp, path);
      if (androidInfo) return androidInfo;
      const cmd = gradlew ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
      return { type: 'Java (Gradle)', command: cmd, args: ['bootRun'], label: `${cmd} bootRun`, needsInstall: false };
    }
  } catch { /* best-effort */ }

  // 4. Go
  try {
    const goMod = await fsp.readFile(path.join(dir, 'go.mod'), 'utf-8').catch(() => null);
    const hasMain = await fsp.readFile(path.join(dir, 'main.go'), 'utf-8').catch(() => null);
    if (goMod) {
      if (hasMain) {
        const mf = await fsp.readFile(path.join(dir, 'Makefile'), 'utf-8').catch(() => null);
        return mf ? { type: 'Go (Makefile)', command: 'make', args: ['run'], label: 'make run', needsInstall: false }
          : { type: 'Go', command: 'go', args: ['run', '.'], label: 'go run .', needsInstall: false };
      }
      const cmdStat = await fsp.stat(path.join(dir, 'cmd')).catch(() => null);
      if (cmdStat?.isDirectory()) {
        const cmdEntries = await fsp.readdir(path.join(dir, 'cmd'), { withFileTypes: true }).catch(() => []);
        for (const entry of cmdEntries) {
          if (entry.isDirectory() || entry.name === 'main.go') {
            const mainPath = entry.isDirectory() ? `cmd/${entry.name}` : 'cmd';
            return { type: 'Go', command: 'go', args: ['run', `./${mainPath}/`], label: `go run ./${mainPath}/`, needsInstall: false };
          }
        }
      }
    }
  } catch { /* best-effort */ }

  // 5. Python
  try {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const pyproject = await fsp.readFile(path.join(dir, 'pyproject.toml'), 'utf-8').catch(() => null);
    // Determine entry point: which file exists, and read its content
    const hasMainPy = await fsp.stat(path.join(dir, 'main.py')).catch(() => null);
    const hasAppPy = !hasMainPy && await fsp.stat(path.join(dir, 'app.py')).catch(() => null);
    const entryPy = hasMainPy ? 'main.py' : hasAppPy ? 'app.py' : null;
    const entryContent = entryPy ? await fsp.readFile(path.join(dir, entryPy), 'utf-8').catch(() => null) : null;
    const managePy = await fsp.stat(path.join(dir, 'manage.py')).catch(() => null);
    if (managePy) return { type: 'Python (Django)', command: py, args: ['manage.py', 'runserver'], label: `${py} manage.py runserver`, needsInstall: false };
    if (pyproject) {
      const pyText = pyproject.toLowerCase();
      if (pyText.includes('fastapi')) return { type: 'Python (FastAPI)', command: py, args: entryPy ? [entryPy] : ['-m', 'uvicorn', 'main:app', '--reload'], label: 'FastAPI dev', needsInstall: false };
      if (pyText.includes('django')) return { type: 'Python (Django)', command: py, args: ['manage.py', 'runserver'], label: `${py} manage.py runserver`, needsInstall: false };
      if (pyText.includes('flask')) return { type: 'Python (Flask)', command: py, args: entryPy ? [entryPy] : ['-m', 'flask', 'run'], label: 'Flask dev', needsInstall: false };
      if (pyText.includes('streamlit')) return { type: 'Python (Streamlit)', command: 'streamlit', args: ['run', entryPy || 'app.py'], label: 'streamlit run', needsInstall: false };
      if (pyText.includes('uvicorn')) return { type: 'Python (uvicorn)', command: py, args: ['-m', 'uvicorn', 'main:app', '--reload'], label: `${py} -m uvicorn main:app --reload`, needsInstall: false };
    }
    if (entryContent) {
      const content = entryContent.toLowerCase();
      if (content.includes('flask')) return { type: 'Python (Flask)', command: py, args: [entryPy!], label: `${py} ${entryPy}`, needsInstall: false };
      if (content.includes('fastapi')) return { type: 'Python (FastAPI)', command: py, args: [entryPy!], label: `${py} ${entryPy}`, needsInstall: false };
      return { type: 'Python', command: py, args: [entryPy!], label: `${py} ${entryPy}`, needsInstall: false };
    }
  } catch { /* best-effort */ }

  // 6. Rust
  try {
    const cargoToml = await fsp.readFile(path.join(dir, 'Cargo.toml'), 'utf-8').catch(() => null);
    if (cargoToml) return { type: 'Rust', command: 'cargo', args: ['run'], label: 'cargo run', needsInstall: false };
  } catch { /* best-effort */ }

  // 7. .NET
  try {
    const entries = await fsp.readdir(dir).catch(() => []);
    const csproj = entries.find((f: string) => f.endsWith('.csproj'));
    if (csproj) return { type: '.NET', command: 'dotnet', args: ['run'], label: 'dotnet run', needsInstall: false };
    const sln = entries.find((f: string) => f.endsWith('.sln'));
    if (sln) return { type: '.NET Solution', command: 'dotnet', args: ['run'], label: 'dotnet run', needsInstall: false };
  } catch { /* best-effort */ }

  // 8. Docker Compose
  try {
    const dc = await fsp.readFile(path.join(dir, 'docker-compose.yml'), 'utf-8').catch(() => null)
      || await fsp.readFile(path.join(dir, 'docker-compose.yaml'), 'utf-8').catch(() => null);
    if (dc) return { type: 'Docker Compose', command: 'docker-compose', args: ['up'], label: 'docker-compose up', needsInstall: false };
  } catch { /* best-effort */ }

  // 9. Makefile-only
  try {
    const mf = await fsp.readFile(path.join(dir, 'Makefile'), 'utf-8').catch(() => null);
    if (mf && /^(run|dev|start|serve):/m.test(mf)) {
      const target = /^run:/m.test(mf) ? 'run' : /^dev:/m.test(mf) ? 'dev' : /^start:/m.test(mf) ? 'start' : 'serve';
      return { type: 'Makefile', command: 'make', args: [target], label: `make ${target}`, needsInstall: false };
    }
  } catch { /* best-effort */ }

  return null;
}

async function detectAndroidStartInfo(dir: string, fsp: any, path: any): Promise<ProjectStartInfo | null> {
  const appGradlePath = await firstExistingPath([
    path.join(dir, 'app', 'build.gradle.kts'),
    path.join(dir, 'app', 'build.gradle'),
  ], fsp);
  const manifestPath = path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml');
  const manifestExists = Boolean(await fsp.stat(manifestPath).catch(() => null));
  if (!appGradlePath || !manifestExists) return null;

  const gradleText = await fsp.readFile(appGradlePath, 'utf-8').catch(() => '');
  if (!/(com\.android\.application|com\.android\.library|android\s*\{)/.test(gradleText)) return null;

  const applicationId = extractAndroidApplicationId(gradleText);
  const sdkDir = await readAndroidSdkDir(dir, fsp, path);
  const wrapper = process.platform === 'win32'
    ? (await fsp.stat(path.join(dir, 'gradlew.bat')).catch(() => null) ? '.\\gradlew.bat' : 'gradle')
    : (await fsp.stat(path.join(dir, 'gradlew')).catch(() => null) ? './gradlew' : 'gradle');

  if (process.platform === 'win32') {
    const script = buildWindowsAndroidLaunchScript(wrapper, sdkDir, applicationId);
    return {
      type: 'Android (Gradle)',
      command: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      label: 'Android assembleDebug + install + launch',
      needsInstall: false,
      background: false,
    };
  }

  const script = buildUnixAndroidLaunchScript(wrapper, sdkDir, applicationId);
  return {
    type: 'Android (Gradle)',
    command: '/bin/sh',
    args: ['-lc', script],
    label: 'Android assembleDebug + install + launch',
    needsInstall: false,
    background: false,
  };
}

async function firstExistingPath(paths: string[], fsp: any): Promise<string | null> {
  for (const p of paths) {
    if (await fsp.stat(p).catch(() => null)) return p;
  }
  return null;
}

async function readAndroidSdkDir(dir: string, fsp: any, path: any): Promise<string> {
  const localProperties = await fsp.readFile(path.join(dir, 'local.properties'), 'utf-8').catch(() => '');
  const match = localProperties.match(/^sdk\.dir\s*=\s*(.+)$/m);
  if (!match) return '';
  return match[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\');
}

function extractAndroidApplicationId(gradleText: string): string {
  return gradleText.match(/\bapplicationId\s*=\s*["']([^"']+)["']/)?.[1]
    || gradleText.match(/\bnamespace\s*=\s*["']([^"']+)["']/)?.[1]
    || '';
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildWindowsAndroidLaunchScript(wrapper: string, sdkDir: string, applicationId: string): string {
  const sdkLiteral = sdkDir ? psQuote(sdkDir) : "($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT)";
  const packageLine = applicationId
    ? `if($deviceReady){ $component=(& $adb shell cmd package resolve-activity --brief ${psQuote(applicationId)} 2>$null | Select-Object -Last 1).Trim(); if($component -and $component -match '/'){ & $adb shell am start -n $component 2>$null | Out-Null } else { & $adb shell monkey -p ${psQuote(applicationId)} -c android.intent.category.LAUNCHER 1 *>$null }; Start-Sleep -Seconds 2; Write-Host 'Android launch requested: ${applicationId}'; & $adb shell dumpsys activity activities | Select-String 'topResumedActivity' | Select-Object -First 1 }`
    : '';
  return [
    "$ErrorActionPreference='Continue'",
    `$sdk=${sdkLiteral}`,
    "if(-not $sdk){ throw 'Android SDK not found. Set ANDROID_HOME or sdk.dir in local.properties.' }",
    '$env:ANDROID_HOME=$sdk; $env:ANDROID_SDK_ROOT=$sdk',
    "$adb=Join-Path $sdk 'platform-tools\\adb.exe'",
    "if(!(Test-Path $adb)){ throw \"adb not found: $adb\" }",
    "& $adb start-server | Out-Null",
    "if((& $adb devices) -match '\\toffline'){ & $adb reconnect offline | Out-Null }",
    "$deviceReady=((& $adb devices) -match '\\tdevice')",
    "if(-not $deviceReady){ $emu=Join-Path $sdk 'emulator\\emulator.exe'; if(Test-Path $emu){ $avds=@(& $emu -list-avds); $preferred=@('icloser_api35','test_avd'); $avd=($preferred | Where-Object { $avds -contains $_ } | Select-Object -First 1); if(-not $avd){ $avd=($avds | Select-Object -First 1) }; if($avd -and -not ((& $adb devices) -match '\\toffline')){ Write-Host \"Starting Android emulator $avd\"; Start-Process -FilePath $emu -ArgumentList @('-avd',$avd,'-no-snapshot-load','-no-audio','-no-boot-anim') -WindowStyle Hidden } } }",
    "for($i=0;$i -lt 75;$i++){ $deviceReady=((& $adb devices) -match '\\tdevice'); if($deviceReady){ break }; Start-Sleep -Seconds 2; Write-Host \"Waiting emulator online... ($i/75)\" }",
    "if(-not $deviceReady){ throw 'Android emulator did not become online. Check `adb devices`.' }",
    "for($i=0;$i -lt 90;$i++){ $boot=(& $adb shell getprop sys.boot_completed 2>$null | Out-String).Trim(); $pm=(& $adb shell pm path android 2>$null | Out-String).Trim(); if($boot -eq '1' -and $pm){ Write-Host 'Android system ready'; break }; Start-Sleep -Seconds 2; Write-Host \"Waiting Android boot/package manager... ($i/90)\" }",
    "$boot=(& $adb shell getprop sys.boot_completed 2>$null | Out-String).Trim(); $pm=(& $adb shell pm path android 2>$null | Out-String).Trim(); if($boot -ne '1' -or -not $pm){ throw 'Android device online but system services are not ready.' }",
    `& ${wrapper} assembleDebug`,
    'if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE }',
    "$apk=Get-ChildItem -Path 'app\\build\\outputs\\apk\\debug' -Filter '*debug*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if(-not $apk){ throw 'Debug APK not found under app\\build\\outputs\\apk\\debug' }",
    "& $adb install -r $apk.FullName",
    'if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE }',
    packageLine,
    'exit 0',
  ].filter(Boolean).join('; ');
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildUnixAndroidLaunchScript(wrapper: string, sdkDir: string, applicationId: string): string {
  const sdkExport = sdkDir
    ? `export ANDROID_HOME=${shQuote(sdkDir)}; export ANDROID_SDK_ROOT=${shQuote(sdkDir)}`
    : 'export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"; export ANDROID_SDK_ROOT="$ANDROID_HOME"';
  const launch = applicationId
    ? `if [ "$device_ready" = "1" ]; then component=$("$adb" shell cmd package resolve-activity --brief ${shQuote(applicationId)} 2>/dev/null | tail -n 1 | tr -d "\\r"); if echo "$component" | grep -q "/"; then "$adb" shell am start -n "$component" >/dev/null; else "$adb" shell monkey -p ${shQuote(applicationId)} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; fi; sleep 2; echo "Android launch requested: ${applicationId}"; "$adb" shell dumpsys activity activities | grep "topResumedActivity" | head -n 1 || true; fi`
    : '';
  return [
    'set -e',
    sdkExport,
    'if [ -z "$ANDROID_HOME" ]; then echo "Android SDK not found. Set ANDROID_HOME or sdk.dir."; exit 1; fi',
    'adb="$ANDROID_HOME/platform-tools/adb"',
    'if [ ! -x "$adb" ]; then echo "adb not found: $adb"; exit 1; fi',
    '"$adb" start-server >/dev/null',
    'device_ready=$("$adb" devices | grep -c "device$" || true)',
    'for i in $(seq 1 75); do device_ready=$("$adb" devices | grep -c "device$" || true); [ "$device_ready" != "0" ] && break; sleep 2; echo "Waiting emulator online... ($i/75)"; done',
    'if [ "$device_ready" = "0" ]; then echo "Android emulator did not become online. Check adb devices."; exit 1; fi',
    'for i in $(seq 1 90); do boot=$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r"); pm=$("$adb" shell pm path android 2>/dev/null || true); if [ "$boot" = "1" ] && [ -n "$pm" ]; then echo "Android system ready"; break; fi; sleep 2; echo "Waiting Android boot/package manager... ($i/90)"; done',
    'boot=$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r"); pm=$("$adb" shell pm path android 2>/dev/null || true); if [ "$boot" != "1" ] || [ -z "$pm" ]; then echo "Android device online but system services are not ready."; exit 1; fi',
    `${wrapper} assembleDebug`,
    'apk=$(find app/build/outputs/apk/debug -name "*debug*.apk" | head -n 1)',
    'if [ -z "$apk" ]; then echo "Debug APK not found under app/build/outputs/apk/debug"; exit 1; fi',
    '"$adb" install -r "$apk"',
    launch,
    'exit 0',
  ].filter(Boolean).join('; ');
}
