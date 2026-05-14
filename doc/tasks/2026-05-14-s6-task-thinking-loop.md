# DEV2-S6.13 Task Thinking Loop

日期：2026-05-14
负责人：dev2

## 背景

用户提出核心机制：任务处理要像人类工程师一样循环执行“收集上下文、采取行动、验证结果”，同时明确模型负责思考推理，工具负责真正动手。

## 交付

- `src/core/task-loop.ts`
- `tests/task-loop.test.ts`
- `doc/TASK_THINKING_LOOP.md`
- `doc/AUTONOMOUS_EXECUTION_CHAIN.md`
- `doc/iCloser_Agent_Shell_完整需求文档.md`
- `doc/DEVELOPMENT.md`

## 行为规则

- 模型：理解目标、推理风险、决定下一步策略。
- 工具：读文件、写文件、运行命令、搜索、验证。
- 验证器：判断是否成功，失败则把证据送回下一轮。
- 用户：只负责目标和关键授权，可随时中断或换方法。

## 验收标准

```bash
npm run test -- task-loop execution-chain
npm run build
npm run smoke:autopilot
```
