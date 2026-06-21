---
name: y-plan
description: Planning-only skill for producing structured implementation, refactor, architecture, product, or debugging plans before execution. Use when the user asks for Y-Plan, planning only, a plan, implementation plan, refactor plan, task breakdown, roadmap, dependency map, role-aware plan workflow, configurable planning agents, or model-backed planning. This standalone skill bundles YCE and mattpocock/skills, owns OpenHarnesses-derived planning capabilities natively through local y-plan agent configuration, supports model-backed planning through Claude, Gemini, Codex, Cursor, Kiro, and Qoder CLI, and can optionally use configurable YCE prompt enhancement and code search. Install to Cursor, Kiro, Zed prompts, Antigravity, and Qoder via install.sh.
---

# Y-Plan

Y-Plan is a planning-only wrapper: it turns a task brief into a structured plan, but never implements, edits files, starts services, publishes issues, or runs validation unless the user separately asks for execution.

The standalone skill is self-contained:

- `vendor/yce/` provides optional prompt enhancement and code search for improving the final plan.
- `vendor/mattpocock-skills/` provides planning references for improving the final plan.
- `agents/y-plan-agents.json` configures Y-Plan native planning phases and default plan-model fallback order.
- `references/y-plan-planning-core.md` defines Y-Plan's native role-aware planning workflow, adapted from OpenHarnesses planning discipline but owned by Y-Plan directly.

All bundled skills and YCE output exist to serve one thing: the model must use them as context and return a better final `<y-plan>` result to the caller. They are not separate deliverables. Inside Y-Plan, mattpocock/skills are directly callable planning knowledge, and YCE is the built-in prompt-enhancement and code-search layer.

## Required Flow

1. Treat the user request as planning scope only.
2. Use the integrated mattpocock/skills guidance before planning. Y-Plan must call the relevant bundled Matt skill references directly from `vendor/mattpocock-skills/`:
   - Always use `implement`, `codebase-design`, and `domain-modeling` when available.
   - Use `tdd` for test-first, risky bugfix, regression, or behavior-heavy work.
   - Use `request-refactor-plan` and `improve-codebase-architecture` for refactors or architecture changes.
   - Use `to-prd`, `to-issues`, and `triage` for product specs, PRDs, ticket breakdowns, or issue-ready plans.
   - Use `grill-with-docs` or `grill-me` when requirements need interview-style sharpening.
   - Use `prototype` when the safest next step is a throwaway prototype.
   - Use `diagnosing-bugs` or `diagnose` for root-cause or debugging plans.
3. Read `agents/y-plan-agents.json` and `references/y-plan-planning-core.md` when planning needs phase separation, validation boundaries, configurable planning workflow, or default model fallback.
4. Use bundled YCE when enabled in `y-plan.config.json` or explicitly requested with `--use-yce`. Default planning mode is `--yce-mode plan`: first enhance the user prompt, then decide from the original + enhanced prompt whether code search is needed, then run code search only when concrete code locations are useful, and finally generate the plan from the original task, enhanced prompt, and search context.
5. Convert Matt skill instructions, Y-Plan native planning role config, planning-core guidance, and optional YCE output into planning constraints inside the final plan.
6. For code-related plans, include `file_changes` that say exactly which file or code area should change, what to change there, why, and whether that came from YCE, user input, or unknown context.
7. Return the plan to the caller. Do not continue into execution.

## Configure Planner Models

Run the installer when setting up Y-Plan on a machine:

```bash
bash install.sh --target cursor --configure
bash install.sh --target kiro
bash install.sh --target zed
bash install.sh --target antigravity
bash install.sh --target qoder
bash install.sh --all-targets
bash install.sh --target agents --configure
```

Use PowerShell on Windows:

```powershell
.\install.ps1 -Target agents -Configure
```

The installer:

- installs the whole standalone `y-plan` directory into the selected skills root or Zed prompts root;
- supports `cursor`, `kiro`, `zed`, `antigravity`, `qoder`, `agents`, `codex`, `claude`, and `opencode` targets;
- lets the user choose one or more planning CLIs;
- tries to discover model names from each CLI;
- falls back to built-in candidates and manual model entry when discovery is unavailable;
- writes a fallback-ordered `y-plan.config.json`;
- asks whether optional YCE enhancement/search should be enabled.

The user does not need to configure every CLI. Y-Plan tries configured models in order until one returns a plan or all fail.

## Model-Backed Invocation

Use the bundled script when the caller wants a model-generated plan. Model fallback order must come from `y-plan.config.json` or `agents/y-plan-agents.json`:

```bash
node scripts/y-plan.mjs "Plan this refactor..."
node scripts/y-plan.mjs --cwd /path/to/project "Create an implementation plan..."
```

Model entries in JSON use this syntax:

