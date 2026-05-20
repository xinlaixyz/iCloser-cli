# 部署运维手册

## 安装

### npm 全局安装
```bash
npm install -g icloser-agent-shell
ic setup --mock       # 离线体验
```

### 源码安装
```bash
git clone https://github.com/icloser/agent-shell
cd AgentCode && npm install && npm run build && npm link
```

### Docker
```bash
docker build -t icloser .
docker run -it --rm -v $(pwd):/project icloser ic doctor
```

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 18 |
| npm | >= 9 |
| Git (可选) | >= 2.30 |

## 配置 AI Provider

```bash
ic setup --provider deepseek     # DeepSeek
ic setup --provider claude       # Claude
ic setup --provider openai       # OpenAI
ic setup --mock                  # 离线模式
```

## CI/CD

项目包含 `.github/workflows/`:
- `smoke.yml` — PR/push 质量门禁 (ubuntu/macos/windows)
- `release.yml` — tag push 自动发布到 npm

## 性能

- pMap 并行扫描 (concurrency=16)
- 增量扫描跳过未变更文件
- 10K 文件项目扫描 < 30s

## 发布流程

```bash
npm version patch     # 版本号升级
npm run prepublish    # build + test + smoke
git push --tags       # 触发 CI 自动发布
```
