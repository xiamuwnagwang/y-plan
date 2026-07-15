param(
  [ValidateSet("menu", "install", "setup", "check", "uninstall", "version", "upgrade", "sync")]
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
  [string]$YceRelayUrl = "",
  [string]$YceRelayToken = "",
  [string]$YouwenToken = "",
  [string]$Model = "",
  [string]$Models = "",
  [switch]$Help
)

$RepoUrl = if ($env:Y_PLAN_REPO_URL) { $env:Y_PLAN_REPO_URL } else { "https://github.com/xiamuwnagwang/y-plan" }
$RemoteSkillMdUrl = if ($env:Y_PLAN_VERSION_URL) { $env:Y_PLAN_VERSION_URL } else { "https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/SKILL.md" }

if ($Help) {
  Write-Output "Y-Plan 中文安装 / 配置脚本"
  Write-Output ""
  Write-Output "用法:"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action install [-Target agents|codex|claude|opencode|cursor|kiro|zed|antigravity|qoder|path] [-Configure]"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -Model codex -EnableYce"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -EnableYce -YceRelayToken yce_xxx"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -Models claude-code,cursor/auto,codex"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action setup -Models codex/gpt-5.5"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action check"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action version"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action upgrade"
  Write-Output "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Action sync"
  Write-Output ""
  Write-Output "说明:"
  Write-Output "  - 不带参数会进入中文菜单。"
  Write-Output "  - install 后自动 bootstrap 默认可运行配置（检测本机 CLI，不写 model，用 CLI 自带默认）。"
  Write-Output "  - setup 不带模型参数时进入中文交互配置。"
  Write-Output "  - -Model/-Models 推荐只写 runtime；需要钉死型号时再写 runtime/model。"
  Write-Output "  - 启用 YCE 时写入 vendor/yce/.env（skill 根目录，不是 yce-engine）。"
  Write-Output "  - -YceRelayToken / -YceRelayUrl / -YouwenToken 可非交互写入 YCE。"
  Write-Output "  - 版本号唯一来源：SKILL.md frontmatter 的 version 字段。"
  Write-Output "  - 若旧 install.ps1 在 Windows 上报 (if `$env:CODEX_HOME) 解析错误，请改用:"
  Write-Output "      irm https://raw.githubusercontent.com/xiamuwnagwang/y-plan/main/fix-windows.ps1 | iex"
  Write-Output "    或: .\fix-windows.ps1 -Target cursor"
  exit 0
}

$ErrorActionPreference = "Stop"
$SkillName = "y-plan"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Prefer USERPROFILE on Windows; $HOME can be unset in some hosts.
$HomeDir = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($HOME) { $HOME } else { $env:HOME }
if (-not $HomeDir) { throw "无法解析用户主目录（USERPROFILE/HOME 为空）" }

function Join-HomePath {
  param([Parameter(Mandatory = $true)][string[]]$Parts)
  $result = $HomeDir
  foreach ($part in $Parts) {
    $result = Join-Path $result $part
  }
  return $result
}

# PS 5.1: do NOT put (if ...) expressions inside @() array literals — parse error.
$CodexSkillsDir = if ($env:CODEX_HOME) {
  Join-Path $env:CODEX_HOME "skills"
} else {
  Join-HomePath @(".codex", "skills")
}

