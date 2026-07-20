#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="y-plan"
REPO_URL="${Y_PLAN_REPO_URL:-https://github.com/xiamuwnagwang/y-plan}"
REPO_ARCHIVE_FALLBACK="${Y_PLAN_REPO_ARCHIVE_URL:-https://github.com/xiamuwnagwang/y-plan/archive/refs/heads/main.tar.gz}"
# Prefer relay frontend skill-version API; fall back to GitHub raw SKILL.md
REMOTE_VERSION_API_URL="${Y_PLAN_VERSION_URL:-${YCE_VERSION_API_URL:-https://yce.aigy.de/api/public/skill-version}}"
REMOTE_SKILL_MD_URL="${Y_PLAN_SKILL_MD_URL:-https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/SKILL.md}"

TARGET="agents"
TARGET_PATH=""
ACTION="menu"
CONFIGURE=0
ALL_TARGETS=0
MODELS=""
ENABLE_YCE=""
YCE_MODE="plan"
YCE_RELAY_URL=""
YCE_RELAY_TOKEN=""
YOUWEN_TOKEN=""

TARGET_KEYS=("agents" "codex" "claude" "opencode" "cursor" "kiro" "zed" "antigravity" "qoder" "qwen" "grok" "kimi" "path")
TARGET_LABELS=(".agents" "Codex" "Claude Code" "OpenCode" "Cursor" "Kiro" "Zed Prompts" "Antigravity" "Qoder" "Qwen" "Grok" "Kimi" "Custom Path")
TARGET_DIRS=(
  "$HOME/.agents/skills"
  "${CODEX_HOME:-$HOME/.codex}/skills"
  "$HOME/.claude/skills"
  "$HOME/.config/opencode/skills"
  "$HOME/.cursor/skills"
  "$HOME/.kiro/skills"
  "$HOME/.config/zed/prompts"
  "$HOME/.antigravity/skills"
  "$HOME/.qoder/skills"
  "$HOME/.qwen/skills"
  "$HOME/.grok/skills"
  "$HOME/.kimi/skills"
  ""
)

IDE_TARGET_KEYS=("cursor" "kiro" "zed" "antigravity" "qoder" "qwen" "grok" "kimi")

usage() {
  cat <<'USAGE'
Y-Plan 中文安装 / 配置脚本

用法:
  bash install.sh --install [--target TARGET] [--path DIR] [--configure] [--all-targets]
  bash install.sh --setup
  bash install.sh --setup --model codex --enable-yce
  bash install.sh --setup --enable-yce --yce-relay-token yce_xxx
  bash install.sh --setup --models claude-code,cursor/auto,codex
  bash install.sh --setup --models codex/gpt-5.5
  bash install.sh --check [--target TARGET] [--path DIR]
  bash install.sh --upgrade              # 下载最新版并更新当前安装
  bash install.sh --sync                 # 把当前目录同步到已检测到的安装目标
  bash install.sh --version
  bash install.sh --uninstall [--target TARGET] [--path DIR]
  bash install.sh --help

安装目标:
  agents, codex, claude, opencode, cursor, kiro, zed, antigravity, qoder, path

示例:
  bash install.sh --install --all-targets
  bash install.sh --install --target cursor
  bash install.sh --install --target zed --configure
  bash install.sh --install --configure --enable-yce --yce-relay-token yce_xxx
  bash install.sh --setup
  bash install.sh --upgrade

说明:
  - 不带参数会进入中文菜单。
  - --install 后会自动 bootstrap 默认可运行配置（检测本机 CLI，不写 model，用 CLI 自带默认）。
  - --setup 会进入中文交互配置：检测 CLI、可选指定模型、配置 API 供应商、选择是否启用 YCE。
  - --model/--models 推荐只写 runtime（如 claude-code,codex）；Cursor 可用 cursor/auto；需要钉死型号时再写 runtime/model。
  - 启用 YCE 时会顺带配置 vendor/yce/.env（YCE skill 根目录，不是 yce-engine）。
  - --yce-relay-token / --yce-relay-url / --youwen-token 可在安装/配置时非交互写入 YCE。
  - 版本号唯一来源：SKILL.md frontmatter 的 version 字段。
USAGE
}

