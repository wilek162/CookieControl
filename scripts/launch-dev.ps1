param(
  [string]$Browser = ""
)

# Resolve extension root (parent of scripts dir)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtPath = Split-Path -Parent $ScriptDir

# Find a Chromium-based browser if not specified
$Candidates = @()
if ([string]::IsNullOrWhiteSpace($Browser)) {
  $Candidates += @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  )
} else {
  $Candidates += $Browser
}

$BrowserPath = $null
foreach ($c in $Candidates) {
  if (Test-Path $c) { $BrowserPath = $c; break }
}

if (-not $BrowserPath) {
  Write-Error "Could not find Chrome/Edge. Pass -Browser <path-to-chrome.exe>."
  exit 1
}

# Use isolated user data dir so we don't affect the default profile
$ProfileDir = Join-Path $env:TEMP "cookiecontrol-dev-profile"
if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Path $ProfileDir | Out-Null }

$Args = @(
  "--user-data-dir=$ProfileDir",
  "--disable-extensions-except=$ExtPath",
  "--load-extension=$ExtPath",
  "about:blank"
)

Write-Host "Launching: $BrowserPath $($Args -join ' ')"
Start-Process -FilePath $BrowserPath -ArgumentList $Args
