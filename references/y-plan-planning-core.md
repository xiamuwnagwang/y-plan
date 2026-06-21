# Y-Plan Planning Core

Y-Plan owns this planning workflow directly. It is not a wrapper around OpenHarnesses and does not call OpenHarnesses to plan.

## Core Capabilities

- Build a phase-aware plan workflow before implementation.
- Use planning phases only: scope, context, design, file-plan, validation-plan.
- Use the local `agents/y-plan-agents.json` file as the configurable source of planning phases.
- Treat phases as owners inside the returned plan, not external agents to dispatch.
- Keep all YCE output, skill text, role configuration, and planning references as context that serves the final plan.
- Call bundled mattpocock/skills as Y-Plan's own planning knowledge. They are not external dependencies once vendored.
- Use YCE as Y-Plan's built-in prompt enhancement and code search path. Default mode: first enhance the user prompt, then decide from the original + enhanced prompt whether concrete code locations are needed, then search only when useful, and finally plan with both enhancement and search context.

## Native Workflow Rules

1. Use `scope` to capture the goal, boundaries, assumptions, and open questions.
2. Use `context` when the plan depends on user history, YCE prompt enhancement, code search, or bundled skill guidance.
3. Use `design` to decide the implementation approach, tradeoffs, dependency order, and risk controls.
4. Use `file-plan` for code-related work so the final plan names concrete files or code areas to change.
5. Use `validation-plan` to describe future verification steps only. Do not run commands, tests, regressions, health checks, or curl checks in Y-Plan.
6. For simple tasks, keep `plan_workflow` short and avoid artificial phases.

## YCE-To-Plan Rule

When YCE is enabled:

1. First use YCE enhance to sharpen the user prompt.
2. Decide whether code search is needed from the original task plus the enhanced prompt.
3. If the task is code-related or asks what to modify, use YCE search against the target `cwd`.
4. Distill YCE findings into `file_changes`.
5. If YCE cannot locate a file, write `UNKNOWN` and name the exact lookup still needed.
6. Never ask the caller to inspect raw YCE output.

## File Changes Rule

Every code-related final plan must include:

- the file or code area to modify;
- the planned change in that file or area;
- validation tied to that file or area.

## Output Rule

The final Markdown plan is the only product. Use readable headings and lists for `plan_workflow`, `selected_skills`, `file_changes`, YCE findings, and risk notes so another model or user can execute it directly. Do not require the caller to inspect raw YCE output, raw skill text, raw agent configuration, or XML tags.