fail() { printf '✗ %s\n' "$*" >&2; }
ok() { printf '✓ %s\n' "$*"; }
info() { printf '• %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }

get_local_version() {
  local dir="${1:-$SCRIPT_DIR}"
  [[ -f "$dir/SKILL.md" ]] && grep -m1 '^version:' "$dir/SKILL.md" 2>/dev/null | sed 's/version:[[:space:]]*//' | tr -d '[:space:]'
}

compare_semver() {
  local a="$1" b="$2"
  local IFS='.'
  # strip leading v
  a="${a#v}"; b="${b#v}"
  read -ra pa <<< "$a"
  read -ra pb <<< "$b"
  local i va vb
  for i in 0 1 2; do
    va="${pa[$i]:-0}"
    vb="${pb[$i]:-0}"
    (( 10#${va} < 10#${vb} )) && { echo "-1"; return; }
    (( 10#${va} > 10#${vb} )) && { echo "1"; return; }
  done
  echo "0"
}

get_remote_version() {
  # 1) relay skill-version API (JSON)
  local api_url="$REMOTE_VERSION_API_URL"
  if [[ -n "$api_url" ]]; then
    local json ver
    if [[ "$api_url" != *"name="* ]]; then
      if [[ "$api_url" == *"?"* ]]; then
        api_url="${api_url}&name=y-plan"
      else
        api_url="${api_url}?name=y-plan"
      fi
    fi
    json="$(curl -fsSL --retry 2 --retry-delay 1 --max-time 10 -H 'Accept: application/json' "$api_url" 2>/dev/null || true)"
    if [[ -n "$json" ]]; then
      ver="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(j&&j.version)process.stdout.write(String(j.version).replace(/^v/i,""));}catch{}})' 2>/dev/null || true)"
      if [[ -n "$ver" ]]; then
        printf '%s\n' "$ver"
        return 0
      fi
    fi
  fi
  # 2) fallback: GitHub raw SKILL.md
  curl -fsSL --retry 2 --retry-delay 1 --max-time 10 "$REMOTE_SKILL_MD_URL" 2>/dev/null \
    | grep -m1 '^version:' | sed 's/version:[[:space:]]*//' | tr -d '[:space:]'
}

download_latest() {
  local tmp_dir
  tmp_dir=$(mktemp -d)

  info "下载最新 Y-Plan..."
  if command -v git >/dev/null 2>&1; then
    if git clone --depth 1 "${REPO_URL}.git" "$tmp_dir/repo" >/dev/null 2>&1; then
      printf '%s\n' "$tmp_dir/repo"
      return 0
    fi
  fi

  if curl -fsSL --retry 3 --retry-delay 1 "$REPO_ARCHIVE_FALLBACK" | tar -xz -C "$tmp_dir" >/dev/null 2>&1; then
    local extracted
    extracted=$(find "$tmp_dir" -maxdepth 1 -type d ! -path "$tmp_dir" | head -1)
    if [[ -n "$extracted" ]]; then
      mv "$extracted" "$tmp_dir/repo"
      printf '%s\n' "$tmp_dir/repo"
      return 0
    fi
  fi

  rm -rf "$tmp_dir"
  fail "下载失败：$REPO_URL"
  return 1
}

bootstrap_dest() {
  local dest="$1"
  if [[ ! -f "$dest/scripts/install.mjs" ]]; then
    warn "跳过 bootstrap：缺少 $dest/scripts/install.mjs"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node "$dest/scripts/install.mjs" --bootstrap || warn "bootstrap 失败（可稍后 bash install.sh --setup）"
  else
    warn "未找到 node，跳过配置 bootstrap；IDE skill 仍可直接使用 SKILL.md"
  fi
}

get_yce_engine_dir() {
  local root="$1"
  printf '%s/vendor/yce/vendor/yce-engine\n' "$root"
}

get_yce_engine_ripgrep_path() {
  local engine_dir="$1"
  [[ -f "$engine_dir/lib/ripgrep.mjs" ]] || return 1
  (
    cd "$engine_dir"
    node --input-type=module -e '
import { existsSync } from "node:fs";
import { resolveRipgrepPath } from "./lib/ripgrep.mjs";
const p = resolveRipgrepPath();
if (!p || p === "rg" || p === "rg.exe" || !existsSync(p)) process.exit(1);
console.log(p);
'
  ) 2>/dev/null
}

get_expected_ripgrep_package_name() {
  local engine_dir="$1"
  (
    cd "$engine_dir"
    node -e 'const arch = process.env.npm_config_arch || process.arch; console.log(`@vscode/ripgrep-${process.platform}-${arch}`);'
  ) 2>/dev/null || echo "@vscode/ripgrep-<platform>"
}

get_expected_ripgrep_package_spec() {
  local engine_dir="$1"
  (
    cd "$engine_dir"
    node --input-type=module -e '
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const arch = process.env.npm_config_arch || process.arch;
const packageName = `@vscode/ripgrep-${process.platform}-${arch}`;
let version = "";

try {
  const entryPath = require.resolve("@vscode/ripgrep");
  const packageJsonPath = join(dirname(dirname(entryPath)), "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  version = pkg.optionalDependencies?.[packageName] || pkg.version || "";
} catch {
}

console.log(version ? `${packageName}@${version}` : packageName);
'
  ) 2>/dev/null || get_expected_ripgrep_package_name "$engine_dir"
}

ensure_yce_engine_ripgrep() {
  local root="$1"
  local label="${2:-Y-Plan}"
  local engine_dir
  engine_dir="$(get_yce_engine_dir "$root")"

  if [[ ! -f "$engine_dir/package.json" ]]; then
    warn "${label}: 内置 YCE yce-engine 缺失，跳过 ripgrep 修复"
    return 0
  fi

  local rg_path expected_pkg platform_spec
  if rg_path="$(get_yce_engine_ripgrep_path "$engine_dir")"; then
    ok "${label}: 内置 YCE ripgrep 已就绪：$rg_path"
    return 0
  fi

  expected_pkg="$(get_expected_ripgrep_package_name "$engine_dir")"
  if ! command -v npm >/dev/null 2>&1; then
    warn "${label}: 未安装 npm，无法自动补齐 ${expected_pkg}"
    return 1
  fi

  info "${label}: 补齐内置 YCE 当前平台 ripgrep（${expected_pkg}）"
  (
    cd "$engine_dir"
    npm install --omit=dev --include=optional --no-audit --fund=false
  )

  if rg_path="$(get_yce_engine_ripgrep_path "$engine_dir")"; then
    ok "${label}: 内置 YCE ripgrep 已就绪：$rg_path"
    return 0
  fi

  platform_spec="$(get_expected_ripgrep_package_spec "$engine_dir")"
  (
    cd "$engine_dir"
    npm install "$platform_spec" --no-save --omit=dev --include=optional --no-audit --fund=false
  )

  if rg_path="$(get_yce_engine_ripgrep_path "$engine_dir")"; then
    ok "${label}: 内置 YCE ripgrep 已就绪：$rg_path"
    return 0
  fi

  warn "${label}: 当前平台 ripgrep 仍不可用（预期 ${platform_spec}）"
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -V|--version) ACTION="version"; shift ;;
    --install) ACTION="install"; shift ;;
    # --setup always enters config mode; --configure only flags "configure after install"
    # so `install.sh --install --configure` still installs first.
    --setup) ACTION="setup"; CONFIGURE=1; shift ;;
    --configure) CONFIGURE=1; shift ;;
    --check) ACTION="check"; shift ;;
    --upgrade) ACTION="upgrade"; shift ;;
    --sync) ACTION="sync"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --all-targets) ALL_TARGETS=1; shift ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --path) TARGET_PATH="${2:-}"; shift 2 ;;
    --enable-yce) ENABLE_YCE="1"; shift ;;
    --disable-yce) ENABLE_YCE="0"; shift ;;
    --yce-mode) YCE_MODE="${2:-plan}"; shift 2 ;;
    --yce-relay-url) YCE_RELAY_URL="${2:-}"; ENABLE_YCE="${ENABLE_YCE:-1}"; shift 2 ;;
    --yce-relay-token) YCE_RELAY_TOKEN="${2:-}"; ENABLE_YCE="${ENABLE_YCE:-1}"; shift 2 ;;
    --youwen-token) YOUWEN_TOKEN="${2:-}"; ENABLE_YCE="${ENABLE_YCE:-1}"; shift 2 ;;
    --model) MODELS="${MODELS:+$MODELS,}${2:-}"; shift 2 ;;
    --models) MODELS="${MODELS:+$MODELS,}${2:-}"; shift 2 ;;
    *) fail "未知参数: $1"; usage >&2; exit 2 ;;
  esac
