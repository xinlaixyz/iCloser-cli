# T1-T4 工具编排器验收记录

日期：2026-05-21

## 目标

把工具能力从“AI 能调用若干工具”升级为“AI 能围绕任务目标持续编排工具”：先识别任务类型，再生成工具计划，执行后观察结果，失败时给出恢复动作，并把工具结果写入短期执行记忆。

## 完成范围

| 编号 | 任务 | 验收结果 |
|------|------|----------|
| T1 | Tool Orchestrator 核心循环 | 已完成：`plan -> execute -> observe -> recover -> evidence` |
| T2 | 任务类型模板 | 已完成：launch、bugfix、feature、explain、release、memory、general |
| T3 | Observe/Recover | 已完成：wrong-shell、command-not-found、missing-env、missing-sdk、test-failed、build-failed、permission-denied、network-failed、timeout |
| T4 | 工具结果进入工作记忆 | 已完成：facts、failures、verified、decisions 去重记录与摘要输出 |

## 入口

CLI：

```bash
ic orchestrate "启动项目"
ic orch "发布检查" --json
ic orchestrate "启动项目" --execute
```

REPL：

```text
/orchestrate 启动项目
```

默认策略：命令型工具只 dry-run，不真实启动服务、不安装依赖、不修改系统。需要真实执行时必须显式加 `--execute`。

## 关键文件

| 文件 | 说明 |
|------|------|
| `src/core/tool-orchestrator.ts` | 工具编排核心：意图分类、模板、执行、观察、恢复 |
| `src/core/execution-memory.ts` | 短期执行记忆：记录工具事实、失败、验证、决策 |
| `src/index.ts` | CLI 增加 `orchestrate/orch` 命令 |
| `src/cli/repl.ts` | REPL 增加 `/orchestrate` 工具编排展示 |
| `tests/tool-orchestrator.test.ts` | T1-T4 单元验收 |
| `docs/API.md` | 命令 API 文档 |
| `docs/PRD.md` | 产品定位与核心能力文档 |
| `docs/TESTING.md` | 测试与验收文档 |

## 已验证命令

```bash
npx tsc --noEmit
npx vitest run tests/tool-orchestrator.test.ts
npm run build
node dist/index.js orchestrate "启动项目" --json
node dist/index.js orchestrate "发布检查" --json
node dist/index.js orchestrate "解释 diff 风险"
```

## 验收结论

T1-T4 已达到第一阶段验收：用户在“启动项目、发布检查、解释 diff”等任务里能看到工具计划、工具执行结果、失败分类、恢复建议和执行记忆摘要，不再只是一次性输出大段 AI 文本。

后续要继续提升到 Claude Code 级体验，还需要补 T5：真实 Provider 在真实项目上持续驱动 `scan -> plan -> tool use -> recover -> verify -> report`，并把长任务过程流式展示做到接近 Claude Code。
