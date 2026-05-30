# T5 真实 Provider 黄金路径验收记录

日期：2026-05-21

## 目标

验证 AgentCode 不只是 mock / scripted smoke，而是能用真实 AI Provider 完成一次代码交付闭环：

```text
setup -> init -> memory -> Provider 生成计划和代码 -> diff -> verify -> repair -> report -> commit/PR
```

## Provider

| 项 | 值 |
|----|----|
| Provider | DeepSeek |
| Model | deepseek-v4-pro |
| Key 来源 | 环境变量 |
| 连通性 | provider smoke test 通过，`ok=true` |

## 脚本改造

`scripts/golden-path-real.mjs` 已从“scripted fallback”改为真实 Provider 链路：

- 调用 `createProvider()` 创建真实 Provider adapter。
- 要求 Provider 返回 JSON patch：`plan + changes[]`。
- 只允许修改 `index.js` 和 `index.test.js`，防止越界写入。
- Provider 生成完整文件内容，脚本只负责安全应用和验证。
- `node --test index.test.js` 失败时，进入 1 轮 Provider repair。
- 归档 8 项产物到 `doc/golden-path/`。

## 真实运行结果

运行命令：

```bash
node scripts/golden-path-real.mjs
```

结果：

| 项 | 结果 |
|----|------|
| Provider setup | 通过，`providerReady=true` |
| 记忆导入 | 通过，导入 3 条 AGENTS.md 规则 |
| AI 计划 | 通过，Provider 返回 plan |
| AI 代码变更 | 通过，Provider 修改 `index.js` / `index.test.js` |
| Diff explain | 通过 |
| 验证 | 通过，`node --test` 8 passed / 0 failed |
| 修复轮次 | 0，首次通过 |
| Commit / PR 草稿 | 通过 |

## 8 项产物

本次真实 Provider 产物前缀：

```text
doc/golden-path/2026-05-21T07-52-55-911Z-*.md
```

| # | 产物 | 文件 |
|---|------|------|
| 1 | 输入需求 | `2026-05-21T07-52-55-911Z-1-requirement.md` |
| 2 | 采用记忆 | `2026-05-21T07-52-55-911Z-2-memory-adopted.md` |
| 3 | AI 计划 | `2026-05-21T07-52-55-911Z-3-plan.md` |
| 4 | 代码 diff | `2026-05-21T07-52-55-911Z-4-diff.md` |
| 5 | 验证日志 | `2026-05-21T07-52-55-911Z-5-verify.md` |
| 6 | 修复记录 | `2026-05-21T07-52-55-911Z-6-repair.md` |
| 7 | 最终报告 | `2026-05-21T07-52-55-911Z-7-report.md` |
| 8 | commit/PR | `2026-05-21T07-52-55-911Z-8-commit.md` |

## 验收结论

T5 / G1 通过。AgentCode 已具备真实 Provider 完成小型代码交付闭环的证据。

下一步不能只重复 demo，需要扩展到 3 个真实场景：

- Android 项目启动/修复。
- Web 项目功能改造。
- 后端项目 bug 修复 + 测试。
