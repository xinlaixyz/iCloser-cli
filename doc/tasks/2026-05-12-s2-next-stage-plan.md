# S2 Next Stage Plan

日期：2026-05-12
负责人：dev2 统筹验收
阶段：S2.1 / S2.2

## 今日收官结论

S1 基线已经具备继续进入 S2 的条件：

- `npm run test`：11 个测试文件，79 个测试通过。
- `npm run smoke` 已作为发布前门槛。
- `ic doctor --strict --json` 已可作为脚本/CI readiness gate。
- mock provider 主链稳定。

## 明日任务安排

### dev1：S2.1 Real Provider Task Chain

目标：真实 Provider 能在任务主链中完成一次真实代码修改。

执行顺序：

1. 阅读 `doc/S2_DEVELOPMENT_PLAN.md` 的 dev1 部分。
2. 检查 `src/core/task-engine.ts` 中 AI 调用和返回消费路径。
3. 检查 `src/ai/provider.ts` 的真实 Provider 返回结构。
4. 选择一个真实 Provider 做最小闭环，优先 DeepSeek，其次 OpenAI/Claude。
5. 修复真实 Provider 失败路径的错误提示。
6. 补测试和文档。

验收标准：

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- `ic provider test` 对真实 Provider 通过。
- 一个最小 TypeScript 项目中 `ic t "修改一个简单函数" --go` 能完成。
- 失败时能看到明确原因和下一步建议。

### dev2：S2.2 AI Output Contract

目标：把 AI 输出变成稳定结构，避免真实 Provider 输出自由文本导致写文件不稳定。

执行顺序：

1. 阅读 `doc/S2_DEVELOPMENT_PLAN.md` 的 dev2 部分。
2. 梳理 AI 输出到文件写入链路。
3. 设计最小结构化输出协议。
4. 实现解析和校验。
5. 让 mock provider 也走同一协议。
6. 补测试和文档。

验收标准：

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- mock task 仍能修改 `notes.txt`。
- 非法 AI 输出不会写文件。
- JSON/stdout 契约测试不退化。

## dev2 后续验收职责

dev1 完成 S2.1 后，dev2 负责验收：

- 代码范围是否符合 S2.1。
- 是否破坏 mock smoke。
- 真实 Provider 失败路径是否清楚。
- 是否有必要的测试。
- 是否更新 README / DEVELOPMENT / task 文档。

dev2 完成 S2.2 后，自验并跑完整 smoke。

两条线合并后，dev2 做集成验收并输出结论。

## 给 dev1 的提示词

```text
明日请开始 S2.1 Real Provider Task Chain。

请先阅读：
- doc/S2_DEVELOPMENT_PLAN.md
- doc/tasks/2026-05-12-s2-next-stage-plan.md

你的任务目标：
把现有任务主链从 mock 演示推进到真实 Provider 可稳定执行。

重点范围：
1. 检查 src/core/task-engine.ts 的 AI 调用链路。
2. 检查 src/ai/provider.ts 的真实 Provider 返回是否能被任务链消费。
3. 至少打通一个真实 Provider，优先 DeepSeek，其次 OpenAI/Claude。
4. 修复真实 Provider 常见失败：
   - 缺少 API Key
   - 鉴权失败
   - 网络失败
   - 超时
   - 模型返回空内容
5. 保持 mock provider 和 npm run smoke 不退化。

验收标准：
- npm run build 通过
- npm run test 通过
- npm run smoke 通过
- ic provider test 对真实 Provider 通过
- 最小 TypeScript 项目中 ic t "修改一个简单函数" --go 能完成
- 失败时错误信息包含明确原因和下一步建议

禁止：
- 不重构 scanner/context/security/verifier 大结构
- 不修改 JSON envelope 契约
- 不改变 smoke 默认使用 mock 的行为

完成后请告诉我：
- 改了哪些文件
- 如何配置真实 Provider
- 实测命令和结果
- 仍有哪些风险
```

