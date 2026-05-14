# S3.11 REPL Bottom Selection UX

## 背景

REPL 在 AI 生成多个待写入文件后会显示底部数字选项，但用户输入 `1和2` 时，旧逻辑只识别单个数字，结果把 `1和2` 当成普通聊天发给 AI，导致写入没有完成。

## 目标

让完全新手不需要猜命令：看到选项后，输入一个或多个编号并回车即可完成对应动作。

## 变更

- `src/cli/repl.ts`
  - 底部提示文案明确支持 `1`、`1,2`、`1和2`、`全部`。
  - 新增 `parseBottomSelection()`，支持单选、多选、范围和全选别名。
  - `handleBottomSelection()` 在普通聊天前拦截明确的底部选项输入。
  - `全部` 只写入全部待写入文件，不执行预览或撤销。
  - 部分写入后会重新展示剩余待写入文件的底部选项。
- `src/ai/provider.ts`
  - mock provider 支持从任务描述中提取多个文件名并生成多文件 Output Contract。
- `scripts/repl-beginner-e2e-smoke.mjs`
  - e2e smoke 改为生成 `hello.txt` 和 `guide.txt`。
  - 实际发送 `1和2`，验证两个文件都写入磁盘。
- `tests/repl-completer.test.ts`
  - 增加底部选项解析单元测试。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke:repl:e2e`
- `npm run smoke:all`

## 用户侧结果

当底部出现：

```text
[1] 写入 A.md
[2] 写入 B.md
[3] 预览变更 /diff
[4] 撤销 /undo
输入 1 回车；多个用 1,2 或 1和2；输入 全部 写入所有文件
```

用户输入 `1和2` 会写入 A.md 和 B.md；输入 `全部` 会写入全部待写入文件。
