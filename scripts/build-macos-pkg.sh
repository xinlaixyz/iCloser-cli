#!/usr/bin/env bash
# Build macOS .pkg installer
# 必须在 macOS 上运行。用法: bash scripts/build-macos-pkg.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_NAME="icloser-agent-shell"
VERSION=$(node -e "console.log(require('$ROOT/package.json').version)")
BUILD_DIR="$ROOT/out/macos-pkg"
PAYLOAD="$BUILD_DIR/payload"
PKG_FILE="$ROOT/out/${PKG_NAME}-${VERSION}.pkg"

echo ""
echo "  Building macOS .pkg installer v${VERSION}"
echo ""

# 1. Build project
echo "  [1/4] Building TypeScript..."
cd "$ROOT" && npx tsc

# 2. Prepare payload
echo "  [2/4] Preparing payload..."
rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD/usr/local/lib/$PKG_NAME"
mkdir -p "$PAYLOAD/usr/local/bin"

# Copy everything
cp -r "$ROOT/dist" "$PAYLOAD/usr/local/lib/$PKG_NAME/"
cp -r "$ROOT/node_modules" "$PAYLOAD/usr/local/lib/$PKG_NAME/"
cp -r "$ROOT/skills" "$PAYLOAD/usr/local/lib/$PKG_NAME/" 2>/dev/null || true
cp -r "$ROOT/templates" "$PAYLOAD/usr/local/lib/$PKG_NAME/" 2>/dev/null || true
cp "$ROOT/package.json" "$PAYLOAD/usr/local/lib/$PKG_NAME/"

# Create launcher
cat > "$PAYLOAD/usr/local/bin/ic" << 'LAUNCHER'
#!/usr/bin/env bash
export NODE_PATH="/usr/local/lib/icloser-agent-shell/node_modules:$NODE_PATH"
exec node "/usr/local/lib/icloser-agent-shell/dist/index.js" "$@"
LAUNCHER
chmod +x "$PAYLOAD/usr/local/bin/ic"

# iCloser alias
ln -sf ic "$PAYLOAD/usr/local/bin/iCloser"

echo "        ✓ payload prepared"

# 3. Build .pkg
echo "  [3/4] Building .pkg..."
pkgbuild \
  --root "$PAYLOAD" \
  --identifier "com.icloser.agent-shell" \
  --version "$VERSION" \
  --install-location "/" \
  --scripts "$ROOT/scripts/macos-scripts" 2>/dev/null || true \
  "$PKG_FILE"

echo "        ✓ $PKG_FILE"

# 4. Show result
echo ""
echo "  ┌─ macOS Package Ready ──────────────────────┐"
echo "  │  $PKG_FILE"
echo "  │"
echo "  │  安装: open $PKG_FILE"
echo "  │  或:   sudo installer -pkg $PKG_FILE -target /"
echo "  │  卸载: sudo rm -rf /usr/local/lib/icloser-agent-shell"
echo "  │         sudo rm /usr/local/bin/ic /usr/local/bin/iCloser"
echo "  └──────────────────────────────────────────────┘"
echo ""

# Show size
ls -lh "$PKG_FILE"
