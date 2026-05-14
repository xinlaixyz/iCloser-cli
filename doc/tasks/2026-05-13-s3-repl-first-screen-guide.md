# S3.4 REPL First Screen Guide

## 背景

S3.2 已支持 `/apikey` 安全输入，但完全新手第一次打开 `ic` 时仍可能不知道下一步该做什么。首屏应直接给出选择，而不是只展示命令列表。

## 目标

让用户打开 `ic` 后一眼看到下一步。

## 行为

未配置真实 Key 时：

```text
1  粘贴 API Key    接入真实模型
2  /apikey         安全输入 Key，不显示在屏幕上
3  直接输入需求    先用 mock 离线体验
```

已配置真实 Provider 时：

```text
1  直接输入需求    例如：帮我给登录模块加手机号验证码登录
2  /scan           扫描项目
3  /status         查看当前状态
```

## 变更

- `src/cli/repl.ts`
  - 新增 `printFirstRunGuide()`。
  - REPL 启动后、底部快捷命令前显示首屏向导。
- `README.md`
  - 补充首屏三选项说明。
- `doc/NEW_USER_ONBOARDING.md`
  - 补充无 Key / 已配置 Key 的首屏表现。
- `doc/DEVELOPMENT.md`
  - 新增 S3.4 记录。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke:first-run`
- `npm run smoke`
- `npm run smoke:project`