done

target_index() {
  local key="$1"
  local i
  for i in "${!TARGET_KEYS[@]}"; do
    [[ "${TARGET_KEYS[$i]}" == "$key" ]] && { echo "$i"; return 0; }
  done
  return 1
}

resolve_dest_root() {
  local idx
  idx="$(target_index "$TARGET")" || {
    if [[ -n "$TARGET_PATH" ]]; then
      printf '%s\n' "$TARGET_PATH"
      return 0
    fi
    fail "未知安装目标: $TARGET"
    exit 2
  }

  if [[ "$TARGET" == "path" ]]; then
    [[ -n "$TARGET_PATH" ]] || { fail "--target path 需要同时提供 --path DIR"; exit 2; }
    printf '%s\n' "$TARGET_PATH"
    return 0
  fi

  printf '%s\n' "${TARGET_DIRS[$idx]}"
}

dest_dir() {
  printf '%s/%s\n' "$(resolve_dest_root)" "$SKILL_NAME"
}

copy_skill_to() {
  local dest_root="$1"
  local label="$2"
  local dest="$dest_root/$SKILL_NAME"
  mkdir -p "$dest_root"

  # Preserve local YCE credentials; .env must stay at vendor/yce/.env (skill root).
  local yce_env_backup=""
  local yce_env_dest="$dest/vendor/yce/.env"
  if [[ -f "$yce_env_dest" ]]; then
    yce_env_backup="$(mktemp)"
    cp "$yce_env_dest" "$yce_env_backup"
  fi
  # Also migrate any misplaced engine .env before overwrite
  local wrong_engine_env="$dest/vendor/yce/vendor/yce-engine/.env"
  if [[ -z "$yce_env_backup" && -f "$wrong_engine_env" ]]; then
    yce_env_backup="$(mktemp)"
    cp "$wrong_engine_env" "$yce_env_backup"
    warn "${label}: 发现错误位置 .env（yce-engine），将迁移到 vendor/yce/.env"
  fi

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '.git' \
      --exclude '.DS_Store' \
      --exclude 'y-plan.config.json' \
      --exclude 'vendor/yce/.env' \
      --exclude 'vendor/yce/vendor/yce-engine/.env' \
      "$SCRIPT_DIR/" "$dest/"
  else
    rm -rf "$dest"
    mkdir -p "$dest"
    (cd "$SCRIPT_DIR" && tar \
      --exclude='.git' \
      --exclude='.DS_Store' \
      --exclude='y-plan.config.json' \
      --exclude='vendor/yce/.env' \
      --exclude='vendor/yce/vendor/yce-engine/.env' \
      -cf - .) | (cd "$dest" && tar -xf -)
  fi

  mkdir -p "$dest/vendor/yce"
  if [[ -n "$yce_env_backup" && -f "$yce_env_backup" ]]; then
    cp "$yce_env_backup" "$yce_env_dest"
    rm -f "$yce_env_backup"
  elif [[ -f "$SCRIPT_DIR/vendor/yce/.env" && ! -f "$yce_env_dest" ]]; then
    # First install: seed from source skill if present
    cp "$SCRIPT_DIR/vendor/yce/.env" "$yce_env_dest"
  fi
  # Never leave credentials under yce-engine
  rm -f "$dest/vendor/yce/vendor/yce-engine/.env"

  chmod +x "$dest/scripts/y-plan.mjs" "$dest/scripts/install.mjs" "$dest/install.sh" 2>/dev/null || true
  ensure_yce_engine_ripgrep "$dest" "$label"
  # Install-and-use: seed default config when missing (detect local CLIs).
  if [[ ! -f "$dest/y-plan.config.json" ]]; then
    bootstrap_dest "$dest"
  fi
  ok "${label} ← Y-Plan v$(get_local_version "$dest" || echo '?')"
  info "$dest"
}

