import { spawnSync } from "node:child_process";
import { extname } from "node:path";

const WINDOWS_NATIVE_EXTENSIONS = new Set([".com", ".exe"]);
const WINDOWS_SCRIPT_EXTENSIONS = new Set([".bat", ".cmd"]);

function windowsCommandPaths(bin) {
  if (!bin || process.platform !== "win32") return [];

  const result = spawnSync("where.exe", [bin], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });
  if (result.status !== 0) return [];

  return [...new Set(
    String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )];
}

function extensionOf(filePath) {
  return extname(String(filePath || "")).toLowerCase();
}

function isWindowsNativeBinary(filePath) {
  return WINDOWS_NATIVE_EXTENSIONS.has(extensionOf(filePath));
}

function isWindowsScript(filePath) {
  return WINDOWS_SCRIPT_EXTENSIONS.has(extensionOf(filePath));
}

/**
 * Resolve a command to the Windows entry point Node can actually launch.
 * npm commonly puts a no-extension POSIX shim before the usable .cmd shim.
 */
export function resolveCommandBin(bin) {
  if (!bin || process.platform !== "win32") return bin || "";

  const paths = windowsCommandPaths(bin);
  if (paths.length === 0) return bin;

  return paths.find(isWindowsNativeBinary)
    || paths.find(isWindowsScript)
    || paths[0];
}

export function commandExists(bin) {
  if (!bin) return false;
  if (process.platform === "win32") return windowsCommandPaths(bin).length > 0;

  return spawnSync("sh", ["-lc", `command -v ${JSON.stringify(bin)}`], {
    encoding: "utf8",
    timeout: 3000,
  }).status === 0;
}

/**
 * Build a child-process invocation that works for npm .cmd/.bat shims on
 * Windows. Native executables still use direct spawn for normal signal and
 * stream behaviour.
 */
export function prepareSpawnCommand(command) {
  const resolvedBin = resolveCommandBin(command.bin);
  if (process.platform !== "win32" || isWindowsNativeBinary(resolvedBin)) {
    return { ...command, bin: resolvedBin };
  }

  const shell = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
  return {
    ...command,
    bin: shell,
    args: ["/d", "/s", "/c", resolvedBin, ...(command.args || [])],
  };
}

export function spawnSyncCommand(command, options = {}) {
  const prepared = prepareSpawnCommand(command);
  return spawnSync(prepared.bin, prepared.args, options);
}