- `claude/<model>` or `claude-api/<model>` uses Anthropic Messages API.
- `claude-code/<model>` or `claude-cli/<model>` uses Claude Code print mode.
- `cursor/<model>` uses Cursor Agent print mode with `--plan`.
- `kiro/<model>` uses Kiro CLI chat mode with `--no-interactive`.
- `gemini/<model>` uses Gemini CLI prompt mode.
- `codex/<model>` uses Codex CLI exec mode.
- `openai/<model>` or `openai-chat/<model>` uses OpenAI Chat Completions API.
- `openai-response/<model>` or `openai-responses/<model>` uses OpenAI Responses API.
- `qoder/<model>` uses Qoder CLI print mode with `qodercli -p --model <model>`.
- The script does not accept runtime model override flags. Edit the JSON `models` array to change fallback order.

API model entries must include `url` or `baseUrl` (or `urlEnv`/`baseUrlEnv`). Y-Plan auto-appends the provider suffix when the URL points at a base host or `/v1`: Claude adds `/v1/messages`, OpenAI Chat adds `/v1/chat/completions`, and OpenAI Responses adds `/v1/responses`. Entries can also include `token`/`apiKey`, `tokenEnv`/`apiKeyEnv`, `maxTokens`, and `temperature`; if the token is omitted, Claude reads `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`, and OpenAI reads `OPENAI_API_KEY`.

Zed and Antigravity load Y-Plan as an in-IDE skill/prompt bundle. Use `references/platform-prompts.md` for per-platform invocation wording.

The script reads the relevant bundled mattpocock/skills `SKILL.md` files, injects them as directly applied planning references, reads `agents/y-plan-agents.json` as the configurable native planning-agent map, adds the Y-Plan planning core reference, optionally injects YCE enhancement/search context, calls the selected model, and returns a Markdown result containing run metadata and the final plan output.

## Optional YCE Integration

YCE is configurable, not mandatory. If no YCE config exists and `--use-yce` is not passed, Y-Plan will not call YCE.

Use YCE for two planning upgrades:

- Prompt enhancement: YCE improves the user brief before planning.
- Code search: YCE locates relevant code so the plan can reference real implementation areas.

YCE stdout is provenance and context only. The planner must distill it into the final plan instead of asking the caller to read raw YCE output.

Y-Plan's default YCE mode is `plan`: enhance first, then search only when the enhanced prompt or user task needs code locations, then pass both the enhanced brief and any code-search context into the planner. This makes the final plan precise enough to say which files should change without forcing code search for non-code planning.

Enable per run:

```bash
node scripts/y-plan.mjs --use-yce --yce-mode auto --cwd /path/to/project "Plan this change..."
node scripts/y-plan.mjs --use-yce --yce-mode plan --cwd /path/to/project "Plan this code change..."
```

Or enable through `scripts/install.mjs`, which writes:

```json
{
  "models": [
    { "runtime": "claude-code", "model": "sonnet" },
    { "runtime": "gemini", "model": "gemini-3.1-pro-preview" },
    { "runtime": "qoder", "model": "Lite" }
  ],
  "yce": {
    "enabled": false,
    "mode": "auto",
    "script": "./vendor/yce/scripts/yce.js",
    "timeoutMs": 300000
  }
}
```

## Plan Contract

Every Y-Plan response must be Markdown and include these sections:

- `goal`: one sentence describing the desired outcome.
- `assumptions`: only facts supported by user input or inspected context.
- `selected_skills`: mattpocock/skills used and why.
- `plan_workflow`: role-aware Y-Plan phases selected from `agents/y-plan-agents.json`, with each phase's input and contribution to the final plan.
- `file_changes`: concrete files or code areas to modify, with planned change and validation method.
- `steps`: ordered steps with owner, dependencies, files or areas likely touched, expected output, and validation method.
- `dependency_graph`: blocking relationships between steps.
- `risks`: concrete risks and mitigation.
- `out_of_scope`: what the plan deliberately does not do.
- `handoff`: what should be returned to the user after planning.

Use plain language. Prefer vertical slices over layer-by-layer tasks. Mark execution as a separate future phase.

The Markdown result is the only product of Y-Plan. Skill names, YCE findings, and OpenHarnesses planning guidance should appear only when they help the model explain or structure that plan.

If code search is required but YCE cannot locate enough context, set `file_changes.file path="UNKNOWN"` and list the exact lookup needed. Do not invent files. Every known file entry should explain how that file's planned change will be verified after execution.

## Boundaries

- Do not create implementation files, tests, README files, issues, commits, branches, or PRs.
- Do not call OpenHarnesses unless the user explicitly requests OpenHarnesses or agent routing.
- Do not use mock data or placeholders in the plan.
- If planning depends on unknown facts, list the exact open questions and provide two or three viable planning branches.

## Configuration Overrides

- `Y_PLAN_CONFIG`: use a different config file.
- YCE always uses the bundled `vendor/yce/scripts/yce.js`; external YCE script overrides are intentionally ignored.
- `Y_PLAN_SKILLS_ROOT`: override bundled mattpocock/skills with another skills root.
- `Y_PLAN_AGENT_CONFIG`: override `agents/y-plan-agents.json` with another Y-Plan planning-agent config.
- `Y_PLAN_QODER_BIN`: override the Qoder executable name.
- `Y_PLAN_CURSOR_BIN`: override the Cursor Agent executable name.
- `Y_PLAN_KIRO_BIN`: override the Kiro CLI executable name.
