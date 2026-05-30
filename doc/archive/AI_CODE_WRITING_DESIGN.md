# AI 代码编写与补齐能力设计

## 核心思路

从 "写文件" 升级为 "**理解现有代码→匹配风格→智能生成→自动验证**"。

```
现在：ic t "加个登录接口" --go
      → AI 读 context → 生成代码 → 写入 → 验证
      → ⚠️ 不读存量代码模式，可能风格不一致

目标：ic t "加个登录接口" --go
      → AI 读现有路由/controller/model 模式
      → 匹配项目风格（命名/缩进/错误处理）
      → 生成 model + controller + route + test
      → 自动验证 → 展示 diff → 确认写入
```

## 12 项能力

### C1. 上下文感知代码生成（写新代码）
```
场景：加一个新功能，AI 要先看懂现有代码怎么写的
流程：
  1. read 现有路由文件 → 了解路由注册模式
  2. read 现有 controller → 了解处理函数签名
  3. read 现有 model → 了解数据结构风格
  4. AI 生成代码，匹配现有模式
  5. diff 展示 → 确认 → 写入

ic code new "用户管理 CRUD"
  → AI 读取现有代码模式
  → 生成 model/controller/route
  → 展示统一 diff
  → 确认后写入
```

### C2. 智能代码补齐（补现有文件）
```
场景：文件里有个空函数，需要实现
流程：
  1. read 当前文件
  2. 找到未完成的函数
  3. AI 理解上下文（参数/返回类型/调用方）
  4. 生成实现
  5. 展示 diff

ic code complete src/auth.ts
  → AI 找到所有未完成的函数
  → 逐个补全
  → diff→确认→写入
```

### C3. 项目风格匹配
```
AI 自动检测并匹配：
  - 命名规范：camelCase / PascalCase / snake_case
  - 缩进：2空格 / 4空格 / Tab
  - 引号：单引号 / 双引号
  - 分号：有 / 无
  - 错误处理：try-catch / Result<T,E> / if err != nil
  - 导出方式：named export / default export
  - 注释风格：JSDoc / 行注释 / 无注释

检测来源：StyleFingerprint (已有!)
```

### C4. 测试代码同生成
```
ic code new "用户管理 CRUD" --with-tests
  → 生成 model/controller/route
  → 同时生成 model.test/controller.test/route.test
  → 写入后立即运行测试验证
```

### C5. 多文件关联修改
```
ic code refactor "把用户ID从 int 改成 uuid"
  → AI 搜索所有使用 UserID 的文件
  → 生成所有文件的修改
  → 统一 diff 展示
  → 确认后批量写入
  → 运行测试验证
```

### C6. 错误驱动修复
```
ic code fix
  → 读取上次验证失败的错误输出
  → AI 定位错误文件和行号
  → 生成针对性修复
  → 只改出错的行（不改其他代码）
  → 重新验证
```

### C7. 增量构建
```
ic code build "用户管理模块"
  第1步：生成 model → 编译验证 ✅
  第2步：生成 controller → 编译验证 ✅
  第3步：生成 route → 编译验证 ✅
  第4步：生成 test → 测试验证 ✅
  每步成功后继续，失败则修正
```

### C8. 代码解释同步输出
```
ic code new "用户管理 CRUD" --explain
  → 生成代码同时输出解释
  → ## model/user.ts
  →   用 bcrypt 哈希密码 (匹配现有 auth 模式)
  →   使用 JSDoc 注释 (匹配项目风格)
  → ## controller/user.ts
  →   从 auth middleware 取 userId (与现有 todo controller 一致)
```

### C9. 模板脚手架生成
```
ic code scaffold express-api    → 生成 Express API 项目骨架
ic code scaffold react-component → 生成 React 组件模板
ic code scaffold go-service     → 生成 Go 服务模板

模板包含：
  - 项目结构
  - 配置文件
  - 基础代码
  - 测试框架
  - README
```

### C10. 安全重构
```
ic code refactor "拆分这个300行的函数" --safe
  → AI 分析函数 → 识别逻辑块 → 提取子函数
  → 保持所有现有测试通过
  → 每次提取后运行测试
  → 测试失败 → 回滚那一步 → 尝试不同方式
```

### C11. 代码迁移
```
ic code migrate "从 express 迁移到 fastify"
  → AI 读取现有路由
  → 识别 express 特定模式 (req, res, next)
  → 转换为 fastify 模式 (request, reply)
  → 逐文件迁移 → 验证
```

### C12. 实时代码建议（REPL 模式）
```
REPL 中输入部分代码 → AI 建议补全

◇  function getUserById(
◆ AI 建议:
  function getUserById(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }
  理由: 匹配现有 db.user 调用模式
  [1] 接受  [2] 修改  [3] 忽略
```

## 实现优先级

| 优先级 | 能力 | 已有基础 | 新增工作 |
|--------|------|---------|---------|
| 🔴 P0 | C1 上下文感知生成 | task引擎+工具调用 | code new 命令+多文件读取逻辑 |
| 🔴 P0 | C3 风格匹配 | StyleFingerprint已有 | 注入AI prompt |
| 🔴 P0 | C6 错误驱动修复 | 验证管线已有 | code fix 命令 |
| 🟡 P1 | C2 智能补齐 | 文件读取已有 | complete + 未完成函数检测 |
| 🟡 P1 | C4 测试同生成 | 已有autotest | --with-tests flag |
| 🟡 P1 | C5 多文件修改 | 搜索已有 | refactor 命令+影响分析 |
| 🟢 P2 | C7 增量构建 | 验证管线 | build 命令+步骤管理 |
| 🟢 P2 | C8 代码解释 | AI输出已有 | --explain flag |
| 🟢 P2 | C9 模板脚手架 | 无 | scaffold 命令+模板库 |
| ⚪ P3 | C10 安全重构 | 测试+回滚已有 | --safe flag+步骤回滚 |
| ⚪ P3 | C11 代码迁移 | 无 | migrate 命令+转换规则 |
| ⚪ P3 | C12 实时建议 | REPL已有 | 代码补全逻辑 |
