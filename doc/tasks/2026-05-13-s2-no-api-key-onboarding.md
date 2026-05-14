# S2.6 No API Key Onboarding

## 背景

真实用户首次运行时经常没有准备好 API Key。旧行为会提示缺少 Key，但 REPL 聊天入口会直接阻断，用户很难先体验系统能力。

## 目标

没有 API Key 时系统仍能启动，并直接给出可复制的 Provider 配置格式。

## 变更

- `src/ai/provider.ts`
  - 新增 `getProviderKeyGuidance()`。
  - 新增 `formatProviderKeyGuidance()`。
  - `smokeTestProvider()` 缺少 Key 时返回完整配置提示。
- `src/index.ts`
  - `ic setup`、`ic provider doctor`、`ic provider test`、`ic provider env` 复用统一 Key 配置提示。
- `src/cli/repl.ts`
  - REPL 启动时按当前 Provider 解析对应环境变量。
  - 当前真实 Provider 缺 Key 时自动切换到 `mock`。
  - 输出 PowerShell / Bash / CMD 配置格式，以及 `ic provider test`、`ic setup --mock` 下一步。
- `tests/provider.test.ts`
  - 增加 Provider Key guidance 单元测试。
- `README.md` / `doc/DEVELOPMENT.md`
  - 记录无 Key 启动和真实 Provider 接入路径。

## 用户体验

```bash
ic
```

如果当前 Provider 是 `deepseek` 但没有 `DEEPSEEK_API_KEY`：

```text
未配置 deepseek API Key，已启用 mock 离线模式
要接入真实模型，复制下面对应终端格式后运行：
需要配置 DEEPSEEK_API_KEY 后才能调用真实模型。
PowerShell: $env:DEEPSEEK_API_KEY="sk-..."
Bash/Zsh:    export DEEPSEEK_API_KEY="sk-..."
CMD:         set DEEPSEEK_API_KEY=sk-...
验证:        ic provider test
无 Key 先用: ic setup --mock
```

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`
