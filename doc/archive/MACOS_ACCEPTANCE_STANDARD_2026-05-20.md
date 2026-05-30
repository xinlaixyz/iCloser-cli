# macOS 顺畅度验收标准

日期：2026-05-20  
适用定位：**本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统**  
目的：把 macOS 作为一等公民平台验收，而不是仅做“理论跨平台兼容”。

## 一、验收结论口径

AgentCode 要替代 Claude Code / Codex，必须在 macOS 开发者主力环境中顺畅运行。macOS 验收不只看测试是否通过，还要检查安装、首次运行、Shell 命令、路径权限、工具调用、长期记忆和打包交付体验。

当前状态：**待真实 macOS 机器复验**。本轮在 Windows 上完成源码与测试标准审查，确认项目已有跨平台基础，但不能代替真实 macOS 验收。

当前 macOS 顺畅度评分：**7.4 / 10**。

## 二、必须通过的命令门禁

在 macOS 真实机器或 `macos-latest` CI 上执行：

```bash
npm ci
npm run build
npx tsc --noEmit
npm run lint
npm test
npm run smoke
npm run smoke:tools
```

最低通过标准：

- 0 failed。
- `--json` 命令 stdout 保持纯 JSON。
- 不出现会误导用户的 `fatal`、权限 warning、Memory mock ERROR。
- smoke 失败必须给出可行动原因，不能静默跳过核心能力。

## 三、真实用户路径

在 macOS 新目录中执行：

```bash
ic --help
ic setup --mock --json
ic init
ic scan --json
ic doctor --json
ic provider list --json
ic mem status
ic mem manifests
ic t "读取项目并给出修改计划" --dry-run
```

通过标准：

- 首次运行不要求用户理解内部目录结构。
- 非 git 项目不能输出生硬的 `fatal: not a git repository`。
- mock provider 可完成基础计划链路。
- 记忆命令可读写 `.icloser` 或隔离后的 `ICLOSER_HOME`。

## 四、工具能力 macOS 检查

12 个 AI 工具必须在 macOS 上完成 smoke：

| 工具 | macOS 检查点 |
|------|--------------|
| `read_file` | `/Users/...`、含空格路径、软链接路径安全 |
| `search_code` | rg/grep 路径和编码正常 |
| `run_command` | Unix 原生命令直通，不被 Windows 适配破坏 |
| `web_search` | 网络不可用时清晰降级 |
| `code_intel` | 项目索引可读取 |
| `git_status` | 非 git 目录安静降级 |
| `web_fetch` | 正文抓取失败有可行动提示 |
| `list_dir` | 隐藏文件、权限不足目录处理清晰 |
| `get_project_overview` | 新项目可生成稳定画像 |
| `read_pdf` | PDF warning 不污染用户主输出 |
| `read_docx` | 不依赖 Windows Office 或 COM |
| `read_xlsx` | 不依赖 Excel 桌面应用 |

## 五、Shell 与构建工具检查

macOS 上必须验证：

```bash
ls
cat package.json
grep -R "TODO" src
python3 --version
./mvnw --version
./gradlew --version
```

通过标准：

- `run_command` 对 macOS/Linux 命令保持原生执行。
- `mvnw.cmd` / `gradlew.bat` 只在 Windows 使用；macOS 使用 `./mvnw` / `./gradlew`。
- 权限不足时提示 `chmod +x`，但不自动执行危险授权。

## 六、安装与打包检查

必须覆盖：

- 源码运行：`npm ci && npm run build && node dist/index.js --help`
- npm 全局安装：`npm install -g` 后 `ic --help`
- tar 包安装：解压后 CLI 可执行
- pkg 安装：安装后 PATH/入口可用
- Gatekeeper/quarantine：首次运行如果被拦截，文档给出明确处理方式

相关脚本：

- `scripts/build-macos-installer.sh`
- `scripts/build-macos-pkg.sh`
- `scripts/build-package.mjs`

## 七、路径与权限检查

必须覆盖：

- `/Users/<user>/Projects/demo`
- `/Users/<user>/Projects/demo with space`
- 软链接项目目录
- 只读文件
- `.icloser` 不存在、不可写、已存在三种状态
- `ICLOSER_HOME` 指向临时目录

通过标准：

- 不越权写入项目根目录外。
- 路径安全检查使用真实路径，软链接不能绕过。
- 权限问题降级为中文、可行动提示。

## 八、长期记忆检查

必须在 macOS 上验证：

```bash
ic mem manifests
ic mem import AGENTS.md CLAUDE.md
ic mem recall "项目规范"
ic mem export AGENTS.generated.md
```

通过标准：

- `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules` 可识别。
- Node 18/20 使用 JSONL/rules 降级路径，Node 24+ 可启用 SQLite 增强。
- 记忆初始化失败不能阻断普通任务。

## 九、发布前判定

| 分数 | 判定 |
|------|------|
| 9.0+ | macOS 可作为主力平台发布 |
| 8.5-8.9 | 可发布，但需列出少量已知限制 |
| 7.5-8.4 | 可内测，不建议对外承诺顺滑替代 Claude Code |
| 7.4 以下 | 只能声明理论兼容，不能作为正式卖点 |

当前 7.4 的主要扣分项：

- 缺真实 macOS 机器全量测试记录。
- 缺 macOS 安装包首次运行验收。
- 缺 macOS quick start 和常见权限问题说明。
- 缺 macOS 工具 smoke 的历史基线。

## 十、下一步任务

1. 在 GitHub Actions `macos-latest` 中加入 `npm run smoke:tools`。
2. 在真实 Mac 上执行本文件第二至第八节，并保存验收日志。
3. 修复所有 macOS 上出现的 JSON 污染、权限 warning、native dependency 安装问题。
4. 更新 README/TESTING，补齐 macOS quick start。
5. 通过后把 macOS 顺畅度评分从 7.4 更新到真实验收分。
