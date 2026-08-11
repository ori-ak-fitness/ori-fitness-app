<#
  launch.ps1 - Opens Ori Fitness App as a standalone desktop window.
  (ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 files as ANSI.)

  By default this opens the LIVE published app on GitHub Pages, so the
  desktop window always shows exactly the same version as the phone and
  no local server is needed.

  Use -Local to open the working copy from this folder instead (starts
  serve.ps1 on port 8123). That is for trying out changes before they are
  pushed. Note that the local copy and the live site keep separate data,
  because browsers store data per address.
#>

param(
    [switch]$Local,
    [int]$Port = 8123
)

$liveUrl = "https://ori-ak-fitness.github.io/ori-fitness-app/"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Local) {
    $url = "http://localhost:$Port/"
} else {
    $url = $liveUrl
}

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# ---- 1. local server (only needed for -Local) ----
if ($Local) {
    if (Test-ServerUp) {
        Write-Host "Server already running on port $Port" -ForegroundColor DarkGray
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
            Write-Host "Another program may be using it. Try:  .\launch.ps1 -Local -Port 8081" -ForegroundColor Yellow
            if ([Environment]::UserInteractive) { Read-Host "Press Enter to close" | Out-Null }
            exit 1
        }
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
    Write-Host "Ori Fitness App opened: $url" -ForegroundColor Green
} else {
    Write-Host "Chrome/Edge not found - opening in your default browser instead." -ForegroundColor Yellow
    Start-Process $url
}
