# T9 — 验证管线并行化

日期：2026-05-20  
模块：`src/core/verifier.ts`  
依赖：Day1 安全修复完成。当前 `createCommit` 安全策略已独立为 `src/core/commit-security.ts`，可进入 T9 设计与实现。  
状态：**待实现，架构设计已确认**

## 一、目标

将验证管线从完全串行提升为安全并行：

- 缩短 `compile + lint + test + coverage` 的总等待时间。
- 保留失败时的可诊断输出。
- 保持自动修复 loop 的行为可控。
- 不让并行阶段互相污染缓存、覆盖率、测试输出或项目文件。

## 二、当前问题

`runVerification()` 当前按 `options.stages` 串行执行：

```text
compile -> lint -> unit-test -> integration-test -> e2e -> coverage
```

问题：

- compile/lint/unit-test 互相独立时仍串行等待。
- 慢项目中验证阶段成为 AI 代码交付主链路瓶颈。
- coverage 已有基线写入和 history 写入，不适合和 unit-test 盲目并行。

## 三、并行安全原则

默认不做全量 `Promise.all(stages)`。必须先分组：

| 分组 | 阶段 | 是否可并行 | 原因 |
|------|------|------------|------|
| Group A | `compile`、`lint` | 可以并行 | 通常只读源码和配置，不写项目业务文件 |
| Group B | `unit-test`、`integration-test` | 谨慎并行 | 可能共享数据库、端口、快照、测试缓存 |
| Group C | `coverage` | 默认串行最后执行 | 会写 coverage 文件、`.icloser/coverage-history.json` |
| Group D | `e2e` | 默认串行 | 可能启动浏览器、服务、端口 |

第一版建议：

```text
parallel(compile, lint) -> unit-test -> integration-test -> e2e -> coverage
```

后续在项目配置中允许开启更激进并行。

## 四、实现方案

### T9-A：新增阶段计划器

新增内部函数：

```typescript
function planVerificationBatches(stages: VerifyStage[]): VerifyStage[][]
```

第一版输出：

- `compile/lint` 合并为同一批。
- `unit-test/integration-test/e2e/coverage` 保持独立批。
- 保留用户原始阶段顺序。

### T9-B：执行批次

将 `runVerification()` 内部循环改为：

```typescript
for (const batch of batches) {
  const results = await Promise.all(batch.map(stage => runStage(...)));
  // 任一 fail，则停止后续批次，剩余阶段标记 skipped
}
```

### T9-C：失败和自动修复策略

第一版不在并行批次内做自动修复。策略：

1. 并行批次执行。
2. 如果有失败阶段，选择第一个失败阶段进入现有 auto-repair。
3. 修复成功后重新运行完整验证或至少重新运行失败阶段所在批次。

这样避免两个失败阶段同时修复同一文件。

### T9-D：覆盖率下降告警

当前 coverage 已保存 baseline/history。T9 需要补：

- 连续 3 次 coverage lines 下降，输出 warning。
- warning 不一定 fail，除非跌破阈值或低于 baseline 容忍值。

### T9-E：非 TS 语言语法检查

非 TS 语言至少不能静默跳过：

- Go：`go test ./...` 或 `go build ./...`
- Python：`python -m py_compile` fallback
- Java：`mvn test` / `gradle test` / `javac -version` fallback

## 五、验收标准

- `compile + lint` 可并行执行，结果仍按原始阶段顺序展示。
- 任一阶段失败后，后续未执行阶段标记 `skipped`。
- auto-repair 不并发修改文件。
- coverage 仍最后执行，history 写入不竞态。
- `verify.log` 保留每个阶段 command/stdout/stderr/exitCode。
- 单测覆盖：
  - 批次规划。
  - 并行批次有一个失败。
  - coverage 仍最后执行。
  - 自动修复不并发。

## 六、风险

- 很多项目的 test/lint/build 脚本会写缓存，并行可能触发文件锁或输出交错。
- Windows/macOS/Linux shell 行为不同，必须纳入跨平台测试。
- 真实项目可能依赖“先 build 再 test”的顺序，第一版不应并行 unit-test。

## 七、建议排期

| 子任务 | 优先级 | 估时 |
|--------|--------|------|
| T9-A 阶段计划器 + 单测 | P0 | 1h |
| T9-B `compile/lint` 并行执行 | P0 | 1.5h |
| T9-C fail/skip 顺序保持 | P0 | 1h |
| T9-D coverage 连续下降告警 | P1 | 1h |
| T9-E 非 TS fallback 强化 | P1 | 1.5h |

最低验收命令：

```bash
npx vitest run tests/verifier.test.ts tests/verifier-coverage.test.ts
npx tsc --noEmit
npm run lint
```
