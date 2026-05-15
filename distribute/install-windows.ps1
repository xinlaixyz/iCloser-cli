# iCloser Agent Shell — Windows 一键安装器
# 单文件分发。右键 → "使用 PowerShell 运行"
# 卸载: .\install-windows.ps1 -Uninstall

param([switch]$Uninstall)

$VERSION = "0.1.0"
$REPO = "https://github.com/icloser/agent-shell"
$INSTALL_DIR = "$env:USERPROFILE\.icloser"
$ErrorActionPreference = "Stop"

function w-step { param($m) Write-Host "  · $m" -ForegroundColor Yellow }
function w-ok   { param($m) Write-Host "  ✓ $m" -ForegroundColor Green }
function w-err  { param($m) Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }
function w-info { param($m) Write-Host "    $m" -ForegroundColor Gray }

if ($Uninstall) {
    Write-Host "`niCloser Agent Shell · 卸载`n" -ForegroundColor Blue
    npm uninstall -g icloser-agent-shell 2>$null
    if (Test-Path $INSTALL_DIR) { Remove-Item -Recurse -Force $INSTALL_DIR }
    $homeDir = Join-Path $env:USERPROFILE ".icloser"
    if (Test-Path $homeDir) { Remove-Item -Recurse -Force $homeDir }
    Write-Host "  卸载完成`n" -ForegroundColor Green
    exit 0
}

Clear-Host 2>$null
Write-Host ""
Write-Host "  iCloser Agent Shell v$VERSION  —  Windows 一键安装" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js
w-step "检查 Node.js..."
try {
    $nv = node --version 2>$null
    if ([int]($nv -replace 'v','').Split('.')[0] -lt 18) { w-err "Node.js >= 18 需要" }
    w-ok "Node.js $nv"
} catch {
    w-info "未检测到 Node.js，尝试 winget 安装..."
    try {
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements
        w-ok "Node.js 已安装。请重新打开终端并运行此脚本"
        exit 0
    } catch {
        w-info "请手动安装: https://nodejs.org"
        exit 1
    }
}

# 2. Install
w-step "安装 iCloser Agent Shell..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $scriptDir "package.json")) {
    w-info "检测到本地项目"
    cd $scriptDir
    if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund --loglevel=error }
    if (-not (Test-Path "dist")) { npx tsc }
    w-ok "本地项目就绪"
} else {
    if (Test-Path $INSTALL_DIR) { Remove-Item -Recurse -Force $INSTALL_DIR }
    git clone --depth 1 $REPO $INSTALL_DIR
    cd $INSTALL_DIR
    npm install --no-audit --no-fund --loglevel=error
    npx tsc
    w-ok "项目安装完成: $INSTALL_DIR"
}

# 3. Global link
w-step "全局注册 ic 命令..."
try { npm link 2>$null; w-ok "ic 命令已全局注册" }
catch {
    w-info "尝试 npm install -g ..."
    try { npm install -g .; w-ok "ic 命令已全局安装" }
    catch { w-info "请手动添加 PATH: $(Get-Location)" }
}

# 4. Done
Write-Host ""
Write-Host "  ┌─ 快速开始 ───────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │  ic setup    首次配置 AI 服务              │" -ForegroundColor Cyan
Write-Host "  │  ic init     初始化项目                    │" -ForegroundColor Cyan
Write-Host "  │  ic          启动对话 REPL                 │" -ForegroundColor Cyan
Write-Host "  │  ic --help   查看所有命令                  │" -ForegroundColor Cyan
Write-Host "  │  卸载: .\install-windows.ps1 -Uninstall   │" -ForegroundColor Cyan
Write-Host "  └───────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""
