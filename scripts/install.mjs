#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = import.meta.url.startsWith("file:///$bunfs/")
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const configPath = resolve(skillDir, "y-plan.config.json");
const defaultAgentConfig = "./agents/y-plan-agents.json";

const CLI_DEFS = [
  {
    runtime: "claude-code",
    label: "Claude Code",
    bin: "claude",
    defaultModels: ["sonnet", "opus", "fable"],
  },
  {
    runtime: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    defaultModels: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "auto"],
  },
  {
    runtime: "codex",
    label: "Codex CLI",
    bin: "codex",
    defaultModels: ["gpt-5.4", "gpt-5.5", "gpt-5.5-codex"],
  },
  {
    runtime: "qoder",
    label: "Qoder CLI",
    bin: "qodercli",
    binCandidates: ["qodercli", "qoder", "qoder-cli"],
    modelCommands: [["--list-models"]],
    defaultModels: ["auto", "lite", "efficient"],
  },
  {
    runtime: "cursor",
    label: "Cursor Agent",
    bin: "agent",
    binCandidates: ["agent", "cursor-agent", "cursor"],
    modelCommands: [["models"], ["--list-models"]],
    defaultModels: ["claude-opus-4-8-thinking-high", "auto"],
  },
  {
    runtime: "kiro",
    label: "Kiro CLI",
    bin: "kiro-cli",
    binCandidates: ["kiro-cli", "kiro"],
    defaultModels: ["auto", "claude-sonnet-4.5", "claude-haiku-4.5"],
  },
];

const PROVIDER_DEFS = [
  {
    runtime: "openai-chat",
    label: "OpenAI 兼容 Chat Completions",
    defaultModels: ["gpt-5.5", "gpt-5.4", "gpt-4.1"],
    defaultUrlEnv: "OPENAI_BASE_URL",
    defaultKeyEnv: "OPENAI_API_KEY",
  },
  {
    runtime: "openai-responses",
    label: "OpenAI 兼容 Responses",
    defaultModels: ["gpt-5.5", "gpt-5.4", "gpt-4.1"],
    defaultUrlEnv: "OPENAI_BASE_URL",
    defaultKeyEnv: "OPENAI_API_KEY",
  },
  {
    runtime: "claude-api",
    label: "Claude / Anthropic Messages API",
    defaultModels: ["claude-opus-4.6", "claude-sonnet-4.5", "claude-haiku-4.5"],
    defaultUrlEnv: "ANTHROPIC_BASE_URL",
    defaultKeyEnv: "ANTHROPIC_API_KEY",
  },
];

const YCE_MODES = ["plan", "auto", "enhance", "search"];

function defaultModelEntries() {
  return [
    { runtime: "claude-code", model: "sonnet" },
    { runtime: "gemini", model: "gemini-3.1-pro-preview" },
    { runtime: "codex", model: "gpt-5.5" },
  ];
}

function commandExists(bin) {
  if (!bin) return false;
  if (process.platform === "win32") {
    return spawnSync("where", [bin], { encoding: "utf8", timeout: 3000 }).status === 0;
  }
  return spawnSync("sh", ["-lc", `command -v ${quoteShell(bin)}`], { encoding: "utf8", timeout: 3000 }).status === 0;
}

function resolveBin(def) {
  for (const bin of [def.bin, ...(def.binCandidates || [])]) {
    if (bin && commandExists(bin)) return bin;
  }
  return def.bin;
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function tryDiscoverModels(def) {
  const binName = resolveBin(def);
  if (!commandExists(binName)) {
    return { models: def.defaultModels, source: "内置候选", actual: false };
  }

  const attempts = [
    ...(def.modelCommands || []).map((args) => [binName, args]),
    [binName, ["models", "--json"]],
    [binName, ["models"]],
    [binName, ["model", "list"]],
  ].filter(([_, args], index, arr) => (
    arr.findIndex(([, otherArgs]) => otherArgs.join("\0") === args.join("\0")) === index
  ));

  for (const [bin, args] of attempts) {
    const result = spawnSync(bin, args, { encoding: "utf8", timeout: 5000 });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.status !== 0 || !text.trim()) continue;
    if (/^\s*Usage:/im.test(text) || /\bOptions:\b/i.test(text)) continue;
    const models = parseModelList(text);
    if (models.length > 0) {
      return { models, source: `实际检测: ${bin} ${args.join(" ")}`.trim(), actual: true };
    }
  }

  return { models: def.defaultModels, source: "内置候选（CLI 未提供可解析模型列表）", actual: false };
}

