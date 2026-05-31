#!/usr/bin/env bash
# ============================================================
#  icloser Agent Shell — macOS 一键安装器
#  单文件分发，自动处理所有依赖
#
#  用法:
#    chmod +x install-macos.sh
#    ./install-macos.sh
#
#  卸载:
#    ./install-macos.sh --uninstall
# ============================================================
set -e

VERSION="0.1.0"
UNINSTALL=false
INSTALL_DIR="$HOME/.icloser"
BIN_DIR="/usr/local/bin"

# Colors
RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'
BLUE='\033[34m'; CYAN='\033[36m'; GRAY='\033[90m'
BOLD='\033[1m'; NC='\033[0m'

step()  { echo -e "  ${YELLOW}·${NC} $1"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info()  { echo -e "    ${GRAY}$1${NC}"; }

[[ "$1" == "--uninstall" || "$1" == "-u" ]] && UNINSTALL=true

# ============================================================
# UNINSTALL
# ============================================================
if $UNINSTALL; then
    echo -e "\n${BLUE}icloser Agent Shell · 卸载${NC}\n"
    # Remove global bins
    for bin in ic icloser; do
        if [ -f "$BIN_DIR/$bin" ]; then
            sudo rm -f "$BIN_DIR/$bin" && ok "已移除 $BIN_DIR/$bin" || info "跳过 $bin"
        fi
    done
    # Remove npm global
    npm uninstall -g icloser 2>/dev/null && ok "已移除 npm 全局包" || true
    # Remove install dir
    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
        ok "已清除 $INSTALL_DIR"
    fi
    # Remove config
    if [ -d "$HOME/.icloser" ]; then
        rm -rf "$HOME/.icloser"
        ok "已清除 $HOME/.icloser"
    fi
    echo -e "\n  ${GREEN}卸载完成${NC}\n"
    exit 0
fi

# ============================================================
# HEADER
# ============================================================
clear 2>/dev/null || true
echo ""
echo -e "  ${CYAN}╭──────────────────────────────────────────────────────╮${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}icloser Agent Shell${NC}  v${VERSION}                              ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  AI 工程执行 CLI · macOS 一键安装                      ${CYAN}│${NC}"
echo -e "  ${CYAN}╰──────────────────────────────────────────────────────╯${NC}"
echo ""

# ============================================================
# 1. macOS CHECK
# ============================================================
step "检查系统环境..."
OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
    err "此安装器仅适用于 macOS。Linux 请使用 install.sh"
fi
MACOS_VER="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
ok "macOS $MACOS_VER"

# ============================================================
# 2. NODE.JS
# ============================================================
step "检查 Node.js..."
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -lt 18 ]; then
        err "Node.js >= 18 需要，当前 $NODE_VERSION"
    fi
    ok "Node.js $NODE_VERSION (系统)"
else
    info "未检测到 Node.js，正在安装..."
    if command -v brew &>/dev/null; then
        info "通过 Homebrew 安装 Node.js..."
        brew install node 2>/dev/null || err "brew install node 失败"
        ok "Node.js $(node --version)"
    else
        info "Homebrew 未安装。正在安装 Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        info "通过 Homebrew 安装 Node.js..."
        brew install node 2>/dev/null || err "brew install node 失败"
        ok "Node.js $(node --version)"
    fi
fi

# ============================================================
# 3. INSTALL icloser
# ============================================================
step "安装 icloser Agent Shell..."

# Use local project directory (this script is inside the project)
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$LOCAL_DIR/package.json" ]; then
    err "未找到 package.json。请确保此脚本在项目根目录运行。"
fi
cd "$LOCAL_DIR"
if [ ! -d "node_modules" ]; then
    info "安装依赖..."
    npm install --no-audit --no-fund --loglevel=error
fi
if [ ! -d "dist" ]; then
    info "编译..."
    npx tsc
fi
ok "项目就绪: $LOCAL_DIR"

# ============================================================
# 4. GLOBAL LINK
# ============================================================
step "全局注册 ic 命令..."

# Method 1: npm link
if npm link 2>/dev/null; then
    ok "ic 命令已全局注册 (npm link)"
else
    # Method 2: symlink
    info "npm link 需要权限，创建 symlink..."
    IC_PATH="$(pwd)/dist/index.js"
    sudo ln -sf "$IC_PATH" "$BIN_DIR/ic" 2>/dev/null || {
        # Method 3: wrapper script
        info "创建 wrapper 脚本..."
        mkdir -p "$HOME/bin"
        cat > "$HOME/bin/ic" << WRAPPER
#!/usr/bin/env bash
exec node "$IC_PATH" "\$@"
WRAPPER
        chmod +x "$HOME/bin/ic"
        echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.zshrc"
        echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bash_profile"
        export PATH="$HOME/bin:$PATH"
        ok "ic 命令已注册到 ~/bin/ic (请重启终端或 source ~/.zshrc)"
    }
    # icloser alias
    if [ -f "$BIN_DIR/ic" ]; then
        sudo ln -sf "$BIN_DIR/ic" "$BIN_DIR/icloser" 2>/dev/null || true
    fi
fi

# ============================================================
# 5. VERIFY
# ============================================================
step "验证安装..."
if command -v ic &>/dev/null; then
    IC_VER=$(ic --version 2>/dev/null || echo "ok")
    ok "ic 命令可用 ($IC_VER)"
else
    info "ic 命令未在 PATH 中"
    info "请运行: export PATH=\"$(pwd):\$PATH\""
    info "或添加到 ~/.zshrc: echo 'export PATH=\"$(pwd):\$PATH\"' >> ~/.zshrc"
fi

# ============================================================
# 6. FIRST RUN GUIDE
# ============================================================
echo ""
echo -e "  ${CYAN}╭─ 安装完成 ────────────────────────────────────────╮${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic setup${NC}        首次配置 AI 服务              ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic init${NC}         初始化项目                    ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic${NC}             启动对话 REPL                 ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic --help${NC}      查看所有命令                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic doctor${NC}      诊断项目状态                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  卸载: ${GRAY}./install-macos.sh --uninstall${NC}          ${CYAN}│${NC}"
echo -e "  ${CYAN}╰──────────────────────────────────────────────────╯${NC}"
echo ""
echo -e "  ${GRAY}文档: docs/DEVELOPER_GUIDE.md${NC}"
echo -e "  ${GRAY}项目: $REPO${NC}"
echo ""
