## [1.0.6] - 2026-07-13

### Fixed

- 新增 `fix-windows.ps1`：旧 `install.ps1` 在 PS 5.1 解析失败时的独立修复入口（下载 main 后重装）
- Windows 嵌套升级：避免依赖 `PSEdition`（PS 5.1 兼容）

## [1.0.5] - 2026-07-13

### Fixed

- Windows `install.ps1`：修复 PowerShell 5.1 解析错误（数组字面量中的 `(if ...)`）
- Windows 路径：优先 `USERPROFILE`，`Join-Path` 分段拼接，避免安装即失败
- Windows 升级：嵌套 install 使用当前 PowerShell 宿主；解压目录优先匹配 `y-plan*`
- 远端版本检测：优先 skill-version API

### Changed

- 内置 `vendor/yce` 同步到 **YCE 1.7.1**（升级提示按本机 skill 目录生成）

# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

版本号唯一来源：`SKILL.md` frontmatter 中的 `version:` 字段。

## [1.0.3] - 2026-07-12

### Changed

- 版本检测改为对接 yce-relay-frontend 公开接口 `GET /api/public/skill-version?name=y-plan`
- 默认检测源：`https://yce.aigy.de/api/public/skill-version`（可用 `Y_PLAN_VERSION_URL` / `YCE_RELAY_URL` 覆盖）
- 每次调用 skill 时本地落后远端会提示升级（缓存 5 分钟）

## [1.0.2] - 2026-07-12

### Fixed

- Claude Code：去掉 `--tools ""`（空 tools 会吞掉后续 prompt，误报必须传 model；**不传 model 即可用 CLI 默认**）
- Cursor：优先 `cursor-agent`，避免 PATH 上的 Grok `agent` 抢占

### Changed

- 默认 runtime 顺序：`claude-code` → `cursor` → `codex`；从默认列表移除 gemini

## [1.0.1] - 2026-07-12

### Changed

- 默认配置 / bootstrap / 自动发现 **不再写死 model 名**，只写 `runtime`，调用时不传 `--model`/`-m`，交给各 CLI 自带默认
- 交互 setup：回车 = CLI 默认；需要钉死型号时再选编号或手输
- `--model` / `--models` 支持仅 `runtime`（如 `claude-code,codex`）

## [1.0.0] - 2026-07-12

### Added

- `SKILL.md` 正式版本号 `version: 1.0.0`
- `scripts/lib/version.mjs`：本地/远端版本读取、semver 比较、24h 缓存更新检查
- CLI：`node scripts/y-plan.mjs --version` / `--check-update`
- 安装器：`install.sh --version` / `--upgrade` / `--sync`；`install.ps1 -Action version|upgrade|sync`
- 安装后自动 `--bootstrap`：检测本机可用 CLI 并写入默认可运行的 `y-plan.config.json`
- 无配置时 `y-plan.mjs` 自动发现本机 CLI，不再硬失败于「No models configured」
- `CHANGELOG.md` 作为维护与发版记录

### Changed

- `build.sh` 默认从 `SKILL.md` 读取版本号（不再只依赖 git tag）
- `install.sh --check` / `install.ps1 -Action check` 输出本地版本与远端更新状态

### Notes

- IDE skill 路径：复制后即可在 Cursor / Claude / Codex 等按 `SKILL.md` 调用
- CLI 路径：安装后自动种子配置，检测到的 CLI 可直接 `node scripts/y-plan.mjs "…"`
- YCE 仍为可选；无 token 时默认关闭，不影响基础规划
