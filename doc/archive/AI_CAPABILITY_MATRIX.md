# AI 能力调用矩阵

日期：2026-05-20
范围：AI 通过工具系统可以调用的全部项目能力

---

## 一、工具能力表（12 工具 × 覆盖范围）

| 工具 | 用途 | 覆盖文件类型 | 自动增强 |
|------|------|-------------|----------|
| **read_file** | 读取文件完整内容 | `.ts` `.js` `.go` `.py` `.java` `.json` `.yaml` `.md` `.pdf` `.html` `.pptx` `.ppt` `.css` `.sql` 等 30+ 扩展名 | PDF→文本提取, HTML→文本提取, PPTX→幻灯片提取, >200行→骨架压缩 |
| **search_code** | 正则搜索项目代码 | 所有文本文件（30+ 扩展名） | >50结果→截断压缩, 空结果→策略切换提示 |
| **code_intel** | 符号定义/引用/类型查询 | TS/TSX/JS/JSX/Go/Python/Java/Kotlin | AST tree-sitter 解析, 调用图分析 |
| **run_command** | 执行本地命令 | 构建/测试/lint/启动 | Windows 命令适配, macOS/Linux 原生命令直通, mvnw/gradlew 检测, 危险命令拦截 |
| **web_search** | 网络搜索 | DuckDuckGo | 二级缓存(1h/24h), 结果去重 |
| **git_status** | Git 状态查询 | status/log/diff/branch | 10s 超时保护 |
| **web_fetch** | 抓取网页正文 | URL | 正文提取、网络不可用降级 |
| **list_dir** | 目录探索 | 项目目录 | 路径限制、空目录提示、长列表截断 |
| **get_project_overview** | 项目画像 | 项目根目录 | 技术栈、模块、测试、API、架构模式 |
| **read_pdf** | PDF 文本读取 | `.pdf` | 文本提取，依赖不可用时给出提示 |
| **read_docx** | Word 文档读取 | `.docx` | 需求/规格文档文本提取，损坏文件不崩溃 |
| **read_xlsx** | Excel 表格读取 | `.xlsx` | 表格行列转文本，适合测试用例/接口表 |

---

## 二、文件类型覆盖

| 类别 | 扩展名 | 读取 | 搜索 | AST | 特殊处理 |
|------|--------|------|------|-----|----------|
| TypeScript | `.ts` `.tsx` | ✅ | ✅ | ✅ tree-sitter | 类型级数据流分析 |
| JavaScript | `.js` `.jsx` `.mjs` | ✅ | ✅ | ✅ tree-sitter | — |
| Go | `.go` | ✅ | ✅ | ✅ tree-sitter | 调用图 |
| Python | `.py` `.pyi` | ✅ | ✅ | ✅ tree-sitter | 装饰器提取 |
| Java | `.java` | ✅ | ✅ | ✅ tree-sitter | Maven/Gradle |
| Kotlin | `.kt` `.kts` | ✅ | ✅ | ✅ tree-sitter | — |
| Swift | `.swift` | ✅ | ✅ | ⚠️ 增强正则 | 属性/扩展/protocol |
| ObjC | `.m` `.mm` `.h` | ✅ | ✅ | ⚠️ 增强正则 | @property/@interface |
| SQL | `.sql` | ✅ | ✅ | ✅ tree-sitter | CREATE TABLE/PROCEDURE |
| JSON | `.json` | ✅ | ✅ | — | 结构化解析 |
| YAML | `.yaml` `.yml` | ✅ | ✅ | — | CI/CD 检测 |
| Markdown | `.md` | ✅ | ✅ | — | 文档质量检测 |
| CSS | `.css` `.scss` `.less` | ✅ | ✅ | — | — |
| PDF | `.pdf` | ✅ | ❌ | — | 文本提取(pdf-parse+回退) |
| HTML | `.html` `.htm` | ✅ | ✅ | — | 文本提取(去标签) |
| PPTX | `.pptx` | ✅ | ❌ | — | ZIP→幻灯片XML→文本 |
| PPT | `.ppt` | ✅ | ❌ | — | 二进制文本扫描 |
| Dockerfile | 无扩展名 | ✅ | ✅ | — | — |
| Makefile | 无扩展名 | ✅ | ✅ | — | — |

---

## 三、AI 执行能力

