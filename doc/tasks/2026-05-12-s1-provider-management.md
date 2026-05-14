# S1 Provider Management

日期：2026-05-12
负责人：dev2
阶段：S1.19

## 目标

让用户能清楚管理 AI Provider、模型和 API Key 状态，解决“怎么输入 API Key、怎么管理大模型”的第一层产品体验。

## 本次变更

- `src/ai/provider.ts`
  - 新增 `ProviderInfo` / `ProviderStatus`。
  - 新增 provider registry：
    - `getAvailableProviders()`
    - `getProviderInfo(provider)`
    - `isAIProvider(value)`
    - `getProviderStatus(config, provider?)`
    - `getProviderStatuses(config)`
  - Provider 元数据包含：默认模型、可用模型、环境变量、是否需要 API Key。
- `src/index.ts`
  - 新增 `ic provider` 命令组：
    - `ic provider list`
    - `ic provider list --json`
    - `ic provider use <name> [model]`
    - `ic provider models [name]`
    - `ic provider model <model>`
    - `ic provider doctor`
    - `ic provider doctor --json`
    - `ic provider env [name]`
- `src/types.ts`
  - `AIConfig.apiKey` 改为可选，和 `ICloserConfig.ai.apiKey?` 对齐。
- `tests/provider.test.ts`
  - 覆盖 provider registry、provider name 校验、mock ready、真实 provider missing key。
- `doc/help.md` / `doc/DEVELOPMENT.md`
  - 补充 Provider 管理命令和 API Key 环境变量策略。

## 当前 API Key 策略

本阶段不做交互式写入明文 Key。推荐用户使用环境变量：

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:DEEPSEEK_API_KEY="sk-..."
$env:DASHSCOPE_API_KEY="sk-..."
```

然后：

```bash
ic provider use openai gpt-4o-mini
ic provider doctor
```

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，68 个测试。
- CLI 轻量验收通过：
  - 临时项目：`C:\tmp\icloser-provider-mgmt`
  - `node dist\index.js provider list`
  - `node dist\index.js provider list --json`
  - `node dist\index.js provider use mock`
  - `node dist\index.js provider doctor --json`
  - `node dist\index.js provider models openai --json`
  - `node dist\index.js provider env openai`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.19 Provider Management，请验收并补产品化文档/集成测试：

1. 新增 provider registry：
   - getAvailableProviders()
   - getProviderInfo(provider)
   - isAIProvider(value)
   - getProviderStatus(config, provider?)
   - getProviderStatuses(config)

2. 新增 CLI：
   - ic provider list
   - ic provider list --json
   - ic provider use <name> [model]
   - ic provider models [name]
   - ic provider model <model>
   - ic provider doctor
   - ic provider doctor --json
   - ic provider env [name]

3. 当前 API Key 策略：
   - 不通过 CLI 交互写入明文 Key
   - 推荐环境变量
   - mock 不需要 Key
   - Claude: ANTHROPIC_API_KEY
   - DeepSeek: DEEPSEEK_API_KEY
   - OpenAI: OPENAI_API_KEY
   - Qwen: QWEN_API_KEY / DASHSCOPE_API_KEY

4. 验收已通过：
   - npm run build
   - npm run test：11 个测试文件，68 个测试
   - provider list/use/models/doctor/env CLI 轻量验收通过

请你补：
- README.md 的“API Key 和模型管理”快速开始。
- provider CLI spawn 测试，至少覆盖 provider list --json / doctor --json / use mock。
- 检查 help.md、DEVELOPMENT.md 命令说明是否够用户复制执行。
```

## 后续建议

- 增加 `ic provider test`，用极小 prompt 实测真实 Provider 连通性。
- 增加安全的 key 存储策略讨论：环境变量优先，后续可支持系统 keychain。
- 增加 `ic config --json`，让配置也进入统一 JSON envelope。
