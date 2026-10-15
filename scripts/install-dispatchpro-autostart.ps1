$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$launcher = Join-Path $PSScriptRoot 'dispatchpro-background.cjs'
foreach ($required in @($nodeExe,$launcher,(Join-Path $projectRoot '.next-web-current-20261005\BUILD_ID'),(Join-Path $projectRoot 'artifacts\voice-backend-current-20261005\api\DispatchPro.Api.dll'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required runtime missing: $required" }
}
foreach ($role in @('backend','frontend')) {
    $taskName = if ($role -eq 'backend') { 'DispatchPro-Backend-9010' } else { 'DispatchPro-Frontend-9005' }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "Task already exists: $taskName; review before replacing" }
    $action = New-ScheduledTaskAction -Execute $nodeExe -Argument ('"'+$launcher+'" '+$role) -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = 'PT30S'
    # Also recover a stopped supervisor even when Scheduler's failure retry is not delivered.
    $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -Hidden -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger,$watchdog) -Settings $settings -Principal $principal -Description 'Existing DispatchPro runtime; hidden SYSTEM startup, dependency wait, single instance and restart on failure.' | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Started $taskName"
}
