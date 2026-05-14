# DEV2-S6.5 Safe Documentation Writer Receipt

日期：2026-05-13
负责人：dev2
状态：已完成

## 目标

补强 `ic auto docs`，让自动文档写入不再只是“显示成功”，而是写入后立即验证磁盘，并通过 JSON 返回可脚本消费的回执。

## 修改文件

- `src/core/autodoc.ts`
- `src/index.ts`
- `tests/autodoc.test.ts`
- `scripts/autopilot-smoke.mjs`
- `doc/PROJECT_AUTOPILOT.md`
- `doc/DEVELOPMENT.md`

## 用户命令

```bash
ic auto docs              # 预览缺失文档和中文确认说明，不写入
ic auto docs --json       # 输出文档计划 JSON，不写入
ic auto docs --go         # 写入缺失文档
ic auto docs --go --json  # 写入并输出 verified receipt JSON
ic auto docs --go --yes   # 覆盖已有文档
```

## JSON

计划：

```json
{
  "kind": "autopilot-docs"
}
```

写入回执：

```json
{
  "kind": "autopilot-docs-written",
  "data": {
    "written": [
      {
        "file": "docs/PRD.md",
        "fullPath": "...",
        "verified": true,
        "bytes": 1234,
        "lines": 60
      }
    ]
  }
}
```

## 验收标准

- 写入后必须 `verified=true`。
- 文档必须位于 `docs/` 目录。
- 默认不覆盖已有文档。
- 覆盖必须显式 `--go --yes`。
- `smoke:autopilot` 必须验证真实文件存在。