function parseModelList(text) {
  const parsedJson = tryParseJsonModelList(text);
  if (parsedJson.length > 0) return parsedJson;

  const lineModels = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^available models$/i.test(line) || /^model$/i.test(line)) continue;
    const match = line.match(/^([a-zA-Z0-9][a-zA-Z0-9._:-]{1,})(?:\s+-\s+|\s*$)/);
    if (match) lineModels.push(match[1]);
  }
  if (lineModels.length > 0) return uniqueModels(lineModels);

  return uniqueModels([
    ...[...String(text || "").matchAll(/["'\s]([a-zA-Z0-9][a-zA-Z0-9._:-]{2,})["'\s]/g)].map((m) => m[1]),
  ].filter(isLikelyModelName));
}

function tryParseJsonModelList(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return uniqueModels(extractModelsFromJson(parsed));
  } catch {
    return [];
  }
}

function extractModelsFromJson(value) {
  if (Array.isArray(value)) {
    return value.flatMap(extractModelsFromJson);
  }
  if (value && typeof value === "object") {
    const direct = [value.id, value.name, value.model, value.modelId].filter((item) => typeof item === "string");
    return [...direct, ...Object.values(value).flatMap(extractModelsFromJson)];
  }
  return typeof value === "string" && isLikelyModelName(value) ? [value] : [];
}

function uniqueModels(models) {
  const seen = new Set();
  const result = [];
  for (const model of models.map((item) => String(item || "").trim()).filter(isLikelyModelName)) {
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

function isLikelyModelName(item) {
  if (!item || item.length < 2) return false;
  if (/^(usage|options|commands|arguments|default|current|model|models)$/i.test(item)) return false;
  return /(?:gpt|claude|sonnet|opus|haiku|fable|gemini|grok|qwen|deepseek|auto|lite|efficient|composer)/i.test(item);
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (cliArgs.help) usage(0);

  const existing = readExistingConfig();
  if (cliArgs.nonInteractive) {
    writeConfig({
      models: cliArgs.models.length > 0 ? cliArgs.models : existing.models || defaultModelEntries(),
      yceEnabled: cliArgs.yceEnabled ?? existing.yce?.enabled ?? false,
      yceMode: cliArgs.yceMode || existing.yce?.mode || "plan",
      agentConfig: cliArgs.agentConfig || existing.agentConfig || defaultAgentConfig,
    });
    return;
  }

  const rl = createInterface({ input, output });
  try {
    console.log("");
    console.log("Y-Plan 中文安装配置");
    console.log("模型配置会写入 y-plan.config.json；运行时按顺序逐个尝试。");
    console.log("");

    const cliModels = await configureCliModels(rl);
    const providerModels = await configureProviderModels(rl);
    const models = [...cliModels, ...providerModels];

    const finalModels = models.length > 0
      ? models
      : await fallbackToExistingOrDefaults(rl, existing);

    const yceConfig = await configureYce(rl, existing);

    writeConfig({
      models: finalModels,
      yceEnabled: yceConfig.enabled,
      yceMode: yceConfig.mode,
      agentConfig: cliArgs.agentConfig || existing.agentConfig || defaultAgentConfig,
    });
  } finally {
    rl.close();
  }
}

async function configureCliModels(rl) {
  console.log("一、检测本机可用 CLI");
  const cliRows = CLI_DEFS.map((def) => {
    const bin = resolveBin(def);
    const available = commandExists(bin);
    const discovery = tryDiscoverModels(def);
    return { ...def, bin, available, discoveredModels: discovery.models, modelSource: discovery.source, actualModels: discovery.actual };
  });

  for (const [index, row] of cliRows.entries()) {
    const status = row.available ? "可用" : "未检测到";
    console.log(`  ${index + 1}) ${row.label} (${row.runtime}) - ${status}`);
    console.log(`     模型来源: ${row.modelSource}`);
    console.log(`     模型候选: ${formatModelPreview(row.discoveredModels)}`);
  }
  console.log("  0) 跳过 CLI，稍后配置 API 供应商");
  console.log("");

  const choice = await rl.question("请选择 CLI（逗号多选，a=全部可用，0=跳过）: ");
  const picked = pickRows(choice, cliRows, { onlyAvailableForAll: true });
  const models = [];

  for (const row of picked) {
    console.log("");
    console.log(`${row.label} 模型候选:`);
    row.discoveredModels.forEach((model, index) => {
      console.log(`  ${index + 1}) ${model}`);
    });
    const modelChoice = await rl.question("选择模型（逗号多选；也可直接输入模型名；回车选第 1 个）: ");
    const selectedModels = parseModelChoice(modelChoice, row.discoveredModels);
    for (const model of selectedModels) {
      models.push({ runtime: row.runtime, model });
    }
  }

  return models;
}

function formatModelPreview(models, limit = 30) {
  if (models.length <= limit) return models.join(", ");
  return `${models.slice(0, limit).join(", ")} ...（共 ${models.length} 个）`;
}

async function configureProviderModels(rl) {
  console.log("");
  console.log("二、配置 API 供应商（可选）");
  PROVIDER_DEFS.forEach((def, index) => {
    console.log(`  ${index + 1}) ${def.label} (${def.runtime})`);
  });
  console.log("  0) 跳过 API 供应商");
  console.log("");

  const choice = await rl.question("请选择供应商（逗号多选，0=跳过）: ");
  const picked = pickRows(choice, PROVIDER_DEFS);
  const models = [];

  for (const provider of picked) {
    console.log("");
    console.log(`${provider.label} 模型候选:`);
    provider.defaultModels.forEach((model, index) => {
      console.log(`  ${index + 1}) ${model}`);
    });
    const modelChoice = await rl.question("选择模型（逗号多选；也可直接输入模型名；回车选第 1 个）: ");
    const selectedModels = parseModelChoice(modelChoice, provider.defaultModels);
    const urlAnswer = await rl.question(`Base URL / URL（回车使用环境变量 ${provider.defaultUrlEnv}）: `);
    const keyEnvAnswer = await rl.question(`密钥环境变量名（回车默认 ${provider.defaultKeyEnv}）: `);
    const maxTokensAnswer = await rl.question("maxTokens（回车默认 4096）: ");
    const temperatureAnswer = await rl.question("temperature（回车不写入）: ");

    for (const model of selectedModels) {
      const entry = {
        runtime: provider.runtime,
        model,
        ...(urlAnswer.trim() ? { baseUrl: urlAnswer.trim() } : { baseUrlEnv: provider.defaultUrlEnv }),
        apiKeyEnv: keyEnvAnswer.trim() || provider.defaultKeyEnv,
      };
      if (maxTokensAnswer.trim()) entry.maxTokens = Number(maxTokensAnswer.trim());
      if (temperatureAnswer.trim()) entry.temperature = Number(temperatureAnswer.trim());
      models.push(entry);
    }
  }

  return models;
}

async function fallbackToExistingOrDefaults(rl, existing) {
  if (Array.isArray(existing.models) && existing.models.length > 0) {
    const answer = await rl.question("没有选择模型，是否保留现有 y-plan.config.json models？[Y/n] ");
    if (!/^n(o)?$/i.test(answer.trim())) return existing.models;
  }

  console.log("未选择模型，将使用内置默认模型顺序。");
  return defaultModelEntries();
}

async function configureYce(rl, existing) {
  console.log("");
  console.log("三、配置 YCE（可选）");
  const existingEnabled = Boolean(existing.yce?.enabled);
  const useYce = await rl.question(`是否启用 YCE 提示词增强和代码检索？${existingEnabled ? "[Y/n]" : "[y/N]"} `);
  const enabled = useYce.trim()
    ? /^y(es)?$/i.test(useYce.trim())
    : existingEnabled;

  if (!enabled) {
    return {
      enabled: false,
      mode: existing.yce?.mode || "plan",
      script: existing.yce?.script || "./vendor/yce/scripts/yce.js",
    };
  }

  console.log("");
  console.log("YCE 模式:");
  YCE_MODES.forEach((mode, index) => {
    console.log(`  ${index + 1}) ${mode}`);
  });
  const modeAnswer = await rl.question(`请选择模式（回车默认 ${existing.yce?.mode || "plan"}）: `);
  const mode = parseIndexedOrText(modeAnswer, YCE_MODES, existing.yce?.mode || "plan");

  console.log("");
  const script = "./vendor/yce/scripts/yce.js";
  const status = existsSync(resolveMaybeRelativeToSkillDir(script)) ? "存在" : "未找到";
  console.log(`YCE 脚本固定使用 Y-Plan 内置版本: ${script} (${status})`);

  return { enabled, mode, script };
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    nonInteractive: false,
    models: [],
    yceEnabled: null,
    yceMode: "",
    yceScript: "",
    agentConfig: defaultAgentConfig,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "--enable-yce") {
      parsed.nonInteractive = true;
      parsed.yceEnabled = true;
    } else if (arg === "--disable-yce") {
      parsed.nonInteractive = true;
      parsed.yceEnabled = false;
    } else if (arg === "--yce-mode") {
      parsed.yceMode = argv[++i] || "plan";
    } else if (arg === "--agent-config") {
      parsed.agentConfig = argv[++i] || parsed.agentConfig;
    } else if (arg === "--model") {
      parsed.nonInteractive = true;
      parsed.models.push(parseModelEntry(argv[++i] || ""));
    } else if (arg === "--models") {
      parsed.nonInteractive = true;
      parsed.models.push(...String(argv[++i] || "").split(",").map(parseModelEntry).filter(Boolean));
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  parsed.models = parsed.models.filter(Boolean);
  return parsed;
}

function usage(exitCode = 0) {
  const text = [
    "用法:",
    "  node scripts/install.mjs",
    "  node scripts/install.mjs --model codex/gpt-5.5 --enable-yce",
    "  node scripts/install.mjs --models claude-code/sonnet,gemini/gemini-3.1-pro-preview",
    "  node scripts/install.mjs --disable-yce --agent-config ./agents/y-plan-agents.json",
    "",
    "说明:",
    "  - 不带参数时进入中文交互式配置。",
    "  - CLI 模型格式: runtime/model，例如 codex/gpt-5.5。",
    "  - API 供应商建议通过交互式配置填写 URL 和密钥环境变量。",
    "  - 配置会写入 y-plan.config.json。",
  ].join("\n");
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

function writeConfig({ models, yceEnabled, yceMode, agentConfig }) {
  const config = {
    agentConfig: agentConfig || defaultAgentConfig,
    models: Array.isArray(models) ? models : [],
    yce: {
      enabled: Boolean(yceEnabled),
      mode: yceMode || "plan",
      script: "./vendor/yce/scripts/yce.js",
      timeoutMs: 300000,
    },
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("");
  console.log(`已写入配置: ${configPath}`);
  console.log(`模型数量: ${config.models.length}`);
  console.log(`YCE: ${config.yce.enabled ? `启用 (${config.yce.mode})` : "未启用"}`);
}

function readExistingConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function pickRows(choice, rows, options = {}) {
  const raw = choice.trim();
  if (!raw || raw === "0") return [];
  if (/^a$/i.test(raw)) {
    return options.onlyAvailableForAll ? rows.filter((row) => row.available) : rows;
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = Number(item) - 1;
    return Number.isInteger(index) && index >= 0 && index < rows.length ? rows[index] : null;
  }).filter(Boolean);
}

function parseModelChoice(choice, discovered) {
  const raw = choice.trim();
  if (!raw) return discovered.slice(0, 1);
  return raw.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    if (/^\d+$/.test(item)) {
      const index = Number(item) - 1;
      return discovered[index] || "";
    }
    return item;
  }).filter(Boolean);
}

function parseIndexedOrText(choice, values, fallback) {
  const raw = choice.trim();
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    return values[index] || fallback;
  }
  return raw;
}

function parseModelEntry(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const [runtime, ...modelParts] = raw.split("/");
  if (!runtime || modelParts.length === 0) {
    throw new Error(`模型格式应为 runtime/model，当前为: ${raw}`);
  }
  return { runtime: normalizeRuntime(runtime), model: modelParts.join("/") };
}

function normalizeRuntime(runtime) {
  if (runtime === "claude") return "claude-code";
  if (runtime === "qodercli" || runtime === "qoder-cli") return "qoder";
  if (runtime === "cursor-agent" || runtime === "cursor-cli") return "cursor";
  if (runtime === "kiro-cli") return "kiro";
  if (runtime === "openai") return "openai-chat";
  if (runtime === "openai-response") return "openai-responses";
  if (runtime === "anthropic") return "claude-api";
  return runtime;
}

function resolveMaybeRelativeToSkillDir(value) {
  if (!value) return "";
  if (isAbsolute(value)) return value;
  return resolve(skillDir, value);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
