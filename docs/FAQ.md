# 常见问题

## 安装

**Q: 安装后 `ic` 命令找不到？**
A: 确认 npm 全局 bin 在 PATH 中。`npm root -g` 查看位置。

**Q: Windows 上安装失败？**
A: 以管理员运行 PowerShell: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

## 使用

**Q: 怎么配置 API Key？**
A: 三种方式：1) 打开 `ic` 直接粘贴 Key 2) `/apikey` 安全输入 3) 环境变量 `export DEEPSEEK_API_KEY=sk-...`

**Q: 分析项目为什么说 language unknown？**
A: 运行 `ic init --force` 强制重新检测。确保项目根目录有 go.mod/package.json 等标志文件。

**Q: 启动项目提示"未找到可启动配置"？**
A: 支持 package.json/go.mod/Makefile/Dockerfile。子目录项目会自动扫描。用 `/cd` 确保在正确目录。

**Q: AI 写到一半超时了？**
A: 分析任务自动 6 轮 + 合成阶段。修改任务 5 轮。超时后系统自动降级处理。

**Q: 怎么重试失败的任务？**
A: `ic t --retry <task-id>`

## 文档

**Q: 怎么生成项目文档？**
A: `ic docs status` 查看缺口，`ic docs generate` 生成全部。

**Q: 能只改文档的部分吗？**
A: `ic docs edit PRD "添加新功能"` — AI 只改相关段落。

## 性能

**Q: 大项目扫描慢？**
A: 支持增量扫描，只处理变更文件。pMap(16) 并行加速。10K+ 文件 < 30s。

**Q: Token 用量太高？**
A: 分析任务上下文约 1-2K tokens。用 `--json` 查看 `ic st --json` 中的 `agentExecutions[].result.tokensUsed`。
