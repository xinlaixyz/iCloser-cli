# S2.9 Beginner First-Run Polish

## 背景

真实验收发现两类新手问题：

1. `setup --key` 成功后，新项目 `ic init` 会把 Provider 重新落到默认 Claude，导致 DeepSeek Key 被错误用于 Claude。
2. 临时 TypeScript 项目未安装依赖时，验证只显示 `tsc not recognized`，新手不知道下一步该做什么。

此外，新手可能输入“我要配置 key”，系统应进入 Key 引导，而不是把这句话发给模型。

## 目标

把首次使用流程压缩为：

```text
ic
粘贴 API Key
输入需求
```

## 变更

- `src/config.ts`
  - 修复全局 AI 配置合并优先级。
  - 当全局配置包含真实 `apiKey` 时，新项目应继承全局 `provider/model/apiKey`。
- `src/cli/repl.ts`
  - 识别“配置 key / 设置 key / 输入 api key”等自然语言意图。
  - Key 引导文案改为“直接粘贴 API Key 后回车”。
  - Key 保存并测试成功后，展示下一步需求示例。
- `src/core/verifier.ts`
  - 验证失败时识别缺少本地工具，如 `tsc`、`eslint`、`vitest`、`jest`。
  - 追加新手提示：先运行 `npm install`。
- `tests/verifier.test.ts`
  - 覆盖缺少本地工具时的 `npm install` 提示。
- `README.md`
  - 增加 first-time user 三步路径。
- `doc/NEW_USER_ONBOARDING.md`
  - 增加完整新手上手文档。

## 真实验收

使用真实 DeepSeek Key 在临时项目中验证：

```bash
ic setup --provider deepseek --key ***
ic init --force
ic provider doctor --json
ic provider test --json
ic t "修改 src/math.ts 添加 subtract 减法函数" --go
ic gate <task-id> --json
```

结果：

- Provider: `deepseek`
- Model: `deepseek-v4-pro`
- Provider test: ok
- Task: completed
- Gate: passed
- `src/math.ts` 新增 `subtract(a, b)`。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`
