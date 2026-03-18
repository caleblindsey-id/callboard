# PM Scheduler — Nightly Sync Runner
# Run this script via Windows Task Scheduler at 5:00 AM daily
#
# Setup: edit the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values below,
# or set them as Windows System Environment Variables and remove the lines here.

$ErrorActionPreference = "Stop"
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# ----------------------------------------------------------------
# Create logs directory if it doesn't exist
# ----------------------------------------------------------------
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# ----------------------------------------------------------------
# Environment variables
# Edit these values, or set them as Windows System Environment
# Variables and remove these two lines.
# ----------------------------------------------------------------
$env:SUPABASE_URL              = "https://YOUR_PROJECT_ID.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"

# ----------------------------------------------------------------
# Run the sync script
# ----------------------------------------------------------------
$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$syncScript = Join-Path $scriptDir "synergy-sync.py"
$logFile    = Join-Path $logsDir "sync-$(Get-Date -Format 'yyyy-MM-dd').log"

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting PM Scheduler nightly sync..." | Tee-Object -FilePath $logFile -Append

& $pythonExe $syncScript 2>&1 | Tee-Object -FilePath $logFile -Append

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sync finished with exit code $exitCode (check log for details)." | Tee-Object -FilePath $logFile -Append
    exit $exitCode
} else {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sync completed successfully." | Tee-Object -FilePath $logFile -Append
    exit 0
}
