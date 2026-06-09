# CallBoard - Hourly Product/Inventory Refresh Runner
# Run via Windows Task Scheduler (hourly, business hours). Refreshes just the
# product catalog incl. qty_on_hand / qty_on_po so the parts-queue Review step
# shows fresh stock numbers, without the heavy nightly customer/contact sync.
# Mirrors run-sync.ps1 (env load + OS-level stdout/stderr redirect) but passes
# --products-only.

$ErrorActionPreference = "Stop"
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# Environment variables - read from repo .env.local (same source as run-sync.ps1
# so key rotations only touch one file).
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

$pythonExe  = "C:\Users\Caleb Lindsey\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$syncScript = Join-Path $scriptDir "synergy-sync.py"
$logFile    = Join-Path $logsDir "inventory-refresh-$(Get-Date -Format 'yyyy-MM-dd').log"

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$header = "$ts Starting hourly product/inventory refresh..."
Write-Host $header
Add-Content -Path $logFile -Value $header

$tmpOut = [System.IO.Path]::GetTempFileName()
$tmpErr = [System.IO.Path]::GetTempFileName()
$proc = Start-Process -FilePath $pythonExe -ArgumentList "`"$syncScript`"", "--products-only" `
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
    $msg = "$ts Inventory refresh finished with exit code $exitCode (check log)."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit $exitCode
} else {
    $msg = "$ts Inventory refresh completed successfully."
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg
    exit 0
}
