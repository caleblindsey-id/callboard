# CallBoard - Register the Hourly Product/Inventory Refresh in Task Scheduler
#
# DELIBERATELY NOT INSTALLED. Read this before running it.
#
# The task this registers runs synergy-sync.py --products-only, whose two steps
# (sync_products + sync_po_lines) are BOTH already part of the 5 AM nightly
# "CallBoard - Nightly Synergy Sync". And Synergy's source data is rebuilt by an
# overnight batch, so nothing it reads changes during the day - an hourly run
# re-reads and re-upserts ~2,600 unchanged rows, 13x a day, for no new data.
#
# It was registered once on 2026-09-02 and removed the same day for exactly that
# reason. Only install it if Synergy starts refreshing intraday - at which point
# fix the interval to match that cadence rather than defaulting to hourly.
#
# MUST be run elevated: Register-ScheduledTask -RunLevel Highest returns
# "Access is denied" otherwise. Right-click -> Run as administrator.

$ErrorActionPreference = "Stop"

$taskName    = "CallBoard - Inventory Refresh"
$description = "Hourly product/inventory refresh (qty_on_hand / qty_on_po) for the parts-queue Review step. Runs every hour, 6 AM-7 PM."
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path

# Trigger: daily at 6:00 AM, repeating every 1 hour for 13 hours (until ~7 PM).
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00AM"
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "06:00AM" `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 13)).Repetition

# Launch via a hidden VBS shim (wscript window style 0) so no console window
# flashes hourly. The shim runs run-inventory-refresh.ps1, which keeps the
# interactive full-network token needed for the ERP query.
# Quote the path - it lives under "C:\Users\Caleb Lindsey\..." (space).
$vbsLauncher = Join-Path $scriptDir "run-inventory-refresh-hidden.vbs"
$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsLauncher`"" `
    -WorkingDirectory $scriptDir

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing task '$taskName'."
}

# Registration failure used to be invisible: without -ErrorAction Stop the
# CimException was printed and the script carried on to announce success, so a
# non-elevated run reported "registered" directly underneath "Access is denied".
# That is how this task sat uninstalled without anyone noticing.
try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Description $description `
        -Trigger $trigger `
        -Action $action `
        -Settings $settings `
        -User $env:USERNAME `
        -RunLevel Highest `
        -ErrorAction Stop | Out-Null
} catch {
    Write-Error "Failed to register '$taskName': $($_.Exception.Message)"
    Write-Host "If this says 'Access is denied', re-run elevated: right-click -> Run as administrator." -ForegroundColor Yellow
    exit 1
}

# Confirm it is actually there rather than trusting the call returned.
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    Write-Error "'$taskName' is not present after registration."
    exit 1
}

Write-Host "Task '$taskName' registered - runs hourly, 6 AM to 7 PM." -ForegroundColor Green
