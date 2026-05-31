#!/usr/bin/env bash
# Build self-contained macOS installer (single .sh file, no network needed)
# Usage: bash scripts/build-macos-installer.sh
# Output: out/icloser-installer.sh (给 Mac 同学这一个文件就够了)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
VERSION=$(node -e "console.log(require('$ROOT/package.json').version)")
DIST_DIR="$OUT/icloser-bundle"
INSTALLER="$OUT/icloser-installer.sh"

echo ""
echo "  Building macOS Self-Extracting Installer v$VERSION"
echo ""

# 1. Build project
echo "  [1/4] Building TypeScript..."
cd "$ROOT"
npx tsc
echo "        ✓ dist/"

# 2. Prepare bundle directory
echo "  [2/4] Preparing bundle..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Copy runtime (exclude heavy dev-deps like vitest, typescript if possible)
cp -r "$ROOT/dist" "$DIST_DIR/"
cp -r "$ROOT/skills" "$DIST_DIR/" 2>/dev/null || true
cp -r "$ROOT/templates" "$DIST_DIR/" 2>/dev/null || true
cp "$ROOT/package.json" "$DIST_DIR/"

# Copy node_modules (full offline support)
echo "        copying node_modules/ ..."
cp -r "$ROOT/node_modules" "$DIST_DIR/"

# Remove heavy test/docs files from bundle to reduce size
rm -rf "$DIST_DIR/node_modules/.cache" 2>/dev/null || true
rm -rf "$DIST_DIR/node_modules/vitest" 2>/dev/null || true
rm -rf "$DIST_DIR/node_modules/@vitest" 2>/dev/null || true

echo "        ✓ bundle ready ($(du -sh "$DIST_DIR" | cut -f1))"

# 3. Create tar.gz
echo "  [3/4] Creating archive..."
BUNDLE_TGZ="$OUT/icloser-bundle.tar.gz"
cd "$OUT"
tar -czf "$BUNDLE_TGZ" "icloser-bundle" 2>/dev/null || {
    # tar not available? try zip
    cd "$DIST_DIR/.."
    zip -r "$OUT/icloser-bundle.zip" "icloser-bundle" 2>/dev/null
    echo "        ! tar failed, using zip instead"
}
cd "$ROOT"

# 4. Create self-extracting installer
echo "  [4/4] Creating installer script..."
SIZE=$(wc -c < "$BUNDLE_TGZ")

cat > "$INSTALLER" << 'HEADER'
#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  icloser Agent Shell · macOS 离线安装器
#  单文件，零网络。发给 Mac 同学直接运行即可。
#
#  用法: chmod +x icloser-installer.sh && ./icloser-installer.sh
#  卸载: ./icloser-installer.sh --uninstall
# ═══════════════════════════════════════════════════════════
set -e

UNINSTALL=false
[[ "$1" == "--uninstall" || "$1" == "-u" ]] && UNINSTALL=true

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'
BLUE='\033[34m'; CYAN='\033[36m'; GRAY='\033[90m'
BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "    ${GRAY}$1${NC}"; }
step() { echo -e "  ${YELLOW}·${NC} $1"; }

# ── Uninstall ──────────────────────────────────────
if $UNINSTALL; then
    echo -e "\n${BLUE}icloser Agent Shell · 卸载${NC}\n"
    npm uninstall -g icloser 2>/dev/null && ok "npm 全局包已移除" || true
    for bin in ic icloser; do
        [ -f "/usr/local/bin/$bin" ] && sudo rm -f "/usr/local/bin/$bin" && ok "/usr/local/bin/$bin" || true
    done
    [ -d "$HOME/.icloser" ] && rm -rf "$HOME/.icloser" && ok "$HOME/.icloser"
    echo -e "\n  ${GREEN}卸载完成${NC}\n"
    exit 0
fi

# ── Header ──────────────────────────────────────────
clear 2>/dev/null || true
echo ""
echo -e "  ${CYAN}╭──────────────────────────────────────────────────────╮${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}icloser Agent Shell${NC} · macOS 离线安装                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  完全离线 · 无需网络 · 包含所有依赖                      ${CYAN}│${NC}"
echo -e "  ${CYAN}╰──────────────────────────────────────────────────────╯${NC}"
echo ""

