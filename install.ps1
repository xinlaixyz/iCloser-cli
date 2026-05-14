# iCloser Agent Shell — Windows 安装脚本
# 用法：.\install.ps1

Write-Host "`niCloser Agent Shell 安装程序`n" -ForegroundColor Blue

# 检查 Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "[✓] Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[✗] 未检测到 Node.js，请先安装 https://nodejs.org" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host "[·] 安装依赖..." -ForegroundColor Yellow
npm install --no-audit --no-fund

# 构建
Write-Host "[·] 构建项目..." -ForegroundColor Yellow
npx tsc

# 全局链接
Write-Host "[·] 全局链接..." -ForegroundColor Yellow
npm link

Write-Host ""
Write-Host "[✓] 安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "运行 ic setup 完成初始化配置" -ForegroundColor Cyan
Write-Host "运行 ic --help 查看所有命令" -ForegroundColor Cyan
Write-Host "也可使用 iCloser 命令（兼容旧习惯）" -ForegroundColor DarkGray
Write-Host ""
