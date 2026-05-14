# DEV2-S5.12 Unified Choice Panel Core

日期：2026-05-13
开发者：dev2

## 背景

用户明确要求确认面板和输入框不要像普通聊天一样混在一起。上一轮已经修复系统权限确认的回显问题，但文件写入、系统操作、撤销、提交仍各有自己的面板逻辑，不利于继续升级为固定底部 TUI。

## 完成内容

- 新增 `src/cli/choice-panel.ts`：统一选择面板模型、渲染、prompt 和数字解析。
- 系统权限确认复用 `renderChoicePanel()`。
- 文件写入确认复用 `renderChoicePanel()`，每个文件成为一个可选项，预览/取消作为后续选项。
- REPL 新增 `activeChoicePanel`，用于动态设置确认态输入框。
- `parseBottomSelection()` 复用 `parseChoiceInput()`，保持旧测试兼容。
- REPL 冒烟新增确认数字不回显为聊天消息的断言。

## 验收命令

- `npm run build`
- `npm run test -- choice-panel system-approval repl-completer`
- `npm run smoke:repl`

## 后续

下一步应继续把 commit/undo 的确认面板也接到 `choice-panel`，再进一步把输出层升级为真正 TUI bottom dock，而不是纯 `console.log` 面板。
