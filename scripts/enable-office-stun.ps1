# Existing voice ICE configuration only; no API build, migration or port change.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$report=Join-Path $root 'artifacts\office-upgrade-20261006'
$configuration=Join-Path $root '.env.local'
$taskName='DispatchPro-Backend-9010'
$previous=[IO.File]::ReadAllText($configuration)
$changed=$false
try {
    $task=Get-ScheduledTask -TaskName $taskName
    if($task.Actions.Arguments -notlike '*dispatchpro-background.cjs*backend*'){throw 'Unexpected backend startup task'}
    if($previous -match '(?m)^Voice__IceServers__'){throw 'Existing ICE configuration requires review; refusing to overwrite it'}
    $webBefore=(Get-NetTCPConnection -LocalPort 9005 -State Listen).OwningProcess
    [IO.File]::WriteAllText($configuration,$previous.TrimEnd()+"`r`n`r`n# WebRTC direct NAT discovery; TURN can be added as a fallback separately.`r`nVoice__IceServers__0__Urls__0=stun:stun.l.google.com:19302`r`n",[Text.UTF8Encoding]::new($false))
    $changed=$true
    Stop-ScheduledTask -TaskName $taskName
    $deadline=(Get-Date).AddSeconds(15)
    do {if(-not(Get-NetTCPConnection -LocalPort 9010 -State Listen -ErrorAction SilentlyContinue)){break};Start-Sleep -Seconds 1}while((Get-Date) -lt $deadline)
    if(Get-NetTCPConnection -LocalPort 9010 -State Listen -ErrorAction SilentlyContinue){throw 'Backend port was not released; refusing a duplicate runtime'}
    Start-ScheduledTask -TaskName $taskName
    $deadline=(Get-Date).AddSeconds(60);$healthy=$false
    do {try{$healthy=(Invoke-WebRequest 'http://127.0.0.1:9010/health/ready' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200}catch{};if($healthy){break};Start-Sleep -Seconds 2}while((Get-Date) -lt $deadline)
    if(-not $healthy){throw 'Backend did not recover'}
    if($webBefore -ne (Get-NetTCPConnection -LocalPort 9005 -State Listen).OwningProcess){throw 'Frontend process changed unexpectedly'}
    'STUN ENABLED; existing API DLL and ports retained; no migration; TURN unavailable' | Set-Content -LiteralPath (Join-Path $report 'stun-result.txt')
    exit 0
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $report 'stun-error.txt')
    if($changed){[IO.File]::WriteAllText($configuration,$previous,[Text.UTF8Encoding]::new($false));Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue}
    exit 1
}
