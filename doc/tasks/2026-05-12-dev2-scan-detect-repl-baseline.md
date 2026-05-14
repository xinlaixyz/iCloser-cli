# 2026-05-12 dev2 S1 基线：detect / scan / REPL / verify

## 背景

当前 iCloser Agent Shell 处于骨架代码补实阶段。S1 的优先目标是建立最短可用工程闭环：

```text
iCloser init → iCloser scan → 生成可持久化索引 → REPL/任务可使用索引 → 验证失败真实失败
```

## 已完成

### 项目识别

- 修复 `src/utils/detect.ts` 中 `fs-extra` 在 ESM 下 namespace import 导致文件列表读取失败的问题。
- `iCloser init --force` 现在可正确识别当前项目：
  - language: `typescript`
  - buildSystem: `npm`
  - testFramework: `vitest`

### 项目索引

- `src/core/scanner.ts` 新增索引持久化能力：
  - `serializeProjectIndex(index)`
  - `deserializeProjectIndex(raw)`
  - `saveProjectIndex(rootPath, index)`
  - `loadProjectIndex(rootPath)`
- `dependencyGraph` 写入 JSON 时转换为 object，读取时恢复为 `Map<string, string[]>`。
- `iCloser scan` 已改为调用核心 `scanProject()`，并写入 `.icloser/index.json`。
- REPL `/init` 与 `/scan` 已优先复用核心 scanner。
- 模块分组粒度调整为目录级：
  - `src`
  - `src/core`
  - `src/cli`
  - `src/utils`
  - 其他二级模块

### REPL 入口

- 修复 `src/cli/repl.ts` 缺失 `cmdEdit()`、`cmdUndo()` 导致构建失败的问题。
- `/verify` 不再用 `|| echo ok` 吞掉失败。
- Windows 下 npm/npx 验证命令通过 `cmd.exe /d /s /c` 执行，避免 `spawnSync npm.cmd EINVAL`。
- `/search` 改为 `execFileSync('rg', args)`，避免 shell quoting 与 `--type-not binary` 兼容问题。
- 新增 `/context [描述]`，用于预览 rich context 会注入哪些文件、token 估算和预算占比。该命令不调用 AI。
- `ContextPackage` 相关性评分已支持基础中文工程词映射，例如“给用户服务增加邮箱校验”可以命中 `src/service/user.ts`。
- 新增 `summarizeContextDebug(context, limit)`，供 REPL `/context` 和后续 CLI task 输出上下文调试摘要复用。

### 测试

- 新增 `tests/detect.test.ts`：
  - TypeScript + npm + Vitest 识别
  - Go + Gin + PostgreSQL 识别
- 新增 `tests/scanner.test.ts`：
  - `scanProject()` 生成索引
  - `saveProjectIndex()` / `loadProjectIndex()` round-trip
  - `dependencyGraph` 读回后仍为 `Map`

## 验收结果

```bash
npm run build
npm run test
node dist/index.js init --force
node dist/index.js scan
```

当前结果：

- `npm run build` 通过。
- dev2 范围测试通过：`tests/detect.test.ts`、`tests/scanner.test.ts`、`tests/context.test.ts` 共 5 个用例。
- `.icloser/icloser.json` 可正确写入项目身份。
- `.icloser/index.json` 可生成并读回。
- 当前项目扫描结果：20 个源码文件，9 个模块。

## 给 dev1 的接入点

dev1 做 task 主链时可以直接依赖：

- `loadConfig(rootPath)`
- `scanProject(...)`
- `saveProjectIndex(rootPath, index)`
- `loadProjectIndex(rootPath)`
- `assembleContextFromProject(rootPath, task, options)`
- `summarizeContextDebug(context, limit)`
- `.icloser/index.json`

建议 task 主链优先读取 `.icloser/index.json`；如果不存在，再调用 `scanProject()` 兜底生成。

如果只需要一个完整上下文包，优先调用：

```typescript
const { assembleContextFromProject } = await import('./core/context.js');
const contextPkg = await assembleContextFromProject(rootPath, task, {
  maxTokens: config.ai.maxTokens,
});
```

这个入口会自动读取项目索引和项目记忆；索引缺失时默认自动扫描并保存。

## 下一步建议

dev2 下一步可继续做：

- 将 task 主链从手动加载 index/memory 迁移到 `assembleContextFromProject()`。