$TargetKeys = @("agents", "codex", "claude", "opencode", "cursor", "kiro", "zed", "antigravity", "qoder", "path")
$TargetLabels = @(".agents", "Codex", "Claude Code", "OpenCode", "Cursor", "Kiro", "Zed Prompts", "Antigravity", "Qoder", "Custom Path")
$TargetDirs = @(
  (Join-HomePath @(".agents", "skills")),
  $CodexSkillsDir,
  (Join-HomePath @(".claude", "skills")),
  (Join-HomePath @(".config", "opencode", "skills")),
  (Join-HomePath @(".cursor", "skills")),
  (Join-HomePath @(".kiro", "skills")),
  (Join-HomePath @(".config", "zed", "prompts")),
  (Join-HomePath @(".antigravity", "skills")),
  (Join-HomePath @(".qoder", "skills")),
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
  $yceEnvDest = Join-Path $DestDir "vendor/yce/.env"
  $wrongEngineEnv = Join-Path $DestDir "vendor/yce/vendor/yce-engine/.env"
  $configDest = Join-Path $DestDir "y-plan.config.json"
  $yceEnvBackup = $null
  $configBackup = $null
  if (Test-Path $yceEnvDest) {
    $yceEnvBackup = [System.IO.Path]::GetTempFileName()
    Copy-Item $yceEnvDest $yceEnvBackup -Force
  } elseif (Test-Path $wrongEngineEnv) {
    $yceEnvBackup = [System.IO.Path]::GetTempFileName()
    Copy-Item $wrongEngineEnv $yceEnvBackup -Force
    Write-Output "WARN ${Label}: 发现错误位置 .env（yce-engine），将迁移到 vendor/yce/.env"
  }
  if (Test-Path $configDest) {
    $configBackup = [System.IO.Path]::GetTempFileName()
    Copy-Item $configDest $configBackup -Force
  }

  New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
  if (Test-Path $DestDir) { Remove-Item -Recurse -Force $DestDir }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

  $Items = Get-ChildItem -Force -Path $ScriptDir | Where-Object {
    $_.Name -ne ".git" -and $_.Name -ne ".DS_Store" -and $_.Name -ne "y-plan.config.json"
  }
  foreach ($Item in $Items) {
    Copy-Item -Recurse -Force -Path $Item.FullName -Destination $DestDir
  }

  if ($yceEnvBackup -and (Test-Path $yceEnvBackup)) {
    $yceRoot = Join-Path $DestDir "vendor/yce"
    New-Item -ItemType Directory -Force -Path $yceRoot | Out-Null
    Copy-Item $yceEnvBackup $yceEnvDest -Force
    Remove-Item $yceEnvBackup -Force -ErrorAction SilentlyContinue
    $engineEnvAfter = Join-Path $DestDir "vendor/yce/vendor/yce-engine/.env"
    if (Test-Path $engineEnvAfter) { Remove-Item $engineEnvAfter -Force -ErrorAction SilentlyContinue }
  }
  if ($configBackup -and (Test-Path $configBackup)) {
    Copy-Item $configBackup $configDest -Force
    Remove-Item $configBackup -Force -ErrorAction SilentlyContinue
  }

  Ensure-YceEngineRipgrep $DestDir $Label
  if (-not (Test-Path $configDest)) {
    Invoke-Bootstrap $DestDir
  }
  $ver = Get-LocalVersion $DestDir
  if ($ver) {
    Write-Output "$Label <- Y-Plan v$ver"
  } else {
    Write-Output "$Label <- Y-Plan"
  }
  Write-Output $DestDir
}

function Copy-Skill {
  Copy-SkillTo (Resolve-DestRoot) $Target | Out-Null
}

function Get-LocalVersion([string]$Dir = $ScriptDir) {
  $skillPath = Join-Path $Dir "SKILL.md"
  if (-not (Test-Path $skillPath)) { return $null }
  $line = Select-String -Path $skillPath -Pattern '^version:\s*(\S+)' | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value }
  return $null
}

function Get-RemoteVersion {
  # Prefer relay skill-version API; fall back to GitHub raw SKILL.md
  $apiUrl = if ($env:Y_PLAN_VERSION_URL) {
    $env:Y_PLAN_VERSION_URL
  } elseif ($env:YCE_VERSION_API_URL) {
    $env:YCE_VERSION_API_URL
  } else {
    "https://yce.aigy.de/api/public/skill-version"
  }
  try {
    $uri = $apiUrl
    if ($uri -notmatch 'name=') {
      if ($uri -match '\?') { $uri = "$uri&name=y-plan" } else { $uri = "$uri`?name=y-plan" }
    }
    $json = (Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10).Content
    $obj = $json | ConvertFrom-Json
    if ($obj -and $obj.version) {
      return ([string]$obj.version).TrimStart('v', 'V')
    }
  } catch {}
  try {
    $text = (Invoke-WebRequest -Uri $RemoteSkillMdUrl -UseBasicParsing -TimeoutSec 10).Content
    if ($text -match '(?m)^version:\s*(\S+)') { return $Matches[1] }
  } catch {}
  return $null
}

