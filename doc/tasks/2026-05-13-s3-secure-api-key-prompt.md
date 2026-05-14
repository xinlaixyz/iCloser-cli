# S3.2 Secure API Key Prompt

## 背景

S2.8 已支持直接粘贴 API Key，但粘贴内容会显示在终端里。完全新手虽然能用，但安全感不足；高级用户也不应该被引导把 Key 写到 shell 历史。

## 目标

提供一个最简单且更安全的 API Key 输入路径：

```text
/apikey
```

## 行为

1. 用户在 REPL 输入 `/apikey`。
2. 系统提示选择 Provider，默认 DeepSeek 或当前待配置 Provider。
3. 系统提示输入 API Key，输入时不回显。
4. 系统保存到全局配置。
5. 系统自动测试真实 Provider。
6. 成功后提示下一步直接输入需求。

## 变更

- `src/cli/repl.ts`
  - `/apikey` 无参数时进入安全输入向导。
  - 新增 `promptApiKeyWizard()`。
  - 新增 `askReplQuestion()`，支持 hidden input。
  - 保留直接粘贴 Key 和 `/apikey provider key` 两条兼容路径。
- `README.md`
  - 新增隐藏输入说明。
- `doc/NEW_USER_ONBOARDING.md`
  - 新增 `/apikey` 安全输入路径。
- `doc/DEVELOPMENT.md`
  - 新增 S3.2 记录。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke:first-run`
- `npm run smoke`
- `npm run smoke:project`
