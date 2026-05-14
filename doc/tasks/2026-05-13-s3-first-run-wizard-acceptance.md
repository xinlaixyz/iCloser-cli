# S3.1 First-Run Wizard Acceptance & Hardening

日期：2026-05-13
负责人：dev1
状态：完成

## 目标

验证并补强"完全不会用的人也能启动"的首轮体验。不做核心逻辑重构，优先验收脚本、边界测试和文档补强。

## 变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `scripts/first-run-smoke.mjs` | 首轮向导自动化验收脚本（8 个测试） |
| `tests/first-run.test.ts` | 首轮体验单元测试（27 个测试） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `smoke:first-run` 脚本 |
| `doc/DEVELOPMENT.md` | 新增 S3.1 记录 |
| `doc/NEW_USER_ONBOARDING.md` | 补充 `--key` 测试/安全提示 |

## first-run-smoke.mjs 测试覆盖

| # | 测试 | 验证点 |
|---|------|--------|
| 1 | `ic setup --mock --json` | mock provider, no apiKey in JSON |
| 2 | `ic setup --provider deepseek --key <fake> --json` | provider=deepseek, fake key not leaked, keySource=config |
| 3 | `ic config --json` (after init) | ai section has no apiKey field, no key in serialized string |
| 4 | `ic doctor --json` | project inherits global provider/model, keySource=config |
| 5 | `ic provider doctor --json` | keySource=config, ready=true, no key leaked |
| 6 | `ic provider list --json` | no key leaked in any provider status |
| 7 | Mock project isolation | mock project stays mock even when global has deepseek+key |
| 8 | `ic setup --provider unknown` | graceful error, no crash |

## first-run.test.ts 测试覆盖

- **JSON safety** (3 tests): `serializeConfig` never includes `apiKey`, ai section has correct shape, mock shows not-required
- **maskApiKey** (5 tests): long keys, sk-ant- prefix, dashscope- prefix, short keys, original key not in masked output
- **inferProviderFromApiKey** (8 tests): claude/openaai/qwen inference, fallback to deepseek, custom fallback, mock→deepseek redirect
- **isLikelyApiKey** (6 tests): recognizes sk-/sk-ant-/dashscope- keys, rejects spaces/short strings/non-key text
- **getProviderStatus with config key** (3 tests): keySource=config, keySource=missing, config key preferred
- **config provider/model defaults** (2 tests): mock never overwritten, real provider inherits global config

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm run build` | 通过 |
| `npm run test` | 14 文件, 138 测试通过 (+27) |
| `npm run smoke` | PASS |
| `npm run smoke:project` | PASS |
| `npm run smoke:first-run` | 8/8 测试通过 |

## NEW_USER_ONBOARDING 命令 smoke 覆盖

| 命令 | 覆盖方式 |
|------|---------|
| `ic` (REPL 粘贴 Key) | provider.test.ts `isLikelyApiKey` / `maskApiKey` |
| `ic setup --mock --json` | first-run-smoke Test 1 + json-contract-spawn |
| `ic setup --provider deepseek --key` | first-run-smoke Test 2 |
| `ic provider key` | provider.test.ts key guidance tests |
| `ic provider test` | json-contract-spawn provider test |
| `ic config --json` (安全) | first-run-smoke Test 3 |

## 后续风险

- `--key` 路径适合测试，普通用户应优先 REPL 粘贴 Key（已在 NEW_USER_ONBOARDING 注明）
- 全局配置合并逻辑在 `loadConfig()` 中，mock 项目隔离依赖 `config.ai.provider !== 'mock'` 判断
- 首次 `ic setup --key` 后会真正尝试网络连通（smokeTestProvider），fake key 会超时但不影响配置持久化
