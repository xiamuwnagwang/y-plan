#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkForUpdate,
  formatUpdateBanner,
  formatVersionLine,
  readLocalVersion,
} from "./lib/version.mjs";

const __dirname = import.meta.url.startsWith("file:///$bunfs/")
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const defaultConfigPath = resolve(skillDir, "y-plan.config.json");
const bundledYceScript = resolve(skillDir, "vendor/yce/scripts/yce.js");
const defaultYceScript = bundledYceScript;
const bundledMattSkillsRoot = resolve(skillDir, "vendor/mattpocock-skills/skills");
const defaultSkillsRoot = bundledMattSkillsRoot;
const planningCoreReferencePath = resolve(skillDir, "references/y-plan-planning-core.md");
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_API_TIMEOUT_MS = 180000;
const PROMPT_TRIM_CHARS = 7000;
const PLANNING_CORE_TRIM_CHARS = 5000;

/** Fallback CLI runtimes when y-plan.config.json is missing — no model pin; use CLI defaults. */
const AUTO_DISCOVER_CLI = [
  { runtime: "claude-code", bins: ["claude"] },
  { runtime: "codex", bins: ["codex"] },
  // Prefer cursor-agent: bare `agent` is often Grok/other CLIs on PATH.
  { runtime: "cursor", bins: ["cursor-agent", "agent", "cursor"] },
  { runtime: "kiro", bins: ["kiro-cli", "kiro"] },
  { runtime: "qoder", bins: ["qodercli", "qoder", "qoder-cli"] },
];

const BUILTIN_AGENT_CONFIG = {
  routing: {
    plannerAgent: "y-plan",
    mode: "planning-only",
    decisionOutput: "plan_workflow",
  },
  roles: {
    scope: {
      title: "范围澄清",
      description: "把用户目标、边界、已知事实和待确认问题收束成计划输入。",
    },
    context: {
      title: "上下文整理",
      description: "整理 YCE、代码检索、用户上下文和相关 skill 结论，用于确定计划依据。",
    },
    design: {
      title: "方案设计",
      description: "拆出可执行的技术路线、取舍、依赖关系和风险控制。",
    },
    "file-plan": {
      title: "文件改动计划",
      description: "明确最终计划中应该改哪些文件或代码区域，以及每处改动的目标。",
    },
    "validation-plan": {
      title: "验证计划",
      description: "只规划后续如何验证，不在 Y-Plan 阶段执行命令、测试或回归。",
    },
  },
};

const RUNTIME_ALIASES = new Map([
  ["claude", "claude-api"],
  ["anthropic", "claude-api"],
  ["claude-api", "claude-api"],
  ["claude-cli", "claude-code"],
  ["claude-code", "claude-code"],
  ["gemini", "gemini"],
  ["codex", "codex"],
  ["openai", "openai-chat"],
  ["openai-chat", "openai-chat"],
  ["openai-chat-completions", "openai-chat"],
  ["openai-response", "openai-responses"],
  ["openai-responses", "openai-responses"],
  ["qoder", "qoder"],
  ["qodercli", "qoder"],
  ["qoder-cli", "qoder"],
  ["cursor", "cursor"],
  ["cursor-agent", "cursor"],
  ["cursor-cli", "cursor"],
  ["kiro", "kiro"],
  ["kiro-cli", "kiro"],
]);

