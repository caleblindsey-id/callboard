# PM Scheduler - Nightly Sync Runner
# Run this script via Windows Task Scheduler at 5:00 AM daily
#
# Setup: edit the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values below,
# or set them as Windows System Environment Variables and remove the lines here.

$ErrorActionPreference = "Stop"
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
# Two parents up: scripts/sync -> scripts -> callboard root. Previous one-level
# resolution wrote wrapper log lines to callboard/scripts/logs/ while the
# Python child wrote to callboard/logs/ - two split log dirs for one job.
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

# ----------------------------------------------------------------
# Create logs directory if it doesn't exist
# ----------------------------------------------------------------
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# ----------------------------------------------------------------
# Environment variables - read from repo .env.local so key rotations
# only need to touch one file. Supabase disabled legacy JWT keys on
# 2026-05-13; .env.local holds the new sb_secret_ key.
# ----------------------------------------------------------------
$envFile = Join-Path $projectRoot ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Error "Missing .env.local at $envFile - cannot load Supabase credentials."
    exit 1
}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$') {
        Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
    }
}
if (-not $env:SUPABASE_URL -and $env:NEXT_PUBLIC_SUPABASE_URL) {
    $env:SUPABASE_URL = $env:NEXT_PUBLIC_SUPABASE_URL
}
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Error "SUPABASE_SERVICE_ROLE_KEY not found in .env.local."
    exit 1
}

# ----------------------------------------------------------------
# Run the sync script
# ----------------------------------------------------------------
$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$syncScript = Join-Path $scriptDir "synergy-sync.py"
$logFile    = Join-Path $logsDir "sync-$(Get-Date -Format 'yyyy-MM-dd').log"

# Capture Python's combined stdout/stderr into temp files via OS-level
# redirection, then append to the day log. Avoids Windows PowerShell 5.1's
# Tee-Object handle-release race when two Tees touch the same file in one
# script.
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$header = "$ts Starting PM Scheduler nightly sync..."
Write-Host $header
Add-Content -Path $logFile -Value $header

$tmpOut = [System.IO.Path]::GetTempFileName()
$tmpErr = [System.IO.Path]::GetTempFileName()
$proc = Start-Process -FilePath $pythonExe -ArgumentList "`"$syncScript`"" `
    -RedirectStandardOutput $tmpOut `
    -RedirectStandardError $tmpErr `
    -NoNewWindow -Wait -PassThru
$exitCode = $proc.ExitCode

foreach ($tmp in @($tmpOut, $tmpErr)) {
    if (Test-Path $tmp) {
        $content = Get-Content $tmp -Raw
        if ($content) {
            Write-Host -NoNewline $content
            Add-Content -Path $logFile -Value $content -NoNewline
        }
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
}

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
if ($exitCode -ne 0) {
    $msg = "$ts Sync finished with exit code $exitCode (check log for details)."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit $exitCode
} else {
    $msg = "$ts Sync completed successfully."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit 0
}
