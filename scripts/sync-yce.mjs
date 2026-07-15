#!/usr/bin/env node
/**
 * Sync YCE-enhance into y-plan/vendor/yce and pin the upstream commit.
 *
 * Source of truth: YCE Git repository (default: local clone or --source).
 * Downstream copy: y-plan/vendor/yce (entity vendor, no symlink).
 *
 * Usage:
 *   node scripts/sync-yce.mjs --source "/path/to/YCE-enhance"
 *   node scripts/sync-yce.mjs --source "/path/to/YCE-enhance" --check
 *   node scripts/sync-yce.mjs --source "/path/to/YCE-enhance" --install-target agents
 *   node scripts/sync-yce.mjs --source "/path/to/YCE-enhance" --allow-dirty
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const vendorYceDir = resolve(projectRoot, "vendor/yce");
const upstreamPath = resolve(vendorYceDir, ".upstream.json");
const DEFAULT_REPO = "https://github.com/xiamuwnagwang/YCE-enhance.git";

const EXCLUDE_NAMES = new Set([
  ".git",
  ".env",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".upstream.json",
]);

const EXCLUDE_SUFFIXES = [".log", ".tmp", ".bak", ".orig"];

function usage(code = 0) {
  const text = `Usage:
  node scripts/sync-yce.mjs --source <YCE_GIT_DIR> [--check] [--allow-dirty] [--skip-tests] [--install-target <target>]

Options:
  --source <dir>           YCE Git working tree (required)
  --check                  Verify vendor/yce matches source commit content; do not write
  --allow-dirty            Allow syncing from a dirty YCE worktree (not recommended)
  --skip-tests             Skip YCE test suite after sync
  --install-target <name>  After sync, run bash install.sh --install --target <name>
  --expected-commit <sha>  With --check, require .upstream.json commit equals this SHA
  --help                   Show this help
`;
  process.stdout.write(text);
  process.exit(code);
}

function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

function info(message) {
  process.stdout.write(`• ${message}\n`);
}

function ok(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function parseArgs(argv) {
  const out = {
    source: "",
    check: false,
    allowDirty: false,
    skipTests: false,
    installTarget: "",
    expectedCommit: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--check") {
      out.check = true;
      continue;
    }
    if (arg === "--allow-dirty") {
      out.allowDirty = true;
      continue;
    }
    if (arg === "--skip-tests") {
      out.skipTests = true;
      continue;
    }
    if (arg === "--source") {
      out.source = argv[++i] || "";
      continue;
    }
    if (arg === "--install-target") {
      out.installTarget = argv[++i] || "";
      continue;
    }
    if (arg === "--expected-commit") {
      out.expectedCommit = argv[++i] || "";
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!out.source) fail("--source <YCE_GIT_DIR> is required");
  out.source = resolve(out.source);
  return out;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  return result;
}

function mustRun(cmd, args, opts = {}) {
  const result = run(cmd, args, opts);
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    fail(`${cmd} ${args.join(" ")} failed\n${stderr || stdout || `exit ${result.status}`}`);
  }
  return (result.stdout || "").trim();
}

function isGitRepo(dir) {
  const result = run("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && (result.stdout || "").trim() === "true";
}

function git(dir, args) {
  return mustRun("git", ["-C", dir, ...args]);
}

function shouldExclude(name) {
  if (EXCLUDE_NAMES.has(name)) return true;
  return EXCLUDE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function walkFiles(root) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldExclude(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(abs);
      }
    }
  }

  if (existsSync(root)) walk(root);
  return files.sort();
}

function fileSha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function contentManifest(root) {
  const files = walkFiles(root);
  const manifest = {};
  for (const abs of files) {
    const rel = relative(root, abs).split("\\").join("/");
    if (rel === ".upstream.json") continue;
    const st = statSync(abs);
    if (!st.isFile()) continue;
    manifest[rel] = fileSha256(abs);
  }
  return manifest;
}

function compareManifests(sourceManifest, targetManifest) {
  const sourceKeys = Object.keys(sourceManifest).sort();
  const targetKeys = Object.keys(targetManifest).sort();
  const onlySource = sourceKeys.filter((k) => !(k in targetManifest));
  const onlyTarget = targetKeys.filter((k) => !(k in sourceManifest));
  const changed = sourceKeys.filter(
    (k) => k in targetManifest && sourceManifest[k] !== targetManifest[k]
  );
  return { onlySource, onlyTarget, changed };
}

function ensureCleanOrAllowed(source, allowDirty) {
  const dirty = git(source, ["status", "--porcelain"]);
  if (dirty && !allowDirty) {
    fail(
      `YCE worktree is dirty. Commit or stash first, or pass --allow-dirty.\n${dirty}`
    );
  }
  if (dirty && allowDirty) {
    info("YCE worktree is dirty; continuing because --allow-dirty was set");
  }
}

function readUpstream() {
  if (!existsSync(upstreamPath)) return null;
  try {
    return JSON.parse(readFileSync(upstreamPath, "utf8"));
  } catch (error) {
    fail(`Invalid ${upstreamPath}: ${error.message}`);
  }
}

function writeUpstream(data) {
  mkdirSync(dirname(upstreamPath), { recursive: true });
  writeFileSync(upstreamPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function syncWithRsync(source, target) {
  mkdirSync(target, { recursive: true });
  const args = [
    "-a",
    "--delete",
    "--exclude=.git",
    "--exclude=.env",
    "--exclude=.DS_Store",
    "--exclude=node_modules",
    "--exclude=dist",
    "--exclude=build",
    "--exclude=coverage",
    "--exclude=.cache",
    "--exclude=*.log",
    "--exclude=*.tmp",
    "--exclude=*.bak",
    "--exclude=.upstream.json",
    `${source}/`,
    `${target}/`,
  ];
  mustRun("rsync", args);
}

function runYceTests(target) {
  const engineDir = resolve(target, "vendor/yce-engine");
  const packageJson = resolve(engineDir, "package.json");
  if (!existsSync(packageJson)) {
    fail(`Missing ${packageJson}; cannot run YCE tests`);
  }

  if (!existsSync(resolve(engineDir, "node_modules"))) {
    info("Installing yce-engine dependencies for tests");
    const install = run("npm", ["ci", "--omit=dev"], { cwd: engineDir, stdio: "inherit" });
    if (install.status !== 0) {
      // fallback for incomplete lock / offline environments
      const install2 = run("npm", ["install", "--omit=dev"], {
        cwd: engineDir,
        stdio: "inherit",
      });
      if (install2.status !== 0) fail("npm install failed in vendor/yce-engine");
    }
  }

  info("Running yce-engine tests");
  const engineTest = run("npm", ["test"], { cwd: engineDir, stdio: "inherit" });
  if (engineTest.status !== 0) fail("yce-engine tests failed");

  const cliTest = resolve(target, "test/auto-enhance-search.test.cjs");
  if (existsSync(cliTest)) {
    info("Running auto enhance→search CLI tests");
    const cli = run("node", ["--test", cliTest], {
      cwd: target,
      stdio: "inherit",
    });
    if (cli.status !== 0) fail("auto enhance→search CLI tests failed");
  }
}

function installAgents(targetName) {
  const installSh = resolve(projectRoot, "install.sh");
  if (!existsSync(installSh)) fail(`Missing ${installSh}`);
  info(`Installing y-plan to target: ${targetName}`);
  const result = run("bash", [installSh, "--install", "--target", targetName], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) fail(`install.sh --install --target ${targetName} failed`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source;

  if (!existsSync(source)) fail(`Source does not exist: ${source}`);
  if (!isGitRepo(source)) fail(`Source is not a Git repository: ${source}`);

  ensureCleanOrAllowed(source, args.allowDirty);

  const commit = git(source, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(commit)) fail(`Invalid commit SHA: ${commit}`);

  const tagResult = run("git", ["-C", source, "describe", "--tags", "--exact-match", "HEAD"]);
  let ref = "";
  if (tagResult.status === 0 && (tagResult.stdout || "").trim()) {
    ref = (tagResult.stdout || "").trim();
  } else {
    const branchResult = run("git", ["-C", source, "rev-parse", "--abbrev-ref", "HEAD"]);
    ref =
      branchResult.status === 0 && (branchResult.stdout || "").trim()
        ? (branchResult.stdout || "").trim()
        : "HEAD";
  }

  const remoteResult = run("git", ["-C", source, "config", "--get", "remote.origin.url"]);
  const remoteUrl =
    remoteResult.status === 0 && (remoteResult.stdout || "").trim()
      ? (remoteResult.stdout || "").trim()
      : DEFAULT_REPO;

  const sourceManifest = contentManifest(source);
  const currentUpstream = readUpstream();
  const targetManifest = contentManifest(vendorYceDir);
  const diff = compareManifests(sourceManifest, targetManifest);

  if (args.check) {
    info(`Checking vendor/yce against ${source}`);
    info(`Source commit: ${commit}`);
    if (args.expectedCommit && args.expectedCommit.toLowerCase() !== commit.toLowerCase()) {
      fail(
        `--expected-commit ${args.expectedCommit} does not match source HEAD ${commit}`
      );
    }
    if (!currentUpstream || !currentUpstream.commit) {
      fail("vendor/yce/.upstream.json is missing or has no commit");
    }
    if (currentUpstream.commit.toLowerCase() !== commit.toLowerCase()) {
      fail(
        `.upstream.json commit ${currentUpstream.commit} != source HEAD ${commit}`
      );
    }
    if (diff.onlySource.length || diff.onlyTarget.length || diff.changed.length) {
      process.stderr.write(
        JSON.stringify(
          {
            onlyInSource: diff.onlySource,
            onlyInVendor: diff.onlyTarget,
            contentChanged: diff.changed,
          },
          null,
          2
        ) + "\n"
      );
      fail("vendor/yce content does not match the source YCE commit");
    }
    ok(`vendor/yce matches YCE commit ${commit}`);
    return;
  }

  info(`Syncing YCE ${commit} (${ref}) → vendor/yce`);
  // Preserve existing vendor/yce/.env across rsync --delete
  const envPath = resolve(vendorYceDir, ".env");
  let envBackup = null;
  if (existsSync(envPath)) {
    const tmp = mkdtempSync(join(tmpdir(), "y-plan-yce-env-"));
    envBackup = join(tmp, ".env");
    copyFileSync(envPath, envBackup);
    info("Preserved existing vendor/yce/.env");
  }

  syncWithRsync(source, vendorYceDir);

  if (envBackup) {
    copyFileSync(envBackup, envPath);
    rmSync(dirname(envBackup), { recursive: true, force: true });
  }

  let repository = DEFAULT_REPO;
  if (/github\.com[:/].*YCE-enhance/i.test(remoteUrl)) {
    repository = DEFAULT_REPO;
  } else if (remoteUrl) {
    repository = remoteUrl.endsWith(".git")
      ? remoteUrl
      : `${remoteUrl.replace(/\/$/, "")}.git`;
  }

  const skillVersion = (() => {
    try {
      const skill = readFileSync(resolve(vendorYceDir, "SKILL.md"), "utf8");
      const m = skill.match(/^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  })();

  const upstream = {
    repository,
    commit,
    ref,
    skillVersion,
    syncedAt: new Date().toISOString(),
  };

  writeUpstream(upstream);

  const afterManifest = contentManifest(vendorYceDir);
  const afterDiff = compareManifests(sourceManifest, afterManifest);
  if (afterDiff.onlySource.length || afterDiff.onlyTarget.length || afterDiff.changed.length) {
    process.stderr.write(JSON.stringify(afterDiff, null, 2) + "\n");
    fail("Post-sync content mismatch");
  }

  ok(`Synced vendor/yce to ${commit}`);
  ok(`Wrote ${relative(projectRoot, upstreamPath)}`);
  process.stdout.write(`${JSON.stringify(upstream, null, 2)}\n`);

  if (!args.skipTests) {
    runYceTests(vendorYceDir);
    ok("YCE tests passed");
  } else {
    info("Skipped tests (--skip-tests)");
  }

  if (args.installTarget) {
    installAgents(args.installTarget);
    ok(`Installed to target ${args.installTarget}`);
  }
}

main();
