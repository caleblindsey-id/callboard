# WrenchDesk — Register Synergy Order Validation in Task Scheduler
# Run once as administrator to set up the nightly validation job.

$taskName       = "WrenchDesk - Validate Synergy Orders"
$legacyTaskName = "PM Scheduler - Validate Synergy Orders"
$description = "Nightly validation of service ticket Synergy order numbers against ERP (roh table)"
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$runScript   = Join-Path $scriptDir "run-validation.ps1"

# Clean up legacy task from the pre-rename era if present
$legacy = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy task '$legacyTaskName'." -ForegroundColor Yellow
}

# Schedule: daily at 5:30 AM (30 min after the nightly sync)
$trigger = New-ScheduledTaskTrigger -Daily -At "05:30AM"

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
    -User $env:USERNAME `
    -RunLevel Highest

Write-Host "Task '$taskName' registered successfully — runs daily at 5:30 AM."
