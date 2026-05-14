# DEV2-S6.12 Repair Smoke Gate

日期：2026-05-14
负责人：dev2

## 目标

把自动修复链路纳入稳定验收：系统发现自动写入后的校验失败时，不能只给用户一个错误，而要具备“生成修复计划、执行最小修复、再次验证、必要时回滚”的产品闭环。

## 本轮完成

- 新增 `scripts/autopilot-repair-smoke.mjs`。
- 新增 npm 脚本 `smoke:repair`。
- `scripts/full-smoke.mjs` 纳入 repair gate。
- 验收文档高确定性失败：缺少一级标题 → 自动补标题 → 文档复验通过。
- 验收测试高确定性失败：语法缺失闭合括号 → 最小修复测试文件。
- 验收安全边界：拒绝修复项目目录外路径。

## 验收标准

```bash
npm run smoke:repair
npm run smoke:all
```

`smoke:repair` 必须输出 `[repair-smoke] PASS`。
