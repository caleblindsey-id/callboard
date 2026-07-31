# CallBoard - Synergy Labor Facts Sync Runner (tech payouts Round 3)
#
# Pulls invoiced service labor per technician per month out of SynergyERP into
# public.synergy_labor_facts. Round 4 turns those rows into payout_lines.
#
# Schedule via Windows Task Scheduler, daily at 5:45 AM (after synergy-sync at
# 5:00 and the equipment-sale scan at 5:35). Re-running an open month refreshes
# rather than doubles, so a daily cadence keeps the current month live and
# costs nothing.
#
# The ERP replica lags one day, so a month is only final after the first
# business day of the following month -- which is also when the written
# commission plan says the month is calculated. The default run covers the
# CURRENT month; pass -Months to backfill.
#
# Usage:
#   .\run-labor-facts.ps1                # current month
#   .\run-labor-facts.ps1 -Period 2026-06
#   .\run-labor-facts.ps1 -Months 6      # last 6 months, oldest first
#   .\run-labor-facts.ps1 -DryRun

param(
    [string]$Period,
    [int]$Months,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

# ----------------------------------------------------------------
# Logs directory
# ----------------------------------------------------------------
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# ----------------------------------------------------------------
# Environment - read from repo .env.local so key rotations only touch one file.
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
# Run
# The Python script manages its own log at logs/labor-facts-YYYY-MM-DD.log
# ----------------------------------------------------------------
$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$syncScript = Join-Path $scriptDir "sync-labor-facts.py"

$syncArgs = @()
if ($Period) { $syncArgs += @("--period", $Period) }
if ($Months) { $syncArgs += @("--months", $Months) }
if ($DryRun) { $syncArgs += "--dry-run" }

Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting Synergy labor facts sync..."

& $pythonExe $syncScript @syncArgs

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sync finished with exit code $exitCode (check log for details)."
    exit $exitCode
} else {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Sync completed successfully."
    exit 0
}
