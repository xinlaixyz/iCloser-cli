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
