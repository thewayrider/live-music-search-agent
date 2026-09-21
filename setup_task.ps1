$jsonPath = "$PSScriptRoot\configs\schedules.json"

if (-Not (Test-Path $jsonPath)) {
    Write-Host "Error: schedules.json not found at $jsonPath"
    exit 1
}

$schedules = Get-Content $jsonPath | ConvertFrom-Json

foreach ($task in $schedules) {
    $taskName = $task.name
    $scriptPath = "$PSScriptRoot\" + $task.script
    
    # Unregister existing task to prevent duplicate entries or orphaned tasks
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPath`""
    
    # Pass the array of days natively to -DaysOfWeek
    $days = $task.days
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $task.time
    
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName $taskName -Description $task.description -Force | Out-Null
    
    Write-Host "Task '$taskName' registered successfully!"
}

Write-Host "All scheduled tasks successfully registered from schedules.json!"