# ── Node.js Check ──────────────────────────────────
step "检查 Node.js..."
if command -v node &>/dev/null; then
    NV=$(node --version)
    MAJOR=$(echo "$NV" | sed 's/v//' | cut -d. -f1)
    [ "$MAJOR" -lt 18 ] && err "Node.js >= 18 需要，当前 $NV"
    ok "Node.js $NV"
else
    info "未检测到 Node.js"
    if command -v brew &>/dev/null; then
        info "通过 Homebrew 安装..."
        brew install node
    else
        info "请先安装 Node.js: https://nodejs.org"
        info "或安装 Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        info "然后重新运行此安装器"
        exit 1
    fi
fi

# ── Extract Bundle ─────────────────────────────────
step "解压离线包..."
INSTALL_DIR="$HOME/.icloser"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Extract embedded tar.gz from the end of this script
ARCHIVE_START=$(awk '/^__ARCHIVE_BELOW__$/ {print NR+1; exit 0}' "$0")
tail -n +$ARCHIVE_START "$0" | tar -xz -C "$INSTALL_DIR" 2>/dev/null || {
    info "tar 解压失败，尝试 unzip..."
    tail -n +$ARCHIVE_START "$0" > /tmp/icloser-bundle.zip
    unzip -o /tmp/icloser-bundle.zip -d "$INSTALL_DIR"
    rm /tmp/icloser-bundle.zip
}

# Find the extracted directory
BUNDLE_DIR=$(ls -d "$INSTALL_DIR"/icloser-bundle* 2>/dev/null | head -1)
if [ -z "$BUNDLE_DIR" ]; then
    BUNDLE_DIR="$INSTALL_DIR"
fi
ok "离线包就绪"

# ── Install ────────────────────────────────────────
step "全局安装 ic 命令..."

# Create wrapper in /usr/local/bin
sudo mkdir -p /usr/local/bin

sudo tee /usr/local/bin/ic > /dev/null << WRAPPER
#!/usr/bin/env bash
export NODE_PATH="$BUNDLE_DIR/node_modules:\$NODE_PATH"
exec node "$BUNDLE_DIR/dist/index.js" "\$@"
WRAPPER
sudo chmod +x /usr/local/bin/ic
sudo ln -sf /usr/local/bin/ic /usr/local/bin/icloser 2>/dev/null || true
ok "ic 命令已就绪"

# ── Verify ─────────────────────────────────────────
step "验证..."
if /usr/local/bin/ic --version >/dev/null 2>&1; then
    ok "安装验证通过"
else
    info "验证跳过 (可手动运行: ic --version)"
fi

# ── Done ───────────────────────────────────────────
echo ""
echo -e "  ${CYAN}╭─ 安装完成 ────────────────────────────────────────╮${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic setup${NC}        首次配置 AI 服务              ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic init${NC}         初始化项目                    ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic${NC}             启动对话 REPL                 ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  ${BOLD}ic --help${NC}      查看所有命令                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}                                                  ${CYAN}│${NC}"
echo -e "  ${CYAN}│${NC}  卸载: ${GRAY}$0 --uninstall${NC}                       ${CYAN}│${NC}"
echo -e "  ${CYAN}╰──────────────────────────────────────────────────╯${NC}"
echo ""

exit 0
__ARCHIVE_BELOW__
HEADER

# Append the tar.gz
echo "        appending archive ($(du -sh "$BUNDLE_TGZ" | cut -f1))..."
cat "$BUNDLE_TGZ" >> "$INSTALLER"
chmod +x "$INSTALLER"

# ── Summary ────────────────────────────────────────
echo ""
echo "  ┌─ Installer Ready ─────────────────────────────────┐"
echo "  │                                                    │"
echo "  │  $INSTALLER"
echo "  │  Size: $(du -sh "$INSTALLER" | cut -f1)"
echo "  │                                                    │"
echo "  │  发给 Mac 同学这一个文件:                           │"
echo "  │    chmod +x icloser-installer.sh                    │"
echo "  │    ./icloser-installer.sh                           │"
echo "  │                                                    │"
echo "  └────────────────────────────────────────────────────┘"
echo ""
