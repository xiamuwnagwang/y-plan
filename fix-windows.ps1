#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 一键修复 / 重装 Y-Plan（可在旧 install.ps1 已损坏时使用）

.DESCRIPTION
  旧版 install.ps1 在 PowerShell 5.1 下会因数组里的 (if ...) 语法在「解析阶段」就失败，
  无法靠旧脚本自愈。本脚本独立、无该语法，会：
    1. 从 GitHub 下载最新 y-plan
    2. 覆盖当前目录（或安装到默认 skills 目录）
    3. 执行 install.ps1 -Action install

.EXAMPLE
  # 在任意目录执行（推荐）：修复并装到 Cursor
  irm https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/fix-windows.ps1 | iex

  # 或下载后本地跑
  .\fix-windows.ps1 -Target cursor
  .\fix-windows.ps1 -Target agents -AllTargets
#>

param(
  [ValidateSet("agents", "codex", "claude", "opencode", "cursor", "kiro", "zed", "antigravity", "qoder")]
  [string]$Target = "cursor",
  [switch]$AllTargets,
  [switch]$Configure,
  [string]$RepoUrl = "https://github.com/xiamuwnagwang/y-plan",
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($Help) {
  Write-Host @"
Y-Plan Windows 修复脚本

用法:
  .\fix-windows.ps1 [-Target cursor] [-AllTargets] [-Configure]

示例:
  .\fix-windows.ps1 -Target cursor
  .\fix-windows.ps1 -Target agents -Configure
  irm https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/fix-windows.ps1 | iex
"@
  exit 0
}

function Write-Step([string]$Message) {
  Write-Host "▸ $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "✔ $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "! $Message" -ForegroundColor Yellow
}

# TLS 1.2 for older Windows
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$HomeDir = $env:USERPROFILE
if (-not $HomeDir) { $HomeDir = $env:HOME }
if (-not $HomeDir) { throw "无法解析用户主目录 USERPROFILE" }

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("y-plan-fix-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null

try {
  Write-Step "下载最新 Y-Plan: $RepoUrl"
  $zipPath = Join-Path $tmpRoot "y-plan-main.zip"
  $archiveUrl = "$RepoUrl/archive/refs/heads/main.zip"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath -UseBasicParsing

  Write-Step "解压..."
  Expand-Archive -Path $zipPath -DestinationPath $tmpRoot -Force
  $repo = Get-ChildItem -Path $tmpRoot -Directory | Where-Object { $_.Name -like "y-plan*" } | Select-Object -First 1
  if (-not $repo) { throw "解压后未找到 y-plan 目录" }

  $installPs1 = Join-Path $repo.FullName "install.ps1"
  if (-not (Test-Path $installPs1)) { throw "缺少 install.ps1: $installPs1" }

  # Sanity: reject known-broken pattern from old releases
  $probe = Select-String -Path $installPs1 -Pattern '\(if \(\$env:CODEX_HOME\)' -SimpleMatch -ErrorAction SilentlyContinue
  if ($probe) {
    throw "下载到的 install.ps1 仍含旧语法 (if `$env:CODEX_HOME)，请稍后重试或检查仓库 main 分支"
  }
  Write-Ok "已下载修复版 install.ps1"

  # Prefer pwsh if present, else Windows PowerShell 5.1
  $psExe = "powershell"
  if (Get-Command pwsh -ErrorAction SilentlyContinue) {
    $psExe = "pwsh"
  }

  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installPs1, "-Action", "install")
  if ($AllTargets) {
    $args += "-AllTargets"
  } else {
    $args += @("-Target", $Target)
  }
  if ($Configure) {
    $args += "-Configure"
  }

  Write-Step "执行安装: $psExe $($args -join ' ')"
  Push-Location $repo.FullName
  try {
    & $psExe @args
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
      throw "install.ps1 退出码 $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  Write-Ok "修复 / 安装完成"
  Write-Host ""
  Write-Host "常用路径:" -ForegroundColor DarkGray
  Write-Host "  Cursor:  $HomeDir\.cursor\skills\y-plan"
  Write-Host "  .agents: $HomeDir\.agents\skills\y-plan"
  Write-Host "  Claude:  $HomeDir\.claude\skills\y-plan"
  Write-Host ""
  Write-Host "验证:" -ForegroundColor DarkGray
  Write-Host "  cd $HomeDir\.cursor\skills\y-plan"
  Write-Host "  .\install.ps1 -Action version"
} finally {
  Remove-Item -Recurse -Force $tmpRoot -ErrorAction SilentlyContinue
}
