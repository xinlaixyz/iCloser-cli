# P0-P3 工具 AI 能力优化落地

日期：2026-05-21

## 目标

按“本地工程执行器 + Claude Code 替代品 + 长期记忆”的定位，把上一轮测评中的 P0-P3 优化从方案推进到可执行能力。

## P0：工具能力冲 9 分

已落地：

- 新增 `ic android doctor`：独立诊断 Android SDK、AVD、system-images、ADB、boot_completed、PackageManager。
- 新增 `ic android start`：复用启动探测，执行 `assembleDebug -> adb install -r -> resolve-activity/am start`。
- `run_command` 支持 `timeoutMs`，Android 长构建不再被 30s 默认超时误杀。
- Android 诊断支持 `local.properties sdk.dir` fallback。

验收命令：

```bash
ic android doctor --json
ic android start --json
ic orchestrate "启动项目" --execute --max-steps 6 --json
```

## P1：Claude Code 替代能力冲 9 分

已落地：

- 新增 `ic task-run "<任务>"`：长任务工具编排入口，保留 plan/step/recover/done 事件。
- 保留 `ic orchestrate` 作为底层确定性编排，`task-run` 面向用户长任务体验。
- 新增真实项目套件脚本 `npm run smoke:real-projects`，覆盖 AgentFI 与 Polymarket 可用路径。

## P2：体验做顺

已落地：

- Android 启动不再使用会污染输出的 `monkey` 主路径，改为 `resolve-activity + am start`。
- `--json` 输出保持可解析，工具事件进入结果 payload。
- Android 启动结果包含前台 Activity 证据。

仍需继续：

- REPL 内流式节奏和折叠展示仍需要 UI 层进一步优化。
- 记忆冲突主动合并还需要下一轮做深。

## P3：发布前补齐

已落地：

- 新增 `ic pr-create`：默认 dry-run，生成 `gh pr create` 命令；加 `--go` 才真正调用 GitHub CLI。
- 新增 `npm run smoke:real-projects`，把真实项目验收沉淀为发布前可跑的套件。
- 文档记录 Android/AgentFI/Polymarket 的实际验收链路。

## 下一轮建议

1. 在 macOS 实机跑 `npm run macos:acceptance` 与 `npm run smoke:real-projects`。
2. 给 `ic task-run` 接入任务报告落盘，形成完整 8 项产物。
3. 给 `ic pr-create --go` 增加分支状态检查和远端检测。
4. 把 `ic android doctor` 的诊断结果接入 `ic doctor` 总体健康检查。
