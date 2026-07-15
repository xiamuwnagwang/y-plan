# Y-Plan

A planning-only skill that turns task briefs into structured Markdown plans — without implementing, editing files, or running anything.

Y-Plan integrates with multiple AI coding tools (Claude Code, Gemini CLI, Codex, Cursor, Kiro, Qoder) and API providers (Anthropic, OpenAI) to generate implementation, refactor, architecture, and debugging plans.

## Features

- **Planning only** — produces plans, never executes code changes
- **Multi-runtime fallback** — tries configured models in order until one succeeds
- **IDE-native installation** — installs as a skill into Cursor, Kiro, Zed, Antigravity, Qoder, Claude Code, Codex, and OpenCode
- **Optional YCE integration** — prompt enhancement and code search to make plans reference real files
- **Bundled planning knowledge** — ships with [mattpocock/skills](https://github.com/mattpocock/skills) for engineering discipline (TDD, domain modeling, codebase design, etc.)
- **Phase-aware workflow** — plans use built-in phases: scope, context, design, file-plan, validation-plan

## Quick Start

安装完成后即可使用：

1. **IDE skill**：复制 `SKILL.md` 到对应 skills 目录后，直接说 `Use Y-Plan to plan this refactor`
2. **CLI**：`install` 会自动检测本机 CLI 并写入 `y-plan.config.json`，无需再跑交互配置

### Download Pre-built Binary

Grab the latest release for your platform from [GitHub Releases](https://github.com/xiamuwnagwang/y-plan/releases):

| Platform | File |
|---|---|
| Linux x64 | `y-plan-vX.X.X-linux-x64.tar.gz` |
| Linux arm64 | `y-plan-vX.X.X-linux-arm64.tar.gz` |
| macOS Apple Silicon | `y-plan-vX.X.X-darwin-arm64.tar.gz` |
| macOS Intel | `y-plan-vX.X.X-darwin-x64.tar.gz` |
| Windows x64 | `y-plan-vX.X.X-windows-x64.zip` |

```bash
# Example: download, extract, and run
tar -xzf y-plan-v1.0.0-linux-x64.tar.gz
cd y-plan
./bin/y-plan "Plan this refactor..."

# Or install as a skill
bash install.sh --install --target cursor
```

Pre-built binaries are standalone — no Node.js required.

### From Source

```bash
# Install to default location (~/.agents/skills/y-plan)
# 自动 bootstrap：检测本机 Claude/Gemini/Codex/Cursor/Kiro/Qoder 并写默认配置
bash install.sh --install

# Install to a specific IDE
bash install.sh --install --target cursor
bash install.sh --install --target kiro
bash install.sh --install --target zed

# Install everywhere
bash install.sh --install --all-targets

# Optional: interactive setup (models, YCE, API providers)
bash install.sh --setup

# Version / upgrade
bash install.sh --version
bash install.sh --check
bash install.sh --upgrade
bash install.sh --sync
```

On Windows (PowerShell):

```powershell
.\install.ps1 -Action install -Target agents
.\install.ps1 -Action version
.\install.ps1 -Action check
.\install.ps1 -Action upgrade
```

If an **old** `install.ps1` fails to parse on PowerShell 5.1 with:

```text
The term 'if' is not recognized ... (if ($env:CODEX_HOME) ...
```

use the standalone repair script (does not depend on the broken file):

```powershell
# one-liner from any directory
irm https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/fix-windows.ps1 | iex

# or after download
.\fix-windows.ps1 -Target cursor
```

## Usage

### In IDE

Once installed as a skill, ask your IDE agent:

> "Use Y-Plan to plan this refactor"
> "Y-Plan: break this feature into vertical slices"

### CLI

```bash
# With pre-built binary (no Node.js needed)
./bin/y-plan "Plan this refactor..."
./bin/y-plan --cwd /path/to/project "Create an implementation plan..."
./bin/y-plan --use-yce --yce-mode plan "Plan this code change..."

# Or with Node.js
node scripts/y-plan.mjs "Plan this refactor..."
```

## Configuration

Running `bash install.sh --setup` (or `node scripts/install.mjs`) launches an interactive configurator that:

1. Detects installed CLIs (Claude Code, Gemini, Codex, Cursor, Kiro, Qoder)
2. Discovers available models from each CLI
3. Lets you pick models and API providers
4. Writes `y-plan.config.json` with a fallback-ordered model list

### Model Entries

| Format | Runtime |
|---|---|
| `claude-code` (推荐) / `claude-code/<model>` | Claude Code CLI (print mode) |
| `codex` / `codex/<model>` | Codex CLI (exec mode) |
| `cursor` / `cursor/auto` | Cursor Agent（优先 `cursor-agent`；`auto` 为官方默认） |
| `kiro` / `kiro/<model>` | Kiro CLI (chat mode) |
| `qoder` / `qoder/<model>` | Qoder CLI (print mode) |
| `claude-api/<model>` | Anthropic Messages API |
| `openai-chat/<model>` | OpenAI Chat Completions API |
| `openai-responses/<model>` | OpenAI Responses API |

CLI 默认只写 runtime，不写 model，由 CLI 自带默认模型决定。API entries require `url`/`baseUrl` (or `urlEnv`/`baseUrlEnv`) and `token`/`apiKey` (or `tokenEnv`/`apiKeyEnv`). Y-Plan auto-appends the correct provider suffix to base URLs.

### Example Config

```json
{
  "models": [
    { "runtime": "claude-code" },
    { "runtime": "cursor", "model": "auto" },
    { "runtime": "codex" }
  ],
  "yce": {
    "enabled": false,
    "mode": "plan",
    "script": "./vendor/yce/scripts/yce.js",
    "timeoutMs": 300000
  }
}
```

默认**不写 `model`**（Claude/Codex 等）：调用时不传 `--model`/`-m`，用 CLI 自带默认。Cursor 推荐显式 `auto`（其官方默认模型名）。需要钉死型号时再写，例如 `{ "runtime": "codex", "model": "gpt-5.5" }`。

## YCE (Optional)

YCE provides two planning upgrades:

- **Prompt enhancement** — improves the user brief before planning
- **Code search** — locates relevant code so the plan can reference real files

Default mode is `plan`: enhance first, then search only when code locations are useful.

```bash
# Enable per-run
node scripts/y-plan.mjs --use-yce --yce-mode plan "Plan this change..."

# Or enable in config via the installer
bash install.sh --setup
```

## Plan Output

Every plan includes these sections:

| Section | Purpose |
|---|---|
| **Goal** | One-sentence desired outcome |
| **Selected Skills** | Which planning skills shaped the plan |
| **Plan Workflow** | Phase-aware breakdown (scope → context → design → file-plan → validation-plan) |
| **File Changes** | Concrete files/areas to modify, with validation |
| **Steps** | Ordered steps with dependencies and expected output |
| **Dependency Graph** | Blocking relationships between steps |
| **Risks** | Concrete risks and mitigations |
| **Out of Scope** | What the plan deliberately skips |
| **Handoff** | What to return after planning |

## Version Management

版本号**唯一来源**是 `SKILL.md` frontmatter 的 `version:` 字段（当前 `1.0.0`）。发版时先改 `SKILL.md` 与 `CHANGELOG.md`，再打 `vX.Y.Z` 标签。

| 命令 | 作用 |
|---|---|
| `node scripts/y-plan.mjs --version` | 打印本地版本 |
| `node scripts/y-plan.mjs --check-update` | 对比远端版本（GitHub raw SKILL.md） |
| `bash install.sh --version` / `--check` / `--upgrade` / `--sync` | 安装器侧版本与升级 |
| `node scripts/lib/version.mjs --check --json` | 机器可读版本检查 |

远端检测源默认：`https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/SKILL.md`  
可用环境变量覆盖：`Y_PLAN_VERSION_URL`、`Y_PLAN_REPO_URL`、`Y_PLAN_DISABLE_UPDATE_CHECK=1`。

## Project Structure

```
y-plan/
├── SKILL.md                          # Skill definition + version (source of truth)
├── CHANGELOG.md                      # Release notes
├── y-plan.example.config.json        # Example config (no secrets)
├── scripts/
│   ├── y-plan.mjs                    # Main CLI — generates plans
│   ├── install.mjs                   # Interactive configurator + --bootstrap
│   ├── lib/version.mjs               # Version read / remote check
│   ├── sync-yce.mjs                  # Vendor YCE sync helper
│   └── build.sh                      # Build script (reads version from SKILL.md)
├── .github/workflows/
│   └── release.yml                   # CI: auto-build + publish on tag push
├── references/
│   ├── y-plan-planning-core.md       # Planning workflow rules
│   └── platform-prompts.md           # Per-IDE invocation patterns
├── vendor/
│   ├── yce/                          # Bundled YCE (prompt enhancement + code search)
│   └── mattpocock-skills/            # Bundled planning skill references
├── install.sh                        # Bash installer (Linux/macOS)
├── install.ps1                       # PowerShell installer (Windows)
└── LICENSE                           # MIT
```

## Building from Source

Requires [Bun](https://bun.sh) for compilation:

```bash
# Build binaries for current platform (version from SKILL.md)
bash scripts/build.sh

# Build with explicit version tag
bash scripts/build.sh v1.0.0

# Output: bin/y-plan, bin/y-plan-install, dist/y-plan-v1.0.0-<platform>-<arch>.tar.gz
```

## Releasing

1. Bump `version:` in `SKILL.md`
2. Update `CHANGELOG.md`
3. Push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

CI builds binaries for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64), then publishes them to [GitHub Releases](https://github.com/xiamuwnagwang/y-plan/releases).

## Environment Variables

| Variable | Purpose |
|---|---|
| `Y_PLAN_CONFIG` | Override config file path |
| `Y_PLAN_AGENT_CONFIG` | Override agent config path |
| `Y_PLAN_SKILLS_ROOT` | Override bundled mattpocock/skills root |
| `Y_PLAN_USE_YCE` | Enable/disable YCE (`1`/`0`) |
| `Y_PLAN_YCE_MODE` | YCE mode (`plan`, `auto`, `enhance`, `search`) |
| `Y_PLAN_HISTORY` | Conversation history for YCE context |
| `Y_PLAN_QODER_BIN` | Override Qoder executable name |
| `Y_PLAN_CURSOR_BIN` | Override Cursor Agent executable name |
| `Y_PLAN_KIRO_BIN` | Override Kiro CLI executable name |
| `Y_PLAN_VERSION_URL` | Remote SKILL.md URL for update checks |
| `Y_PLAN_REPO_URL` | GitHub repo URL for upgrade downloads |
| `Y_PLAN_DISABLE_UPDATE_CHECK` | Set `1` to disable runtime update banners |

## License

[MIT](LICENSE)
