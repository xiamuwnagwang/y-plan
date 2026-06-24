param(
  [ValidateSet("menu", "install", "setup", "check", "uninstall")]
  [string]$Action = "menu",
  [ValidateSet("agents", "codex", "claude", "opencode", "cursor", "kiro", "zed", "antigravity", "qoder", "path")]
  [string]$Target = "agents",
  [string]$Path = "",
  [switch]$Configure,
  [switch]$AllTargets,
  [switch]$EnableYce,
  [switch]$DisableYce,
  [ValidateSet("plan", "auto", "enhance", "search")]
  [string]$YceMode = "plan",
  [string]$Model = "",
  [string]$Models = "",
  [switch]$Help
)

if ($Help) {
  Write-Output "Y-Plan 中文安装 / 配置脚本"
  Write-Output ""
  Write-Output "用法:"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action install [-Target agents|codex|claude|opencode|cursor|kiro|zed|antigravity|qoder|path] [-Configure]"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -Model codex/gpt-5.5 -EnableYce"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -Models claude-code/sonnet,gemini/gemini-3.1-pro-preview"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action check"
  Write-Output ""
  Write-Output "说明:"
  Write-Output "  - 不带参数会进入中文菜单。"
  Write-Output "  - setup 不带模型参数时进入中文交互配置。"
  Write-Output "  - -Model/-Models 使用 runtime/model 格式。"
  exit 0
}

$ErrorActionPreference = "Stop"
$SkillName = "y-plan"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$TargetKeys = @("agents", "codex", "claude", "opencode", "cursor", "kiro", "zed", "antigravity", "qoder", "path")
$TargetLabels = @(".agents", "Codex", "Claude Code", "OpenCode", "Cursor", "Kiro", "Zed Prompts", "Antigravity", "Qoder", "Custom Path")
$TargetDirs = @(
  (Join-Path $HOME ".agents/skills"),
  (if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $HOME ".codex/skills" }),
  (Join-Path $HOME ".claude/skills"),
  (Join-Path $HOME ".config/opencode/skills"),
  (Join-Path $HOME ".cursor/skills"),
  (Join-Path $HOME ".kiro/skills"),
  (Join-Path $HOME ".config/zed/prompts"),
  (Join-Path $HOME ".antigravity/skills"),
  (Join-Path $HOME ".qoder/skills"),
  ""
)

function Get-TargetIndex([string]$Key) {
  for ($i = 0; $i -lt $TargetKeys.Count; $i++) {
    if ($TargetKeys[$i] -eq $Key) { return $i }
  }
  throw "未知安装目标: $Key"
}

function Resolve-DestRoot {
  if ($Target -eq "path") {
    if (-not $Path) { throw "-Target path 需要同时提供 -Path DIR" }
    return $Path
  }
  $idx = Get-TargetIndex $Target
  return $TargetDirs[$idx]
}

function Resolve-DestDir {
  return (Join-Path (Resolve-DestRoot) $SkillName)
}

function Get-YceEngineDir([string]$Root) {
  return (Join-Path $Root "vendor/yce/vendor/yce-engine")
}

function Get-YceEngineRipgrepPath([string]$EngineDir) {
  $resolver = Join-Path $EngineDir "lib/ripgrep.mjs"
  if (-not (Test-Path $resolver)) { return $null }

  Push-Location $EngineDir
  try {
    $script = @'
import { existsSync } from "node:fs";
import { resolveRipgrepPath } from "./lib/ripgrep.mjs";
const p = resolveRipgrepPath();
if (!p || p === "rg" || p === "rg.exe" || !existsSync(p)) process.exit(1);
console.log(p);
'@
    $out = & node --input-type=module -e $script 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($out | Select-Object -First 1)
  } catch {
    return $null
  } finally {
    Pop-Location
  }
}

function Get-ExpectedRipgrepPackageName([string]$EngineDir) {
  Push-Location $EngineDir
  try {
    $out = & node -e 'const arch = process.env.npm_config_arch || process.arch; console.log(`@vscode/ripgrep-${process.platform}-${arch}`);' 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Select-Object -First 1) }
  } catch {
  } finally {
    Pop-Location
  }
  return "@vscode/ripgrep-<platform>"
}

function Get-ExpectedRipgrepPackageSpec([string]$EngineDir) {
  Push-Location $EngineDir
  try {
    $script = @'
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
'@
    $out = & node --input-type=module -e $script 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Select-Object -First 1) }
  } catch {
  } finally {
    Pop-Location
  }
  return (Get-ExpectedRipgrepPackageName $EngineDir)
}

