<#
  launch.ps1 - Opens Ori Fitness App as a standalone desktop window.
  (ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI.)

  What it does:
    1. Starts the local server (serve.ps1) if it is not already running.
    2. Opens the app in Chrome/Edge "app mode" - a clean window with no
       tabs and no address bar, so it looks and feels like a real app.

  Normally launched by double-clicking "Ori Fitness.cmd".
#>

# Port 8123 belongs to YOUR app window only.
# Claude's own testing uses 8080, so the two can never show up at the same
# time or share state - that is what caused the "app opens twice" confusion.
param([int]$Port = 8123)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:$Port/"

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# ---- 1. server ----
if (Test-ServerUp) {
    Write-Host "Server already running on $url" -ForegroundColor DarkGray
} else {
    Write-Host "Starting local server..." -ForegroundColor Green
    $serve = Join-Path $root "serve.ps1"
    # The path contains spaces ("Ori Fitness App"), so it must be quoted here -
    # Start-Process does not quote array arguments for us.
    Start-Process -FilePath "powershell" `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`" -Port $Port" `
        -WindowStyle Hidden

    $ready = $false
    foreach ($i in 1..25) {
        Start-Sleep -Milliseconds 300
        if (Test-ServerUp) { $ready = $true; break }
    }
    if (-not $ready) {
        Write-Host "Could not start the server on port $Port." -ForegroundColor Red
        Write-Host "Another program may be using it. Try:  .\launch.ps1 -Port 8081" -ForegroundColor Yellow
        if ([Environment]::UserInteractive) { Read-Host "Press Enter to close" | Out-Null }
        exit 1
    }
}

# ---- 2. browser in app mode ----
$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
    # --app gives a clean window: no tabs, no address bar.
    # A separate profile folder keeps this window independent of your normal browsing.
    $profileDir = Join-Path $env:LOCALAPPDATA "OriFitnessApp\browser-profile"
    Start-Process -FilePath $browser -ArgumentList @(
        "--app=$url",
        "--user-data-dir=`"$profileDir`"",
        "--window-size=430,860"
    )
    Write-Host "Ori Fitness App opened." -ForegroundColor Green
} else {
    Write-Host "Chrome/Edge not found - opening in your default browser instead." -ForegroundColor Yellow
    Start-Process $url
}
