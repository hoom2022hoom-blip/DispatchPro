$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
try {
    foreach($name in @('DispatchPro-Backend-9010','DispatchPro-Frontend-9005')) {
        $task=Get-ScheduledTask -TaskName $name
        $boot=New-ScheduledTaskTrigger -AtStartup
        $boot.Delay='PT30S'
        $watchdog=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
        Set-ScheduledTask -TaskName $name -Trigger @($boot,$watchdog) | Out-Null
        Start-ScheduledTask -TaskName $name
    }
    & (Join-Path $PSScriptRoot 'verify-dispatchpro-autostart.ps1')
    exit $LASTEXITCODE
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'artifacts\windows-autostart\finalization-error.txt')
    exit 1
}
