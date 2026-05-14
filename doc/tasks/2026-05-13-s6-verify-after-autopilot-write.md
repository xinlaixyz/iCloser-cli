# DEV2-S6.7 Verify After Autopilot Write

日期：2026-05-13
负责人：dev2
状态：已完成

## 目标

让 `ic auto docs --go` 和 `ic auto tests --go` 写入后立即返回验证结果。用户不仅知道文件存在，还知道系统做过校验；如果依赖未安装，系统明确跳过并给出下一步，不假装通过。

## 修改文件

- `src/core/autopilot-verify.ts`
- `src/index.ts`
- `tests/autopilot-verify.test.ts`
- `scripts/autopilot-smoke.mjs`
- `doc/DEVELOPMENT.md`

## 行为

### 文档写入

```bash
ic auto docs --go --json
```

返回：

```json
{
  "kind": "autopilot-docs-written",
  "data": {
    "verification": {
      "status": "pass",
      "kind": "docs"
    }
  }
}
```

### 测试写入

```bash
ic auto tests --go --json
```

如果依赖已安装，会运行测试命令；如果没有 `node_modules`，返回：

```json
{
  "verification": {
    "status": "skipped",
    "summary": "项目依赖尚未安装，跳过测试命令执行",
    "suggestion": "请先运行 npm install，然后重新执行 ic auto tests --go。"
  }
}
```

## 原则

- 能验证就自动验证。
- 不能验证时明确 skipped，不假装成功。
- 验证摘要必须进入普通输出和 JSON 回执。
