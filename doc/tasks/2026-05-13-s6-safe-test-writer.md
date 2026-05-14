# DEV2-S6.6 Safe Test Writer

日期：2026-05-13
负责人：dev2
状态：已完成

## 目标

让 `ic auto tests` 从“只生成测试计划”推进到“能安全写入一个最小测试文件”。本阶段坚持小步策略：一次只处理一个模块、一个测试文件，写入后必须磁盘验证，不自动大批量改代码。

## 修改文件

- `src/core/autotest.ts`
- `src/index.ts`
- `tests/autotest.test.ts`
- `scripts/autopilot-smoke.mjs`
- `doc/DEVELOPMENT.md`

## 用户命令

```bash
ic auto tests              # 只读测试规划
ic auto tests --json       # 测试计划 JSON
ic auto tests --go         # 为最高优先级缺口模块写入 1 个测试文件
ic auto tests --go --json  # 写入并输出 verified receipt JSON
ic auto tests --go --module pages
ic auto tests --go --yes   # 覆盖已有测试文件
```

## JSON

```json
{
  "kind": "autopilot-tests-written",
  "data": {
    "written": [
      {
        "file": "src/pages/Home.test.tsx",
        "sourceFile": "src/pages/Home.tsx",
        "fullPath": "...",
        "verified": true,
        "bytes": 200,
        "lines": 9
      }
    ]
  }
}
```

## 安全规则

- 默认只写入一个测试文件。
- 默认不覆盖已有测试文件。
- 覆盖必须显式 `--yes`。
- 写入后必须返回 `verified=true`。
- 后续阶段再接自动运行测试与失败修复。
