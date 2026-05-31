# icloser

终端里的中文 AI 改代码助手。接国产模型（DeepSeek / Qwen），理解项目、精确改代码、给你可审查的 diff。

## 安装

```bash
npm install -g icloser
```

或本地开发：

```bash
git clone https://github.com/xinlaixyz/iCloser-cli.git
cd icloser
npm install && npm run build && npm link
```

## 用起来：一条路径

```bash
ic
```

进去后只做三件事：

```text
1. 粘贴你的 DeepSeek API Key，回车
2. 告诉它你想改什么，例如：帮我给用户模块加手机验证码登录
3. 看它给出的 diff —— 输入 1 写入，2 预览，3 取消
```

没有 Key 也能先试：启动时选「离线 Mock 模式」，整条流程照样跑通，随时粘贴真实 Key 切换。

## 配 Key

| 方式 | 命令 |
|------|------|
| 启动后粘贴 | 直接把 `sk-xxx` 贴进去回车 |
| 指定服务商 | `/apikey deepseek sk-xxx` |
| 环境变量 | `$env:DEEPSEEK_API_KEY = "sk-xxx"`（PowerShell） |

支持 DeepSeek、Qwen、OpenAI、Claude，以及无需 Key 的 Mock。

## 它能做什么

- **改代码**：理解你的项目结构，按需求精确修改，输出 diff 让你审查后再落盘。
- **验证**：改完自动跑检查，告诉你结果，而不是改完就走。
- **记忆**：记住你的项目和偏好，下次不用重复解释。

## License

MIT
