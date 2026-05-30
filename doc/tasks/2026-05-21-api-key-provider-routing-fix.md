# 接口密钥与模型服务路由修复

日期：2026-05-21

## 一、问题

用户粘贴 DeepSeek 风格的 `sk-...` 接口密钥时，如果当前模型服务是 Claude 或 OpenAI，iCloser 会把这段密钥误判为当前模型服务的密钥。

随后 `provider test` 会因为鉴权失败或模型不匹配而失败，用户看到的现象就是：明明输入了 DeepSeek 密钥，但系统仍然无法进入真实 AI。

第二个问题是 DeepSeek 的模型和 endpoint 配置不准确。用户提供的真实配置是：

- OpenAI 协议地址：`https://api.deepseek.com`
- Anthropic 协议地址：`https://api.deepseek.com/anthropic`
- 模型：`deepseek-v4-flash`、`deepseek-v4-pro`

因此不能把 DeepSeek 的 `sk-...` 密钥默认路由到 OpenAI 模型服务，也不能把产品模型名随意映射成旧模型名。

## 二、修复

- 普通 `sk-...` 密钥默认归属 DeepSeek。
- `sk-ant-...` 仍然归属 Claude。
- `sk-or-...` 仍然归属 OpenRouter / OpenAI 兼容路由。
- OpenAI 需要通过显式命令选择，不能从普通 `sk-...` 粘贴自动推断。
- 启动时会自动修复旧配置中的模型服务 / 密钥不匹配。例如 `provider=claude` 但密钥是普通 `sk-...` 时，会在内存中修正为 DeepSeek。
- DeepSeek 使用 DeepSeek 模型服务，并通过 OpenAI 兼容协议访问 `https://api.deepseek.com`。
- DeepSeek 请求模型保留为产品模型：
  - `deepseek-v4-pro`
  - `deepseek-v4-flash`
- `/apikey` 保存密钥后，即使即时连通性测试因网络问题失败，也不会把用户引导回 mock，而是保留真实模型服务，让下一次任务输出更具体的错误。

## 三、验收结果

- `npx tsc --noEmit` 通过。
- `npx vitest run tests\provider.test.ts tests\first-run.test.ts tests\repl-ai-routing.test.ts` 通过。
- `npm run build` 通过。
- `npm run lint` 通过。
- `npm test` 通过：122 个测试文件，1744 passed，2 skipped。
- `node dist\index.js provider doctor --json` 返回 DeepSeek / `deepseek-v4-pro` / `keySource=config`。
- `node dist\index.js provider test --json` 真实 DeepSeek endpoint 通过：`ok=true`，`tokensUsed=65`。

## 四、安全说明

本文档不写入任何真实接口密钥。测试只使用伪造的密钥形状字符串。
