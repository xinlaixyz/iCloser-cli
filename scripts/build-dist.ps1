# Build macOS + Windows offline distributable packages
# Usage: powershell -File scripts/build-dist.ps1
# Output: out/icloser-macos.zip + out/icloser-windows.zip

$ROOT = (Get-Location).Path
$PKG = Get-Content "$ROOT\package.json" | ConvertFrom-Json
$VERSION = $PKG.version
$NAME = "icloser-v$VERSION"
$OUT = "$ROOT\out"
$BUNDLE = "$OUT\$NAME"

Write-Host ""
Write-Host "  Building distributable packages v$VERSION" -ForegroundColor Cyan
Write-Host ""

# 1. Build
Write-Host "  [1/4] Compiling TypeScript..." -ForegroundColor Yellow
Push-Location $ROOT; npx tsc 2>&1 | Out-Null; Pop-Location
Write-Host "        ✓ dist/" -ForegroundColor Green

# 2. Prepare bundle
Write-Host "  [2/4] Preparing bundle..." -ForegroundColor Yellow
if (Test-Path $BUNDLE) { Remove-Item -Recurse -Force $BUNDLE }
New-Item -ItemType Directory -Force -Path $BUNDLE | Out-Null

Copy-Item -Recurse "$ROOT\dist" "$BUNDLE\dist" -Force
Copy-Item -Recurse "$ROOT\node_modules" "$BUNDLE\node_modules" -Force
if (Test-Path "$ROOT\skills") { Copy-Item -Recurse "$ROOT\skills" "$BUNDLE\skills" -Force }
if (Test-Path "$ROOT\templates") { Copy-Item -Recurse "$ROOT\templates" "$BUNDLE\templates" -Force }
Copy-Item "$ROOT\package.json" "$BUNDLE\" -Force

# Create Mac launcher
@"
#!/usr/bin/env bash
# icloser Agent Shell v$VERSION — 离线运行
# 用法: ./ic [命令]
DIR="`$(cd "`$(dirname "`$0")" && pwd)"
export NODE_PATH="`$DIR/node_modules:`$NODE_PATH"
exec node "`$DIR/dist/index.js" "`$@"
"@ | Set-Content -Path "$BUNDLE\ic" -Encoding UTF8 -NoNewline

# Create Windows launcher
@"
@echo off
set "DIR=%~dp0"
set "NODE_PATH=%DIR%node_modules;%NODE_PATH%"
node "%DIR%dist\index.js" %*
"@ | Set-Content -Path "$BUNDLE\ic.cmd" -Encoding ASCII -NoNewline

# Copy install scripts
Copy-Item "$ROOT\install.sh" "$BUNDLE\macos-install.sh" -Force
Copy-Item "$ROOT\install.ps1" "$BUNDLE\windows-install.ps1" -Force

Write-Host "        ✓ bundle ready" -ForegroundColor Green

# 3. Create Mac zip
Write-Host "  [3/4] Creating macOS package..." -ForegroundColor Yellow
$MAC_ZIP = "$OUT\$NAME-macos.zip"
if (Test-Path $MAC_ZIP) { Remove-Item $MAC_ZIP }
Compress-Archive -Path "$BUNDLE\*" -DestinationPath $MAC_ZIP -Force
$macSize = [math]::Round((Get-Item $MAC_ZIP).Length / 1MB, 1)
Write-Host "        ✓ $MAC_ZIP ($macSize MB)" -ForegroundColor Green

# 4. Create Windows zip
Write-Host "  [4/4] Creating Windows package..." -ForegroundColor Yellow
$WIN_ZIP = "$OUT\$NAME-windows.zip"
if (Test-Path $WIN_ZIP) { Remove-Item $WIN_ZIP }
Compress-Archive -Path "$BUNDLE\*" -DestinationPath $WIN_ZIP -Force
$winSize = [math]::Round((Get-Item $WIN_ZIP).Length / 1MB, 1)
Write-Host "        ✓ $WIN_ZIP ($winSize MB)" -ForegroundColor Green

# Clean bundle dir
Remove-Item -Recurse -Force $BUNDLE

# Summary
Write-Host ""
Write-Host "  ┌─ Packages Ready ──────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │                                                        │" -ForegroundColor Cyan
Write-Host "  │  发给 Mac 同学:                                        │" -ForegroundColor Cyan
Write-Host "  │    $MAC_ZIP              │" -ForegroundColor Cyan
Write-Host "  │                                                        │" -ForegroundColor Cyan
Write-Host "  │  Mac 同学使用:                                         │" -ForegroundColor Cyan
Write-Host "  │    1. 解压 $NAME-macos.zip                       │" -ForegroundColor Cyan
Write-Host "  │    2. cd $NAME                                      │" -ForegroundColor Cyan
Write-Host "  │    3. chmod +x ic macos-install.sh                     │" -ForegroundColor Cyan
Write-Host "  │    4. ./ic                                             │" -ForegroundColor Cyan
Write-Host "  │       (或 ./macos-install.sh 全局安装)                 │" -ForegroundColor Cyan
Write-Host "  │                                                        │" -ForegroundColor Cyan
Write-Host "  │  发给 Windows 同学:                                    │" -ForegroundColor Cyan
Write-Host "  │    $WIN_ZIP           │" -ForegroundColor Cyan
Write-Host "  │                                                        │" -ForegroundColor Cyan
Write-Host "  │  Windows 同学使用:                                     │" -ForegroundColor Cyan
Write-Host "  │    1. 解压 $NAME-windows.zip                     │" -ForegroundColor Cyan
Write-Host "  │    2. 双击 ic.cmd 或运行 windows-install.ps1            │" -ForegroundColor Cyan
Write-Host "  │                                                        │" -ForegroundColor Cyan
Write-Host "  └────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""
