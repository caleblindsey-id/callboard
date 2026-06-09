# CallBoard - Register the Hourly Product/Inventory Refresh in Task Scheduler
# Run once. Refreshes products.qty_on_hand / qty_on_po every hour, business
# hours, so the parts-queue Review step shows fresh stock numbers. The 5 AM
# nightly run-sync still does the full catalog + customers/contacts.

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

Register-ScheduledTask `
    -TaskName $taskName `
    -Description $description `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -User $env:USERNAME `
    -RunLevel Highest

Write-Host "Task '$taskName' registered - runs hourly, 6 AM to 7 PM."
