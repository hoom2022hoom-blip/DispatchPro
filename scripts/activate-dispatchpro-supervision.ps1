$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
try {
    # Terminate only the old supervisor, preserving its existing API child.
    $backend=Get-NetTCPConnection -LocalPort 9010 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique
    $api=Get-CimInstance Win32_Process -Filter "ProcessId=$backend"
    $supervisor=Get-CimInstance Win32_Process -Filter "ProcessId=$($api.ParentProcessId)"
    if($supervisor.CommandLine -notlike '*dispatchpro-background.cjs*backend*'){throw 'Unexpected backend supervisor; no process stopped'}
    Stop-Process -Id $supervisor.ProcessId -Force
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName 'DispatchPro-Backend-9010'
    Start-ScheduledTask -TaskName 'DispatchPro-Frontend-9005'
    Start-Sleep -Seconds 12
    & (Join-Path $PSScriptRoot 'verify-dispatchpro-autostart.ps1') -TestFrontendRecovery
    exit $LASTEXITCODE
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'artifacts\windows-autostart\activation-error.txt')
    exit 1
}
