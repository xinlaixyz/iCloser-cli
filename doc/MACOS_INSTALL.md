# iCloser Agent Shell — macOS 安装指南

## 系统要求

- macOS 12+ (Monterey 或更新)
- Node.js >= 18.0.0
- npm >= 9.0.0 (通常随 Node.js 一起安装)

## 安装

### 1. 检查 Node.js

```bash
node --version   # 需要 >= 18.0.0
npm --version
```

如果未安装 Node.js，推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理版本：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
# 重新打开终端
nvm install 22
nvm use 22
```

### 2. 全局安装

```bash
npm install -g icloser-agent-shell
```

安装完成后，以下两个命令均可启动：

```bash
ic
iCloser
```

### 3. 首次配置

启动后进入 REPL 交互界面。

#### 配置 API Key（真实模型）

**方法一：直接粘贴（推荐）**

在 REPL 中直接粘贴 API Key 后回车：

```
sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

系统会自动识别 Key 类型（DeepSeek/OpenAI/Claude）并保存。

**方法二：安全输入向导**

```
/apikey
```

按提示选择 Provider 并输入 Key。

**方法三：环境变量**

```bash
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# 或
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# 或
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

将以上行添加到 `~/.zshrc` 或 `~/.bash_profile` 中。

**方法四：CLI 直接配置**

```bash
ic provider key deepseek sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### 离线体验（无需 Key）

如果暂时没有 API Key：

```bash
ic setup --mock
```

使用 mock provider 可以离线体验全部功能。

### 4. 项目中使用

```bash
cd /path/to/your-project
ic init        # 初始化项目
ic              # 启动 REPL 交互
```

## 常见问题

### permission denied: ic

npm 全局安装目录不在 PATH 中，或没有执行权限。

**检查 npm 全局 bin 路径：**

```bash
npm bin -g
```

输出如 `/usr/local/bin` 或 `/Users/<you>/.npm-global/bin`。

**确保该路径在 PATH 中：**

```bash
echo $PATH | tr ':' '\n' | grep npm
```

如果不在，添加到 `~/.zshrc`：

```bash
export PATH="$(npm bin -g):$PATH"
```

然后 `source ~/.zshrc` 或重新打开终端。

### npm ERR! EACCES: permission denied

全局安装时权限不足。

**推荐方案（使用 nvm）：**

```bash
nvm use 22
npm install -g icloser-agent-shell
```

nvm 管理的 Node.js 全局模块目录在用户目录下，不需要 sudo。

**备选方案（修改 npm 全局目录）：**

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH="$HOME/.npm-global/bin:$PATH"
npm install -g icloser-agent-shell
```

### 启动后提示"项目未初始化"

运行 `ic init` 初始化当前项目。

### 提示"缺少 API Key"

这是正常的。首次使用时，系统会引导你配置 API Key。也可以先用 `ic setup --mock` 进入离线模式。

### Node.js 版本过低

```bash
nvm install 22
nvm use 22
```

### 命令 `ic` 或 `iCloser` 不识别

1. 检查是否安装成功：`npm list -g icloser-agent-shell`
2. 检查 PATH：`echo $PATH | grep npm`
3. 重新安装：`npm uninstall -g icloser-agent-shell && npm install -g icloser-agent-shell`

## 验证安装

```bash
ic --help          # 查看所有命令
ic --version       # 查看版本
ic setup --mock    # 离线模式快速体验
```

## 卸载

```bash
npm uninstall -g icloser-agent-shell
```
