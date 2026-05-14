# S1 Config JSON Contract

日期：2026-05-12
负责人：dev2
阶段：S1.23

## 目标

补齐 `ic config --json`，让脚本、CI 或后续 UI shell 能读取当前项目配置摘要，同时避免泄露 API Key。

## 本次变更

- `src/cli/json.ts`
  - 新增 `ConfigJson`。
  - 新增 `serializeConfig(config)`。
  - 输出包含：
    - project identity
    - ai provider/model/ready/keySource/envVars
    - execution
    - security 统计和 disabledRules
    - skills
    - memory
  - 不输出 `apiKey` 字段。
- `src/index.ts`
  - `ic config --json` 输出：
    - envelope `kind: config`
    - `data: serializeConfig(config)`
- `tests/json-contract.test.ts`
  - 覆盖 `serializeConfig()` 不泄露 `apiKey`。
- `tests/json-contract-spawn.test.ts`
  - 覆盖 `ic config --json` 可解析。
- `doc/help.md`
  - 补充 `ic config --json` 命令说明。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，79 个测试。
- `node dist\index.js config --json` 可解析，`kind = config`。
- `npm run smoke` 通过。

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.23 Config JSON Contract，请验收并补文档：

1. 新增 ic config --json。
2. 输出统一 JSON envelope：
   {
     "version": 1,
     "kind": "config",
     "data": {}
   }

3. data 内容是公开配置摘要：
   - project identity
   - ai provider/model/ready/keySource/envVars
   - execution
   - security 统计与 disabledRules
   - skills
   - memory

4. 安全要求：
   - 不输出 apiKey 字段
   - 不输出明文 Key

5. 当前验收：
   - npm run build 通过
   - npm run test 通过：11 个测试文件，79 个测试
   - node dist/index.js config --json 可解析，kind = config
   - npm run smoke 通过

请你补：
- README.md 的 JSON Output 列表增加 ic config --json。
- DEVELOPMENT.md 的 JSON contract 小节增加 kind=config。
- 如果补 CI 文档，把 config --json 放进可选诊断命令。
```

## 后续建议

- 后续新增 JSON 输出都继续走 `src/cli/json.ts` serializer。
- 可增加 `ic config security --json`，但当前 `config --json` 已覆盖安全摘要。
