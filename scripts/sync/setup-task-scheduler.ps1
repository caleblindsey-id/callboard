# WrenchDesk — Register nightly sync in Windows Task Scheduler
# RIGHT-CLICK this file and select "Run as administrator"

$taskName = "WrenchDesk - Nightly Synergy Sync"
$legacyTaskName = "PM Scheduler - Nightly Synergy Sync"
$scriptPath = "$PSScriptRoot\run-sync.ps1"

# Clean up legacy task from the pre-rename era if present
$legacy = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy task '$legacyTaskName'." -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "05:00AM"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "Runs daily at 5:00 AM. Logs written to: $PSScriptRoot\..\..\logs\"
Write-Host ""
Pause
