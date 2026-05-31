# icloser 新手上手流程

这份文档只面向完全不会命令行、也不知道 Provider / 环境变量是什么的用户。

## 最简单路径

打开终端，进入项目目录，输入：

```bash
ic
```

看到输入光标后，直接粘贴 API Key 并回车：

```text
◇  sk-xxxxxxxxxxxxxxxx
```

如果不想让 Key 显示在屏幕上，输入：

```text
◇  /apikey
```

然后按提示选择 Provider 并粘贴 Key。Key 输入时不会显示。

icloser 会自动完成：

1. 识别这是一段 API Key。
2. 保存到用户全局配置。
3. 切换到真实 Provider。
4. 测试模型是否能连通。
5. 告诉用户下一步可以直接输入需求。

然后用户直接输入：

```text
◇  帮我给登录模块加手机号验证码登录
```

如果 AI 生成了文件修改，底部会出现数字选项。用户只需要输入选项后回车：

```text
1        写入第 1 个文件
1和2     写入第 1、2 个文件
1,2      写入第 1、2 个文件
全部     写入所有待写入文件
```

想先看内容时，也可以输入底部显示的“预览变更”编号，或直接输入 `/diff`。

## 没有 API Key

没有 Key 也能启动：

```bash
ic
```

系统会自动使用 `mock` 离线模式。用户仍然可以体验：

- `/status`
- `/scan`
- `/verify`
- `/search`
- mock 任务流

任何时候拿到 Key，都可以直接粘贴后回车。

首次进入 REPL 时，icloser 会显示三个下一步选项：

```text
1  粘贴 API Key    接入真实模型
2  /apikey         安全输入 Key，不显示在屏幕上
3  直接输入需求    先用 mock 离线体验
```

如果已经配置好真实模型，则显示：

```text
1  直接输入需求
2  /scan
3  /status
```

## 用户说“我要配置 key”

如果用户输入：

```text
◇  我要配置 key
```

系统不会把这句话发给模型，而是直接显示 Key 输入引导。

## 新手常见错误

### 依赖没安装

如果验证时看到类似：

```text
'tsc' is not recognized as an internal or external command
```

icloser 会追加提示：

```text
项目依赖可能还没安装。请先在项目目录运行 npm install，然后重新执行 ic t 或 ic verify。
```

## 高级路径

会命令行的用户仍可使用：

```bash
ic setup --provider deepseek --key sk-xxxxxxxxxxxxxxxx
ic provider key deepseek sk-xxxxxxxxxxxxxxxx
ic provider test
```

也可以使用环境变量：

```powershell
$env:DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
```

## 安全说明

- `ic config --json` 不输出明文 API Key。
- 终端成功提示只显示脱敏后的 Key。
- 主推荐路径是 REPL 内粘贴 Key；命令行 `--key` 更适合测试和高级用户。
