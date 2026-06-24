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
bash install.sh --install

# Install to a specific IDE
bash install.sh --install --target cursor
bash install.sh --install --target kiro
bash install.sh --install --target zed

# Install everywhere
bash install.sh --install --all-targets

# Interactive setup (configure models, YCE, API providers)
bash install.sh --setup
```

On Windows (PowerShell):

```powershell
.\install.ps1 -Action install -Target agents -Configure
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
| `claude-code/<model>` | Claude Code CLI (print mode) |
| `gemini/<model>` | Gemini CLI (prompt mode) |
| `codex/<model>` | Codex CLI (exec mode) |
| `cursor/<model>` | Cursor Agent (plan mode) |
| `kiro/<model>` | Kiro CLI (chat mode) |
| `qoder/<model>` | Qoder CLI (print mode) |
| `claude-api/<model>` | Anthropic Messages API |
| `openai-chat/<model>` | OpenAI Chat Completions API |
| `openai-responses/<model>` | OpenAI Responses API |

API entries require `url`/`baseUrl` (or `urlEnv`/`baseUrlEnv`) and `token`/`apiKey` (or `tokenEnv`/`apiKeyEnv`). Y-Plan auto-appends the correct provider suffix to base URLs.

### Example Config

```json
{
  "models": [
    { "runtime": "claude-code", "model": "sonnet" },
    { "runtime": "gemini", "model": "gemini-3.1-pro-preview" },
    { "runtime": "codex", "model": "gpt-5.5" }
  ],
  "yce": {
    "enabled": false,
    "mode": "plan",
    "script": "./vendor/yce/scripts/yce.js",
    "timeoutMs": 300000
  }
}
```

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

## Project Structure

```
y-plan/
├── SKILL.md                          # Skill definition (loaded by IDEs)
├── scripts/
│   ├── y-plan.mjs                    # Main CLI — generates plans
│   ├── install.mjs                   # Interactive configurator
│   └── build.sh                      # Build script (compiles binaries + packages release)
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
# Build binaries for current platform
bash scripts/build.sh

# Build with version tag
bash scripts/build.sh v1.0.0

# Output: bin/y-plan, bin/y-plan-install, dist/y-plan-v1.0.0-<platform>-<arch>.tar.gz
```

## Releasing

Push a version tag to trigger the GitHub Actions release workflow:

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

## License

[MIT](LICENSE)