copy_skill() {
  copy_skill_to "$(resolve_dest_root)" "$TARGET"
}

run_setup() {
  local root="$1"
  local args=()
  [[ "$ENABLE_YCE" == "1" ]] && args+=(--enable-yce)
  [[ "$ENABLE_YCE" == "0" ]] && args+=(--disable-yce)
  [[ -n "$MODELS" ]] && args+=(--models "$MODELS")
  [[ -n "$YCE_RELAY_URL" ]] && args+=(--yce-relay-url "$YCE_RELAY_URL")
  [[ -n "$YCE_RELAY_TOKEN" ]] && args+=(--yce-relay-token "$YCE_RELAY_TOKEN")
  [[ -n "$YOUWEN_TOKEN" ]] && args+=(--youwen-token "$YOUWEN_TOKEN")
  args+=(--yce-mode "$YCE_MODE")
  # Non-interactive when any explicit flag is present; otherwise interactive configure.
  if [[ "$ENABLE_YCE" == "1" || "$ENABLE_YCE" == "0" || -n "$MODELS" || -n "$YCE_RELAY_TOKEN" || -n "$YCE_RELAY_URL" || -n "$YOUWEN_TOKEN" ]]; then
    node "$root/scripts/install.mjs" "${args[@]}"
  else
    node "$root/scripts/install.mjs"
  fi
}

