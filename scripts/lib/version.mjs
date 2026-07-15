#!/usr/bin/env node
/**
 * Y-Plan version management — single source of truth is SKILL.md frontmatter:
 *   version: x.y.z
 *
 * Remote authority: yce-relay-frontend public API
 *   GET {origin}/api/public/skill-version?name=y-plan
 *   → { version, downloadUrl, upgradeHint, notes }
 *
 * Used by: y-plan.mjs, install.mjs, install.sh, build.sh.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";

function resolveVersionEndpoint() {
  const explicit = (process.env.Y_PLAN_VERSION_URL || process.env.YCE_VERSION_API_URL || "").trim();
  if (explicit) {
    // Accept either full skill-version URL or brand/base origin
    if (/skill-version/i.test(explicit)) return explicit.replace(/\/+$/, "");
    try {
      const u = new URL(explicit);
      return `${u.origin}/api/public/skill-version`;
    } catch {
      return explicit.replace(/\/+$/, "");
    }
  }

  const relay =
    (process.env.YCE_RELAY_URL || "").trim() ||
    (process.env.Y_PLAN_RELAY_URL || "").trim();
  if (relay) {
    try {
      const u = new URL(relay);
      return `${u.origin}/api/public/skill-version`;
    } catch {
      // ignore
    }
  }

  return "https://yce.aigy.de/api/public/skill-version";
}

export const DEFAULT_REMOTE_SKILL_MD_URL = resolveVersionEndpoint();
export const DEFAULT_REPO_URL =
  process.env.Y_PLAN_REPO_URL ||
  "https://github.com/xiamuwnagwang/y-plan";
export const DEFAULT_REPO_ARCHIVE_URL =
  process.env.Y_PLAN_REPO_ARCHIVE_URL ||
  "https://github.com/xiamuwnagwang/y-plan/archive/refs/heads/main.tar.gz";

const REMOTE_SKILL_NAME = process.env.Y_PLAN_VERSION_SKILL_NAME || "y-plan";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — server bumps should surface soon
const CACHE_FILE = join(tmpdir(), "y-plan-version-check.json");

export function readVersionFromText(text) {
  if (!text) return null;
  const m = String(text).match(/^version:\s*(\S+)/m);
  return m ? m[1].trim() : null;
}

export function readLocalVersion(rootDir) {
  try {
    const skillPath = join(rootDir, "SKILL.md");
    if (!existsSync(skillPath)) return null;
    return readVersionFromText(readFileSync(skillPath, "utf8"));
  } catch {
    return null;
  }
}

export function compareSemver(a, b) {
  const pa = String(a || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function getCacheKey(remoteUrl) {
  return `${remoteUrl || "disabled"}::${REMOTE_SKILL_NAME}`;
}

function readCache(remoteUrl) {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (
      raw
      && typeof raw.checkedAt === "number"
      && typeof raw.remoteVersion === "string"
      && raw.cacheKey === getCacheKey(remoteUrl)
    ) {
      return raw;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeCache(payload) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    // ignore
  }
}

function fetchJson(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      const lib = url.startsWith("https:") ? https : http;
      const req = lib.get(url, { timeout: timeoutMs, headers: { Accept: "application/json" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeoutMs).then(done);
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
          if (data.length > 256 * 1024) {
            req.destroy();
            done(null);
          }
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              done(JSON.parse(data));
            } catch {
              done(null);
            }
          } else {
            done(null);
          }
        });
      });
      req.on("timeout", () => {
        req.destroy();
        done(null);
      });
      req.on("error", () => done(null));
    } catch {
      done(null);
    }
  });
}

export async function getRemoteVersion({ force = false, remoteUrl = DEFAULT_REMOTE_SKILL_MD_URL } = {}) {
  if (!remoteUrl || process.env.Y_PLAN_DISABLE_UPDATE_CHECK === "1") {
    return { version: null, fromCache: false, meta: null };
  }

  const cache = readCache(remoteUrl);
  if (!force && cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    return {
      version: cache.remoteVersion,
      fromCache: true,
      meta: {
        downloadUrl: cache.downloadUrl || null,
        upgradeHint: cache.upgradeHint || null,
        notes: cache.notes || null,
      },
    };
  }

  let body = null;
  try {
    const url = new URL(remoteUrl);
    if (!url.searchParams.has("name")) {
      url.searchParams.set("name", REMOTE_SKILL_NAME);
    }
    body = await fetchJson(url.toString(), 3000);
  } catch {
    body = null;
  }

  // Fallback: if endpoint is raw SKILL.md URL, parse version from text
  if (!body || typeof body.version !== "string") {
    // try as plain text SKILL.md
    try {
      const textUrl = remoteUrl.includes("skill-version")
        ? null
        : remoteUrl;
      if (textUrl) {
        // already tried JSON; skip
      }
    } catch {
      // ignore
    }
    if (cache?.remoteVersion) {
      return {
        version: cache.remoteVersion,
        fromCache: true,
        meta: {
          downloadUrl: cache.downloadUrl || null,
          upgradeHint: cache.upgradeHint || null,
          notes: cache.notes || null,
        },
      };
    }
    return { version: null, fromCache: false, meta: null };
  }

  const version = String(body.version).trim().replace(/^v/i, "");
  const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl.trim() : "";
  const upgradeHint = typeof body.upgradeHint === "string" ? body.upgradeHint.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (version) {
    writeCache({
      cacheKey: getCacheKey(remoteUrl),
      checkedAt: Date.now(),
      remoteVersion: version,
      downloadUrl,
      upgradeHint,
      notes,
    });
  }
  return {
    version,
    fromCache: false,
    meta: {
      downloadUrl: downloadUrl || null,
      upgradeHint: upgradeHint || null,
      notes: notes || null,
    },
  };
}

export async function checkForUpdate({ rootDir, force = false, remoteUrl = DEFAULT_REMOTE_SKILL_MD_URL } = {}) {
  if (process.env.Y_PLAN_DISABLE_UPDATE_CHECK === "1") return null;
  const localVersion = readLocalVersion(rootDir);
  if (!localVersion) return null;
  const { version: remoteVersion, meta } = await getRemoteVersion({ force, remoteUrl });
  if (!remoteVersion) return null;
  const cmp = compareSemver(localVersion, remoteVersion);
  return {
    localVersion,
    remoteVersion,
    remoteUrl,
    repoUrl: DEFAULT_REPO_URL,
    downloadUrl: meta?.downloadUrl || null,
    upgradeHint: meta?.upgradeHint || null,
    notes: meta?.notes || null,
    rootDir: rootDir || null,
    updateAvailable: cmp < 0,
  };
}

export function formatUpdateBanner(info) {
  if (!info || !info.updateAvailable) return null;
  const rootDir = info.rootDir || null;
  const installScript = rootDir && existsSync(join(rootDir, "install.sh"))
    ? join(rootDir, "install.sh")
    : null;
  const lines = [
    "",
    "==================================================",
    "⬆  y-plan 有新版本可用！请先升级后再继续使用。",
    `   当前本地版本: v${info.localVersion}`,
    `   最新远端版本: v${info.remoteVersion}`,
    `   远端检测源: ${info.remoteUrl}${info.remoteUrl.includes("?") ? "" : `?name=${REMOTE_SKILL_NAME}`}`,
  ];
  if (info.notes) lines.push(`   说明: ${info.notes}`);
  if (info.downloadUrl) lines.push(`   下载: ${info.downloadUrl}`);
  lines.push("   升级方法（按你本机当前 skill 目录，勿照搬他人路径）:");
  if (installScript) {
    lines.push(`     bash "${installScript}" --upgrade`);
    lines.push("   或: bash \"" + installScript + "\" --install");
  } else if (rootDir) {
    lines.push(`     cd "${rootDir}" && bash ./install.sh --upgrade`);
  } else {
    lines.push("     在本机 y-plan skill 根目录执行: bash ./install.sh --upgrade");
  }
  // Ignore server hints that hardcode a single-user install path.
  if (info.upgradeHint && !/\$HOME\/\.|~\/\.|\/Users\/|\/home\//.test(info.upgradeHint)) {
    lines.push(`   额外说明: ${info.upgradeHint}`);
  }
  lines.push("==================================================");
  return lines.join("\n");
}

export function formatVersionLine(rootDir) {
  const version = readLocalVersion(rootDir) || "unknown";
  return `y-plan v${version}`;
}

// CLI: node scripts/lib/version.mjs [--root DIR] [--check] [--json] [--force]
async function cliMain() {
  const argv = process.argv.slice(2);
  let rootDir = process.cwd();
  let check = false;
  let asJson = false;
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") rootDir = argv[++i] || rootDir;
    else if (arg === "--check") check = true;
    else if (arg === "--json") asJson = true;
    else if (arg === "--force") force = true;
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "Usage: node scripts/lib/version.mjs [--root DIR] [--check] [--json] [--force]\n",
      );
      process.exit(0);
    }
  }

  const localVersion = readLocalVersion(rootDir);
  if (!check) {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ localVersion }, null, 2)}\n`);
    } else {
      process.stdout.write(`${localVersion || "unknown"}\n`);
    }
    process.exit(localVersion ? 0 : 1);
  }

  const info = await checkForUpdate({ rootDir, force });
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ localVersion, ...(info || {}) }, null, 2)}\n`);
  } else {
    process.stdout.write(`local:  ${localVersion || "unknown"}\n`);
    if (info?.remoteVersion) {
      process.stdout.write(`remote: ${info.remoteVersion}\n`);
      process.stdout.write(`update: ${info.updateAvailable ? "yes" : "no"}\n`);
    } else {
      process.stdout.write("remote: (unavailable)\n");
    }
    const banner = formatUpdateBanner(info);
    if (banner) process.stdout.write(`${banner}\n`);
  }
  process.exit(0);
}

const isDirectRun = (() => {
  try {
    const entry = process.argv[1] || "";
    return entry.endsWith("version.mjs") || entry.endsWith("version.js");
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  cliMain().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}
