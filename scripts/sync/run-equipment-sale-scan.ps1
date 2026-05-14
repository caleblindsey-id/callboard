# PM Scheduler - Nightly Equipment-Sale Lead Candidate Scan Runner
# Run this script via Windows Task Scheduler at 5:35 AM daily (after validation at 5:30 AM)

$ErrorActionPreference = "Stop"
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
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
# Run the scan script
# The Python script manages its own log file in logs/scan-equipment-sale-YYYY-MM-DD.log
# ----------------------------------------------------------------
$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$scanScript = Join-Path $scriptDir "scan-equipment-sale-candidates.py"

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting equipment-sale lead candidate scan..."

& $pythonExe $scanScript

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Scan finished with exit code $exitCode (check log for details)."
    exit $exitCode
} else {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Scan completed successfully."
    exit 0
}