install_targets() {
  local keys=("$@")
  local key idx label
  for key in "${keys[@]}"; do
    [[ "$key" == "path" ]] && continue
    idx="$(target_index "$key")" || { fail "未知安装目标: $key"; exit 2; }
    label="${TARGET_LABELS[$idx]}"
    copy_skill_to "${TARGET_DIRS[$idx]}" "$label"
    if [[ "$CONFIGURE" -eq 1 ]]; then
      run_setup "${TARGET_DIRS[$idx]}/$SKILL_NAME"
    fi
  done
}

cmd_install() {
  if [[ "$ALL_TARGETS" -eq 1 ]]; then
    install_targets "${TARGET_KEYS[@]}"
    return 0
  fi

  copy_skill
  if [[ "$CONFIGURE" -eq 1 ]]; then
    run_setup "$(dest_dir)"
  fi
}

cmd_setup() {
  run_setup "$SCRIPT_DIR"
}

cmd_menu() {
  local local_ver
  local_ver="$(get_local_version "$SCRIPT_DIR" || true)"
  echo ""
  echo "Y-Plan 中文安装 / 配置${local_ver:+  (v${local_ver})}"
  echo ""
  echo "  1) 安装 / 更新到 ${TARGET_LABELS[0]} (${TARGET_DIRS[0]}/$SKILL_NAME)"
  echo "  2) 生成 / 修改配置（CLI、模型、API 供应商、YCE）"
  echo "  3) 安装 / 更新并立即配置"
  echo "  4) 检查安装状态 / 版本"
  echo "  5) 升级到远端最新版"
  echo "  6) 同步当前目录到已安装目标"
  echo "  7) 卸载默认安装目录"
  echo "  0) 退出"
  echo ""

  local choice
  read -rp "请选择: " choice
  case "$choice" in
    1) cmd_install ;;
    2) cmd_setup ;;
    3) CONFIGURE=1; cmd_install ;;
    4) cmd_check ;;
    5) cmd_upgrade ;;
    6) cmd_sync ;;
    7) cmd_uninstall ;;
    0) echo "已退出" ;;
    *) fail "无效选择: $choice"; exit 1 ;;
  esac
}

