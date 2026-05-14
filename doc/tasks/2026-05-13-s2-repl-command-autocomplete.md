# S2.7 REPL Command Autocomplete

## 背景

REPL 命令逐渐增多后，用户需要记住 `/status`、`/scan`、`/verify`、`/config provider ...` 等命令。真实使用时应允许用户边输入边用 Tab 自动联想。

## 目标

为交互式 REPL 增加原生命令补全能力。

## 变更

- `src/cli/repl.ts`
  - 为 `readline.createInterface()` 增加 `completer`。
  - 新增 `replCompleter()`。
  - 支持 slash 命令前缀补全。
  - 支持 `/config provider <provider>` 补全。
  - 支持 `/config model <model>` 按当前 Provider 模型列表补全。
  - 底部快捷提示新增 `Tab 补全`。
- `tests/repl-completer.test.ts`
  - 覆盖 slash 命令、config key、provider、model、普通聊天不补全。

## 使用示例

```text
/sta<Tab>                  -> /status
/config p<Tab>             -> /config provider
/config provider de<Tab>   -> /config provider deepseek
```

## 验收

- `npm run build`
- `npm run test`
- `npm run smoke`
- `npm run smoke:project`
