# DEV2-S7.1 Tool Capability Registry

日期：2026-05-14
负责人：dev2

## 目标

建立五大工具能力注册表，把 S6 的“三步循环 × 五大工具矩阵”变成运行时可查询的能力快照。

## 交付

- `src/core/tool-registry.ts`
- `tests/tool-registry.test.ts`

## 能力

- 查询单个工具能力：文件操作、搜索、执行命令、网络搜索、代码智能。
- 查询某个循环步骤需要哪些工具。
- 输出中文降级提示。
- 网络搜索和代码智能默认受限，但不中断任务，会明确降级。

## 验收

```bash
npm run test -- tool-registry task-loop
npm run build
npm run lint
```
