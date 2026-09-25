$json = '[{"days": ["Monday", "Wednesday"]}]'; $schedules = $json | ConvertFrom-Json; foreach ($t in $schedules) { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $t.days -At '09:00AM' }
