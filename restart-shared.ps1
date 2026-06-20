param(
  [switch]$StopOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot ".env"

function Read-DotEnvValue {
  param(
    [string]$Name,
    [string]$Default = ""
  )

  if (-not (Test-Path -LiteralPath $EnvFile)) {
    return $Default
  }

  $line = Get-Content -LiteralPath $EnvFile |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $Default
  }

  $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=", "").Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Stop-PidFromFile {
  param(
    [string]$Label,
    [string]$PidFile
  )

  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "$Label pid: missing"
    return
  }

  $raw = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $pidValue = 0
  [void][int]::TryParse([string]$raw, [ref]$pidValue)
  if ($pidValue -le 0) {
    Write-Host "$Label pid: invalid"
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process) {
    Write-Host "Stopping $Label pid=$pidValue"
    Stop-Process -Id $pidValue -Force
  } else {
    Write-Host "$Label pid=$pidValue is stale"
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Get-PortListenerPids {
  param([int]$Port)

  $pids = @()
  try {
    $pids += Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess
  } catch {
    $lines = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    foreach ($line in $lines) {
      $parts = ($line.ToString().Trim() -split "\s+")
      $candidate = $parts[-1]
      $parsed = 0
      if ([int]::TryParse($candidate, [ref]$parsed)) {
        $pids += $parsed
      }
    }
  }

  return $pids | Where-Object { $_ -gt 0 } | Sort-Object -Unique
}

function Stop-PortListeners {
  param(
    [int]$Port,
    [int[]]$SkipPids = @()
  )

  $listenerPids = Get-PortListenerPids -Port $Port
  if (-not $listenerPids -or $listenerPids.Count -eq 0) {
    Write-Host "Port $Port listener: none"
    return
  }

  foreach ($pidValue in $listenerPids) {
    if ($SkipPids -contains $pidValue) {
      continue
    }
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    Write-Host "Stopping port $Port listener pid=$pidValue process=$name"
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
}

$stateDir = Read-DotEnvValue -Name "CYBERBOSS_STATE_DIR" -Default (Join-Path $HOME ".cyberboss")
$portRaw = Read-DotEnvValue -Name "CYBERBOSS_SHARED_PORT" -Default "8765"
$port = 8765
[void][int]::TryParse($portRaw, [ref]$port)

$logDir = Join-Path $stateDir "logs"
$bridgePidFile = Join-Path $logDir "shared-wechat.pid"
$appServerPidFile = Join-Path $logDir "shared-app-server.pid"

Write-Host "Cyberboss shared restart"
Write-Host "project: $ProjectRoot"
Write-Host "state:   $stateDir"
Write-Host "port:    $port"
Write-Host ""

Stop-PidFromFile -Label "shared bridge" -PidFile $bridgePidFile
Stop-PidFromFile -Label "shared app-server" -PidFile $appServerPidFile
Stop-PortListeners -Port $port

if ($StopOnly) {
  Write-Host ""
  Write-Host "Stopped. Not starting because -StopOnly was provided."
  exit 0
}

Write-Host ""
Write-Host "Starting npm run shared:start ..."
Set-Location -LiteralPath $ProjectRoot
npm run shared:start
