# CallBoard - Register Synergy Labor Facts Sync in Task Scheduler
# Run once to set up the daily labor-facts job (tech payouts Round 3).

$taskName    = "CallBoard - Labor Facts Sync"
$description = "Daily pull of invoiced service labor per technician per month from SynergyERP into synergy_labor_facts. Feeds the commission report."
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$runScript   = Join-Path $scriptDir "run-labor-facts.ps1"

# Schedule: daily at 5:45 AM. Ordering matters -- synergy-sync runs at 5:00,
# validation at 5:30, the equipment-sale scan at 5:35. This goes last because it
# reads users.synergy_id, which synergy-sync maintains.
#
# Daily rather than monthly on purpose: the sync is idempotent on
# (synergy_id, period, bucket), so re-running the current month refreshes it in
# place. That keeps the in-progress month live for distance-to-next-tier without
# any month-end scramble. The ERP replica lags one day, so the month is only
# final after the first business day of the following month.
$trigger = New-ScheduledTaskTrigger -Daily -At "05:45AM"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File `"$runScript`"" `
    -WorkingDirectory $scriptDir

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

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
    -User $env:USERNAME

Write-Host "Task '$taskName' registered successfully - runs daily at 5:45 AM."
