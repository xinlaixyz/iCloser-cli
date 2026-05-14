#!/usr/bin/env bash
# iCloser Agent Shell — Linux/macOS 安装脚本
# 用法：chmod +x install.sh && ./install.sh

set -e

echo ""
echo -e "\033[34miCloser Agent Shell 安装程序\033[0m"
echo ""

# 检查 Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "\033[32m[✓] Node.js $NODE_VERSION\033[0m"
else
    echo -e "\033[31m[✗] 未检测到 Node.js，请先安装 https://nodejs.org\033[0m"
    exit 1
fi

# 安装依赖
echo -e "\033[33m[·] 安装依赖...\033[0m"
npm install --no-audit --no-fund

# 构建
echo -e "\033[33m[·] 构建项目...\033[0m"
npx tsc

# 全局链接
echo -e "\033[33m[·] 全局链接...\033[0m"
npm link

echo ""
echo -e "\033[32m[✓] 安装完成！\033[0m"
echo ""
echo -e "运行 \033[36mic setup\033[0m 完成初始化配置"
echo -e "运行 \033[36mic --help\033[0m 查看所有命令"
echo -e "\033[90m也可使用 iCloser 命令（兼容旧习惯）\033[0m"
echo ""