function Ensure-YceEngineRipgrep([string]$Root, [string]$Label = "Y-Plan") {
  $engineDir = Get-YceEngineDir $Root
  $packageJson = Join-Path $engineDir "package.json"
  if (-not (Test-Path $packageJson)) {
    Write-Output "WARN ${Label}: 内置 YCE yce-engine 缺失，跳过 ripgrep 修复"
    return
  }

  $rgPath = Get-YceEngineRipgrepPath $engineDir
  if ($rgPath) {
    Write-Output "OK ${Label}: 内置 YCE ripgrep 已就绪: $rgPath"
    return
  }

  $expectedPackage = Get-ExpectedRipgrepPackageName $engineDir
  $npmPath = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmPath) { $npmPath = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npmPath) {
    throw "${Label}: 未安装 npm，无法自动补齐 $expectedPackage"
  }

  Write-Output "INFO ${Label}: 补齐内置 YCE 当前平台 ripgrep ($expectedPackage)"
  Push-Location $engineDir
  try {
    & $npmPath.Source install --omit=dev --include=optional --no-audit --fund=false
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    $rgPath = Get-YceEngineRipgrepPath $engineDir
    if (-not $rgPath) {
      $platformSpec = Get-ExpectedRipgrepPackageSpec $engineDir
      & $npmPath.Source install $platformSpec --no-save --omit=dev --include=optional --no-audit --fund=false
      if ($LASTEXITCODE -ne 0) { throw "npm install $platformSpec failed with exit code $LASTEXITCODE" }
      $rgPath = Get-YceEngineRipgrepPath $engineDir
    }
    if (-not $rgPath) { throw "当前平台 ripgrep 仍不可用（预期 $expectedPackage）" }
    Write-Output "OK ${Label}: 内置 YCE ripgrep 已就绪: $rgPath"
  } finally {
    Pop-Location
  }
}

function Copy-SkillTo([string]$DestRoot, [string]$Label) {
  $DestDir = Join-Path $DestRoot $SkillName
  New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
  if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

  $Items = Get-ChildItem -Force -Path $ScriptDir | Where-Object {
    $_.Name -ne ".git" -and $_.Name -ne ".DS_Store" -and $_.Name -ne "y-plan.config.json"
  }
  foreach ($Item in $Items) {
    Copy-Item -Recurse -Force -Path $Item.FullName -Destination $DestDir
  }
  Ensure-YceEngineRipgrep $DestDir $Label
  Write-Output "$Label <- Y-Plan"
  Write-Output $DestDir
}

function Copy-Skill {
  Copy-SkillTo (Resolve-DestRoot) $Target | Out-Null
}

function Invoke-Setup([string]$Root) {
  $ArgsList = @()
  if ($EnableYce) { $ArgsList += "--enable-yce" }
  if ($DisableYce) { $ArgsList += "--disable-yce" }
  $mergedModels = @()
  if ($Model) { $mergedModels += $Model }
  if ($Models) { $mergedModels += $Models }
  if ($mergedModels.Count -gt 0) { $ArgsList += @("--models", ($mergedModels -join ",")) }
  $ArgsList += @("--yce-mode", $YceMode)
  node (Join-Path $Root "scripts/install.mjs") @ArgsList
}

function Invoke-Check {
  $DestDir = Resolve-DestDir
  $Checks = @(
    "SKILL.md",
    "scripts/y-plan.mjs",
    "scripts/install.mjs",
    "references/platform-prompts.md",
    "vendor/yce/scripts/yce.js",
    "vendor/mattpocock-skills/skills/engineering/codebase-design/SKILL.md"
  )
  foreach ($Rel in $Checks) {
    $Full = Join-Path $ScriptDir $Rel
    if (Test-Path $Full) { Write-Output "OK $Rel" } else { throw "缺失 $Rel" }
  }
  Ensure-YceEngineRipgrep $ScriptDir "源目录"
  node --check (Join-Path $ScriptDir "scripts/y-plan.mjs") | Out-Null
  node --check (Join-Path $ScriptDir "scripts/install.mjs") | Out-Null
  Write-Output "OK 脚本语法正常"
  if (Test-Path $DestDir) { Write-Output "OK 已安装目录存在: $DestDir" } else { Write-Output "WARN 未找到已安装目录: $DestDir" }
}

function Invoke-Uninstall {
  $DestDir = Resolve-DestDir
  if (Test-Path $DestDir) {
    Remove-Item -Recurse -Force $DestDir
    Write-Output "已从 $DestDir 卸载 Y-Plan"
  } else {
    Write-Output "Y-Plan 未安装在 $DestDir"
  }
}

function Invoke-Menu {
  Write-Output ""
  Write-Output "Y-Plan 中文安装 / 配置"
  Write-Output ""
  Write-Output "  1) 安装 / 更新到 .agents"
  Write-Output "  2) 生成 / 修改配置（CLI、模型、API 供应商、YCE）"
  Write-Output "  3) 安装 / 更新并立即配置"
  Write-Output "  4) 检查安装状态"
  Write-Output "  5) 卸载默认安装目录"
  Write-Output "  0) 退出"
  Write-Output ""
  $choice = Read-Host "请选择"
  switch ($choice) {
    "1" { Copy-Skill }
    "2" { Invoke-Setup $ScriptDir }
    "3" { Copy-Skill; Invoke-Setup (Resolve-DestDir) }
    "4" { Invoke-Check }
    "5" { Invoke-Uninstall }
    "0" { Write-Output "已退出" }
    default { throw "无效选择: $choice" }
  }
}

switch ($Action) {
  "menu" { Invoke-Menu }
  "install" {
    if ($AllTargets) {
      for ($i = 0; $i -lt $TargetKeys.Count; $i++) {
        if ($TargetKeys[$i] -eq "path") { continue }
        Copy-SkillTo $TargetDirs[$i] $TargetLabels[$i] | Out-Null
        if ($Configure) { Invoke-Setup (Join-Path $TargetDirs[$i] $SkillName) }
      }
    } else {
      Copy-Skill
      if ($Configure) { Invoke-Setup (Resolve-DestDir) }
    }
  }
  "setup" { Invoke-Setup $ScriptDir }
  "check" { Invoke-Check }
  "uninstall" { Invoke-Uninstall }
}
