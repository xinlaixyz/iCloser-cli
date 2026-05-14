# S2.8 Paste API Key Onboarding

## 背景

环境变量对新手不友好。真实用户第一次打开系统时，最自然的动作应该是直接把 API Key 粘进去，而不是学习 PowerShell / Bash 配置方式。

## 目标

让完全不会命令行配置的人也能完成真实模型接入。

## 新手路径

```text
ic
◇  sk-xxxxxxxxxxxxxxxx
```

系统自动：

1. 判断这是一段 API Key。
2. 选择当前缺失 Key 的 Provider；没有上下文时默认 DeepSeek。
3. 保存到 `~/.icloser/config.json` 的全局 AI 配置。
4. 切换 Provider 和默认模型。
5. 自动执行 Provider smoke test。

## 显式路径

```text
/apikey sk-xxxxxxxxxxxxxxxx
/apikey deepseek sk-xxxxxxxxxxxxxxxx
```

```bash
ic setup --provider deepseek --key sk-xxxxxxxxxxxxxxxx
ic provider key deepseek sk-xxxxxxxxxxxxxxxx
```

## 安全边界

- JSON 输出不暴露 `apiKey`。
- 终端展示只显示 mask 后的 Key，例如 `sk-123...abcd`。
- 高级用户仍可使用环境变量。

## 变更

- `src/ai/provider.ts`
  - `isLikelyApiKey()`
  - `inferProviderFromApiKey()`
  - `maskApiKey()`
- `src/cli/repl.ts`
  - 直接粘贴 Key 自动配置。
  - 新增 `/apikey` / `/key`。
  - 无 Key mock 提示改为“直接粘贴 API Key”。
- `src/index.ts`
  - `ic setup --key <api-key>`。
  - `ic provider key [provider] <api-key>`。
- `src/cli/theme.ts`
  - help 中增加 `/apikey`。
- `tests/provider.test.ts`
  - 覆盖 Key 识别、Provider 推断、mask。
- `tests/repl-completer.test.ts`
  - 覆盖 `/apikey` provider 补全。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`
