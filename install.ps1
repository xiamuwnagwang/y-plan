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
  [string]$AgentConfig = "./agents/y-plan-agents.json",
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
  $ArgsList += @("--yce-mode", $YceMode, "--agent-config", $AgentConfig)
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
    "vendor/mattpocock-skills/skills/engineering/codebase-design/SKILL.md",
    "agents/y-plan-agents.json"
  )
  foreach ($Rel in $Checks) {
    $Full = Join-Path $ScriptDir $Rel
    if (Test-Path $Full) { Write-Output "OK $Rel" } else { throw "缺失 $Rel" }
  }
  node --check (Join-Path $ScriptDir "scripts/y-plan.mjs") | Out-Null
  node --check (Join-Path $ScriptDir "scripts/install.mjs") | Out-Null
  $AgentJson = Get-Content -Raw (Join-Path $ScriptDir "agents/y-plan-agents.json")
  $null = $AgentJson | ConvertFrom-Json
  Write-Output "OK 脚本语法和 agent JSON 正常"
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
