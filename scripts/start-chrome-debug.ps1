[CmdletBinding()]
param(
  [ValidateSet("interactive", "stable", "headless")]
  [string]$Mode = "stable",

  [int]$Port = 9222,

  [string]$RemoteDebuggingAddress = "127.0.0.1",

  [string]$UserDataDir = "$env:TEMP\chrome-cdp-$Mode-profile",

  [string]$ChromePath = "",

  [int]$WindowWidth = 1400,

  [int]$WindowHeight = 1000,

  [string[]]$ExtraArgs = @(),

  [int]$ReadyTimeoutSeconds = 10,

  [switch]$ReuseExisting,

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$lockPath = Join-Path $env:TEMP "chrome-cdp-$Port-start.lock"
$lockStream = $null

try {
  $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  throw "Another Chrome CDP startup is already running for port $Port. Wait for it to finish, then retry."
}

try {
$candidatePaths = @(@(
  $ChromePath,
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) })

if (-not $candidatePaths) {
  throw "Chrome executable was not found. Pass -ChromePath with the full path to chrome.exe."
}

$chrome = $candidatePaths[0]
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

$commonArgs = @(
  "--remote-debugging-port=$Port",
  "--remote-debugging-address=$RemoteDebuggingAddress",
  "--user-data-dir=$UserDataDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=$WindowWidth,$WindowHeight"
)

$modeArgs = switch ($Mode) {
  "interactive" {
    @(
      "--new-window"
    )
  }
  "stable" {
    @(
      "--new-window",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-features=CalculateNativeWinOcclusion"
    )
  }
  "headless" {
    @(
      "--headless=new"
    )
  }
}

$arguments = @(
  $commonArgs
  $modeArgs
  $ExtraArgs
  "about:blank"
)

function Format-ChromeArgument {
  param([string]$Argument)

  if ($Argument -notmatch "\s") {
    return $Argument
  }

  '"' + ($Argument -replace '"', '\"') + '"'
}

function Resolve-ProbeHost {
  param([string]$Address)

  if ($Address -eq "0.0.0.0" -or $Address -eq "::") {
    return "127.0.0.1"
  }

  return $Address
}

function Wait-ChromeDebugEndpoint {
  param(
    [string]$Address,
    [int]$Port,
    [int]$TimeoutSeconds
  )

  $probeHost = Resolve-ProbeHost $Address
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $url = "http://$probeHost`:$Port/json/version"

  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null
      return $url
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }

  throw "Chrome DevTools endpoint did not become reachable within ${TimeoutSeconds}s: $url"
}

function Get-DebugPortListeners {
  param([int]$Port)

  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    return @()
  }

  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Format-ListenerSummary {
  param($Listeners)

  $Listeners |
    Select-Object LocalAddress, LocalPort, OwningProcess |
    ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess)" }
}

if ($DryRun) {
  Write-Host "Chrome path: $chrome"
  Write-Host "Mode: $Mode"
  Write-Host "CDP endpoint: http://$RemoteDebuggingAddress`:$Port"
  Write-Host "User data dir: $UserDataDir"
  Write-Host "Arguments:"
  $arguments | ForEach-Object { Write-Host "  $_" }
  exit 0
}

$existingListeners = @(Get-DebugPortListeners $Port)
if ($existingListeners.Count -gt 0) {
  $summary = Format-ListenerSummary $existingListeners

  if ($ReuseExisting) {
    $readyUrl = Wait-ChromeDebugEndpoint $RemoteDebuggingAddress $Port $ReadyTimeoutSeconds
    Write-Host "Reusing existing Chrome CDP endpoint on port $Port"
    Write-Host "Listeners: $($summary -join ', ')"
    Write-Host "Ready probe: $readyUrl"
    exit 0
  }

  throw "Port $Port is already listening ($($summary -join ', ')). Close that Chrome instance, choose another -Port, or pass -ReuseExisting to attach to the existing endpoint instead of launching another Chrome."
}

$process = Start-Process -FilePath $chrome -ArgumentList ($arguments | ForEach-Object { Format-ChromeArgument $_ }) -PassThru

$readyUrl = Wait-ChromeDebugEndpoint $RemoteDebuggingAddress $Port $ReadyTimeoutSeconds

Write-Host "Started Chrome CDP on http://$RemoteDebuggingAddress`:$Port using profile $UserDataDir"
Write-Host "Ready probe: $readyUrl"
Write-Host "Mode: $Mode"
Write-Host "Launcher PID: $($process.Id)"
} finally {
  if ($lockStream) {
    $lockStream.Dispose()
  }
}
