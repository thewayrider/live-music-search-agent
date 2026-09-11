# Task 1: Main Crawlers
$taskName = "LiveMusicSearchAgent"
$scriptPath = "$PSScriptRoot\run_crawlers.bat"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Wednesday, Friday, Saturday -At 9:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -TaskName $taskName -Description "Runs the Live Music Search Agent on Mon/Wed/Fri/Sat at 9AM" -Force
Write-Host "Task '$taskName' registered successfully!"

# Task 2: Air Charts Crawler
$taskNameAir = "LiveMusicSearchAgent_AirCharts"
$scriptPathAir = "$PSScriptRoot\run_air_charts.bat"
$actionAir = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAir`""
$triggerAir = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 4:00PM
$settingsAir = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionAir -Trigger $triggerAir -Settings $settingsAir -TaskName $taskNameAir -Description "Runs the Air Charts Crawler on Monday at 16:00" -Force
Write-Host "Task '$taskNameAir' registered successfully!"

# Task 3: AMRAP Crawler
$taskNameAmrap = "LiveMusicSearchAgent_Amrap"
$scriptPathAmrap = "$PSScriptRoot\run_amrap.bat"
$actionAmrap = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAmrap`""
$triggerAmrap = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 4:00PM
$settingsAmrap = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionAmrap -Trigger $triggerAmrap -Settings $settingsAmrap -TaskName $taskNameAmrap -Description "Runs the AMRAP Crawler on Thursday at 16:00" -Force
Write-Host "Task '$taskNameAmrap' registered successfully!"

# Task 4: Acid Stag Crawler
$taskNameAcidStag = "LiveMusicSearchAgent_AcidStag"
$scriptPathAcidStag = "$PSScriptRoot\run_acid_stag.bat"
$actionAcidStag = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathAcidStag`""
$triggerAcidStag = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 4:00PM
$settingsAcidStag = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionAcidStag -Trigger $triggerAcidStag -Settings $settingsAcidStag -TaskName $taskNameAcidStag -Description "Runs the Acid Stag Crawler on Friday at 16:00" -Force
Write-Host "Task '$taskNameAcidStag' registered successfully!"


# Task 7: Triple J API Crawler
$taskNameTripleJ = "Triple J API Crawler"
$scriptPathTripleJ = "$PSScriptRoot\run_triplej.bat"
$actionTripleJ = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathTripleJ`""
$triggerTripleJ = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Wednesday, Friday -At 12:00PM
$settingsTripleJ = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionTripleJ -Trigger $triggerTripleJ -Settings $settingsTripleJ -TaskName $taskNameTripleJ -Description "Runs the Triple J API Crawler on Mon, Wed, Fri at 12:00" -Force
Write-Host "Task '$taskNameTripleJ' registered successfully!"

# Task 8: Triple J Unearthed Crawler
$taskNameTripleJUnearthed = "Triple J Unearthed Crawler"
$scriptPathTripleJUnearthed = "$PSScriptRoot\run_triplej_unearthed.bat"
$actionTripleJUnearthed = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathTripleJUnearthed`""
$triggerTripleJUnearthed = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Wednesday, Friday -At 2:00PM
$settingsTripleJUnearthed = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionTripleJUnearthed -Trigger $triggerTripleJUnearthed -Settings $settingsTripleJUnearthed -TaskName $taskNameTripleJUnearthed -Description "Runs the Triple J Unearthed Crawler on Mon, Wed, Fri at 14:00" -Force
Write-Host "Task '$taskNameTripleJUnearthed' registered successfully!"

# Task 9: Futuremag Crawler
$taskNameFuturemag = "LiveMusicSearchAgent_Futuremag"
$scriptPathFuturemag = "$PSScriptRoot\run_futuremag.bat"
$actionFuturemag = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathFuturemag`""
$triggerFuturemag = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 9:00AM
$settingsFuturemag = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionFuturemag -Trigger $triggerFuturemag -Settings $settingsFuturemag -TaskName $taskNameFuturemag -Description "Runs the Futuremag Crawler on Friday at 09:00" -Force
Write-Host "Task '$taskNameFuturemag' registered successfully!"

# Task 10: Roots Mag Crawler
$taskNameRootsMag = "LiveMusicSearchAgent_RootsMag"
$scriptPathRootsMag = "$PSScriptRoot\run_roots_mag.bat"
$actionRootsMag = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$scriptPathRootsMag`""
$triggerRootsMag = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 9:00AM
$settingsRootsMag = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -Action $actionRootsMag -Trigger $triggerRootsMag -Settings $settingsRootsMag -TaskName $taskNameRootsMag -Description "Runs the Roots Mag Crawler on Friday at 09:00" -Force
Write-Host "Task '$taskNameRootsMag' registered successfully!"
