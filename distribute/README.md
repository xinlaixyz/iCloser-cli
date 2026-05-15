# iCloser Agent Shell · 分发包

给用户的一键安装文件。每个平台一个文件，双击或命令行运行。

## macOS 用户

```bash
# 1. 把 install-macos.sh 发给 Mac 同学
# 2. 打开终端，cd 到文件所在目录
# 3. 运行:
chmod +x install-macos.sh
./install-macos.sh

# 4. 完成！关闭并重新打开终端
# 5. 运行: ic setup
```

**自动完成:**
- 检测/安装 Homebrew + Node.js
- 下载/编译 iCloser
- 全局注册 `ic` 命令
- 添加到 PATH

**卸载:**
```bash
./install-macos.sh --uninstall
```

---

## Windows 用户

```powershell
# 右键 install-windows.ps1 → "使用 PowerShell 运行"
# 或在 PowerShell 中:
.\install-windows.ps1

# 卸载:
.\install-windows.ps1 -Uninstall
```

**自动完成:**
- 检测/安装 Node.js (winget)
- 下载/编译 iCloser
- 全局注册 `ic` 命令

---

## 给开发者的打包命令

```bash
# 在项目根目录运行:
npm run package          # 构建全平台离线包 → out/
make macos-pkg           # 构建 macOS .pkg (需 macOS)
make package             # 同 npm run package

# 检查分发包内容:
ls -la distribute/
```

---

## 版本

`v0.1.0` — 2026-05-15
