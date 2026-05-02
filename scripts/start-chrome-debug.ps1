param(
  [int]$Port = 9222,
  [string]$UserDataDir = "$env:TEMP\chrome-cdp-profile",
  [string]$ChromePath = ""
)

$ErrorActionPreference = "Stop"

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

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$UserDataDir",
  "about:blank"
)

Write-Host "Started Chrome CDP on http://localhost:$Port using profile $UserDataDir"
