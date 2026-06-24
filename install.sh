#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="y-plan"

TARGET="agents"
TARGET_PATH=""
ACTION="menu"
CONFIGURE=0
ALL_TARGETS=0
MODELS=""
ENABLE_YCE=""
YCE_MODE="plan"

TARGET_KEYS=("agents" "codex" "claude" "opencode" "cursor" "kiro" "zed" "antigravity" "qoder" "path")
TARGET_LABELS=(".agents" "Codex" "Claude Code" "OpenCode" "Cursor" "Kiro" "Zed Prompts" "Antigravity" "Qoder" "Custom Path")
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
  ""
)

IDE_TARGET_KEYS=("cursor" "kiro" "zed" "antigravity" "qoder")

usage() {
  cat <<'USAGE'
Y-Plan 中文安装 / 配置脚本

用法:
  bash install.sh --install [--target TARGET] [--path DIR] [--configure] [--all-targets]
  bash install.sh --setup
  bash install.sh --setup --model codex/gpt-5.5 --enable-yce
  bash install.sh --setup --models claude-code/sonnet,gemini/gemini-3.1-pro-preview
  bash install.sh --check [--target TARGET] [--path DIR]
  bash install.sh --uninstall [--target TARGET] [--path DIR]
  bash install.sh --help

安装目标:
  agents, codex, claude, opencode, cursor, kiro, zed, antigravity, qoder, path

示例:
  bash install.sh --install --all-targets
  bash install.sh --install --target cursor
  bash install.sh --install --target zed --configure
  bash install.sh --setup

说明:
  - 不带参数会进入中文菜单。
  - --setup 会进入中文交互配置：检测 CLI、选择模型、配置 API 供应商、选择是否启用 YCE。
  - --model/--models 使用 runtime/model 格式，会直接写入 y-plan.config.json。
USAGE
}

fail() { printf '✗ %s\n' "$*" >&2; }
ok() { printf '✓ %s\n' "$*"; }
info() { printf '• %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }

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
    --install) ACTION="install"; shift ;;
    --setup|--configure) ACTION="setup"; CONFIGURE=1; shift ;;
    --check) ACTION="check"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --all-targets) ALL_TARGETS=1; shift ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --path) TARGET_PATH="${2:-}"; shift 2 ;;
    --enable-yce) ENABLE_YCE="1"; shift ;;
    --disable-yce) ENABLE_YCE="0"; shift ;;
    --yce-mode) YCE_MODE="${2:-plan}"; shift 2 ;;
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

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '.git' \
      --exclude '.DS_Store' \
      --exclude 'y-plan.config.json' \
      "$SCRIPT_DIR/" "$dest/"
  else
    rm -rf "$dest"
    mkdir -p "$dest"
    (cd "$SCRIPT_DIR" && tar --exclude='.git' --exclude='.DS_Store' --exclude='y-plan.config.json' -cf - .) | (cd "$dest" && tar -xf -)
  fi

  chmod +x "$dest/scripts/y-plan.mjs" "$dest/scripts/install.mjs" "$dest/install.sh" 2>/dev/null || true
  ensure_yce_engine_ripgrep "$dest" "$label"
  ok "${label} ← Y-Plan"
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
  args+=(--yce-mode "$YCE_MODE")
  node "$root/scripts/install.mjs" "${args[@]}"
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
  echo ""
  echo "Y-Plan 中文安装 / 配置"
  echo ""
  echo "  1) 安装 / 更新到 ${TARGET_LABELS[0]} (${TARGET_DIRS[0]}/$SKILL_NAME)"
  echo "  2) 生成 / 修改配置（CLI、模型、API 供应商、YCE）"
  echo "  3) 安装 / 更新并立即配置"
  echo "  4) 检查安装状态"
  echo "  5) 卸载默认安装目录"
  echo "  0) 退出"
  echo ""

  local choice
  read -rp "请选择: " choice
  case "$choice" in
    1) cmd_install ;;
    2) cmd_setup ;;
    3) CONFIGURE=1; cmd_install ;;
    4) cmd_check ;;
    5) cmd_uninstall ;;
    0) echo "已退出" ;;
    *) fail "无效选择: $choice"; exit 1 ;;
  esac
}

cmd_check() {
  local dest
  dest="$(dest_dir)"
  info "检查 Y-Plan 源目录: $SCRIPT_DIR"
  [[ -f "$SCRIPT_DIR/SKILL.md" ]] && ok "源 SKILL.md 存在" || fail "源 SKILL.md 缺失"
  [[ -f "$SCRIPT_DIR/scripts/y-plan.mjs" ]] && ok "y-plan.mjs 存在" || fail "y-plan.mjs 缺失"
  [[ -f "$SCRIPT_DIR/references/platform-prompts.md" ]] && ok "平台提示词存在" || fail "平台提示词缺失"
  [[ -f "$SCRIPT_DIR/vendor/yce/scripts/yce.js" ]] && ok "内置 YCE 存在" || fail "内置 YCE 缺失"
  [[ -f "$SCRIPT_DIR/vendor/mattpocock-skills/skills/engineering/codebase-design/SKILL.md" ]] && ok "内置 mattpocock/skills 存在" || fail "内置 mattpocock/skills 缺失"
  ensure_yce_engine_ripgrep "$SCRIPT_DIR" "源目录"
  node --check "$SCRIPT_DIR/scripts/y-plan.mjs" >/dev/null && ok "y-plan.mjs 语法正常"
  node --check "$SCRIPT_DIR/scripts/install.mjs" >/dev/null && ok "install.mjs 语法正常"
  if [[ -d "$dest" ]]; then
    ok "已安装目录存在: $dest"
  else
    warn "未找到已安装目录: $dest"
  fi
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
  uninstall) cmd_uninstall ;;
  *) fail "未知动作: $ACTION"; exit 2 ;;
esac