| 能力 | CLI入口 | REPL入口 | 说明 |
|------|---------|----------|------|
| 任务执行 | `ic t "描述" --go` | — | 完整流水线: 规划→执行→验证→报告 |
| 代码生成 | `ic gen new "描述"` | — | 管道: 上下文→规划→合成→编译验证 |
| 代码修复 | `ic gen fix` | — | 错误定位→AI修复→验证 |
| 代码补全 | `ic gen complete <文件>` | — | TODO/空函数体检测→AI补全 |
| 代码重构 | `ic code refactor "描述"` | — | 多文件影响分析→重构 |
| 项目扫描 | `ic scan` | `/scan` | 10阶段扫描+增量指纹+monorepo |
| 项目分析 | `ic t "分析" --go` | 对话 | 上下文注入→结构化分析报告 |
| 文档生成 | `ic docs generate` | — | 9种文档模板→AI生成 |
| 文档搜索 | `ic docs search` | — | 全文搜索已有文档 |
| 测试生成 | `ic code new --with-tests` | — | 源→测试→空检测→重新生成 |
| 质量门禁 | `ic gate <task-id>` | — | 6道门禁(测试/安全/推理/报告/回滚/Git) |
| 依赖检查 | 启动时自动 | `/start` | Java/Go/Python/Rust 依赖检测 |
| 配置管理 | `ic config` | `/config` | 全局/项目配置读写 |
| Provider切换 | `ic provider use` | — | Mock/Claude/DeepSeek/OpenAI/Qwen |
| 技能激活 | — | 对话 | 5内置skill→自动匹配任务→注入提示 |
| 队列监控 | `ic queue --watch` | — | 2s刷新实时状态 |
| 并行任务 | `ic t "A" "B"` | — | 多任务并行调度 |

---

## 四、自主开发能力（11 Auto）

| # | 能力 | 触发阶段 | 效果 |
|---|------|----------|------|
| Auto-1 | 自审查 | 合成后 | AI审查自己输出(完整性/正确性/一致性/安全性) |
| Auto-2 | 文件感知规划 | 规划阶段 | 已注入文件标注"无需再读取" |
| Auto-3 | 迭代开发 | 验证阶段 | 生成→验证→修复循环(3轮) |
| Auto-4 | 语义验证 | 编译后 | import包存在性/外部引用检查 |
| Auto-5 | 自动测试生成 | 写入后 | 缺失测试→AI生成→空检测→重生成 |
| Auto-6 | 影响感知上下文 | 上下文阶段 | AST依赖图反向查找受影响文件 |
| Auto-7 | 任务记忆学习 | 完成后 | 记录执行模式→提取策略建议 |
| Auto-8 | 快照回滚 | 写入前 | .icloser/snapshots/ 备份, 失败自动恢复 |
| Auto-9 | 依赖排序写入 | 写入阶段 | 被依赖文件最后写 |
| Auto-10 | 并行文件探索 | 执行阶段 | 连续read_file步骤并行执行 |
| Auto-11 | Token预算监控 | 执行阶段 | 70%预算触发提前合成 |

---

## 五、待完成任务

| # | 任务 | 当前状态 | 目标 | 估时 |
|---|------|----------|------|------|
| T1 | DOCX 文档支持 | ✅ 已完成 | `read_docx` 工具 + 单测 + smoke | — |
| T2 | XLSX 表格支持 | ✅ 已完成 | `read_xlsx` 工具 + 单测 + smoke | — |
| T3 | 图片 OCR 支持 | 无 | PNG/JPG 文字识别 | 4h |
| T4 | REPL 工具执行可视化 | ✅ 首版已落实 | `handleChatWithTools()` 已接入工具过程实时展示；待真实 REPL / macOS 观感复验 | 复验 2h |
| T5 | 工具能力 smoke | ✅ 已完成 | `npm run smoke:tools`，47/47 通过 | — |
| T6 | 工具权限产品化 | 能力分散 | `ic doctor --tools` 或 `ic tools status` | 4h |
| T7 | NPM 首次发布 | 未发布 | npm publish + 验证 | 2h |

---

## 六、当前指标

```
工具数量:  12 个 (read_file/search_code/code_intel/run_command/web_search/git_status/web_fetch/list_dir/get_project_overview/read_pdf/read_docx/read_xlsx)
文件类型:  30+ 扩展名 (含 PDF/HTML/PPTX/PPT/DOCX/XLSX)
CLI命令:  38 个
REPL命令: 37 个
Auto能力: 11 项
测试:     116 files / 1715 passed / 2 skipped
Lint:     0 errors / 9 warnings
工具 smoke: 47/47 passed
评分:     8.6/10 (工具能力维度，见 OVERALL_REANALYSIS)
```
