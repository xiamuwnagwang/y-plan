# OpenHarnesses Planning Reference

Use these ideas as planning constraints inside Y-Plan. Do not invoke OpenHarnesses from Y-Plan unless the user explicitly asks for routing or agent dispatch outside the planning-only flow. This reference exists only to help the model produce a better final plan for the caller.

## Planning Capabilities To Reuse

- Prefer a readonly analysis phase before any execution phase.
- Treat code exploration, external research, advisory review, UI review, doc review, readonly validation, and execute validation as separate responsibilities.
- Gate execution carefully: only plan command execution, tests, health checks, smoke tests, or curl checks when the user task explicitly needs validation or release confidence.
- For simple, clear, small-scope tasks, plan a direct local change instead of adding extra routing or coordination stages.
- For uncertain tasks, plan a first discovery step and require evidence before committing to a fix path.
- For code-location tasks, use YCE prepass when enabled so the model sees relevant files before it writes the plan.
- When YCE has already produced a prepass result, tell downstream planning to use that context, avoid repeated search loops, and distill the useful findings into the final plan.
- When multiple roles would be useful, keep boundaries clean:
  - explore: locate files and summarize implementation evidence.
  - advisor: compare approaches and risks.
  - researcher: gather external docs or version facts.
  - code-reviewer: diagnose likely defects and repair strategy.
  - readonly-validator: inspect existing logs or outputs.
  - execute-validator: run explicit verification only when asked.

## YCE Prepass Trigger Shape

Run optional YCE prepass for planning prompts that ask where code lives, where an implementation is, which module or component handles something, or how a route/handler/provider is wired. YCE output is not a separate result; it is evidence for the final plan.

Representative trigger patterns:

- locate code, find implementation, code path, source code
- "在哪", "哪里", "哪个文件", "哪个模块", "哪段代码"
- "定位代码/实现/逻辑/文件/函数/类/接口/模块"

Avoid YCE prepass for:

- empty prompts;
- pure validation tasks that already require execution;
- tasks debugging Y-Plan/OpenHarnesses recursion itself;
- prompts where the user disabled YCE.

## Planner Output Discipline

The plan should preserve OpenHarnesses-style handoff quality without spawning agents:

- list selected skill guidance and why it applies;
- name dependencies between steps;
- identify files or areas likely touched when known;
- keep validation separate from implementation;
- mark execution as a future phase;
- include fallback branches when model, CLI, YCE, or code search can fail;
- return the completed plan to the caller, not just store it locally;
- never require the caller to inspect raw YCE output, raw skill text, or this reference to understand the plan.
