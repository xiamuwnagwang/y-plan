#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = import.meta.url.startsWith("file:///$bunfs/")
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const configPath = resolve(skillDir, "y-plan.config.json");
const yceRootDir = resolve(skillDir, "vendor/yce");
const yceEnvPath = resolve(yceRootDir, ".env");
const DEFAULT_YCE_RELAY_URL = "https://yce.aigy.de";
const DEFAULT_YCE_YOUWEN_API_URL = "https://a.aigy.de";
const CLI_RUNTIME_KEYS = new Set(["claude-code", "gemini", "codex", "qoder", "cursor", "kiro"]);

const CLI_DEFS = [
  {
    runtime: "claude-code",
    label: "Claude Code",
    bin: "claude",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5", "claude-haiku-4-5-20251001", "sonnet", "opus", "fable"],
  },
  {
    runtime: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    defaultModels: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "auto"],
  },
  {
    runtime: "codex",
    label: "Codex CLI",
    bin: "codex",
    defaultModels: ["gpt-5.5", "gpt-5.4"],
  },
  {
    runtime: "qoder",
    label: "Qoder CLI",
    bin: "qodercli",
    binCandidates: ["qodercli", "qoder", "qoder-cli"],
    modelCommands: [["--list-models"]],
    defaultModels: ["Auto", "Ultimate", "Performance", "Efficient", "Lite", "Qwen3.7-Max", "DeepSeek-V4-Pro"],
  },
  {
    runtime: "cursor",
    label: "Cursor Agent",
    bin: "agent",
    binCandidates: ["agent", "cursor-agent", "cursor"],
    modelCommands: [["--list-models"]],
    defaultModels: ["auto", "gpt-5.5-high", "claude-opus-4-8-thinking-high", "composer-2.5-fast", "gpt-5.3-codex"],
  },
  {
    runtime: "kiro",
    label: "Kiro CLI",
    bin: "kiro-cli",
    binCandidates: ["kiro-cli", "kiro"],
    modelCommands: [["chat", "--list-models", "--format", "json-pretty"], ["chat", "--list-models"]],
    defaultModels: ["auto", "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5", "deepseek-3.2", "qwen3-coder-next"],
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

const YCE_DEFAULT_MODE = "plan";

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

  const raw = String(text || "");
  const backtickModels = [...raw.matchAll(/`([a-zA-Z0-9][a-zA-Z0-9._:-]{1,})`/g)].map((m) => m[1]);
  if (backtickModels.length > 0) {
    return uniqueModels(backtickModels);
  }

  const lineModels = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^available models$/i.test(line) || /^model$/i.test(line) || /^\*?\s*default/i.test(line)) continue;
    const match = line.match(/^(\*?\s*)([a-zA-Z0-9][a-zA-Z0-9._:-]{1,})(?:\s|$)/);
    if (match) lineModels.push(match[2]);
  }
  if (lineModels.length > 0) return uniqueModels(lineModels);

  return uniqueModels([
    ...[...raw.matchAll(/["'\s]([a-zA-Z0-9][a-zA-Z0-9._:-]{2,})["'\s]/g)].map((m) => m[1]),
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
    const direct = [value.model_name, value.model_id, value.id, value.name, value.model]
      .filter((item) => typeof item === "string" && isLikelyModelName(item));
    const skipKeys = new Set(["description", "context_window_tokens", "rate_multiplier", "rate_unit", "object", "created", "owned_by", "type", "display_name"]);
    const rest = Object.entries(value)
      .filter(([key]) => !skipKeys.has(key))
      .map(([, val]) => val)
      .flatMap(extractModelsFromJson);
    return [...direct, ...rest];
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
  const raw = String(item || "").trim();
  if (!raw || raw.length < 2) return false;
  if (/\s/.test(raw)) return false;
  if (/^(usage|options|commands|arguments|default|current|model|models|available|description|context_window_tokens|rate_multiplier|rate_unit|credit|credits|object|created|owned_by|type|display_name)$/i.test(raw)) return false;
  return /(?:gpt|claude|sonnet|opus|haiku|fable|gemini|grok|qwen|deepseek|glm|minimax|kimi|composer|codex|auto|lite|efficient|ultimate|performance|qmodel)/i.test(raw);
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (cliArgs.help) usage(0);

  const existing = readExistingConfig();
  if (cliArgs.nonInteractive) {
    const existingEnv = parseEnvFile(yceEnvPath);
    const yceEnabled = cliArgs.yceEnabled ?? existing.yce?.enabled ?? false;
    if (yceEnabled && !existsSync(yceEnvPath)) {
      writeYceEnvFile({
        relayUrl: DEFAULT_YCE_RELAY_URL,
        relayToken: "",
        youwenToken: "",
        youwenApiUrl: DEFAULT_YCE_YOUWEN_API_URL,
      });
    }
    const baseModels = cliArgs.models.length > 0 ? cliArgs.models : existing.models || defaultModelEntries();
    const needPreserve = cliArgs.models.length > 0;
    const preservedApiModels = needPreserve
      ? (Array.isArray(existing.models) ? existing.models : [])
          .filter((entry) => entry && !CLI_RUNTIME_KEYS.has(entry.runtime))
      : [];
    const seenKeys = new Set();
    const mergedModels = [...baseModels, ...preservedApiModels].filter((entry) => {
      if (!entry || !entry.runtime) return false;
      const key = `${entry.runtime}/${entry.model}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    writeConfig({
      models: mergedModels,
      yceEnabled,
      yceMode: "plan",
      yceRelayUrl: existingEnv.YCE_RELAY_URL || existing.yce?.relayUrl || (yceEnabled ? DEFAULT_YCE_RELAY_URL : undefined),
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
      yceRelayUrl: yceConfig.relayUrl,
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
    const keyAnswer = await rl.question(`API 密钥 或 环境变量名（回车使用 ${provider.defaultKeyEnv}；直接粘贴 sk-xxx 等密钥会自动识别）: `);

    const urlField = {};
    const rawUrl = urlAnswer.trim();
    if (rawUrl) {
      const normalized = normalizeBaseUrl(rawUrl);
      if (normalized !== rawUrl) {
        console.log(`  URL 已规范化: ${rawUrl} -> ${normalized}`);
      }
      urlField.baseUrl = normalized;
    } else {
      urlField.baseUrlEnv = provider.defaultUrlEnv;
    }

    const keyField = {};
    const rawKey = keyAnswer.trim();
    if (rawKey) {
      if (looksLikeSecret(rawKey)) {
        keyField.apiKey = rawKey;
      } else {
        keyField.apiKeyEnv = rawKey;
      }
    } else {
      keyField.apiKeyEnv = provider.defaultKeyEnv;
    }

    for (const model of selectedModels) {
      const entry = {
        runtime: provider.runtime,
        model,
        ...urlField,
        ...keyField,
      };
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
  console.log("三、配置 YCE（提示词增强 + 代码检索）");
  console.log("YCE 默认使用 plan 模式（先增强提示词，再按需检索代码，最后用于规划）。");
  const existingEnabled = Boolean(existing.yce?.enabled);
  const useYce = await rl.question(`是否启用 YCE？${existingEnabled ? "[Y/n]" : "[Y/n]"} `);
  const enabled = useYce.trim()
    ? /^y(es)?$/i.test(useYce.trim())
    : true;

  const script = "./vendor/yce/scripts/yce.js";
  const scriptStatus = existsSync(resolveMaybeRelativeToSkillDir(script)) ? "存在" : "未找到";

  if (!enabled) {
    console.log("");
    console.log(`YCE 脚本（未启用）: ${script} (${scriptStatus})`);
    return {
      enabled: false,
      mode: "plan",
      script,
    };
  }

  console.log("");
  console.log(`YCE 脚本: ${script} (${scriptStatus})`);
  console.log("接下来配置 YCE 检索密钥（写入 vendor/yce/.env），用于连接 YCE relay。");
  console.log("");

  const relayConfig = await configureYceRelay(rl);

  console.log("");
  console.log(`YCE 已启用，模式固定为 plan。`);
  console.log(`  Relay URL: ${relayConfig.relayUrl}`);
  console.log(`  检索密钥: ${relayConfig.relayToken ? maskSecret(relayConfig.relayToken) : "(未配置，检索将无法租 key)"}`);

  return {
    enabled: true,
    mode: "plan",
    script,
    relayUrl: relayConfig.relayUrl,
    relayToken: relayConfig.relayToken,
  };
}

async function configureYceRelay(rl) {
  const existingEnv = parseEnvFile(yceEnvPath);
  const relayUrlDefault = existingEnv.YCE_RELAY_URL || DEFAULT_YCE_RELAY_URL;
  const relayTokenDefault = existingEnv.YCE_RELAY_TOKEN || existingEnv.YCE_API_KEY || "";

  console.log(`YCE Relay URL 当前: ${relayUrlDefault}`);
  const relayUrlAnswer = await rl.question(`YCE Relay URL（回车默认 ${DEFAULT_YCE_RELAY_URL}）: `);
  const relayUrl = relayUrlAnswer.trim() ? normalizeBaseUrl(relayUrlAnswer.trim()) : relayUrlDefault;
  console.log("");

  console.log(`YCE 检索密钥 当前: ${relayTokenDefault ? maskSecret(relayTokenDefault) : "(空)"}`);
  const relayTokenAnswer = await rl.question("YCE 检索密钥 / YCE_RELAY_TOKEN（格式 yce_...；回车保留）: ");
  const relayToken = relayTokenAnswer.trim() || relayTokenDefault;

  const youwenTokenDefault = existingEnv.YCE_YOUWEN_TOKEN || "";
  console.log("");
  console.log(`Youwen 增强 Token 当前: ${youwenTokenDefault ? maskSecret(youwenTokenDefault) : "(空，仅用于提示词增强)"}`);
  const youwenTokenAnswer = await rl.question("Youwen 增强 Token（回车保留）: ");
  const youwenToken = youwenTokenAnswer.trim() || youwenTokenDefault;

  writeYceEnvFile({
    relayUrl,
    relayToken,
    youwenToken,
    youwenApiUrl: existingEnv.YCE_YOUWEN_API_URL || DEFAULT_YCE_YOUWEN_API_URL,
  });

  return { relayUrl, relayToken, youwenToken };
}

function parseEnvFile(path) {
  const data = {};
  if (!existsSync(path)) return data;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    data[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return data;
}

function writeYceEnvFile({ relayUrl, relayToken, youwenToken, youwenApiUrl }) {
  if (!existsSync(yceRootDir)) mkdirSync(yceRootDir, { recursive: true });
  const lines = [
    "# YCE runtime configuration (managed by Y-Plan install)",
    "",
    "# yw-enhance adapter",
    `YCE_YOUWEN_SCRIPT=./scripts/youwen.js`,
    `YCE_YOUWEN_API_URL=${youwenApiUrl}`,
    `YCE_YOUWEN_TOKEN=${youwenToken}`,
    `YCE_YOUWEN_ENHANCE_MODE=agent`,
    `YCE_YOUWEN_ENABLE_SEARCH=true`,
    "",
    "# yce-engine adapter (远端优先：默认连接 yce.aigy.de relay)",
    "# YCE_RELAY_TOKEN 是 YCE 搜索密钥；不要和 YCE_YOUWEN_TOKEN 混用",
    `YCE_ENGINE_SCRIPT=./vendor/yce-engine/yce-engine.mjs`,
    `YCE_ENGINE_MAX_RESULTS=10`,
    `YCE_ENGINE_MAX_TURNS=3`,
    `YCE_RELAY_URL=${relayUrl}`,
    `YCE_RELAY_TOKEN=${relayToken}`,
    `YCE_LOCAL_FALLBACK=false`,
    "",
    "# yce orchestrator (milliseconds)",
    `YCE_DEFAULT_MODE=plan`,
    `YCE_TIMEOUT_ENHANCE_MS=300000`,
    `YCE_TIMEOUT_SEARCH_MS=180000`,
    "",
  ];
  writeFileSync(yceEnvPath, lines.join("\n"));
}

function maskSecret(value) {
  const raw = String(value || "");
  if (raw.length <= 4) return "****";
  return `${raw.slice(0, 2)}${"*".repeat(Math.max(4, raw.length - 4))}${raw.slice(-2)}`;
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    nonInteractive: false,
    models: [],
    yceEnabled: null,
    yceMode: "",
    yceScript: "",
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
    "  node scripts/install.mjs --disable-yce",
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

function writeConfig({ models, yceEnabled, yceMode, yceRelayUrl }) {
  const config = {
    models: Array.isArray(models) ? models : [],
    yce: {
      enabled: Boolean(yceEnabled),
      mode: yceMode || "plan",
      script: "./vendor/yce/scripts/yce.js",
      timeoutMs: 300000,
      ...(yceRelayUrl ? { relayUrl: yceRelayUrl } : {}),
    },
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("");
  console.log(`已写入配置: ${configPath}`);
  console.log(`模型数量: ${config.models.length}`);
  console.log(`YCE: ${config.yce.enabled ? `启用 (${config.yce.mode})` : "未启用"}`);
  if (config.yce.enabled) {
    console.log(`YCE .env: ${yceEnvPath}`);
  }
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

function normalizeBaseUrl(value) {
  let trimmed = String(value || "").trim();
  if (!trimmed) return "";
  trimmed = trimmed.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^\/+/, "");
    trimmed = `https://${trimmed}`;
  }
  trimmed = trimmed.replace(/\/(v1|api)\/?(?:messages|responses|chat\/completions)?\/?$/i, (match, p1) => `/${p1}`);
  return trimmed;
}

function looksLikeSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^[A-Z][A-Z0-9_]*$/.test(raw) && raw.length <= 64 && !raw.includes("-")) return false;
  return /^(sk-|yw-|yce_|Bearer\s|ai-|ant-|cr_)/i.test(raw) || raw.length >= 32 || /[=:]/.test(raw);
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
