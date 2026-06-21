# Y-Plan Platform Prompts

Use these invocation patterns inside each IDE. Y-Plan is planning-only: it returns a structured Markdown plan and does not implement, edit files, or run validation unless the user separately asks for execution.

## Cursor

- Skill path: `~/.cursor/skills/y-plan`
- In IDE: say `用 Y-Plan 只做计划`, `Y-Plan`, or `@y-plan` with the task brief.
- CLI fallback:

```bash
node ~/.cursor/skills/y-plan/scripts/y-plan.mjs --cwd /path/to/project "Plan this refactor..."
```

## Kiro

- Skill path: `~/.kiro/skills/y-plan`
- In IDE: say `用 Y-Plan 只做计划` or invoke the bundled skill with the task brief.
- CLI fallback:

```bash
node ~/.kiro/skills/y-plan/scripts/y-plan.mjs --cwd /path/to/project "Break this feature into vertical slices..."
```

## Zed

- Prompt path: `~/.config/zed/prompts/y-plan`
- In Zed Agent: say `用 Y-Plan 只做计划` or select the Y-Plan prompt with the task brief.
- Zed loads this directory as an agent prompt bundle; there is no separate Y-Plan CLI runtime on Zed.

## Antigravity

- Skill path: `~/.antigravity/skills/y-plan`
- In IDE: say `用 Y-Plan 只做计划` or invoke the bundled skill with the task brief.
- Antigravity uses the skill directly in the IDE; model-backed fallback should use Cursor, Kiro, Codex, or Qoder CLI if needed.

## Qoder

- Skill path: `~/.qoder/skills/y-plan`
- In IDE: say `用 Y-Plan 只做计划` or invoke the bundled skill with the task brief.
- CLI fallback:

```bash
node ~/.qoder/skills/y-plan/scripts/y-plan.mjs --cwd /path/to/project "Create a planning-only breakdown..."
```

## Shared Plan Contract

Every Y-Plan response must be Markdown and include:

- `goal`
- `assumptions`
- `selected_skills`
- `plan_workflow`
- `file_changes`
- `steps`
- `dependency_graph`
- `risks`
- `out_of_scope`
- `handoff`

If code locations are unknown, write `UNKNOWN` in the relevant File Changes entry and list the exact lookup still needed. Do not invent files.