cmd_version() {
  local ver
  ver="$(get_local_version "$SCRIPT_DIR" || true)"
  if [[ -n "$ver" ]]; then
    printf 'y-plan v%s\n' "$ver"
  else
    fail "无法从 SKILL.md 读取 version"
    exit 1
  fi
}

cmd_check() {
  local dest local_ver remote_ver cmp
  dest="$(dest_dir)"
  local_ver="$(get_local_version "$SCRIPT_DIR" || true)"
  remote_ver="$(get_remote_version || true)"

  echo ""
  info "检查 Y-Plan 源目录: $SCRIPT_DIR"
  [[ -n "$local_ver" ]] && ok "本地版本: v${local_ver}" || warn "本地版本: 未知（SKILL.md 缺少 version）"
  if [[ -n "$remote_ver" ]]; then
    info "远端最新: v${remote_ver}"
    if [[ -n "$local_ver" ]]; then
      cmp="$(compare_semver "$local_ver" "$remote_ver")"
      if [[ "$cmp" == "-1" ]]; then
        warn "有新版本可用。升级: bash install.sh --upgrade"
      elif [[ "$cmp" == "0" ]]; then
        ok "已是最新版本"
      else
        info "本地版本高于远端（开发/预发布）"
      fi
    fi
  else
    warn "远端版本不可用（网络或仓库地址）"
  fi
  echo ""

  [[ -f "$SCRIPT_DIR/SKILL.md" ]] && ok "源 SKILL.md 存在" || fail "源 SKILL.md 缺失"
  [[ -f "$SCRIPT_DIR/scripts/y-plan.mjs" ]] && ok "y-plan.mjs 存在" || fail "y-plan.mjs 缺失"
  [[ -f "$SCRIPT_DIR/scripts/lib/version.mjs" ]] && ok "version.mjs 存在" || warn "version.mjs 缺失"
  [[ -f "$SCRIPT_DIR/references/platform-prompts.md" ]] && ok "平台提示词存在" || fail "平台提示词缺失"
  [[ -f "$SCRIPT_DIR/vendor/yce/scripts/yce.js" ]] && ok "内置 YCE 存在" || fail "内置 YCE 缺失"
  [[ -f "$SCRIPT_DIR/vendor/mattpocock-skills/skills/engineering/codebase-design/SKILL.md" ]] && ok "内置 mattpocock/skills 存在" || fail "内置 mattpocock/skills 缺失"
  ensure_yce_engine_ripgrep "$SCRIPT_DIR" "源目录"
  if command -v node >/dev/null 2>&1; then
    node --check "$SCRIPT_DIR/scripts/y-plan.mjs" >/dev/null && ok "y-plan.mjs 语法正常"
    node --check "$SCRIPT_DIR/scripts/install.mjs" >/dev/null && ok "install.mjs 语法正常"
    node --check "$SCRIPT_DIR/scripts/lib/version.mjs" >/dev/null 2>&1 && ok "version.mjs 语法正常" || true
  else
    warn "未找到 node，跳过语法检查"
  fi
  if [[ -f "$SCRIPT_DIR/y-plan.config.json" ]]; then
    ok "源目录已有 y-plan.config.json"
  else
    info "源目录无配置（安装目标会自动 bootstrap；也可 bash install.sh --setup）"
  fi
  if [[ -d "$dest" ]]; then
    ok "已安装目录存在: $dest"
    local inst_ver
    inst_ver="$(get_local_version "$dest" || true)"
    [[ -n "$inst_ver" ]] && info "安装目录版本: v${inst_ver}"
    [[ -f "$dest/y-plan.config.json" ]] && ok "安装目录已有配置" || warn "安装目录缺少配置（可 bootstrap）"
  else
    warn "未找到已安装目录: $dest"
  fi
  echo ""
  info "安装后可直接使用："
  info "  IDE:  \"Use Y-Plan to plan this refactor\""
  info "  CLI:  node \"$SCRIPT_DIR/scripts/y-plan.mjs\" \"Plan this change...\""
}

