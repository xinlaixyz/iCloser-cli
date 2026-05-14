# S1 Release Smoke Script

日期：2026-05-12
负责人：dev2
阶段：S1.22

## 目标

把“本地可跑版验收”固化为一个命令，避免每次手动复制一串 CLI 命令。以后只要运行 `npm run smoke`，就能判断当前版本是否具备最小可演示闭环。

## 本次变更

- `package.json`
  - 新增脚本：`npm run smoke`
- `scripts/release-smoke.mjs`
  - 自动运行：
    - `npm run build`
    - `npm run test`
    - 创建临时项目
    - `ic setup --mock --json`
    - `ic init --force`
    - `ic provider use mock`
    - `ic provider test --json`
    - `ic doctor --json`
    - `ic t "...notes.txt..." --go`
    - `ic status --json`
    - `ic gate <task-id> --json`
    - `ic report`
  - 校验：
    - JSON 输出可解析
    - provider test 通过
    - doctor ready = true
    - task 状态为 `completed`
    - gate `passed = true`
    - `notes.txt` 包含 mock edit marker
  - 支持 `ICLOSER_KEEP_SMOKE=1` 保留临时项目，方便排查。
- `README.md`
  - 新增 Release Smoke Test 说明。
- `install.ps1` / `install.sh`
  - 复验 S1.21 时修正残留文案：默认提示使用 `ic setup` / `ic --help`，保留 `iCloser` 为兼容别名。

## 验收

- `npm run smoke` 通过。
- smoke 内部也通过：
  - `npm run build`
  - `npm run test`：11 个测试文件，79 个测试
  - mock provider 主链完成
  - doctor ready = true
  - gate passed
  - report 可读取

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.22 Release Smoke Script，请验收并补文档/CI 建议：

1. 新增 npm 脚本：
   - npm run smoke

2. 新增脚本：
   - scripts/release-smoke.mjs

3. smoke 会自动执行：
   - npm run build
   - npm run test
   - 临时项目 init
   - setup --mock --json
   - provider use mock
   - provider test --json
   - doctor --json
   - task --go
   - status --json
   - gate --json
   - report

4. 验收标准：
   - npm run smoke 退出码为 0
   - 输出最后包含 [smoke] PASS <task-id>
   - gate passed = true

5. 额外说明：
   - 默认会清理临时项目。
   - 设置 ICLOSER_KEEP_SMOKE=1 或运行 npm run smoke:keep 可保留临时项目用于排查。

请你补：
- README 中如果需要更醒目的“发布前运行 npm run smoke / npm run smoke:keep”说明。
- DEVELOPMENT.md 检查 release smoke 小节是否清楚。
- 后续 CI 配置建议：pull request / release 前运行 npm run smoke。
```

## 后续建议

- CI 接入时可先用 `npm run smoke` 作为 release gate。
- 后续真实 Provider 联调可增加 `npm run smoke:provider`，但默认 smoke 继续使用 mock 保持稳定。