function Compare-Semver([string]$A, [string]$B) {
  $normA = ($A -replace '^v', '')
  $normB = ($B -replace '^v', '')
  $pa = $normA.Split('.') | ForEach-Object {
    $n = 0
    [void][int]::TryParse($_, [ref]$n)
    $n
  }
  $pb = $normB.Split('.') | ForEach-Object {
    $n = 0
    [void][int]::TryParse($_, [ref]$n)
    $n
  }
  for ($i = 0; $i -lt 3; $i++) {
    $va = 0
    $vb = 0
    if ($i -lt @($pa).Count) { $va = @($pa)[$i] }
    if ($i -lt @($pb).Count) { $vb = @($pb)[$i] }
    if ($va -lt $vb) { return -1 }
    if ($va -gt $vb) { return 1 }
  }
  return 0
}

function Invoke-Bootstrap([string]$Root) {
  $installJs = Join-Path $Root "scripts/install.mjs"
  if (-not (Test-Path $installJs)) {
    Write-Output "WARN 跳过 bootstrap：缺少 $installJs"
    return
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Output "WARN 未找到 node，跳过配置 bootstrap；IDE skill 仍可直接使用 SKILL.md"
    return
  }
  & node $installJs --bootstrap
}

function Invoke-Setup([string]$Root) {
  $ArgsList = @()
  if ($EnableYce) { $ArgsList += "--enable-yce" }
  if ($DisableYce) { $ArgsList += "--disable-yce" }
  $mergedModels = @()
  if ($Model) { $mergedModels += $Model }
  if ($Models) { $mergedModels += $Models }
  if ($mergedModels.Count -gt 0) { $ArgsList += @("--models", ($mergedModels -join ",")) }
  if ($YceRelayUrl) { $ArgsList += @("--yce-relay-url", $YceRelayUrl) }
  if ($YceRelayToken) { $ArgsList += @("--yce-relay-token", $YceRelayToken) }
  if ($YouwenToken) { $ArgsList += @("--youwen-token", $YouwenToken) }
  if ($ArgsList.Count -gt 0) {
    $ArgsList += @("--yce-mode", $YceMode)
    node (Join-Path $Root "scripts/install.mjs") @ArgsList
  } else {
    node (Join-Path $Root "scripts/install.mjs")
  }
}

function Invoke-Version {
  $ver = Get-LocalVersion $ScriptDir
  if ($ver) { Write-Output "y-plan v$ver" } else { throw "无法从 SKILL.md 读取 version" }
}

