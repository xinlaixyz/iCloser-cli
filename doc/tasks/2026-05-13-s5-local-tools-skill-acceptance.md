# DEV2-S5.6 local-tools Skill 交叉验收与修补

日期：2026-05-13

## 背景

dev1 新增“本地开发工具管家” skill，并安装 ESLint 作为第一轮本地工具能力。dev2 负责交叉验收。

## 验收结论

有条件通过，阻塞项已由 dev2 修补。

## dev1 交付内容

- `skills/local-tools/manifest.json`
- `skills/local-tools/system-prompt.md`
- `src/skill/manager.ts` 注册 `local-tools`
- `eslint.config.mjs`
- `package.json` / `package-lock.json` 增加 ESLint 相关 devDependencies
- `scripts/check-lint.mjs` 接入 ESLint

## dev2 修补内容

- 修复 `scripts/check-lint.mjs` 在 Windows 下调用 `npx.cmd` 静默失败的问题。
- ESLint warning 不作为当前发布阻塞，但会明确输出 warning 数量。
- 新增 `tests/skill-manager.test.ts`，覆盖：
  - `local-tools` 是 enabled builtin skill。
  - 新手工具安装请求能匹配 `local-tools`。

## 风险

- 当前 ESLint 还有 57 个 warning，主要是既有未使用变量。建议下一轮独立清理。
- `skills/local-tools` 与 `src/skill/manager.ts` 仍是双份定义，建议下一轮统一为从 `skills/` 目录加载内置 skill。

## 验收命令

- `npm run lint`
- `npm run build`
- `npm run test -- skill-manager`
- `npm run test`
- `npm run smoke:all`

