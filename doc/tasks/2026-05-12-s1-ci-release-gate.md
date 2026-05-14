# S1 CI Release Gate

日期：2026-05-12
负责人：dev2
阶段：S1.25

## 目标

把本地 release smoke 固化为默认 CI 门槛，让 PR 和主分支 push 都能自动验证“可跑版”闭环。

## 本次变更

- `.github/workflows/smoke.yml`
  - 新增 GitHub Actions workflow。
  - 触发条件：
    - `pull_request`
    - push 到 `main` / `master`
  - 运行环境：
    - `windows-latest`
    - Node 22
    - `npm ci`
    - `npm run smoke`
- `scripts/release-smoke.mjs`
  - 修正干净 CI 环境下的顺序：先执行 `npm run build`，再检查 `dist/index.js`。
- `README.md`
  - CI 说明改为指向仓库内置 workflow。
- `doc/DEVELOPMENT.md`
  - 补充 CI release gate 说明。

## 验收

- `npm run smoke` 通过。
- smoke 内部通过：
  - `npm run build`
  - `npm run test`：11 个测试文件，79 个测试
  - `ic doctor --json`
  - mock task 主链
  - gate passed

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.25 CI Release Gate，请验收并补充文档措辞：

1. 新增 GitHub Actions：
   - .github/workflows/smoke.yml

2. CI 触发：
   - pull_request
   - push 到 main/master

3. CI 执行：
   - windows-latest
   - Node 22
   - npm ci
   - npm run smoke

4. 同步修复：
   - scripts/release-smoke.mjs 原来在 build 前检查 dist/index.js，干净 CI 环境可能失败。
   - 现在改为先 npm run build，再检查 dist/index.js。

5. 已验收：
   - npm run smoke 通过
   - npm run test：11 个测试文件，79 个测试

请你重点检查：
- README 的 CI 段落是否清楚。
- DEVELOPMENT.md 是否应该补“PR 合并门槛：必须 npm run smoke 通过”。
- 是否需要增加分支策略说明：所有 S1 代码进入主分支前必须通过 smoke。
```

## 后续建议

- 等仓库接入 GitHub 后，把该 workflow 设置为 required check。
- 后续真实 Provider 联调可另建手动 workflow，不影响默认 mock smoke 稳定性。
