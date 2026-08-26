# CallBoard - Register the Purchasing/Reorder Inventory Sync in Task Scheduler
#
# NOT YET INTENDED TO BE RUN - scheduling for the Purchasing/Reorder module is
# finalized later (see docs/superpowers/plans/2026-07-14-purchasing-reorder-module.md).
# The nightly full sync (run-sync.ps1) already calls the same three sync
# functions, so this standalone schedule is only needed if the inventory feed
# should refresh more often than nightly. Mirrors setup-inventory-refresh-task.ps1.
#
# Run once (when ready): populates inv_reorder / inv_vendors / inv_bins
# (Whse 4) on its own cadence, independent of the nightly customer/product sync.

$taskName    = "CallBoard - Inventory Reorder Sync"
$description = "Purchasing/Reorder inventory feed (inv_reorder / inv_vendors / inv_bins, Whse 4) for the reorder-walk module."
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path

# Trigger placeholder - hourly during business hours, same cadence as the
# product refresh. Adjust once the module's actual freshness needs are known.
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00AM"
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "06:00AM" `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Hours 13)).Repetition

# Launch via a hidden VBS shim (wscript window style 0) so no console window
# flashes. The shim runs run-inventory-reorder.ps1, which keeps the
# interactive full-network token needed for the ERP query.
# Quote the path - it lives under "C:\Users\Caleb Lindsey\..." (space).
$vbsLauncher = Join-Path $scriptDir "run-inventory-reorder-hidden.vbs"
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

Write-Host "Task '$taskName' registered."
