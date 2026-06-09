# CallBoard - Register the On-Demand Re-Check Queue Drainer in Task Scheduler
# Run once as administrator. Drains revalidation_queue every 2 min, 6 AM-7 PM.

$taskName    = "CallBoard - Drain Revalidation Queue"
$description = "Drains on-demand Synergy re-check requests enqueued by the hosted app (revalidation_queue). Runs every 2 min during business hours."
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$runScript   = Join-Path $scriptDir "run-drain-queue.ps1"

# Trigger: daily at 6:00 AM, repeating every 2 min for 13 hours (until ~7:00 PM).
# PS 5.1 idiom: build a one-time repeating trigger and graft its Repetition onto
# a daily trigger.
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00AM"
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "06:00AM" `
    -RepetitionInterval (New-TimeSpan -Minutes 2) `
    -RepetitionDuration (New-TimeSpan -Hours 13)).Repetition

# Launch via a hidden VBS shim (wscript window style 0) so no console window
# flashes on the desktop every 2 min. The shim runs run-drain-queue.ps1, which
# keeps the interactive full-network token needed for the ERP query.
# Quote the path - it lives under "C:\Users\Caleb Lindsey\..." (space).
$vbsLauncher = Join-Path $scriptDir "run-drain-queue-hidden.vbs"
$action = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsLauncher`"" `
    -WorkingDirectory $scriptDir

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

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

Write-Host "Task '$taskName' registered - runs every 2 min, 6 AM to 7 PM."
