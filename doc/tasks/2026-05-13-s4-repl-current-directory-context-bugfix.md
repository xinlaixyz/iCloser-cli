# S4 REPL Current Directory Context Bugfix

## 背景

用户在 REPL 输入“分析代码质量，整个目录”后，AI 回复“无法访问文件系统/请提供文件内容”。这是严重体验问题：iCloser Agent Shell 本来就运行在当前目录，用户不应该手动粘贴文件或解释路径。

## 根因

- REPL 普通聊天只使用轻量 `state.projectIndex`，没有接入核心 `assembleContextFromProject()`。
- 未扫描或索引为空时，模型收到的源码上下文几乎为空。
- system prompt 没有明确说明“iCloser 已提供当前目录和源码上下文”，导致真实模型按普通聊天机器人口吻拒绝。
- mock provider 对分析类请求仍默认生成写文件 JSON，不符合只读分析语义。
- 额外发现 `index.ts` 存在 `memory events` 与 `mem|memory` 命令重名，导致 CLI 启动崩溃。

## 修复内容

- REPL 普通聊天改为调用 `assembleContextFromProject(rootPath, task, { scanIfMissing: true })`。
- 缺少索引时自动扫描并保存 `.icloser/index.json`。
- 成功加载索引后同步 REPL 的 `state.projectIndex`。
- system prompt 注入当前工作目录，并要求模型不要声称无法访问文件系统。
- 对“整个目录 / 当前目录 / 代码质量 / 项目结构”请求添加整体分析提示。
- 增加目录列表 fallback，scanner 失败时仍能给模型基本上下文。
- mock provider 对只读分析类请求返回 prose，不生成 pending file。
- `memory events` 改为 `ic mem events`，避免 commander 命令冲突。

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke:repl:e2e`
- `npm run smoke:all`

## 用户侧结果

用户在 REPL 输入：

```text
分析代码质量，整个目录
```

系统应基于当前目录索引和源码上下文直接分析，不再要求用户提供文件内容或路径。
