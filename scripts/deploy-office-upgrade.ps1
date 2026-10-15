# Activate only the validated web build. Backend, database and tunnel stay unchanged.
$WebOnly=$true
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$report=Join-Path $root 'artifacts\office-upgrade-20261006'
$configuration=Join-Path $root 'artifacts\windows-autostart\runtime.json'
$names=@('DispatchPro-Backend-9010','DispatchPro-Frontend-9005')
if($WebOnly){$names=@('DispatchPro-Frontend-9005')}
$previous=if(Test-Path -LiteralPath $configuration){Get-Content -LiteralPath $configuration -Raw}else{'{"webDist":".next-web-current-20261005","apiDll":"artifacts/voice-backend-current-20261005/api/DispatchPro.Api.dll"}'}
$activated=$false
function Wait-Healthy([string]$url) {
    $deadline=(Get-Date).AddSeconds(120)
    do {try{if((Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200){return}}catch{};Start-Sleep -Seconds 2}while((Get-Date) -lt $deadline)
    throw "Runtime not healthy: $url"
}
try {
    foreach($file in @('.next-office-upgrade-20261006-r6\BUILD_ID','artifacts\office-upgrade-20261006\pwa\sw.js')){if(-not(Test-Path -LiteralPath (Join-Path $root $file))){throw "Prepared build missing: $file"}}
    foreach($name in $names){$task=Get-ScheduledTask -TaskName $name;if($task.Actions.Arguments -notlike '*dispatchpro-background.cjs*'){throw "Unexpected task action: $name"}}
    $protectedBefore=@(Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    $previous | Set-Content -LiteralPath (Join-Path $report 'previous-runtime.json') -Encoding UTF8
    @{webDist='.next-office-upgrade-20261006-r6';apiDll=($previous|ConvertFrom-Json).apiDll} | ConvertTo-Json | Set-Content -LiteralPath $configuration -Encoding UTF8
    $activated=$true
    foreach($name in $names){Stop-ScheduledTask -TaskName $name}
    $deadline=(Get-Date).AddSeconds(15)
    $targetPorts=if($WebOnly){@(9005)}else{@(9005,9010)}
    do {$remaining=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in $targetPorts});if($remaining.Count -eq 0){break};Start-Sleep -Seconds 1}while((Get-Date) -lt $deadline)
    if($remaining.Count -gt 0){throw 'Application ports did not release; no extra process launched'}
    Copy-Item -LiteralPath (Join-Path $report 'pwa\sw.js') -Destination (Join-Path $root 'public\sw.js')
    Get-ChildItem -LiteralPath (Join-Path $report 'pwa') -Filter 'workbox-*.js' | Copy-Item -Destination (Join-Path $root 'public')
    foreach($name in $names){Start-ScheduledTask -TaskName $name}
    Wait-Healthy 'http://127.0.0.1:9010/health/ready'
    Wait-Healthy 'http://127.0.0.1:9005/office/driver-map'
    Wait-Healthy 'https://office.nablustaxi.com/office'
    $protectedAfter=@(Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if(($protectedBefore -join ',') -ne ($protectedAfter -join ',')){throw 'Protected TCP 5050 listener changed'}
    & (Join-Path $PSScriptRoot 'verify-dispatchpro-autostart.ps1')
    Copy-Item -LiteralPath (Join-Path $root 'artifacts\windows-autostart\verification-after.json') -Destination (Join-Path $report 'runtime-verification.json')
    'DEPLOYMENT PASS; existing startup tasks preserved; TCP 5050 unchanged; no migration' | Set-Content -LiteralPath (Join-Path $report 'deployment-result.txt')
    exit 0
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $report 'deployment-error.txt')
    if($activated){
        $previous | Set-Content -LiteralPath $configuration -Encoding UTF8
        foreach($name in $names){Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue}
        Start-Sleep -Seconds 3
        foreach($name in $names){Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue}
    }
    exit 1
}
