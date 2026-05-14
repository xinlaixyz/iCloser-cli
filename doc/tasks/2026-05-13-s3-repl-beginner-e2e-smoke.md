# S3.9 REPL Beginner End-to-End Smoke

日期：2026-05-13
负责人：dev2

## 背景

现有 `smoke:repl` 只覆盖 `/apikey` 安全输入向导、key guidance、`/status`、`/exit` 和 key 泄露检查。缺少一个真实新手路径：完全空项目 → 打开 `ic` → 跟随 REPL 引导逐步完成初始化、任务、写入、退出的完整闭环。

## 变更

- 新增 `scripts/repl-beginner-e2e-smoke.mjs`
- 新增 npm script：`npm run smoke:repl:e2e`
- `npm run smoke:all` 新增 `repl-e2e` 步骤（在 `repl` 之后、`release` 之前）
- 更新 README 和 DEVELOPMENT 的验收说明

## 验收路径（13 步）

1. 创建临时空项目，写入最小 `package.json`
2. 使用临时 `HOME` / `ICLOSER_HOME`，确保无全局配置
3. 清除所有真实 API Key 环境变量
4. 启动 `node dist/index.js` 进入 REPL
5. 确认 REPL 进入 mock 离线模式
6. 发送 `/doctor`，确认提示未初始化或 `/init` 建议
7. 发送 `/init`，确认项目识别和初始化成功
8. 发送 `/doctor`，确认 ready 或下一步建议出现
9. 发送任务输入 "帮我创建 hello.txt 写入 iCloser beginner smoke"
10. 确认 mock AI 生成 hello.txt pending file
11. 发送数字 `1` 写入文件
12. 确认 `hello.txt` 存在于磁盘且包含 smoke 标记
13. 发送 `/status` → `/exit`，exit code = 0

额外检查：
- stdout/stderr 不包含真实 API Key 或 Key 环境变量名
- 全程 mock 离线模式，无网络依赖

## 纳入 smoke:all 决策

`smoke:repl:e2e` 耗时约 20-30 秒（mock provider 无网络），已纳入 `smoke:all`。执行顺序：

1. `npm run build`
2. `npm run test`
3. `npm run smoke:first-run`
4. `npm run smoke:repl`
5. `npm run smoke:repl:e2e`
6. `npm run smoke`
7. `npm run smoke:project`

## 验收标准

- [x] `npm run build` 通过
- [x] `npm run test` 通过
- [x] `npm run smoke:repl` 通过
- [x] `npm run smoke:repl:e2e` 通过
- [x] `npm run smoke:all` 通过
- [x] 不依赖真实 API Key
- [x] 不依赖 Git 仓库
- [x] Windows 可跑
- [x] 不破坏现有 `smoke:repl`