function Invoke-Check {
  $DestDir = Resolve-DestDir
  $localVer = Get-LocalVersion $ScriptDir
  $remoteVer = Get-RemoteVersion
  Write-Output ""
  if ($localVer) { Write-Output "OK 本地版本: v$localVer" } else { Write-Output "WARN 本地版本未知" }
  if ($remoteVer) {
    Write-Output "INFO 远端最新: v$remoteVer"
    if ($localVer) {
      $cmp = Compare-Semver $localVer $remoteVer
      if ($cmp -lt 0) { Write-Output "WARN 有新版本可用。升级: install.ps1 -Action upgrade" }
      elseif ($cmp -eq 0) { Write-Output "OK 已是最新版本" }
      else { Write-Output "INFO 本地版本高于远端（开发/预发布）" }
    }
  } else {
    Write-Output "WARN 远端版本不可用"
  }
  $Checks = @(
    "SKILL.md",
    "scripts/y-plan.mjs",
    "scripts/install.mjs",
    "scripts/lib/version.mjs",
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
  if (Test-Path $DestDir) {
    Write-Output "OK 已安装目录存在: $DestDir"
    $instVer = Get-LocalVersion $DestDir
    if ($instVer) { Write-Output "INFO 安装目录版本: v$instVer" }
  } else {
    Write-Output "WARN 未找到已安装目录: $DestDir"
  }
  Write-Output "INFO 安装后可直接在 IDE 说 Use Y-Plan，或 node scripts/y-plan.mjs `"Plan...`""
}

function Invoke-Sync {
  $count = 0
  Write-Output "INFO 同步当前 Y-Plan 到已安装目录"
  for ($i = 0; $i -lt $TargetKeys.Count; $i++) {
    if ($TargetKeys[$i] -eq "path") { continue }
    $dest = Join-Path $TargetDirs[$i] $SkillName
    if (Test-Path $dest) {
      Copy-SkillTo $TargetDirs[$i] $TargetLabels[$i] | Out-Null
      $count++
    }
  }
  if ($count -eq 0) {
    Write-Output "WARN 未检测到已安装目录，改为安装到默认目标 agents"
    Copy-Skill
  } else {
    Write-Output "OK 已同步 $count 个安装目录"
  }
}

function Invoke-Upgrade {
  $localVer = Get-LocalVersion $ScriptDir
  $remoteVer = Get-RemoteVersion
  $localLabel = if ($localVer) { $localVer } else { "unknown" }
  $remoteLabel = if ($remoteVer) { $remoteVer } else { "unknown" }
  Write-Output "INFO 本地版本: $localLabel"
  Write-Output "INFO 远端版本: $remoteLabel"
  if ($localVer -and $remoteVer -and (Compare-Semver $localVer $remoteVer) -ge 0) {
    Write-Output "OK 无需升级（本地 >= 远端）"
    return
  }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("y-plan-upgrade-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Write-Output "INFO 下载最新 Y-Plan..."
    $zip = Join-Path $tmp "repo.zip"
    $archiveUrl = "$RepoUrl/archive/refs/heads/main.zip"
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $repo = Get-ChildItem -Directory $tmp |
      Where-Object { $_.Name -like "y-plan*" } |
      Select-Object -First 1
    if (-not $repo) {
      $repo = Get-ChildItem -Directory $tmp | Select-Object -First 1
    }
    if (-not $repo) { throw "下载解压失败" }
    $installPs1 = Join-Path $repo.FullName "install.ps1"
    if (-not (Test-Path $installPs1)) { throw "解压后未找到 install.ps1: $($repo.FullName)" }
    Push-Location $repo.FullName
    try {
      # Prefer current host; PS 5.1 has no reliable PSEdition=Core.
      $psExe = "powershell"
      if ($PSVersionTable.PSVersion.Major -ge 6) {
        $psExe = "pwsh"
      } elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
        # Optional: allow pwsh if installed even under Windows PowerShell host
        $psExe = "pwsh"
      }
      if ($AllTargets) {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $installPs1 -Action install -AllTargets
      } else {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $installPs1 -Action install -Target $Target
      }
      if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "嵌套 install.ps1 失败，exit=$LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
    Write-Output "OK 升级完成"
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
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
  $ver = Get-LocalVersion $ScriptDir
  $title = "Y-Plan 中文安装 / 配置"
  if ($ver) { $title = "$title  (v$ver)" }
  Write-Output ""
  Write-Output $title
  Write-Output ""
  Write-Output "  1) 安装 / 更新到 .agents"
  Write-Output "  2) 生成 / 修改配置（CLI、模型、API 供应商、YCE）"
  Write-Output "  3) 安装 / 更新并立即配置"
  Write-Output "  4) 检查安装状态 / 版本"
  Write-Output "  5) 升级到远端最新版"
  Write-Output "  6) 同步当前目录到已安装目标"
  Write-Output "  7) 卸载默认安装目录"
  Write-Output "  0) 退出"
  Write-Output ""
  $choice = Read-Host "请选择"
  switch ($choice) {
    "1" { Copy-Skill }
    "2" { Invoke-Setup $ScriptDir }
    "3" { Copy-Skill; Invoke-Setup (Resolve-DestDir) }
    "4" { Invoke-Check }
    "5" { Invoke-Upgrade }
    "6" { Invoke-Sync }
    "7" { Invoke-Uninstall }
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
  "version" { Invoke-Version }
  "upgrade" { Invoke-Upgrade }
  "sync" { Invoke-Sync }
  "uninstall" { Invoke-Uninstall }
}
