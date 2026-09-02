# Task 1: Main Crawlers
$taskName = "LiveMusicSearchAgent"
$scriptPath = "$PSScriptRoot\run_crawlers.bat"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Wednesday, Friday, Saturday -At 9:00AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName $taskName -Description "Runs the Live Music Search Agent on Mon/Wed/Fri/Sat at 9AM" -Force
Write-Host "Task '$taskName' registered successfully!"

# Task 2: Air Charts Crawler
$taskNameAir = "LiveMusicSearchAgent_AirCharts"
$scriptPathAir = "$PSScriptRoot\run_air_charts.bat"
$actionAir = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAir`""
$triggerAir = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 4:00PM
Register-ScheduledTask -Action $actionAir -Trigger $triggerAir -TaskName $taskNameAir -Description "Runs the Air Charts Crawler on Monday at 16:00" -Force
Write-Host "Task '$taskNameAir' registered successfully!"

# Task 3: AMRAP Crawler
$taskNameAmrap = "LiveMusicSearchAgent_Amrap"
$scriptPathAmrap = "$PSScriptRoot\run_amrap.bat"
$actionAmrap = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAmrap`""
$triggerAmrap = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 4:00PM
Register-ScheduledTask -Action $actionAmrap -Trigger $triggerAmrap -TaskName $taskNameAmrap -Description "Runs the AMRAP Crawler on Thursday at 16:00" -Force
Write-Host "Task '$taskNameAmrap' registered successfully!"

# Task 4: Acid Stag Crawler
$taskNameAcidStag = "LiveMusicSearchAgent_AcidStag"
$scriptPathAcidStag = "$PSScriptRoot\run_acid_stag.bat"
$actionAcidStag = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAcidStag`""
$triggerAcidStag = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 4:00PM
Register-ScheduledTask -Action $actionAcidStag -Trigger $triggerAcidStag -TaskName $taskNameAcidStag -Description "Runs the Acid Stag Crawler on Friday at 16:00" -Force
Write-Host "Task '$taskNameAcidStag' registered successfully!"
