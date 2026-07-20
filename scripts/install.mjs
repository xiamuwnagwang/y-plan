#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = import.meta.url.startsWith("file:///$bunfs/")
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, "..");
const configPath = resolve(skillDir, "y-plan.config.json");
// YCE skill root is vendor/yce — .env MUST live here, never under vendor/yce-engine.
const yceRootDir = resolve(skillDir, "vendor/yce");
const yceEnvPath = resolve(yceRootDir, ".env");
const yceEngineEnvPath = resolve(yceRootDir, "vendor/yce-engine/.env");
const DEFAULT_YCE_RELAY_URL = "https://yce.aigy.de";
const DEFAULT_YCE_YOUWEN_API_URL = "https://a.aigy.de";
const CLI_RUNTIME_KEYS = new Set(["claude-code", "codex", "qoder", "cursor", "kiro", "antigravity", "qwen", "opencode", "grok", "kimi"]);

const CLI_DEFS = [
  {
    runtime: "claude-code",
    label: "Claude Code",
    bin: "claude",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5", "claude-haiku-4-5-20251001", "sonnet", "opus", "fable"],
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
    defaultModels: ["Cantus", "Auto", "Ultimate", "Performance", "Efficient", "Lite", "Qwen3.7-Max", "DeepSeek-V4-Pro"],
  },
  {
    runtime: "cursor",
    label: "Cursor Agent",
    // Prefer cursor-agent: bare `agent` is often Grok Build on PATH, not Cursor.
    bin: "cursor-agent",
    binCandidates: ["cursor-agent", "agent", "cursor"],
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
  {
    runtime: "antigravity",
    label: "Antigravity CLI",
    bin: "agy",
    binCandidates: ["agy", "antigravity", "antigravity-cli"],
    modelCommands: [["models"]],
    defaultModels: [
      "Claude Opus 4.6 (Thinking)",
      "Claude Sonnet 4.6 (Thinking)",
      "Gemini 3.5 Flash (High)",
      "Gemini 3.5 Flash (Medium)",
      "Gemini 3.5 Flash (Low)",
      "Gemini 3.1 Pro (High)",
      "Gemini 3.1 Pro (Low)",
      "GPT-OSS 120B (Medium)"
    ],
  },
  {
    runtime: "qwen",
    label: "Qwen Code CLI",
    bin: "qwen",
    binCandidates: ["qwen", "qwen-code"],
    modelCommands: [["models"]],
    defaultModels: ["glm-5.2", "qwen3.5-max", "qwen3-coder-next", "qwen-coder-32b"],
  },
  {
    runtime: "opencode",
    label: "OpenCode CLI",
    bin: "opencode",
    binCandidates: ["opencode", "open-code"],
    modelCommands: [["models"]],
    defaultModels: ["opencode-go/kimi-k3", "auto", "anthropic/claude-3-7-sonnet", "openai/gpt-4o"],
  },
  {
    runtime: "grok",
    label: "Grok CLI",
    bin: "grok",
    binCandidates: ["grok", "grok-cli"],
    modelCommands: [["models"]],
    defaultModels: ["auto", "grok-3", "grok-3-mini"],
  },
  {
    runtime: "kimi",
    label: "Kimi CLI",
    bin: "kimi",
    binCandidates: ["kimi", "kimi-cli", "kimi-code"],
    modelCommands: [],
    defaultModels: ["auto", "kimi-k1.5", "kimi-k2.5"],
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

/** Default CLI runtimes only — omit model so each CLI uses its own default. */
function defaultModelEntries() {
  return [
    { runtime: "antigravity", model: "Claude Opus 4.6 (Thinking)" },
    { runtime: "claude-code" },
    { runtime: "codex" },
    { runtime: "cursor" },
  ];
}

function modelEntryKey(entry) {
  if (!entry || !entry.runtime) return "";
  return entry.model ? `${entry.runtime}/${entry.model}` : entry.runtime;
}

function compactModelEntry(entry) {
  if (!entry || !entry.runtime) return null;
  const out = { runtime: entry.runtime };
  if (entry.model) out.model = entry.model;
  // Preserve optional API fields
  for (const key of ["url", "baseUrl", "urlEnv", "baseUrlEnv", "token", "apiKey", "tokenEnv", "apiKeyEnv", "anthropicVersion"]) {
    if (entry[key] != null && entry[key] !== "") out[key] = entry[key];
  }
  return out;
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
    if (isLikelyModelName(line)) lineModels.push(line);
    else {
      const match = line.match(/^(\*?\s*)([a-zA-Z0-9][a-zA-Z0-9._:() -]{1,})(?:\s|$)/);
      if (match && isLikelyModelName(match[2])) lineModels.push(match[2].trim());
    }
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
  if (/[\r\n\t]/.test(raw)) return false;
  if (/^(usage|options|commands|arguments|default|current|model|models|available|description|context_window_tokens|rate_multiplier|rate_unit|credit|credits|object|created|owned_by|type|display_name)$/i.test(raw)) return false;
  return /(?:gpt|claude|sonnet|opus|haiku|fable|gemini|grok|qwen|deepseek|glm|minimax|kimi|composer|codex|auto|lite|efficient|ultimate|performance|qmodel)/i.test(raw);
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (cliArgs.help) usage(0);

  const existing = readExistingConfig();

  if (cliArgs.bootstrap && !cliArgs.models.length && cliArgs.yceEnabled == null
      && cliArgs.yceRelayToken == null && !cliArgs.yceRelayUrl && cliArgs.youwenToken == null) {
    runBootstrap({
      force: cliArgs.force,
      yceEnabled: false,
      yceMode: cliArgs.yceMode || YCE_DEFAULT_MODE,
    });
    return;
  }

  if (cliArgs.nonInteractive) {
    if (cliArgs.bootstrap) {
      // bootstrap combined with explicit flags: force write + respect yce/models flags
      if (existsSync(configPath) && !cliArgs.force && cliArgs.models.length === 0 && cliArgs.yceEnabled == null) {
        console.log(`已有配置，跳过 bootstrap: ${configPath}`);
        return;
      }
    }

    const existingEnv = loadYceEnvMerged();
    const hasYceTokenArgs = Boolean(
      cliArgs.yceRelayToken != null
      || cliArgs.yceRelayUrl
      || cliArgs.youwenToken != null
    );
    let yceEnabled = cliArgs.yceEnabled;
    if (yceEnabled == null && hasYceTokenArgs) yceEnabled = true;
    if (yceEnabled == null) yceEnabled = existing.yce?.enabled ?? false;

    let writtenEnv = existingEnv;
    if (yceEnabled || hasYceTokenArgs) {
      writtenEnv = writeYceEnvFile({
        relayUrl: cliArgs.yceRelayUrl || existingEnv.YCE_RELAY_URL || existing.yce?.relayUrl || DEFAULT_YCE_RELAY_URL,
        relayToken: cliArgs.yceRelayToken != null
          ? cliArgs.yceRelayToken
          : (existingEnv.YCE_RELAY_TOKEN || existingEnv.YCE_API_KEY || ""),
        youwenToken: cliArgs.youwenToken != null
          ? cliArgs.youwenToken
          : (existingEnv.YCE_YOUWEN_TOKEN || ""),
        youwenApiUrl: existingEnv.YCE_YOUWEN_API_URL || DEFAULT_YCE_YOUWEN_API_URL,
      });
    } else {
      migrateWrongEngineEnvIfNeeded();
    }

    const baseModels = cliArgs.models.length > 0
      ? cliArgs.models
      : (cliArgs.bootstrap ? bootstrapModels() : (existing.models || defaultModelEntries()));
    const needPreserve = cliArgs.models.length > 0;
    const preservedApiModels = needPreserve
      ? (Array.isArray(existing.models) ? existing.models : [])
          .filter((entry) => entry && !CLI_RUNTIME_KEYS.has(entry.runtime))
      : [];
    const seenKeys = new Set();
    const mergedModels = [...baseModels, ...preservedApiModels].filter((entry) => {
      if (!entry || !entry.runtime) return false;
      const key = modelEntryKey(entry);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    writeConfig({
      models: mergedModels,
      yceEnabled,
      yceMode: cliArgs.yceMode || YCE_DEFAULT_MODE,
      yceRelayUrl: writtenEnv.YCE_RELAY_URL || existing.yce?.relayUrl || (yceEnabled ? DEFAULT_YCE_RELAY_URL : undefined),
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
    console.log(`${row.label} 模型候选（可选）:`);
    row.discoveredModels.forEach((model, index) => {
      console.log(`  ${index + 1}) ${model}`);
    });
    const modelChoice = await rl.question(
      "选择模型（回车=CLI 自带默认，推荐；逗号多选编号；也可直接输入模型名）: ",
    );
    if (!modelChoice.trim()) {
      // Prefer CLI built-in default: write runtime only, no model field.
      models.push({ runtime: row.runtime });
      console.log(`  → 使用 ${row.runtime} 自带默认模型（不写 model）`);
      continue;
    }
    const selectedModels = parseModelChoice(modelChoice, row.discoveredModels);
    for (const model of selectedModels) {
      if (model) models.push({ runtime: row.runtime, model });
      else models.push({ runtime: row.runtime });
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

  console.log("未选择模型，将使用内置默认 CLI 顺序（不写 model，走各 CLI 自带默认）。");
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

/** Merge skill-root .env with any misplaced yce-engine/.env (skill root wins). */
function loadYceEnvMerged() {
  const skillEnv = parseEnvFile(yceEnvPath);
  const engineEnv = parseEnvFile(yceEngineEnvPath);
  return { ...engineEnv, ...skillEnv };
}

/**
 * .env must be at YCE skill root: <y-plan>/vendor/yce/.env
 * Never write to vendor/yce/vendor/yce-engine/.env
 */
function migrateWrongEngineEnvIfNeeded() {
  if (!existsSync(yceEngineEnvPath)) return parseEnvFile(yceEnvPath);
  const engineEnv = parseEnvFile(yceEngineEnvPath);
  if (!existsSync(yceEnvPath)) {
    if (!existsSync(yceRootDir)) mkdirSync(yceRootDir, { recursive: true });
    writeFileSync(yceEnvPath, readFileSync(yceEngineEnvPath, "utf8"));
    console.log(`已将错误位置的 .env 迁移到 YCE skill 根目录: ${yceEnvPath}`);
  } else {
    const skillEnv = parseEnvFile(yceEnvPath);
    const missing = Object.entries(engineEnv).filter(([k, v]) => v && !skillEnv[k]);
    if (missing.length > 0) {
      for (const [k, v] of missing) skillEnv[k] = v;
      writeYceEnvFile({
        relayUrl: skillEnv.YCE_RELAY_URL || DEFAULT_YCE_RELAY_URL,
        relayToken: skillEnv.YCE_RELAY_TOKEN || skillEnv.YCE_API_KEY || "",
        youwenToken: skillEnv.YCE_YOUWEN_TOKEN || "",
        youwenApiUrl: skillEnv.YCE_YOUWEN_API_URL || DEFAULT_YCE_YOUWEN_API_URL,
        localFallback: skillEnv.YCE_LOCAL_FALLBACK || "false",
        preserveExtra: skillEnv,
      });
    }
  }
  try {
    unlinkSync(yceEngineEnvPath);
    console.log(`已删除错误位置的 .env: ${yceEngineEnvPath}`);
  } catch {
    // ignore
  }
  return parseEnvFile(yceEnvPath);
}

function writeYceEnvFile({ relayUrl, relayToken, youwenToken, youwenApiUrl, localFallback, preserveExtra }) {
  if (!existsSync(yceRootDir)) mkdirSync(yceRootDir, { recursive: true });

  // Always merge/migrate first so we never lose tokens from a misplaced engine .env.
  const existing = loadYceEnvMerged();
  const mergedRelayUrl = relayUrl || existing.YCE_RELAY_URL || DEFAULT_YCE_RELAY_URL;
  const mergedRelayToken = relayToken != null && relayToken !== undefined
    ? String(relayToken)
    : (existing.YCE_RELAY_TOKEN || existing.YCE_API_KEY || "");
  const mergedYouwenToken = youwenToken != null && youwenToken !== undefined
    ? String(youwenToken)
    : (existing.YCE_YOUWEN_TOKEN || "");
  const mergedYouwenApiUrl = youwenApiUrl || existing.YCE_YOUWEN_API_URL || DEFAULT_YCE_YOUWEN_API_URL;
  const mergedLocalFallback = localFallback != null
    ? String(localFallback)
    : (existing.YCE_LOCAL_FALLBACK || "false");

  const lines = [
    "# YCE runtime configuration (managed by Y-Plan install)",
    `# Path contract: this file MUST be at vendor/yce/.env (YCE skill root), NOT vendor/yce-engine/.env`,
    "",
    "# yw-enhance adapter",
    `YCE_YOUWEN_SCRIPT=./scripts/youwen.js`,
    `YCE_YOUWEN_API_URL=${mergedYouwenApiUrl}`,
    `YCE_YOUWEN_TOKEN=${mergedYouwenToken}`,
    `YCE_YOUWEN_ENHANCE_MODE=${existing.YCE_YOUWEN_ENHANCE_MODE || "agent"}`,
    `YCE_YOUWEN_ENABLE_SEARCH=${existing.YCE_YOUWEN_ENABLE_SEARCH || "true"}`,
    `YCE_YOUWEN_MGREP_API_KEY=${existing.YCE_YOUWEN_MGREP_API_KEY || ""}`,
    "",
    "# yce-engine adapter (远端优先：默认连接 yce.aigy.de relay)",
    "# YCE_RELAY_TOKEN 是 YCE 搜索密钥；不要和 YCE_YOUWEN_TOKEN 混用",
    `YCE_ENGINE_SCRIPT=./vendor/yce-engine/yce-engine.mjs`,
    `YCE_ENGINE_MAX_RESULTS=${existing.YCE_ENGINE_MAX_RESULTS || "10"}`,
    `YCE_ENGINE_MAX_TURNS=${existing.YCE_ENGINE_MAX_TURNS || "3"}`,
    `YCE_RELAY_URL=${mergedRelayUrl}`,
    `YCE_RELAY_TOKEN=${mergedRelayToken}`,
    `YCE_LOCAL_FALLBACK=${mergedLocalFallback}`,
    "",
    "# yce orchestrator (milliseconds)",
    `YCE_DEFAULT_MODE=${existing.YCE_DEFAULT_MODE || "plan"}`,
    `YCE_TIMEOUT_ENHANCE_MS=${existing.YCE_TIMEOUT_ENHANCE_MS || "300000"}`,
    `YCE_TIMEOUT_SEARCH_MS=${existing.YCE_TIMEOUT_SEARCH_MS || "180000"}`,
    "",
  ];
  writeFileSync(yceEnvPath, lines.join("\n"));

  if (existsSync(yceEngineEnvPath)) {
    try {
      unlinkSync(yceEngineEnvPath);
      console.log(`已删除错误位置的 .env（应在 skill 根目录）: ${yceEngineEnvPath}`);
    } catch {
      // ignore
    }
  }

  console.log(`YCE .env 已写入 skill 根目录: ${yceEnvPath}`);
  return {
    YCE_RELAY_URL: mergedRelayUrl,
    YCE_RELAY_TOKEN: mergedRelayToken,
    YCE_YOUWEN_TOKEN: mergedYouwenToken,
    YCE_YOUWEN_API_URL: mergedYouwenApiUrl,
    ...(preserveExtra || {}),
  };
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
    bootstrap: false,
    force: false,
    models: [],
    yceEnabled: null,
    yceMode: "",
    yceScript: "",
    yceRelayUrl: "",
    yceRelayToken: null,
    youwenToken: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "--bootstrap") {
      parsed.nonInteractive = true;
      parsed.bootstrap = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--enable-yce") {
      parsed.nonInteractive = true;
      parsed.yceEnabled = true;
    } else if (arg === "--disable-yce") {
      parsed.nonInteractive = true;
      parsed.yceEnabled = false;
    } else if (arg === "--yce-mode") {
      parsed.yceMode = argv[++i] || "plan";
    } else if (arg === "--yce-relay-url") {
      parsed.nonInteractive = true;
      parsed.yceRelayUrl = argv[++i] || "";
      if (parsed.yceEnabled == null) parsed.yceEnabled = true;
    } else if (arg === "--yce-relay-token") {
      parsed.nonInteractive = true;
      parsed.yceRelayToken = argv[++i] || "";
      if (parsed.yceEnabled == null) parsed.yceEnabled = true;
    } else if (arg === "--youwen-token") {
      parsed.nonInteractive = true;
      parsed.youwenToken = argv[++i] || "";
      if (parsed.yceEnabled == null) parsed.yceEnabled = true;
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
    "  node scripts/install.mjs --bootstrap",
    "  node scripts/install.mjs --model codex --enable-yce",
    "  node scripts/install.mjs --model codex/gpt-5.5 --enable-yce",
    "  node scripts/install.mjs --enable-yce --yce-relay-token yce_xxx",
    "  node scripts/install.mjs --models claude-code,cursor/auto,codex",
    "  node scripts/install.mjs --disable-yce",
    "",
    "说明:",
    "  - 不带参数时进入中文交互式配置。",
    "  - --bootstrap：安装后非交互种子配置（检测本机 CLI，不覆盖已有配置，除非 --force）。",
    "  - CLI 格式: 仅 runtime（推荐，用 CLI 自带默认模型），或 runtime/model 指定型号。",
    "  - 例如: claude-code、codex、cursor/auto、kiro、qoder；指定型号: codex/gpt-5.5。",
    "  - API 供应商仍建议写明 model，并通过交互式配置填写 URL 和密钥环境变量。",
    "  - 配置会写入 y-plan.config.json。",
    "  - 启用 YCE 时会把密钥写入 vendor/yce/.env（YCE skill 根目录，不是 yce-engine）。",
    "  - --yce-relay-token / --yce-relay-url / --youwen-token 可非交互写入 YCE .env。",
  ].join("\n");
  (exitCode === 0 ? console.log : console.error)(text);
  process.exit(exitCode);
}

/**
 * Detect installed CLIs and build a ready-to-use model list.
 * Prefer available CLIs; never pin model names — use each CLI's built-in default.
 */
function bootstrapModels() {
  const available = [];
  for (const def of CLI_DEFS) {
    const bin = resolveBin(def);
    if (commandExists(bin)) {
      available.push({ runtime: def.runtime });
    }
  }
  if (available.length > 0) return available;
  return defaultModelEntries();
}

function runBootstrap({ force = false, yceEnabled = false, yceMode = "plan", yceRelayUrl = "" } = {}) {
  if (existsSync(configPath) && !force) {
    console.log(`已有配置，跳过 bootstrap: ${configPath}`);
    console.log("如需覆盖，使用: node scripts/install.mjs --bootstrap --force");
    return false;
  }

  migrateWrongEngineEnvIfNeeded();
  const models = bootstrapModels();
  writeConfig({
    models,
    yceEnabled: Boolean(yceEnabled),
    yceMode: yceMode || "plan",
    yceRelayUrl: yceRelayUrl || undefined,
  });
  console.log("bootstrap 完成：检测本机 CLI，不写 model（走各 CLI 自带默认）。");
  console.log(`runtime 顺序: ${models.map((m) => m.runtime).join(", ")}`);
  console.log("安装后可直接：");
  console.log('  node scripts/y-plan.mjs "Plan this refactor..."');
  console.log("或在 IDE 中说：Use Y-Plan to plan this change");
  return true;
}

function writeConfig({ models, yceEnabled, yceMode, yceRelayUrl }) {
  const compactModels = (Array.isArray(models) ? models : [])
    .map(compactModelEntry)
    .filter(Boolean);
  const config = {
    models: compactModels,
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
  console.log(`runtime 数量: ${config.models.length}`);
  for (const m of config.models) {
    console.log(`  - ${m.model ? `${m.runtime}/${m.model}` : `${m.runtime} (CLI 默认)`}`);
  }
  console.log(`YCE: ${config.yce.enabled ? `启用 (${config.yce.mode})` : "未启用"}`);
  if (config.yce.enabled) {
    console.log(`YCE .env（skill 根目录）: ${yceEnvPath}`);
    if (existsSync(yceEngineEnvPath)) {
      console.log(`警告: 发现错误位置 .env: ${yceEngineEnvPath}（应只在 skill 根目录）`);
    }
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
  if (!runtime) {
    throw new Error(`模型格式应为 runtime 或 runtime/model，当前为: ${raw}`);
  }
  const model = modelParts.join("/").trim();
  const entry = { runtime: normalizeRuntime(runtime) };
  if (model) entry.model = model;
  return entry;
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
