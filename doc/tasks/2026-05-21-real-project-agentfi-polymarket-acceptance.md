# 真实项目验收：AgentFI + Polymarket

日期：2026-05-21

## 目标

用两个真实项目检验 AgentCode 的 Claude Code 替代能力：

- `D:\temp\Codex\AgentFI`：复杂 Web/后端多模块项目。
- `D:\temp\Codex\Polymarket`：纯 Android Gradle 项目。

重点不只看“能不能读项目”，还看：

- 是否能识别真实启动入口。
- 是否能区分多模块项目。
- 是否能跑真实构建/测试。
- Android 项目是否能走到 APK 构建、安装、启动前台。
- 遇到环境问题时是否给出可行动证据。

## AgentCode 补漏

本轮真实项目测试发现并修复了两个工具编排问题：

| 问题 | 修复 |
|------|------|
| 多模块仓库根目录没有 `package.json` 时，只读根配置，错过子项目 | `ToolOrchestrator` 接入 `scanForSubProjects()`，可识别 Maven、Node/Vite、Docker Compose 子项目 |
| Android dry-run PowerShell 启动脚本被误判为 `wrong-shell` | `classifyFailure()` 对安全 dry-run 命令直接判定为 `none` |
| Docker Compose 子项目被错误映射为 `build.gradle.kts` | 子项目配置文件和启动命令补齐为 `docker-compose -f <dir>/docker-compose.yml up` |
| Android 启动依赖 `installDebug`，设备刚上线时 PackageManager 未 ready 会失败 | 启动链路改为 `assembleDebug -> wait boot_completed + pm path android -> adb install -r -> resolve-activity/am start` |
| Android 长构建被 `run_command` 30s 超时误杀 | `run_command` 支持 `timeoutMs`，Android 启动步骤设置为 240s |
| Android 诊断只看环境变量，忽略 `local.properties` | 诊断命令增加 `sdk.dir` fallback，并输出 AVD、system-images、ADB、boot、PackageManager 证据 |
| `monkey` 输出污染 `--json` | 改用 `cmd package resolve-activity --brief` + `am start -n`，`monkey` 只作为静默兜底 |

## AgentFI 验收

路径：`D:\temp\Codex\AgentFI`

### 工具编排

命令：

```bash
node D:\temp\Codex\AgentCode\dist\index.js orchestrate "启动项目" --json
```

结果：通过。

识别到的启动路径：

| 模块 | 类型 | 启动命令 |
|------|------|----------|
| `agentfi-server` | Spring Boot / Maven | `agentfi-server\mvnw.cmd -f agentfi-server/pom.xml spring-boot:run` |
| `agentfi-web` | Node.js / Vite | `npm --prefix agentfi-web run dev` |
| `database` | Docker Compose | `docker-compose -f database/docker-compose.yml up` |

### 真实验证

| 命令 | 结果 |
|------|------|
| `npm run build` in `agentfi-web` | 通过，Vite build 成功 |
| `.\mvnw.cmd test` in `agentfi-server` | 通过，`Tests run: 707, Failures: 0, Errors: 0, Skipped: 0` |

结论：AgentFI 作为复杂多模块 Web 项目，当前工具编排与验证能力通过。后续若做“真实启动”，需要按顺序启动 database -> server -> web，并增加端口/健康检查。

## Polymarket 验收

路径：`D:\temp\Codex\Polymarket`

补充验收：第一次真实验收发现 Android 测试仍停留在模板状态，随后直接修复 Polymarket 项目测试与本机 AVD 环境，并完成 APK 安装启动。

### 工具编排

命令：

```bash
node D:\temp\Codex\AgentCode\dist\index.js orchestrate "启动项目" --json
```

结果：通过。

识别到 Android Gradle 启动路径，读取：

- `settings.gradle.kts`
- `build.gradle.kts`
- `app/build.gradle.kts`

并生成 Android install/launch dry-run 脚本。

### 真实验证

| 命令 | 结果 | 说明 |
|------|------|------|
| `.\gradlew.bat tasks --all` | 通过 | Gradle wrapper 和 Android task 图可用 |
| `.\gradlew.bat app:assembleDebug` | 通过 | debug APK 构建成功 |
| `.\gradlew.bat app:testDebugUnitTest` | 通过 | 已修复过期模板测试：`GreetingScreenshotTest.kt` 改为 `AppScreenshotTest.kt` 并渲染真实 `Web3PredictApp()`，Robolectric SDK 从 36 下调到 35，应用名断言改为 `iCloser Web3 Predict` |
| `adb install -r app-debug.apk` | 通过 | APK 安装到 `icloser_api35` |
| `adb shell am start -n com.aistudio.web3predict.pwqxyz/com.example.MainActivity` | 通过 | `MainActivity` 前台运行 |
| `node D:\temp\Codex\AgentCode\dist\index.js orchestrate "启动项目" --execute --max-steps 6 --json` | 通过 | AgentCode 自身完成 Android assemble/install/launch/diagnose，6 步全成功，JSON 零噪音 |

### Android 环境问题

初始状态下当前机器 ADB 无设备：

```text
List of devices attached
```

AVD 检查：

- `test_avd`：启动时报 `No initial system image for this configuration!`
- `Medium_Phone_API_36.1`：启动时报 `Broken AVD system path`，缺少 `C:\Android\sdk\system-images\android-36.1\google_apis_playstore\x86_64\`

补救动作：

- 安装稳定镜像：`system-images;android-35;google_apis;x86_64`。
- 创建验收 AVD：`icloser_api35`。
- 启动后等待 `sys.boot_completed=1` 和 `pm path android` 可用。
- 使用 ADB 直装 APK，绕过 Gradle 在系统服务未完全 ready 时触发的 PackageInstaller NPE。

最终状态：

```text
emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64
Starting: Intent { cmp=com.aistudio.web3predict.pwqxyz/com.example.MainActivity }
topResumedActivity=ActivityRecord{... com.aistudio.web3predict.pwqxyz/com.example.MainActivity ...}
```

结论：Polymarket 的构建、JVM 测试、APK 安装、前台启动均已通过。原有 `test_avd` 和 `Medium_Phone_API_36.1` 仍属于本机损坏/缺失镜像，不再作为验收 AVD。

## 综合结论

| 项目 | 编排能力 | 构建/测试 | 启动/运行 | 结论 |
|------|----------|-----------|-----------|------|
| AgentFI | 通过 | 通过 | 待端口健康检查 | 多模块识别与验证通过 |
| Polymarket | 通过 | 通过 | 通过 | Android 构建、测试、安装、前台启动通过 |

## 下一步

1. 给 AgentCode 增加 Android 环境诊断命令：检测 AVD ini、system image、ADB online、APK 路径、applicationId。
2. 给 Android 启动编排增加“等待 boot_completed + PackageManager ready”步骤，避免设备刚上线就安装。已落地到启动脚本。
3. 给多模块项目增加真实启动顺序模板：database -> backend -> frontend -> health check。
4. 将 `icloser_api35` 作为 Windows 本机 Android 验收默认 AVD，并在 macOS 标准中保留等价检查项。
