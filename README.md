# iCloser Agent Shell

Terminal AI Engineering Assistant — understand project → precise edits → auto-verify → deliver reviewable changes.

## Install

```bash
cd AgentCode
npm install
npm run build
npm link
```

## Quick Start

### For First-Time Users

```bash
ic
```

Then do the simplest thing:

```text
◇  paste your API key and press Enter
◇  tell iCloser what you want to change
```

For hidden input, type:

```text
◇  /apikey
```

iCloser will ask for the provider and API Key. The Key is not shown while you type.

On first launch, iCloser also shows a three-option guide so new users know whether to paste a key, use `/apikey`, or try offline mock mode.

Example:

```text
◇  help me add phone-code login
```

When iCloser shows file changes, press `1` to write them, `2` to preview, or `3` to cancel.

```bash
# 1. First-time setup — choose one:
ic setup --mock                          # offline, no API key needed
ic setup --provider deepseek             # requires DEEPSEEK_API_KEY
ic setup --provider openai               # requires OPENAI_API_KEY

# 2. Verify provider is ready
ic provider test

# 3. Enter a project and initialize
cd my-project
ic init
ic doctor                                # check project readiness
ic doctor --strict                       # non-zero exit when not ready

# 4. Create and run a task
ic t "add phone login to user module"    # preview mode, show plan first
ic y <task-id>                           # confirm and execute
ic gate <task-id>                        # quality gate check
ic r                                     # view report
```

`ic setup --mock` auto-selects the mock provider if no real API key is detected, so you can always start with zero config.

`ic doctor` tells you the next exact action. For a new user it points to `ic init`, then `ic` plus direct API Key paste or `/apikey`, then `ic scan`, then `ic t "你的任务描述"`.

Inside the REPL, use `/doctor` for the same readiness guide without leaving the session.

If you start `ic` without an API key, the REPL still opens and automatically uses the offline mock provider. It prints the exact copyable format for connecting a real provider later.

## Release Smoke Test

**Run before every push or PR merge:**

```bash
npm run smoke
npm run smoke:project
```

For full local acceptance before a handoff, run:

```bash
npm run smoke:all
```

`npm run smoke` runs the core acceptance chain:
1. `npm run build` + `npm run test`
2. Creates a temporary project
3. `ic setup --mock --json` → `ic init`
4. `ic provider use mock` → `ic provider test --json`
5. `ic doctor --json`
6. `ic t "..." --go` (full 12-step pipeline)
7. `ic status --json` → `ic gate --json` → `ic report`

Exit code 0 = everything green. Uses mock provider (zero API key needed).

Set `ICLOSER_KEEP_SMOKE=1` or run `npm run smoke:keep` to keep the temp project for debugging.

`npm run smoke:project` creates a small TypeScript project and validates the same task chain against a more realistic project shape.

`npm run smoke:first-run` validates the first-time wizard experience: setup, config persistence, JSON key safety, and provider isolation.

`npm run smoke:repl` spawns the interactive REPL and validates `/apikey` hidden-input wizard, key guidance, `/status`, and clean `/exit` — no real network needed.

`npm run smoke:repl:init` validates `/doctor` → `/init` → `/doctor` → `/scan` in an uninitialized REPL project.

`npm run smoke:repl:e2e` runs a full beginner end-to-end smoke: open `ic` in an empty project → `/doctor` → `/init` → `/doctor` → task input → pending files → `1和2` multi-select write → `/status` → `/exit`. No API key, no Git, no network needed.

`npm run smoke:all` runs build, unit tests, first-run smoke, REPL smoke, REPL init smoke, REPL e2e smoke, memory smoke, release smoke, and real-project smoke in sequence.

### CI Release Gate

`.github/workflows/smoke.yml` runs on every PR and push to `main`/`master`:

- **OS:** windows-latest
- **Node:** 22
- **Steps:** checkout → `npm ci` → `npm run smoke`
- **Timeout:** 10 minutes

A failing smoke means the PR is not ready to merge. Always run `npm run smoke` locally before pushing.

## API Key & Model Management

iCloser supports two API Key paths:

1. Beginner path: open `ic`, paste your API Key, press Enter. iCloser saves it in the global user config and switches the provider automatically. **(Recommended)**
2. Advanced path: set the API Key as an environment variable.
3. Testing path: `ic setup --key sk-xxx` on the command line. Suitable for CI and automated tests, but ordinary users should prefer the REPL paste path above.

JSON outputs such as `ic config --json` never expose the saved key.

```text
◇  sk-xxxxxxxxxxxxxxxx
```

You can also be explicit:

```text
◇  /apikey deepseek sk-xxxxxxxxxxxxxxxx
```

| Provider | Environment Variable |
|----------|---------------------|
| DeepSeek | `DEEPSEEK_API_KEY` |
| Claude   | `ANTHROPIC_API_KEY` |
| OpenAI   | `OPENAI_API_KEY` |
| Qwen     | `QWEN_API_KEY` or `DASHSCOPE_API_KEY` |
| Mock     | not required |

```bash
# PowerShell
$env:DEEPSEEK_API_KEY = "sk-xxx"

# Bash / Zsh
export DEEPSEEK_API_KEY="sk-xxx"

# Windows CMD
set DEEPSEEK_API_KEY=sk-xxx
```

No key yet:

```bash
ic setup --mock
ic
```

The system will start in offline mock mode, so `/status`, `/scan`, `/verify`, `/search`, and mock task flows remain usable. Paste your key at any time to switch from mock to a real provider.

### Switch Provider

```bash
ic provider list                         # list all providers and key status
ic provider key deepseek sk-xxx          # save key and test provider
ic provider use deepseek                 # switch provider
ic provider models openai                # list models for a provider
ic provider doctor                       # diagnostic
ic doctor                                # project readiness diagnostic
ic doctor --strict --json                # CI/script readiness gate
ic provider env openai                   # show env var instructions
```

## JSON Output

All `--json` outputs use a unified envelope:

```json
{"version": 1, "kind": "<kind>", "data": {...}}
```

```bash
ic config --json                         # project config (no apiKey)
ic doctor --json                         # project readiness diagnostic
ic doctor --strict --json                # readiness diagnostic with non-zero failure
ic st --json                             # task list
ic gate <task-id> --json                 # gate result
ic config security rules --json          # security rules
ic provider list --json                  # provider statuses
ic provider doctor --json                # provider diagnostic
ic setup --mock --json                   # setup result
```

## Advanced: ICLOSER_HOME

Override the global config directory (default `~/.icloser`):

```bash
ICLOSER_HOME=/tmp/ci-icloser ic setup --mock
ICLOSER_HOME=/tmp/ci-icloser ic config
```

Useful for CI, testing, or sandboxed environments.

## Commands

| Command | Description |
|---------|-------------|
| `ic setup` | First-time setup wizard |
| `ic init` | Initialize project |
| `ic doctor` | Check project readiness |
| `/doctor` | REPL readiness guide |
| `ic t "desc"` | Create task |
| `ic y/n <id>` | Accept/reject task |
| `ic st [id]` | Task status |
| `ic gate <id>` | Gate check (6 gates) |
| `ic r` | Latest report |
| `ic config` | View/modify config |
| `ic provider` | Manage AI provider |
| `ic mem` | Project memory |
| `ic rule` | Architecture rules |
| `ic audit` | Agent action audit log |

See `doc/help.md` for full command reference.
