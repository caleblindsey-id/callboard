# CallBoard - On-Demand Re-Check Queue Drainer
# Runs every ~2 min via Windows Task Scheduler during business hours. Drains
# pending re-check requests that the hosted app enqueued in revalidation_queue
# (the hosted Vercel app can't run the validator itself - no Python/ODBC/LAN).

$ErrorActionPreference = "Stop"
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
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
# only need to touch one file (same loader as run-validation.ps1).
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
# Run the validator in drain mode
# ----------------------------------------------------------------
$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$valScript  = Join-Path $scriptDir "validate-synergy-orders.py"
$logFile    = Join-Path $logsDir "drain-queue-$(Get-Date -Format 'yyyy-MM-dd').log"

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$header = "$ts Draining revalidation queue..."
Write-Host $header
Add-Content -Path $logFile -Value $header

# OS-level redirection into temp files, then append to the day log - avoids the
# PowerShell 5.1 Tee-Object handle race (same pattern as run-validation.ps1).
$tmpOut = [System.IO.Path]::GetTempFileName()
$tmpErr = [System.IO.Path]::GetTempFileName()
$proc = Start-Process -FilePath $pythonExe -ArgumentList "`"$valScript`"", "--drain-queue" `
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
    $msg = "$ts Drain finished with exit code $exitCode (check log for details)."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit $exitCode
} else {
    $msg = "$ts Drain completed."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit 0
}
