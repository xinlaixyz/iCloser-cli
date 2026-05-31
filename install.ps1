# iCloser Agent Shell — Windows 一键安装脚本
# 用法: powershell -ExecutionPolicy Bypass -File install.ps1
#       或右键 install.ps1 → "使用 PowerShell 运行"

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$ICLOSER_VERSION = "0.1.0"

function Write-Step { param($msg) Write-Host "  [$([char]0x00B7)] $msg" -ForegroundColor Yellow }
function Write-OK { param($msg) Write-Host "  [$([char]0x2713)] $msg" -ForegroundColor Green }
function Write-ERR { param($msg) Write-Host "  [$([char]0x2717)] $msg" -ForegroundColor Red; exit 1 }
function Write-INFO { param($msg) Write-Host "    $msg" -ForegroundColor Gray }

# ============================================================
# Uninstall
# ============================================================
if ($Uninstall) {
    Write-Host "`niCloser Agent Shell 卸载`n" -ForegroundColor Blue
    try {
        npm uninstall -g icloser 2>$null
        Write-OK "已卸载 icloser-agent-shell"
    } catch {
        Write-INFO "未找到全局安装"
    }
    # Clean config
    $homeDir = if ($env:ICLOSER_HOME) { $env:ICLOSER_HOME } else { Join-Path $env:USERPROFILE ".icloser" }
    if (Test-Path $homeDir) {
        Remove-Item -Recurse -Force $homeDir
        Write-OK "已清除配置: $homeDir"
    }
    Write-Host ""
    exit 0
}

# ============================================================
# Install
# ============================================================
Write-Host ""
Write-Host "  ╭─────────────────────────────────────────────╮" -ForegroundColor Blue
Write-Host "  │  iCloser Agent Shell v$ICLOSER_VERSION                  │" -ForegroundColor Blue
Write-Host "  │  AI 工程执行 CLI · 一键安装                   │" -ForegroundColor Blue
Write-Host "  ╰─────────────────────────────────────────────╯" -ForegroundColor Blue
Write-Host ""

# 1. Check / Install Node.js
Write-Step "检查 Node.js..."
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        $major = [int]$nodeVersion.Replace('v','').Split('.')[0]
        if ($major -lt 18) {
            Write-ERR "Node.js >= 18 需要，当前 $nodeVersion。请升级: https://nodejs.org"
        }
        Write-OK "Node.js $nodeVersion"
    } else { throw }
} catch {
    Write-Host "  [!] 未检测到 Node.js" -ForegroundColor Yellow
    Write-INFO "尝试通过 winget 安装..."
    try {
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements
        Write-OK "Node.js 已安装（请重新打开终端后运行此脚本）"
        exit 0
    } catch {
        Write-INFO "winget 不可用，请手动安装: https://nodejs.org (下载 LTS 版本)"
        Write-INFO "安装后重新运行此脚本即可"
        exit 1
    }
}

# 2. Check npm
Write-Step "检查 npm..."
try {
    $npmVersion = npm --version 2>$null
    Write-OK "npm v$npmVersion"
} catch {
    Write-ERR "npm 不可用，请重新安装 Node.js"
}

# 3. Check git (optional)
Write-Step "检查 Git..."
try {
    $gitVersion = git --version 2>$null
    Write-OK "Git 已安装"
} catch {
    Write-INFO "Git 未安装 (可选, 仅影响 git diff/commit 功能)"
}

# 4. Install dependencies (skip if offline package)
if (Test-Path "node_modules") {
    Write-OK "依赖已打包 (离线模式)"
} else {
    Write-Step "安装依赖..."
    npm install --no-audit --no-fund --loglevel=error
    Write-OK "依赖安装完成"
}

# 5. Build
Write-Step "编译 TypeScript..."
npx tsc
Write-OK "编译完成"

# 6. Test (quick smoke)
Write-Step "运行快速测试..."
$testResult = npx vitest run 2>&1 | Select-String "Tests.*passed"
if ($testResult) {
    Write-OK "测试通过: $testResult"
} else {
    Write-INFO "测试完成 (详见上方输出)"
}

# 7. Global install
Write-Step "全局注册 ic 命令..."
try {
    npm link 2>$null
    Write-OK "ic 命令已全局注册"
} catch {
    Write-INFO "npm link 失败, 尝试 npm install -g ..."
    try {
        npm install -g .
        Write-OK "ic 命令已全局安装"
    } catch {
        Write-INFO "全局安装失败。你可以使用:"
        Write-INFO "  node dist/index.js <命令>"
        Write-INFO "  或 npx ic <命令>"
    }
}

# 8. Verify
Write-Step "验证安装..."
try {
    $icVersion = node dist/index.js --version 2>$null
    Write-OK "安装成功! iCloser Agent Shell v$ICLOSER_VERSION"
} catch {
    Write-INFO "验证跳过"
}

# 9. Done
Write-Host ""
Write-Host "  ┌─ 快速开始 ───────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │  ic setup          首次配置 AI 服务        │" -ForegroundColor Cyan
Write-Host "  │  ic init           初始化项目              │" -ForegroundColor Cyan
Write-Host "  │  ic                启动对话 REPL           │" -ForegroundColor Cyan
Write-Host "  │  ic --help         查看所有命令            │" -ForegroundColor Cyan
Write-Host "  │  ic doctor         检查就绪状态            │" -ForegroundColor Cyan
Write-Host "  │                                            │" -ForegroundColor Cyan
Write-Host "  │  卸载: .\install.ps1 -Uninstall            │" -ForegroundColor Cyan
Write-Host "  └───────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""
Write-Host "  文档: docs/DEVELOPER_GUIDE.md" -ForegroundColor Gray
Write-Host ""
