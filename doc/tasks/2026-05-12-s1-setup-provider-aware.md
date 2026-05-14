# S1 Provider-Aware Setup

日期：2026-05-12
负责人：dev2
阶段：S1.21

## 目标

重构 `ic setup` 的首次安装体验，避免硬编码 DeepSeek 网络检查，让 setup 能围绕当前 Provider、API Key、mock fallback 和连通性检查给出清晰路径。

## 本次变更

- `src/index.ts`
  - `ic setup` 不再请求 `https://api.deepseek.com/v1/models`。
  - 新增参数：
    - `ic setup --mock`
    - `ic setup --provider <name>`
    - `ic setup --model <name>`
    - `ic setup --json`
  - 自动选择逻辑：
    - 如果指定 `--mock`，使用 mock。
    - 如果指定 `--provider`，使用指定 Provider。
    - 否则优先选择检测到环境变量的真实 Provider。
    - 没有任何 Key 时默认使用 mock。
  - setup 后提示：
    - `ic init`
    - `ic provider doctor`
    - `ic provider test`
    - `ic t "你的任务描述"`
- `src/config.ts`
  - 新增 `ICLOSER_HOME` 支持，允许覆盖全局配置目录。
  - 默认仍是 `~/.icloser`。
- `tests/json-contract-spawn.test.ts`
  - 新增 setup spawn 测试：
    - `ic setup --mock --json` 可解析，并写入 `ICLOSER_HOME/config.json`。
    - `ic setup --provider openai --json` 在无 Key 时也可解析。
- `doc/help.md` / `doc/DEVELOPMENT.md`
  - 补充 setup 参数和 `ICLOSER_HOME` 行为。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，79 个测试（后续 S1 测试已增补）。
- CLI 轻量验收通过：
  - `ICLOSER_HOME=C:\tmp\icloser-setup-home2`
  - `node dist\index.js setup --mock`
  - `node dist\index.js setup --provider openai --json`
  - `setup --json` 输出 `kind: setup`，可被 JSON parser 解析。

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.21 Provider-Aware Setup，请验收并补 README/安装体验：

1. ic setup 已重构：
   - 不再硬编码 DeepSeek 网络检查。
   - 支持：
     - ic setup --mock
     - ic setup --provider <name>
     - ic setup --model <name>
     - ic setup --json

2. 自动选择 Provider：
   - 指定 --mock 时使用 mock。
   - 指定 --provider 时使用指定 Provider。
   - 未指定时，优先选择检测到环境变量的真实 Provider。
   - 没有任何 API Key 时默认使用 mock，保证本地 smoke 可跑。

3. 新增 ICLOSER_HOME：
   - 可覆盖全局配置目录。
   - 默认仍是 ~/.icloser。
   - 适合测试、CI、受限环境。

4. 新增 spawn 测试：
   - setup --mock --json
   - setup --provider openai --json

5. 当前验收：
   - npm run build 通过
   - npm run test 通过：11 个测试文件，79 个测试（后续 S1 测试已增补）
   - setup --json stdout 为纯 JSON，kind = setup

请你补：
- README.md 快速开始改成：
  1. npm link
  2. ic setup --mock 或配置真实 Key 后 ic setup --provider openai
  3. ic provider test
  4. ic init
  5. ic t "..."
- 安装脚本/postinstall 如有旧 iCloser/setup 说明，统一到 ic。
- 如需要，给 ICLOSER_HOME 补一小段高级用法说明。
```

## 后续建议

- 增加交互式 provider 选择。
- 增加 `ic setup --test`，setup 后自动跑 provider test。
- 增加 keychain 支持前，继续推荐环境变量。
