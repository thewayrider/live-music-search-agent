# Self-elevate to Administrator to ensure Unregister-ScheduledTask has permissions
if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Elevating to Administrator to disable Desktop background tasks..."
    Start-Process PowerShell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$PSScriptRoot'; & '$PSCommandPath'`""
    exit
}

Write-Host "============================================================"
Write-Host "Disabling / Unregistering Scheduled Tasks on Desktop PC..."
Write-Host "============================================================"

$taskNames = @(
    "LiveMusicSearchAgent",
    "LiveMusicSearchAgent_AcidStag",
    "LiveMusicSearchAgent_AirCharts",
    "LiveMusicSearchAgent_Amrap",
    "LiveMusicSearchAgent_Deezer",
    "LiveMusicSearchAgent_Futuremag",
    "LiveMusicSearchAgent_ListenBrainz",
    "LiveMusicSearchAgent_MusicBrainz",
    "LiveMusicSearchAgent_RootsMag",
    "LiveMusicSearchAgent_Nialler9",
    "Triple J API Crawler",
    "Triple J Unearthed Crawler",
    "Triple J Weekly Reminder"
)

foreach ($name in $taskNames) {
    $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "[-] Unregistered task: $name"
    } else {
        Write-Host "[.] Task not present: $name"
    }
}

Write-Host "`nAll background crawler tasks on this Desktop PC have been removed."
Write-Host "Your 24/7 Always-On Mini PC remains the sole runner for Task Scheduler jobs."