const CODE_SEARCH_INTENT_PATTERNS = [
  /搜索代码|查找代码|检索代码|定位代码|代码位置|相关代码|源码位置|调用链|定位实现|实现位置|相关实现|逻辑在哪|代码在哪|代码哪里|改哪个文件|哪个文件|文件改动/i,
  /函数|类|接口|模块|组件|route|handler|provider|api/i,
  /\b(source code|code path|call chain|locate (?:the )?(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|search (?:the )?(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|where.*(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|implementation (?:location|path)|function|class|module|component|route|handler|provider|api)\b/i,
];

const CODE_SEARCH_OVERRIDE_PATTERNS = [
  /搜索代码|查找代码|检索代码|定位代码|代码位置|相关代码|源码位置|调用链|定位实现|实现位置|相关实现|逻辑在哪|代码在哪|代码哪里|改哪个文件|哪个文件/i,
  /\b(source code|code path|call chain|locate (?:the )?(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|search (?:the )?(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|where.*(?:code|source|implementation|function|class|module|component|route|handler|provider|api)|where to (?:update|change|edit|modify).*(?:\w[\w./-]*\.(?:sh|mjs|js|ts|tsx|jsx|json|md|ps1|py|rb|go|rs|java|kt|swift|css|scss|html)|file|script)|implementation (?:location|path))\b/i,
];

const NON_CODE_SEARCH_SUPPRESSION_PATTERNS = [
  /非代码|纯文本|不触碰文件|不读写文件|不读取.*文件|不创建.*文件|不修改.*文件|不要编辑文件|不得.*文件|无需.*文件|无文件变更|无文件改动/i,
  /\b(non-code|do not (?:read|create|edit|modify|touch).*files?|no code changes?|without (?:reading|creating|editing|modifying|touching).*files?)\b/i,
];

const MATT_SKILLS = [
  {
    name: "implement",
    always: true,
    paths: ["engineering/implement/SKILL.md", "skills/engineering/implement/SKILL.md", "implement/SKILL.md"],
    reason: "implementation discipline, vertical slices, scope boundaries, and execution handoff",
  },
  {
    name: "codebase-design",
    always: true,
    paths: ["engineering/codebase-design/SKILL.md", "skills/engineering/codebase-design/SKILL.md", "codebase-design/SKILL.md"],
    reason: "module, interface, depth, leverage, and locality vocabulary",
  },
  {
    name: "domain-modeling",
    always: true,
    paths: ["engineering/domain-modeling/SKILL.md", "skills/engineering/domain-modeling/SKILL.md", "domain-modeling/SKILL.md"],
    reason: "domain terminology, glossary, and decision-sharpening discipline",
  },
  {
    name: "ask-matt",
    keywords: [/which skill/i, /ask-matt/i, /该用.*skill/i, /选择.*skill/i],
    paths: ["engineering/ask-matt/SKILL.md", "skills/engineering/ask-matt/SKILL.md", "ask-matt/SKILL.md"],
    reason: "skill routing hints from the mattpocock/skills collection",
  },
  {
    name: "tdd",
    keywords: [/tdd/i, /test/i, /测试/, /回归/, /bug/i, /fix/i],
    paths: ["engineering/tdd/SKILL.md", "skills/engineering/tdd/SKILL.md", "tdd/SKILL.md"],
    reason: "test-first behavior planning and vertical red-green-refactor slices",
  },
  {
    name: "request-refactor-plan",
    keywords: [/refactor/i, /重构/, /架构/, /architecture/i],
    paths: ["deprecated/request-refactor-plan/SKILL.md", "skills/deprecated/request-refactor-plan/SKILL.md", "request-refactor-plan/SKILL.md"],
    reason: "small safe refactor commits and scope boundaries",
  },
  {
    name: "improve-codebase-architecture",
    keywords: [/架构/, /architecture/i, /module/i, /模块/, /seam/i, /interface/i],
    paths: ["engineering/improve-codebase-architecture/SKILL.md", "skills/engineering/improve-codebase-architecture/SKILL.md", "improve-codebase-architecture/SKILL.md"],
    reason: "architecture deepening opportunities and friction analysis",
  },
  {
    name: "to-prd",
    keywords: [/prd/i, /需求/, /product/i, /spec/i, /规格/],
    paths: ["engineering/to-prd/SKILL.md", "skills/engineering/to-prd/SKILL.md", "to-prd/SKILL.md"],
    reason: "product requirement framing before implementation planning",
  },
  {
    name: "to-issues",
    keywords: [/issue/i, /ticket/i, /任务拆分/, /拆成/, /工单/, /slice/i],
    paths: ["engineering/to-issues/SKILL.md", "skills/engineering/to-issues/SKILL.md", "to-issues/SKILL.md"],
    reason: "independent vertical slices and dependency-aware issue breakdown",
  },
  {
    name: "triage",
    keywords: [/triage/i, /分流/, /评估/, /优先级/],
    paths: ["engineering/triage/SKILL.md", "skills/engineering/triage/SKILL.md", "triage/SKILL.md"],
    reason: "issue readiness, labels, and next-action clarity",
  },
  {
    name: "grill-with-docs",
    keywords: [/不确定/, /澄清/, /interview/i, /grill/i, /模糊/, /方案/],
    paths: ["engineering/grill-with-docs/SKILL.md", "skills/engineering/grill-with-docs/SKILL.md", "grill-with-docs/SKILL.md"],
    reason: "question-driven sharpening when requirements are under-specified",
  },
  {
    name: "prototype",
    keywords: [/prototype/i, /原型/, /验证想法/, /throwaway/i],
    paths: ["engineering/prototype/SKILL.md", "skills/engineering/prototype/SKILL.md", "prototype/SKILL.md"],
    reason: "throwaway prototype planning for uncertain design or state-machine work",
  },
  {
    name: "diagnosing-bugs",
    keywords: [/bug/i, /error/i, /报错/, /排障/, /调试/, /root cause/i, /根因/],
    paths: ["engineering/diagnosing-bugs/SKILL.md", "skills/engineering/diagnosing-bugs/SKILL.md", "diagnosing-bugs/SKILL.md", "diagnose/SKILL.md"],
    reason: "diagnosis plan shape: reproduce, narrow, hypothesize, instrument, fix, verify",
  },
  {
    name: "resolving-merge-conflicts",
    keywords: [/merge conflict/i, /conflict/i, /冲突/, /合并/],
    paths: ["engineering/resolving-merge-conflicts/SKILL.md", "skills/engineering/resolving-merge-conflicts/SKILL.md", "resolving-merge-conflicts/SKILL.md"],
    reason: "merge-conflict planning, verification order, and safety boundaries",
  },
  {
    name: "review",
    keywords: [/review/i, /评审/, /代码审查/, /审查/],
    paths: ["in-progress/review/SKILL.md", "skills/in-progress/review/SKILL.md", "review/SKILL.md"],
    reason: "review-oriented risk scanning and findings-first structure",
  },
  {
    name: "handoff",
    keywords: [/handoff/i, /交接/, /上下文压缩/],
    paths: ["productivity/handoff/SKILL.md", "skills/productivity/handoff/SKILL.md", "handoff/SKILL.md"],
    reason: "handoff completeness and next-agent context discipline",
  },
  {
    name: "grill-me",
    keywords: [/grill-me/i, /追问/, /压力测试/, /问清楚/],
    paths: ["productivity/grill-me/SKILL.md", "skills/productivity/grill-me/SKILL.md", "grill-me/SKILL.md"],
    reason: "stress-test questions for weak or ambiguous plans",
  },
  {
    name: "writing-shape",
    keywords: [/文章/, /写作/, /草稿/, /发布/, /edit article/i],
    paths: ["in-progress/writing-shape/SKILL.md", "skills/in-progress/writing-shape/SKILL.md", "writing-shape/SKILL.md"],
    reason: "writing task structure, shaping, and publication-oriented planning",
  },
  {
    name: "setup-pre-commit",
    keywords: [/pre-commit/i, /husky/i, /lint-staged/i, /格式化/, /lint/i],
    paths: ["misc/setup-pre-commit/SKILL.md", "skills/misc/setup-pre-commit/SKILL.md", "setup-pre-commit/SKILL.md"],
    reason: "quality-gate planning for pre-commit and formatting workflows",
  },
  {
    name: "git-guardrails-claude-code",
    keywords: [/git guardrail/i, /git 安全/, /危险 git/, /git hook/i],
    paths: ["misc/git-guardrails-claude-code/SKILL.md", "skills/misc/git-guardrails-claude-code/SKILL.md", "git-guardrails-claude-code/SKILL.md"],
    reason: "git safety guardrail planning",
  },
  {
    name: "migrate-to-shoehorn",
    keywords: [/shoehorn/i, /type assertion/i, /\bas\b.*测试/],
    paths: ["misc/migrate-to-shoehorn/SKILL.md", "skills/misc/migrate-to-shoehorn/SKILL.md", "migrate-to-shoehorn/SKILL.md"],
    reason: "specialized TypeScript test migration planning",
  },
  {
    name: "scaffold-exercises",
    keywords: [/exercise/i, /练习/, /课程/, /workshop/i],
    paths: ["misc/scaffold-exercises/SKILL.md", "skills/misc/scaffold-exercises/SKILL.md", "scaffold-exercises/SKILL.md"],
    reason: "exercise and workshop planning structure",
  },
];

function usage(exitCode = 0) {
  const version = readLocalVersion(skillDir) || "unknown";
  const out = [
    `y-plan v${version}`,
    "",
    "Usage:",
    "  node scripts/y-plan.mjs [--cwd path] [--use-yce] <task>",
    "  node scripts/y-plan.mjs --version",
    "  node scripts/y-plan.mjs --check-update",
    "",
    "Examples:",
    "  node scripts/y-plan.mjs \"Plan this refactor\"",
    "  node scripts/y-plan.mjs --use-yce --yce-mode auto --history \"User: ...\" \"Plan this code change\"",
    "",
    "Output: Markdown.",
    "YCE default mode: plan (enhance prompt, decide whether code search is needed, then plan with both contexts).",
    "Models: y-plan.config.json models, or auto-discovered local CLIs when config is missing.",
  ].join("\n");
  (exitCode === 0 ? console.log : console.error)(out);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    config: process.env.Y_PLAN_CONFIG || defaultConfigPath,
    agentConfig: process.env.Y_PLAN_AGENT_CONFIG || "",
    useYce: envFlag(process.env.Y_PLAN_USE_YCE),
    yceExplicit: process.env.Y_PLAN_USE_YCE != null,
    yceMode: process.env.Y_PLAN_YCE_MODE || "",
    history: process.env.Y_PLAN_HISTORY || "",
    showVersion: false,
    checkUpdate: false,
    task: "",
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") usage(0);
    if (arg === "-V" || arg === "--version") {
      args.showVersion = true;
      continue;
    }
    if (arg === "--check-update") {
      args.checkUpdate = true;
      continue;
    }
    if (arg === "--cwd") {
      args.cwd = argv[++i] || "";
      continue;
    }
    if (arg === "--config") {
      args.config = argv[++i] || "";
      continue;
    }
    if (arg === "--agent-config") {
      args.agentConfig = argv[++i] || "";
      continue;
    }
    if (arg === "--use-yce") {
      args.useYce = true;
      args.yceExplicit = true;
      continue;
    }
    if (arg === "--no-yce") {
      args.useYce = false;
      args.yceExplicit = true;
      continue;
    }
    if (arg === "--yce-mode") {
      args.yceMode = argv[++i] || "plan";
      continue;
    }
    if (arg === "--history") {
      args.history = argv[++i] || "";
      continue;
    }
    if (arg === "--task") {
      rest.push(argv[++i] || "");
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    rest.push(arg);
  }
  args.task = rest.join(" ").trim();
  return args;
}

function commandExists(bin) {
  if (!bin) return false;
  if (process.platform === "win32") {
    return spawnSync("where", [bin], { encoding: "utf8", timeout: 3000 }).status === 0;
  }
  return spawnSync("sh", ["-lc", `command -v ${JSON.stringify(bin)}`], {
    encoding: "utf8",
    timeout: 3000,
  }).status === 0;
}

function formatModelLabel(entry) {
  if (!entry) return "(none)";
  return entry.model ? `${entry.runtime}/${entry.model}` : `${entry.runtime} (cli-default)`;
}

function discoverLocalModelChoices() {
  const found = [];
  for (const def of AUTO_DISCOVER_CLI) {
    if (def.bins.some((bin) => commandExists(bin))) {
      found.push({ runtime: def.runtime });
    }
  }
  if (found.length > 0) return found;
  // Last resort static runtime order so CLI still has a try list after install.
  return AUTO_DISCOVER_CLI.slice(0, 3).map((d) => ({ runtime: d.runtime }));
}

function envFlag(value) {
  if (value == null || value === "") return false;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function readConfig(configPath) {
  if (!configPath || !existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function readJsonFileIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function readStdinIfNeeded(task) {
  if (task) return task;
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function resolveModelChoice(rawRuntime, rawModel, rawEntry = {}) {
  let runtime = rawRuntime || "";
  let model = rawModel || "";

  if (!runtime && model.includes("/")) {
    const [prefix, ...modelParts] = model.split("/");
    const mapped = RUNTIME_ALIASES.get(prefix);
    if (mapped) {
      runtime = mapped;
      model = modelParts.join("/");
    }
  }

  runtime = RUNTIME_ALIASES.get(runtime || "claude") || runtime || "claude-code";
  if (!RUNTIME_ALIASES.has(runtime) && ![...RUNTIME_ALIASES.values()].includes(runtime)) {
    throw new Error(`Unsupported runtime: ${runtime}`);
  }
  return { ...rawEntry, runtime, model };
}

function normalizeModelEntry(entry) {
  if (typeof entry === "string") {
    return resolveModelChoice("", entry);
  }
  if (entry && typeof entry === "object") {
    return resolveModelChoice(entry.runtime || "", entry.model || "", entry);
  }
  throw new Error(`Invalid model entry: ${JSON.stringify(entry)}`);
}

function resolveModelChoices(args, config, agentConfig = {}) {
  const configuredModels = Array.isArray(config.models) ? config.models : [];
  const agentModels = Array.isArray(agentConfig.models) ? agentConfig.models : [];
  const jsonChoices = [...agentModels, ...configuredModels];
  if (jsonChoices.length > 0) {
    return jsonChoices.map(normalizeModelEntry);
  }

  const discovered = discoverLocalModelChoices();
  writeProgress(
    `[y-plan] no models in config; using auto-discovered CLIs (cli defaults): ${discovered.map(formatModelLabel).join(", ")}`,
  );
  return discovered.map(normalizeModelEntry);
}

function readFirstExisting(root, relativePaths) {
  for (const relativePath of relativePaths) {
    const fullPath = resolve(root, relativePath);
    if (existsSync(fullPath)) {
      return { path: fullPath, content: readFileSync(fullPath, "utf8") };
    }
  }
  return null;
}

function resolveMaybeRelativeToSkillDir(value) {
  if (!value) return "";
  return isAbsolute(value) ? value : resolve(skillDir, value);
}

function selectMattSkills(task) {
  const root = process.env.Y_PLAN_SKILLS_ROOT || defaultSkillsRoot;
  const selected = [];
  const missing = [];
  for (const skill of MATT_SKILLS) {
    const matched = skill.always || (skill.keywords || []).some((pattern) => pattern.test(task));
    if (!matched) continue;
    const loaded = readFirstExisting(root, skill.paths);
    if (loaded) {
      selected.push({ ...skill, path: loaded.path, content: loaded.content });
    } else {
      missing.push({ name: skill.name, paths: skill.paths.map((p) => resolve(root, p)) });
    }
  }
  return { selected, missing, root };
}

function readPlanningCoreReference() {
  if (!existsSync(planningCoreReferencePath)) return "";
  return readFileSync(planningCoreReferencePath, "utf8");
}

function loadAgentConfig(args, config) {
  const externalPath = args.agentConfig || config.agentConfig || "";
  if (externalPath) {
    const path = resolveMaybeRelativeToSkillDir(externalPath);
    const loaded = readJsonFileIfExists(path);
    if (loaded) {
      return { path, config: loaded, exists: true };
    }
  }
  return { path: "(built-in)", config: BUILTIN_AGENT_CONFIG, exists: false };
}

function normalizeAgentRoles(agentConfig) {
  const source = agentConfig.roles && typeof agentConfig.roles === "object"
    ? agentConfig.roles
    : Object.fromEntries(Object.entries(agentConfig).filter(([key, value]) => (
        key !== "routing" && value && typeof value === "object" && Array.isArray(value.agentNames)
      )));
  return Object.entries(source).map(([name, role]) => ({
    name,
    title: role.title || name,
    description: role.description || "",
  }));
}

function buildAgentPlanningGuidance(agentConfigInfo, task) {
  const roles = normalizeAgentRoles(agentConfigInfo.config);
  const roleNames = roles.map((role) => role.name);
  const roleLines = roles.map((role) => (
    `- ${role.name} (${role.title}): ${role.description}`
  )).join("\n");

  return [
    `config path: ${agentConfigInfo.path}`,
    `config loaded: ${agentConfigInfo.exists ? "true" : "false; using built-in fallback"}`,
    `planner agent: ${agentConfigInfo.config.routing?.plannerAgent || "y-plan"}`,
    `mode: ${agentConfigInfo.config.routing?.mode || "planning-only"}`,
    `decision output: ${agentConfigInfo.config.routing?.decisionOutput || "plan_workflow"}`,
    `planning task: ${task}`,
    "",
    "Y-Plan native planning phases:",
    roleLines || "- none",
    "",
    "Workflow rules:",
    `- Use these phases as plan_workflow owners only; they are not external agents and must not dispatch work.`,
    `- Available planning phases: ${roleNames.join(", ") || "none"}.`,
    "- Keep the workflow compact for simple tasks instead of inventing extra phases.",
    "- For uncertain tasks, start with scope/context, then design/file-plan, then validation-plan.",
    "- validation-plan describes future checks only; do not run commands, tests, health checks, or regressions in Y-Plan.",
  ].join("\n");
}

function buildIntegratedMattSummary(selected) {
  return selected.map((skill) => `${skill.name}: ${skill.reason}`).join("; ");
}

const PROGRESS_NOISE_PATTERNS = [
  /^\s*Reading additional input from stdin/i,
  /^\s*OpenAI Codex v\d/i,
  /^\s*-+\s*$/,
  /^\s*workdir:/i,
  /^\s*model:/i,
  /^\s*provider:/i,
  /^\s*approval:/i,
  /^\s*sandbox:/i,
  /^\s*reasoning effort:/i,
  /^\s*reasoning summaries:/i,
  /^\s*session id:/i,
  /^\s*user\s*$/i,
  /^\s*tokens used/i,
  /^\s*\d[\d,]*\s*$/,
  /Skill descriptions were shortened/i,
  /rmcp::transport/i,
  /AuthRequired/i,
];

function writeProgress(message) {
  process.stderr.write(`${message}\n`);
}

function writeModelOutput(modelChoice, event) {
  if (!event || !event.text) return;
  if (event.stream === "stdout") {
    process.stderr.write(event.text);
    return;
  }
  if (event.stream === "progress") {
    process.stderr.write(event.text);
    return;
  }
  if (event.stream === "stderr") {
    const lines = String(event.text).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (PROGRESS_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) continue;
      if (/error|failed|timeout|timed out|fatal|denied|unauthorized/i.test(trimmed)) {
        process.stderr.write(`[${modelChoice.runtime}] ${trimmed}\n`);
      }
    }
  }
}

function writeYceProgress(event) {
  if (!event || !event.message) return;
  process.stderr.write(`${event.message}\n`);
}

function runProcess(command, cwd, { timeoutMs = DEFAULT_API_TIMEOUT_MS, onStdout, onStderr } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command.bin, command.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolvePromise({ code: 124, stdout, stderr: `${stderr}\nTimeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) {
        try { onStdout(text); } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) {
        try { onStderr(text); } catch {}
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runYcePrepass({ args, config, task, onProgress }) {
  const yceConfig = config.yce && typeof config.yce === "object" ? config.yce : {};
  const enabled = args.yceExplicit ? Boolean(args.useYce) : Boolean(yceConfig.enabled);
  if (!enabled) {
    return { enabled: false, prompt: task, stdout: "", stderr: "", code: 0 };
  }

  const report = (message) => {
    if (onProgress) onProgress({ message });
  };

  const yceScript = defaultYceScript;
  if (!existsSync(yceScript)) {
    return {
      enabled: true,
      prompt: task,
      stdout: "",
      stderr: `YCE script not found: ${yceScript}`,
      code: 127,
    };
  }

  const history = args.history || yceConfig.history || `User: ${task}`;
  const mode = args.yceMode || yceConfig.mode || "plan";
  const timeoutMs = Number(yceConfig.timeoutMs || DEFAULT_TIMEOUT_MS);
  const runs = [];

  const runYce = async (query, yceMode) => {
    report(`[y-plan] yce ${yceMode} running ...`);
    const yceArgs = [
      yceScript,
      query,
      "--mode", yceMode,
      "--cwd", args.cwd,
      "--xml-pretty",
    ];
    if (history) yceArgs.push("--history", history);
    const result = await runProcess({ bin: "node", args: yceArgs }, args.cwd, { timeoutMs });
    const enhancedPrompt = extractTag(result.stdout, "prompt");
    const searchResult = extractTag(result.stdout, "result");
    const resolvedAction = extractTag(result.stdout, "resolved-action");
    const success = extractTag(result.stdout, "success") === "true";
    const errors = extractErrors(result.stdout);
    const run = {
      mode: yceMode,
      query,
      code: result.code,
      success,
      resolvedAction,
      enhancedPrompt,
      searchResult,
      errors,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    runs.push(run);
    return run;
  };

  if (mode === "plan") {
    const enhanceRun = await runYce(task, "enhance");
    const enhancedTask = enhanceRun.enhancedPrompt || task;
    const shouldSearch = shouldRunYceSearch({ originalText: task, expandedText: enhancedTask, yceConfig });
    report(shouldSearch ? "[y-plan] yce enhance done; code search needed." : "[y-plan] yce enhance done; no code search needed.");
    let searchRun = null;
    if (shouldSearch) {
      searchRun = await runYce(enhancedTask, "search");
    }
    const contextBlock = searchRun?.searchResult
      ? `\n\n[YCE code search context]\n${searchRun.searchResult}`
      : "";

    return {
      enabled: true,
      prompt: `${enhancedTask}${contextBlock}`,
      stdout: runs.map((run) => run.stdout).filter(Boolean).join("\n"),
      stderr: runs.map((run) => run.stderr).filter(Boolean).join("\n"),
      code: searchRun?.code ?? enhanceRun.code,
      mode,
      enhancedPrompt: enhanceRun.enhancedPrompt,
      searchResult: searchRun?.searchResult || "",
      searchExecuted: Boolean(searchRun),
      runs,
    };
  }

  const yceArgs = [
    yceScript,
    task,
    "--mode", mode,
    "--cwd", args.cwd,
    "--xml-pretty",
  ];
  if (history) yceArgs.push("--history", history);

  const result = await runProcess({ bin: "node", args: yceArgs }, args.cwd, {
    timeoutMs,
  });

  const enhancedPrompt = extractTag(result.stdout, "prompt");
  const searchResult = extractTag(result.stdout, "result");
  const resolvedAction = extractTag(result.stdout, "resolved-action");
  const success = extractTag(result.stdout, "success") === "true";
  const errors = extractErrors(result.stdout);
  const nextPrompt = enhancedPrompt || task;
  const contextBlock = searchResult
    ? `\n\n[YCE code search context]\n${searchResult}`
    : "";

  return {
    enabled: true,
    prompt: `${nextPrompt}${contextBlock}`,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
    mode,
    enhancedPrompt,
    searchResult,
    searchExecuted: Boolean(searchResult),
    runs: [{
      mode,
      query: task,
      code: result.code,
      success,
      resolvedAction,
      enhancedPrompt,
      searchResult,
      errors,
      stdout: result.stdout,
      stderr: result.stderr,
    }],
  };
}

function shouldRunYceSearch({ originalText, expandedText, yceConfig = {} }) {
  if (yceConfig.forceSearch) return true;
  const original = String(originalText || "");
  const combined = `${original}\n${String(expandedText || "")}`;
  const hasSearchIntent = CODE_SEARCH_INTENT_PATTERNS.some((pattern) => pattern.test(combined));
  if (!hasSearchIntent) return false;
  const suppressesSearch = NON_CODE_SEARCH_SUPPRESSION_PATTERNS.some((pattern) => pattern.test(combined));
  if (!suppressesSearch) return true;
  return CODE_SEARCH_OVERRIDE_PATTERNS.some((pattern) => pattern.test(original));
}

function extractTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || String(xml || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractErrors(xml) {
  const errors = [];
  const pattern = /<error\b([^>]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/error>/gi;
  for (const match of String(xml || "").matchAll(pattern)) {
    const attrs = match[1] || "";
    const source = attrs.match(/\bsource="([^"]*)"/i)?.[1] || "unknown";
    const code = attrs.match(/\bcode="([^"]*)"/i)?.[1] || "unknown";
    const message = decodeXmlEntities((match[2] || match[3] || "").trim());
    errors.push(`${source}/${code}: ${message}`);
  }
  return errors;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function trimForPrompt(content, maxChars = PROMPT_TRIM_CHARS) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[truncated by y-plan: ${content.length - maxChars} chars omitted]`;
}

const SKILL_SUMMARY_MAX_CHARS = 600;

function summarizeSkill(content) {
  const text = String(content || "").trim();
  if (!text) return "(empty)";
  const withoutFrontmatter = text.replace(/^---[\s\S]*?---\s*/, "");
  const lines = withoutFrontmatter.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summaryLines = [];
  let total = 0;
  for (const line of lines) {
    if (/^#{1,6}\s+/i.test(line)) {
      if (summaryLines.length > 0) break;
      continue;
    }
    if (total + line.length > SKILL_SUMMARY_MAX_CHARS) {
      const remaining = SKILL_SUMMARY_MAX_CHARS - total;
      if (remaining > 0) summaryLines.push(`${line.slice(0, remaining)}...`);
      break;
    }
    summaryLines.push(line);
    total += line.length + 1;
    if (summaryLines.length >= 3) break;
  }
  const summary = summaryLines.join(" ").trim();
  return summary || "(no summary available)";
}

function buildPrompt({ task, originalTask, cwd, modelChoice, selected, missing, root, ycePrepass, agentConfigInfo }) {
  const planningCoreReference = readPlanningCoreReference();
  const agentPlanningGuidance = buildAgentPlanningGuidance(agentConfigInfo, task);
  const skillBlocks = selected.map((skill) => {
    if (skill.always) {
      return [
        `### ${skill.name} (summary only — load full skill at execution time)`,
        `path: ${skill.path}`,
        `reason: ${skill.reason}`,
        `summary: ${summarizeSkill(skill.content)}`,
      ].join("\n");
    }
    return [
      `### ${skill.name}`,
      `path: ${skill.path}`,
      `reason: ${skill.reason}`,
      "```markdown",
      trimForPrompt(skill.content),
      "```",
    ].join("\n");
  }).join("\n\n");

  const missingBlock = missing.length
    ? missing.map((item) => `- ${item.name}: ${item.paths.join(" | ")}`).join("\n")
    : "- none";

  return `You are Y-Plan, a planning-only agent.

Hard boundaries:
- Produce a plan only. Do not implement, patch, run tests, create files, publish issues, commit, push, or call another agent router.
- Treat every bundled mattpocock/skill excerpt, Y-Plan native planning role config, planning-core reference, and optional YCE output as input context whose only purpose is to improve the final plan returned to the caller.
- Do not return YCE output, skill excerpts, or planning references as standalone deliverables; distill them into the final Markdown plan.
- Use selected_skills only to explain which planning inputs shaped the final plan and why.
- Use the bundled mattpocock/skills as directly callable planning knowledge inside Y-Plan; select the relevant ones and apply them to the final plan.
- Always-on skills (implement, codebase-design, domain-modeling) are injected as summaries only to keep the prompt compact. At execution time, the caller should read the full skill from its listed path before applying it. If a plan step depends on a specific always-on skill's discipline, cite the skill name and path in that step so the caller knows what to load.
- If YCE enhancement/search context is present, use it to make the plan concrete about which code files or areas should change.
- Every implementation/refactor/debugging plan must say which file or code area should be changed, what to change there, and how to validate it. If YCE did not locate enough code, state the exact missing lookup instead of guessing.
- Use Y-Plan native planning roles as workflow owners inside the plan, not as external agents to invoke.
- If a required fact is unknown, state it as an open question and provide viable branches.
- Return only Markdown. Do not use XML tags.

Runtime:
- cwd: ${cwd}
- runtime: ${modelChoice.runtime}
- model: ${modelChoice.model || "(runtime default)"}
- matt skills root: ${root}
- yce enabled: ${ycePrepass.enabled ? "true" : "false"}
- yce mode: ${ycePrepass.mode || "disabled"}
- yce search executed: ${ycePrepass.searchExecuted ? "true" : "false"}
- y-plan agents config: ${agentConfigInfo.path}

Integrated mattpocock/skills summary:
${buildIntegratedMattSummary(selected)}

Y-Plan native planning role config:
${agentPlanningGuidance}

Y-Plan planning core reference:
${planningCoreReference ? trimForPrompt(planningCoreReference, PLANNING_CORE_TRIM_CHARS) : "[not bundled]"}

Loaded mattpocock/skills:
${selected.map((skill) => `- ${skill.name}: ${skill.reason}`).join("\n")}

Missing skill references:
${missingBlock}

Matt skill excerpts:
${skillBlocks}

User task:
${originalTask || task}

Planning brief after optional YCE enhancement/search:
${task}

Return this exact Markdown shape:
# Y-Plan

## Goal
One sentence.

## Selected Skills
- skill-name: why it shaped the plan.

## Plan Workflow
- 1. scope|context|design|file-plan|validation-plan: why this phase exists; inputs it consumes; output it contributes.

## File Changes
- path: absolute or project-relative path from YCE/context, or UNKNOWN.
  Change: specific planned change in this file or code area.
  Validation: how to verify this file/area change after execution.

## Assumptions
- ...

## Open Questions
- ...

## Steps
- 1. Title
  Purpose: ...
  Depends on: none or comma-separated ids.
  Likely files or areas: concrete files/areas from File Changes, or UNKNOWN plus the lookup needed.
  Expected output: ...
  Validation: ...

## Dependency Graph
- plain-text dependency list.

## Risks
- Risk: ...
  Mitigation: ...

## Out Of Scope
- ...

## Handoff
What to return after planning.`;
}

function resolveRuntimeBin(runtime) {
  if (runtime === "claude-code") return "claude";
  if (runtime === "gemini") return "gemini";
  if (runtime === "codex") return "codex";
  if (runtime === "qoder") {
    return process.env.Y_PLAN_QODER_BIN || firstExistingBin(["qodercli", "qoder", "qoder-cli"]) || "qodercli";
  }
  if (runtime === "cursor") {
    // Never prefer bare `agent` first — it may be Grok Build, not Cursor.
    return process.env.Y_PLAN_CURSOR_BIN
      || firstExistingBin(["cursor-agent", "agent", "cursor"])
      || "cursor-agent";
  }
  if (runtime === "kiro") {
    return process.env.Y_PLAN_KIRO_BIN || firstExistingBin(["kiro-cli", "kiro"]) || "kiro-cli";
  }
  return runtime;
}

function firstExistingBin(bins) {
  for (const bin of bins) {
    if (commandExists(bin)) return bin;
  }
  return "";
}

function buildCommand(modelChoice, prompt) {
  const { runtime, model } = modelChoice;
  if (runtime === "claude-code") {
    // Do NOT pass --tools "" : Claude CLI treats the next argv as the tools
    // value when the empty string is ambiguous, which swallows the prompt and
    // yields "Input must be provided...". Model is optional (CLI default works).
    const args = ["-p", "--permission-mode", "plan"];
    if (model) args.push("--model", model);
    args.push(prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  if (runtime === "gemini") {
    const args = ["--approval-mode", "plan"];
    if (model) args.push("-m", model);
    args.push("-p", prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  if (runtime === "codex") {
    const args = ["exec", "--skip-git-repo-check"];
    if (model) args.push("-m", model);
    args.push("--", prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  if (runtime === "qoder") {
    const args = ["-p"];
    if (model) args.push("--model", model);
    args.push(prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  if (runtime === "cursor") {
    const args = ["-p", "--plan", "--force"];
    if (model) args.push("--model", model);
    args.push(prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  if (runtime === "kiro") {
    const args = ["chat", "--no-interactive", "--trust-tools="];
    if (model) args.push("--model", model);
    args.push(prompt);
    return { bin: resolveRuntimeBin(runtime), args };
  }
  throw new Error(`Unsupported runtime: ${runtime}`);
}

async function runModel(modelChoice, prompt, cwd, { onOutput } = {}) {
  if (isApiRuntime(modelChoice.runtime)) {
    return runApiModel(modelChoice, prompt, { onOutput });
  }
  const command = buildCommand(modelChoice, prompt);
  return runProcess(command, cwd, {
    onStdout: (text) => {
      if (onOutput) onOutput({ stream: "stdout", text });
    },
    onStderr: (text) => {
      if (onOutput) onOutput({ stream: "stderr", text });
    },
  });
}

function isApiRuntime(runtime) {
  return runtime === "claude-api" || runtime === "openai-chat" || runtime === "openai-responses";
}

async function runApiModel(modelChoice, prompt, { onOutput } = {}) {
  const runtime = modelChoice.runtime;
  try {
    const { url, headers, body } = buildApiRequest(modelChoice, prompt);
    if (onOutput) onOutput({ stream: "progress", text: `[${runtime}/${modelChoice.model || ""}] requesting ${url}\n` });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(modelChoice.timeoutMs || DEFAULT_API_TIMEOUT_MS));
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const errorText = await safeReadText(response);
      return { code: 1, stdout: "", stderr: `${runtime} API failed: ${response.status} ${response.statusText} - ${errorText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    const isEventStream = /text\/event-stream/i.test(contentType) || Boolean(response.body && response.body.getReader && contentType === "");

    if (isEventStream && response.body && response.body.getReader) {
      const { output, error } = await readSseStream(response, runtime, (delta) => {
        if (onOutput) onOutput({ stream: "stdout", text: delta });
      });
      if (error) {
        return { code: 1, stdout: output, stderr: `${runtime} API stream error: ${error}` };
      }
      if (!output.trim()) {
        return { code: 1, stdout: "", stderr: `${runtime} API stream returned empty text` };
      }
      return { code: 0, stdout: output, stderr: "" };
    }

    const responseText = await response.text();
    const output = extractApiText(runtime, responseText);
    if (!output.trim()) {
      return { code: 1, stdout: "", stderr: `${runtime} API returned empty text: ${responseText}` };
    }
    if (onOutput) onOutput({ stream: "stdout", text: output });
    return { code: 0, stdout: output, stderr: "" };
  } catch (error) {
    if (error.name === "AbortError") {
      return { code: 124, stdout: "", stderr: `${runtime} API timed out after ${modelChoice.timeoutMs || DEFAULT_API_TIMEOUT_MS}ms` };
    }
    return { code: 1, stdout: "", stderr: `${runtime} API request failed: ${error.message}` };
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function buildApiRequest(modelChoice, prompt) {
  const runtime = modelChoice.runtime;
  if (runtime === "claude-api") {
    const url = buildProviderUrl(modelChoice, ["ANTHROPIC_BASE_URL", "CLAUDE_BASE_URL"], "/v1/messages");
    const token = resolveApiConfigValue(modelChoice, "token", ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]);
    const model = requireModelName(modelChoice);
    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": token,
        "anthropic-version": modelChoice.anthropicVersion || "2023-06-01",
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      },
    };
  }

  if (runtime === "openai-chat") {
    const url = buildProviderUrl(modelChoice, ["OPENAI_BASE_URL"], "/v1/chat/completions");
    const token = resolveApiConfigValue(modelChoice, "token", ["OPENAI_API_KEY"]);
    const model = requireModelName(modelChoice);
    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      },
    };
  }

  if (runtime === "openai-responses") {
    const url = buildProviderUrl(modelChoice, ["OPENAI_BASE_URL"], "/v1/responses");
    const token = resolveApiConfigValue(modelChoice, "token", ["OPENAI_API_KEY"]);
    const model = requireModelName(modelChoice);
    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: {
        model,
        input: [{ role: "user", content: prompt }],
        stream: true,
      },
    };
  }

  throw new Error(`Unsupported API runtime: ${runtime}`);
}

function resolveApiConfigValue(modelChoice, key, envNames, fallback = "") {
  const envKey = modelChoice[`${key}Env`] || modelChoice.apiKeyEnv || modelChoice.tokenEnv;
  const direct = modelChoice[key] || (key === "token" ? modelChoice.apiKey : "");
  const value = direct || (envKey ? process.env[envKey] : "") || envNames.map((name) => process.env[name]).find(Boolean) || fallback;
  if (!value) {
    throw new Error(`${modelChoice.runtime} requires ${key} or ${key}Env in JSON config`);
  }
  return value;
}

function buildProviderUrl(modelChoice, envNames, suffix) {
  const rawUrl = resolveUrlConfigValue(modelChoice, envNames);
  const normalized = normalizeBaseUrl(rawUrl);
  return `${stripEndpointSuffix(normalized)}${suffix}`;
}

function resolveUrlConfigValue(modelChoice, envNames) {
  const envKey = modelChoice.urlEnv || modelChoice.baseUrlEnv;
  const direct = modelChoice.url || modelChoice.baseUrl;
  const value = direct || (envKey ? process.env[envKey] : "") || envNames.map((name) => process.env[name]).find(Boolean) || "";
  if (!value) {
    throw new Error(`${modelChoice.runtime} requires url/baseUrl or urlEnv/baseUrlEnv in JSON config`);
  }
  return value;
}

function requireModelName(modelChoice) {
  if (!modelChoice.model) {
    throw new Error(`${modelChoice.runtime} requires model in JSON config`);
  }
  return modelChoice.model;
}

function normalizeBaseUrl(value) {
  let trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^\/+/, "");
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

function stripEndpointSuffix(baseUrl) {
  return baseUrl.replace(/\/v\d+\/?(?:messages|responses|chat\/completions)?\/?$/i, "").replace(/\/(v\d+)\/?$/i, "/$1").replace(/\/+$/, "");
}

function extractApiText(runtime, responseText) {
  const parsed = JSON.parse(responseText);
  if (runtime === "claude-api") {
    return (parsed.content || [])
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  if (runtime === "openai-chat") {
    return parsed.choices?.map((choice) => choice?.message?.content || "").join("") || "";
  }
  if (runtime === "openai-responses") {
    if (typeof parsed.output_text === "string" && parsed.output_text) return parsed.output_text;
    return (parsed.output || []).map((item) => {
      if (item?.type === "message") {
        return (item.content || []).map((part) => part?.text || "").join("");
      }
      if (item?.type === "reasoning") {
        return (item.summary || []).map((part) => part?.text || "").join("\n");
      }
      return "";
    }).join("");
  }
  return "";
}

function extractStreamDelta(runtime, event) {
  if (!event || typeof event !== "object") return "";
  const type = event.type || "";
  if (runtime === "claude-api") {
    if (type === "content_block_delta" && event.delta) {
      if (event.delta.type === "text_delta" && typeof event.delta.text === "string") return event.delta.text;
      if (typeof event.delta.text === "string") return event.delta.text;
    }
    return "";
  }
  if (runtime === "openai-chat") {
    const delta = event.choices?.[0]?.delta;
    if (delta && typeof delta.content === "string") return delta.content;
    return "";
  }
  if (runtime === "openai-responses") {
    if (type === "response.output_text.delta" && typeof event.delta === "string") return event.delta;
    return "";
  }
  return "";
}

function isStreamErrorEvent(runtime, event) {
  if (!event || typeof event !== "object") return null;
  if (event.error) {
    const err = event.error;
    return `${err.code || err.type || "error"}: ${err.message || JSON.stringify(err)}`;
  }
  const type = event.type || "";
  if (runtime === "openai-responses" && type === "response.failed" && event.response?.error) {
    const err = event.response.error;
    return `${err.code || "error"}: ${err.message || JSON.stringify(err)}`;
  }
  if (runtime === "openai-chat" && event.choices?.[0]?.finish_reason === "error") {
    return `chat completion finished with error`;
  }
  return null;
}

async function readSseStream(response, runtime, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let output = "";
  let lastEventId = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nlIndex;
    while ((nlIndex = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, nlIndex);
      buffer = buffer.slice(nlIndex + 1);
      const line = rawLine.replace(/\r$/, "");
      if (!line) continue;
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        lastEventId = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("id:")) continue;
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const errMsg = isStreamErrorEvent(runtime, event);
        if (errMsg) {
          return { output, error: errMsg };
        }
        const delta = extractStreamDelta(runtime, event);
        if (delta) {
          output += delta;
          if (onDelta) onDelta(delta);
        }
      } catch {
        // ignore non-JSON keep-alive or partial frames
      }
    }
  }
  return { output, error: null };
}

function extractYPlanBlock(stdout) {
  const text = String(stdout || "").trim();
  const match = text.match(/<y-plan\b[\s\S]*<\/y-plan>/i);
  return match ? match[0].trim() : text;
}

function emitResult({ success, modelChoice, attempts, cwd, selected, missing, stdout, stderr, code, ycePrepass }) {
  const planOutput = extractYPlanBlock(stdout);
  emitMarkdownResult({ success, modelChoice, attempts, cwd, selected, missing, planOutput, stderr, code, ycePrepass });
}

function emitMarkdownResult({ success, modelChoice, attempts, cwd, selected, missing, planOutput, stderr, code, ycePrepass }) {
  const lines = [
    "# Y-Plan Result",
    "",
    `- Success: ${success ? "true" : "false"}`,
    `- Runtime: ${modelChoice.runtime}`,
    `- Model: ${modelChoice.model || "(cli default)"}`,
    `- CWD: ${cwd}`,
    `- Exit code: ${code}`,
    `- YCE: ${ycePrepass.enabled ? `enabled (${ycePrepass.code})` : "disabled"}`,
    "",
    "## Fallback Attempts",
    "",
    attempts.length > 0
      ? attempts.map((attempt) => `- ${formatModelLabel(attempt)}: exit ${attempt.code}`).join("\n")
      : "- none",
    "",
    "## Selected Skills",
    "",
    selected.length > 0
      ? selected.map((skill) => `- ${skill.name}: ${skill.reason}`).join("\n")
      : "- none",
    "",
    "## Missing Skills",
    "",
    missing.length > 0
      ? missing.map((skill) => `- ${skill.name}`).join("\n")
      : "- none",
    "",
    "## Plan",
    "",
    xmlPlanToMarkdown(planOutput),
  ];

  if (stderr.trim()) {
    lines.push("", "## Stderr", "", "```text", stderr.trim(), "```");
  }

  if (ycePrepass.enabled) {
    lines.push("", "## YCE Prepass", "", renderYcePrepassSummary(ycePrepass));
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderYcePrepassSummary(ycePrepass) {
  const lines = [
    `- Mode: ${ycePrepass.mode || "unknown"}`,
    `- Exit code: ${ycePrepass.code}`,
    `- Search executed: ${ycePrepass.searchExecuted ? "true" : "false"}`,
  ];

  if (Array.isArray(ycePrepass.runs) && ycePrepass.runs.length > 0) {
    lines.push("- Runs:");
    for (const run of ycePrepass.runs) {
      lines.push(`  - ${run.mode}: success=${run.success ? "true" : "false"}, action=${run.resolvedAction || "unknown"}, exit=${run.code}`);
      if (run.enhancedPrompt) {
        lines.push(`    Enhanced prompt: ${oneLinePreview(run.enhancedPrompt, 180)}`);
      }
      if (run.searchResult) {
        lines.push("    Search result:");
        for (const item of summarizeSearchResult(run.searchResult)) {
          lines.push(`      - ${item}`);
        }
      }
      if (Array.isArray(run.errors) && run.errors.length > 0) {
        lines.push("    Errors:");
        for (const item of run.errors.slice(0, 3)) {
          lines.push(`      - ${oneLinePreview(item, 220)}`);
        }
      }
      if (run.stderr && run.stderr.trim()) {
        lines.push(`    Stderr: ${oneLinePreview(run.stderr, 180)}`);
      }
    }
  }

  if (ycePrepass.stderr && ycePrepass.stderr.trim()) {
    lines.push(`- Stderr summary: ${oneLinePreview(ycePrepass.stderr, 240)}`);
  }

  return lines.join("\n");
}

function oneLinePreview(value, maxChars = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function summarizeSearchResult(searchResult, maxItems = 5) {
  const lines = String(searchResult || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const picked = lines.filter((line) => /^(Found|No relevant|Path:|\[\d+\/\d+\]|grep keywords:)/i.test(line)).slice(0, maxItems);
  return picked.length > 0 ? picked : [oneLinePreview(searchResult, 220)];
}

function xmlPlanToMarkdown(planOutput) {
  const inner = stripOuterTag(String(planOutput || "").trim(), "y-plan");
  if (!inner || inner === planOutput.trim()) return planOutput.trim();

  const sections = [];
  const tagRegex = /<([a-zA-Z0-9_-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = tagRegex.exec(inner)) !== null) {
    const tag = match[1];
    const body = match[2].trim();
    sections.push(renderPlanSection(tag, body));
  }

  return sections.filter(Boolean).join("\n\n") || inner.replace(/<[^>]+>/g, "").trim();
}

function stripOuterTag(value, tag) {
  const match = value.match(new RegExp(`^<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>$`, "i"));
  return match ? match[1].trim() : value;
}

function renderPlanSection(tag, body) {
  const title = tag.split(/[-_]/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
  const items = extractPlanItems(body);
  if (items.length > 0) {
    return [`## ${title}`, "", items.map((item) => `- ${item}`).join("\n")].join("\n");
  }
  return [`## ${title}`, "", cleanPlanText(body)].join("\n");
}

function extractPlanItems(body) {
  const itemRegex = /<(?:item|skill|phase|file|step|edge)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|skill|phase|file|step|edge)>/g;
  const items = [];
  let match;
  while ((match = itemRegex.exec(body)) !== null) {
    const text = cleanPlanText(match[1]);
    if (text) items.push(text);
  }
  return items;
}

function cleanPlanText(value) {
  return decodeXmlEntities(String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.showVersion) {
    process.stdout.write(`${formatVersionLine(skillDir)}\n`);
    process.exit(0);
  }

  if (args.checkUpdate) {
    const info = await checkForUpdate({ rootDir: skillDir, force: true });
    process.stdout.write(`local:  ${info?.localVersion || readLocalVersion(skillDir) || "unknown"}\n`);
    if (info?.remoteVersion) {
      process.stdout.write(`remote: ${info.remoteVersion}\n`);
      process.stdout.write(`update: ${info.updateAvailable ? "yes" : "no"}\n`);
      const banner = formatUpdateBanner(info);
      if (banner) process.stdout.write(`${banner}\n`);
    } else {
      process.stdout.write("remote: (unavailable)\n");
    }
    process.exit(0);
  }

  // 每次调用先做版本检测（短等待）：服务端版本升高则立刻提示升级。
  const updateCheckPromise = checkForUpdate({ rootDir: skillDir }).catch(() => null);
  try {
    const earlyInfo = await Promise.race([
      updateCheckPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
    const earlyBanner = formatUpdateBanner(earlyInfo);
    if (earlyBanner) writeProgress(earlyBanner);
  } catch {
    // ignore
  }

  const config = readConfig(args.config);
  const originalTask = await readStdinIfNeeded(args.task);
  if (!originalTask) usage(1);

  const ycePrepass = await runYcePrepass({ args, config, task: originalTask, onProgress: writeYceProgress });
  const task = ycePrepass.prompt || originalTask;
  const agentConfigInfo = loadAgentConfig(args, config);
  const modelChoices = resolveModelChoices(args, config, agentConfigInfo.config);
  const { selected, missing, root } = selectMattSkills(task);
  const attempts = [];
  let finalChoice = modelChoices[0];
  let finalResult = { code: 1, stdout: "", stderr: "No model choices configured." };

  for (const modelChoice of modelChoices) {
    finalChoice = modelChoice;
    const prompt = buildPrompt({ task, originalTask, cwd: args.cwd, modelChoice, selected, missing, root, ycePrepass, agentConfigInfo });
    writeProgress(`[y-plan] planning with ${formatModelLabel(modelChoice)} ...`);
    const result = await runModel(modelChoice, prompt, args.cwd, {
      onOutput: (event) => writeModelOutput(modelChoice, event),
    });
    attempts.push({ ...modelChoice, code: result.code });
    finalResult = result;
    if (result.code === 0 && result.stdout.trim()) break;
    writeProgress(`[y-plan] ${formatModelLabel(modelChoice)} returned no usable output (exit ${result.code}); trying next model.`);
  }

  emitResult({
    success: finalResult.code === 0 && finalResult.stdout.trim().length > 0,
    modelChoice: finalChoice,
    attempts,
    cwd: args.cwd,
    selected,
    missing,
    stdout: finalResult.stdout,
    stderr: finalResult.stderr,
    code: finalResult.code,
    ycePrepass,
  });
  process.exit(finalResult.code === 0 ? 0 : finalResult.code);
}

main().catch((error) => {
  process.stdout.write(`# Y-Plan Result

- Success: false

## Error

\`\`\`text
${error.stack || error.message}
\`\`\`
`);
  process.exit(1);
});
