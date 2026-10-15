param([switch]$TestFrontendRecovery)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$reportDir=Join-Path $root 'artifacts\windows-autostart'
function Snapshot {
    $tasks=@(foreach($name in @('DispatchPro-Backend-9010','DispatchPro-Frontend-9005')) {
        $task=Get-ScheduledTask -TaskName $name
        $info=Get-ScheduledTaskInfo -TaskName $name
        [pscustomobject]@{Name=$name;State=[string]$task.State;UserId=$task.Principal.UserId;LogonType=[string]$task.Principal.LogonType;Triggers=@($task.Triggers | ForEach-Object {[pscustomobject]@{Type=$_.CimClass.CimClassName;Delay=$_.Delay}});Settings=$task.Settings | Select-Object RestartCount,RestartInterval,MultipleInstances,ExecutionTimeLimit,StartWhenAvailable;LastTaskResult=$info.LastTaskResult;Action=$task.Actions | Select-Object Execute,Arguments}
        Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $reportDir ($name+'.xml')) -Encoding UTF8
    })
    $ports=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 9005,9010,5050} | Select-Object LocalAddress,LocalPort,OwningProcess)
    $processes=@(foreach($listenerId in @($ports.OwningProcess | Select-Object -Unique)) {
        Get-CimInstance Win32_Process -Filter "ProcessId=$listenerId" | Select-Object ProcessId,ParentProcessId,SessionId,ExecutablePath
    })
    $http=@(foreach($url in @('http://127.0.0.1:9005/office','http://127.0.0.1:9010/health/ready','https://office.nablustaxi.com/office')) {
        try {$r=Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 20;[pscustomobject]@{Url=$url;Status=[int]$r.StatusCode}} catch {[pscustomobject]@{Url=$url;Error=$_.Exception.Message}}
    })
    [pscustomobject]@{Time=(Get-Date -Format o);Boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime;Tasks=$tasks;Ports=$ports;Processes=$processes;Http=$http;Cloudflared=Get-Service Cloudflared | Select-Object Name,Status,StartType;UDP3520=@(Get-NetUDPEndpoint -LocalPort 3520 -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess)}
}
try {
    $before=Snapshot
    $before | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDir 'verification-before.json') -Encoding UTF8
    if($TestFrontendRecovery) {
        $listeners=@(Get-NetTCPConnection -LocalPort 9005 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique)
        if($listeners.Count -ne 1){throw 'Unexpected frontend listener count'}
        $web=Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0])"
        $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($web.ParentProcessId)"
        if($web.CommandLine -notlike '*node_modules*next*start*-p 9005*' -or $parent.CommandLine -notlike '*dispatchpro-background.cjs*frontend*'){throw 'Frontend identity mismatch; no process stopped'}
        Stop-Process -Id $web.ProcessId -Force
        $deadline=(Get-Date).AddSeconds(110)
        $recovered=$false
        do {
            Start-Sleep -Seconds 3
            try {
                $current=@(Get-NetTCPConnection -LocalPort 9005 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
                if($current.Count -eq 1 -and $current[0] -ne $web.ProcessId -and (Invoke-WebRequest 'http://127.0.0.1:9005/office' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200){$recovered=$true;break}
            } catch {}
        } while((Get-Date) -lt $deadline)
        [pscustomobject]@{RecoveryPass=$recovered;OldFrontendPid=$web.ProcessId;NewFrontendPid=$current;BackendPidBefore=@($before.Ports | Where-Object LocalPort -eq 9010).OwningProcess} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDir 'failure-recovery.json') -Encoding UTF8
        if(-not $recovered){throw 'Frontend scheduled restart did not recover within 110 seconds'}
    }
    Snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $reportDir 'verification-after.json') -Encoding UTF8
    exit 0
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $reportDir 'verification-error.txt') -Encoding UTF8
    exit 1
}
