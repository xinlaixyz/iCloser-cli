# S2 Development Plan

日期：2026-05-12
阶段目标：从“骨架可跑”推进到“真实 Provider + 真实项目可用”。

## 当前基线

S1 已完成并通过本地验收：

- CLI 主链可跑。
- mock provider 可离线完成任务闭环。
- Provider 管理、Provider test、setup、config JSON、doctor JSON 已补齐。
- `ic doctor --strict --json` 可作为脚本门禁。
- `npm run smoke` 可作为发布前验收。
- 当前测试基线：11 个测试文件，79 个测试通过。

## S2 总目标

在一个真实 TypeScript 项目中，使用真实 AI Provider 完成一次代码修改，并通过：

1. `ic init`
2. `ic doctor --strict --json`
3. `ic provider test`
4. `ic t "..." --go`
5. `ic gate <task-id> --json`
6. `ic report`
7. `npm run smoke`

## 双开发分工

### dev1：S2.1 Real Provider Task Chain

负责人：dev1

目标：把现有任务主链从 mock 演示推进到真实 Provider 可稳定执行。

范围：

- 检查 `src/core/task-engine.ts` 的 AI 调用链路。
- 检查 `src/ai/provider.ts` 的真实 Provider 调用返回是否能被任务链消费。
- 确认 DeepSeek/OpenAI/Claude 至少一个真实 Provider 可以完成任务。
- 对真实 Provider 的异常做清楚处理：
  - 缺少 API Key
  - 鉴权失败
  - 网络失败
  - 超时
  - 模型返回空内容
- 保持 mock provider 行为不退化，`npm run smoke` 必须继续通过。

禁止范围：

- 不重构 scanner/context/security/verifier 的大结构。
- 不修改 JSON envelope 契约。
- 不改变 S1 smoke 的默认 mock 行为。

交付物：

- 真实 Provider 任务链修复代码。
- 必要的单元测试或 spawn 测试。
- 文档更新：
  - README 的真实 Provider 使用说明。
  - DEVELOPMENT 的 S2.1 记录。
  - `doc/tasks/2026-05-13-s2-real-provider-task-chain.md`。

验收标准：

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- `ic provider test --json` 对 mock 仍通过。
- 使用至少一个真实 Provider 时：
  - `ic provider test` 通过。
  - 一个最小 TypeScript 项目中 `ic t "修改一个简单函数" --go` 能完成。
  - 失败时错误信息包含下一步建议，不吞异常。

### dev2：S2.2 AI Output Contract

负责人：dev2

目标：把模型输出收敛成稳定、可验证、可写入的结构，降低真实 Provider 输出自由文本导致的任务失败率。

范围：

- 梳理当前 AI 输出到文件写入的路径。
- 设计并实现最小结构化输出协议：
  - `summary`
  - `changes[]`
  - `file`
  - `operation`
  - `content` 或 `patch`
  - `reasoning`
- 增加解析与校验：
  - JSON parse 失败时给出诊断。
  - 缺失文件名时拒绝写入。
  - 空变更时拒绝执行。
  - 路径越界时交给 security 拦截。
- 对 mock provider 也输出同一结构，保证 smoke 覆盖协议。
- 保持已有 report/gate/status JSON 不破坏。

禁止范围：

- 不引入大型 diff 引擎。
- 不改变 Provider 管理命令。
- 不绕过 security/verifier。

交付物：

- AI 输出协议类型或本地 helper。
- 解析/校验测试。
- mock provider 适配结构化输出。
- 任务链消费结构化输出。
- 文档更新：
  - ARCHITECTURE 的 AI 输出路径说明。
  - DEVELOPMENT 的 S2.2 记录。
  - `doc/tasks/2026-05-13-s2-ai-output-contract.md`。

验收标准：

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- mock task 仍能修改 `notes.txt`。
- 非法 AI 输出不会写文件，并给出可读错误。
- JSON/stdout 契约测试不退化。

## 集成验收

当 dev1 和 dev2 都完成后，由 dev2 统一验收：

1. 拉齐代码和文档。
2. 跑 `npm run build`。
3. 跑 `npm run test`。
4. 跑 `npm run smoke`。
5. 用 mock provider 跑一个临时 TypeScript 项目。
6. 用真实 Provider 跑一个临时 TypeScript 项目。
7. 检查 report/gate/status JSON。
8. 输出验收结论和阻塞项。

## 时间预估

- S2.1：0.5-1 天。
- S2.2：1-1.5 天。
- 集成验收和修补：0.5 天。

两人并行后，预计 2 天内可以得到“真实 Provider 可演示版本”；3-4 天内可以推进到内部 MVP。

