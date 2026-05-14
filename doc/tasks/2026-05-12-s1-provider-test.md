# S1 Provider Test

日期：2026-05-12
负责人：dev2
阶段：S1.20

## 目标

在用户执行真实任务前，提供一个轻量命令检查当前 Provider 是否真的可调用，避免任务执行到一半才发现 API Key、模型或网络不可用。

## 本次变更

- `src/ai/provider.ts`
  - 新增 `ProviderSmokeResult`。
  - 新增 `smokeTestProvider(config)`。
  - smoke test 先检查 `getProviderStatus()`：
    - 缺 Key 时快速返回失败，不发网络请求。
    - ready 时发极小 prompt：`Reply with exactly: OK`。
- `src/index.ts`
  - 新增 `ic provider test`。
  - 新增 `ic provider test --json`，输出 `kind: provider-test`。
- `tests/provider.test.ts`
  - 覆盖 mock provider 无 Key 可通过。
  - 覆盖真实 provider 无 Key 时快速失败并提示环境变量。
- `doc/help.md` / `doc/DEVELOPMENT.md`
  - 补充 provider test 使用说明。

## 使用方式

```bash
ic provider doctor
ic provider test
ic provider test --json
```

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，70 个测试。
- CLI 轻量验收通过：
  - 临时项目：`C:\tmp\icloser-provider-test`
  - `node dist\index.js provider use mock`
  - `node dist\index.js provider test`
  - `node dist\index.js provider test --json`
  - `node dist\index.js provider use openai`
  - `node dist\index.js provider test --json`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.20 Provider Test，请验收并补 CLI spawn 测试/README：

1. 新增核心函数：
   - smokeTestProvider(config)
   - 返回 ProviderSmokeResult：
     provider/model/ok/duration/keySource/tokensUsed/error

2. 新增 CLI：
   - ic provider test
   - ic provider test --json

3. 行为：
   - mock 不需要 API Key，provider test 应通过。
   - 真实 Provider 缺 Key 时快速失败，不发网络请求。
   - Provider ready 时发极小 prompt 检查真实连通性。
   - JSON 输出使用 envelope：kind = provider-test。

4. 当前验收：
   - npm run build 通过
   - npm run test 通过：11 个测试文件，70 个测试
   - 临时项目中 provider use mock + provider test 通过
   - provider test --json 可解析

请你补：
- provider CLI spawn 测试：
  - provider test --json with mock
  - provider test --json missing key path（注意清空对应 env 或构造无 key 配置）
- README.md 增加“配置完 Key 后先运行 ic provider test”的步骤。
- help.md 如有命令表遗漏继续同步。
```

## 后续建议

- 增加 `ic provider test --timeout <ms>`。
- 将 `provider-test` 纳入统一 JSON 契约测试。
- 后续如支持系统 keychain，doctor/test 仍保持同一输出结构。
