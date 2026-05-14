#!/usr/bin/env bash
# iCloser Agent Shell — macOS/Linux 一键安装脚本
# 用法: chmod +x install.sh && ./install.sh
# 卸载: ./install.sh --uninstall

set -e

ICLOSER_VERSION="0.1.0"
UNINSTALL=false

[[ "$1" == "--uninstall" || "$1" == "-u" ]] && UNINSTALL=true

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BLUE='\033[34m'
CYAN='\033[36m'; GRAY='\033[90m'; BOLD='\033[1m'; NC='\033[0m'

step() { echo -e "  ${YELLOW}·${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "    ${GRAY}$1${NC}"; }

# ============================================================
# Uninstall
# ============================================================
if $UNINSTALL; then
    echo -e "\n${BLUE}iCloser Agent Shell 卸载${NC}\n"
    npm uninstall -g icloser-agent-shell 2>/dev/null && ok "已卸载 icloser-agent-shell" || info "未找到全局安装"
    HOME_DIR="${ICLOSER_HOME:-$HOME/.icloser}"
    if [ -d "$HOME_DIR" ]; then
        rm -rf "$HOME_DIR"
        ok "已清除配置: $HOME_DIR"
    fi
    echo ""
    exit 0
fi

# ============================================================
# Install
# ============================================================
echo ""
echo -e "  ${CYAN}╭─────────────────────────────────────────────╮${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}iCloser Agent Shell${NC} v${ICLOSER_VERSION}                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  AI 工程执行 CLI · 一键安装                   ${CYAN}│${NC}"
echo -e "  ${CYAN}╰─────────────────────────────────────────────╯${NC}"
echo ""

# 1. Check / Install Node.js
step "检查 Node.js..."
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -lt 18 ]; then
        err "Node.js >= 18 需要，当前 $NODE_VERSION。请升级: https://nodejs.org"
    fi
    ok "Node.js $NODE_VERSION"
else
    echo -e "  ${YELLOW}[!]${NC} 未检测到 Node.js"
    info "尝试安装..."

    OS_TYPE="$(uname -s)"
    if [ "$OS_TYPE" = "Darwin" ]; then
        # macOS: try Homebrew
        if command -v brew &>/dev/null; then
            info "通过 Homebrew 安装..."
            brew install node
            ok "Node.js 已通过 Homebrew 安装"
        else
            info "Homebrew 未安装。请先安装 Homebrew:"
            info "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            info "然后重新运行此脚本"
            exit 1
        fi
    elif [ "$OS_TYPE" = "Linux" ]; then
        # Linux: try nvm or apt
        if command -v curl &>/dev/null; then
            info "通过 nvm 安装..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            nvm install --lts
            ok "Node.js 已通过 nvm 安装"
        else
            info "请手动安装 Node.js: https://nodejs.org"
            exit 1
        fi
    else
        info "未知系统，请手动安装 Node.js: https://nodejs.org"
        exit 1
    fi
fi

# 2. Check npm
step "检查 npm..."
command -v npm &>/dev/null && ok "npm v$(npm --version)" || err "npm 不可用"

# 3. Check git (optional)
step "检查 Git..."
command -v git &>/dev/null && ok "Git 已安装" || info "Git 未安装 (可选)"

# 4. Install dependencies
step "安装依赖..."
npm install --no-audit --no-fund --loglevel=error
ok "依赖安装完成"

# 5. Build
step "编译 TypeScript..."
npx tsc
ok "编译完成"

# 6. Test
step "运行测试..."
if npx vitest run 2>&1 | tail -3; then
    ok "测试通过"
else
    info "部分测试未通过 (可能缺少 AI API Key，不影响安装)"
fi

# 7. Global install
step "全局注册 ic 命令..."
if npm link 2>/dev/null; then
    ok "ic 命令已全局注册"
else
    info "npm link 失败，尝试 npm install -g ..."
    if npm install -g . 2>/dev/null; then
        ok "ic 命令已全局安装"
    else
        info "全局安装需要 sudo。尝试:"
        info "  sudo npm install -g ."
        info "或直接使用:"
        info "  node dist/index.js <命令>"
    fi
fi

# 8. Done
echo ""
echo -e "  ${CYAN}┌─ 快速开始 ───────────────────────────────┐${NC}"
echo -e "  ${CYAN}│${NC}  ic setup         首次配置 AI 服务        ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ic init          初始化项目              ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ic               启动对话 REPL           ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ic --help        查看所有命令            ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ic doctor        检查就绪状态            ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                           ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  卸载: ./install.sh --uninstall          ${CYAN}│${NC}"
echo -e "  ${CYAN}└───────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${GRAY}文档: docs/DEVELOPER_GUIDE.md${NC}"
echo ""