cmd_sync() {
  # Sync current source tree into all already-installed skill locations + default target.
  local key idx dest label count=0
  info "同步当前 Y-Plan v$(get_local_version "$SCRIPT_DIR" || echo '?') 到已安装目录"
  for key in "${TARGET_KEYS[@]}"; do
    [[ "$key" == "path" ]] && continue
    idx="$(target_index "$key")" || continue
    dest="${TARGET_DIRS[$idx]}/$SKILL_NAME"
    label="${TARGET_LABELS[$idx]}"
    if [[ -d "$dest" ]]; then
      copy_skill_to "${TARGET_DIRS[$idx]}" "$label"
      count=$((count + 1))
    fi
  done
  if [[ "$count" -eq 0 ]]; then
    warn "未检测到已安装目录，改为安装到默认目标 agents"
    cmd_install
  else
    ok "已同步 $count 个安装目录"
  fi
}

cmd_upgrade() {
  local local_ver remote_ver cmp repo_dir
  local_ver="$(get_local_version "$SCRIPT_DIR" || true)"
  remote_ver="$(get_remote_version || true)"

  info "本地版本: ${local_ver:-unknown}"
  info "远端版本: ${remote_ver:-unknown}"

  if [[ -n "$local_ver" && -n "$remote_ver" ]]; then
    cmp="$(compare_semver "$local_ver" "$remote_ver")"
    if [[ "$cmp" != "-1" ]]; then
      ok "无需升级（本地 >= 远端）"
      return 0
    fi
  fi

  repo_dir="$(download_latest)" || exit 1
  info "用远端内容更新本机安装目标..."
  (
    cd "$repo_dir"
    if [[ "$ALL_TARGETS" -eq 1 ]]; then
      bash install.sh --install --all-targets
    else
      bash install.sh --install --target "$TARGET" ${TARGET_PATH:+--path "$TARGET_PATH"}
    fi
    if [[ "$CONFIGURE" -eq 1 || -n "$MODELS" || -n "$ENABLE_YCE" ]]; then
      # Re-apply setup flags against freshly installed dest
      true
    fi
  )
  # Also refresh current SCRIPT_DIR if it looks like an install location
  if [[ -f "$SCRIPT_DIR/SKILL.md" && "$SCRIPT_DIR" != "$repo_dir" ]]; then
    info "刷新当前源目录内容（保留 config 与 .env）..."
    if command -v rsync >/dev/null 2>&1; then
      rsync -a \
        --exclude '.git' \
        --exclude '.DS_Store' \
        --exclude 'y-plan.config.json' \
        --exclude 'vendor/yce/.env' \
        --exclude 'vendor/yce/vendor/yce-engine/.env' \
        "$repo_dir/" "$SCRIPT_DIR/"
    fi
  fi
  rm -rf "$(dirname "$repo_dir")"
  ok "升级完成 → v$(get_local_version "$SCRIPT_DIR" || echo "${remote_ver:-?}")"
  info "如需改模型/YCE: bash install.sh --setup"
}

cmd_uninstall() {
  local dest
  dest="$(dest_dir)"
  if [[ -d "$dest" ]]; then
    rm -rf "$dest"
    ok "已从 $dest 卸载 Y-Plan"
  else
    warn "Y-Plan 未安装在 $dest"
  fi
}

case "$ACTION" in
  menu) cmd_menu ;;
  install) cmd_install ;;
  setup) cmd_setup ;;
  check) cmd_check ;;
  version) cmd_version ;;
  upgrade) cmd_upgrade ;;
  sync) cmd_sync ;;
  uninstall) cmd_uninstall ;;
  *) fail "未知动作: $ACTION"; exit 2 ;;
esac
