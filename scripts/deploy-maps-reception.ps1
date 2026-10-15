$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$report=Join-Path $root 'artifacts\maps-reception-20261006'
$config=Join-Path $root 'artifacts\windows-autostart\runtime.json'
$dist='.next-maps-reception-20261006-live'
$taskName='DispatchPro-Frontend-9005'
$previous=Get-Content -LiteralPath $config -Raw
$activated=$false
function Protected-State {
 @((Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(9010,5050,3520)} | ForEach-Object {"$($_.LocalPort):$($_.OwningProcess)"}) + (Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object {"tunnel:$($_.Id)"})) | Sort-Object -Unique
}
function Wait-Healthy([string]$url) {
 $deadline=(Get-Date).AddSeconds(120)
 do {try{if((Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200){return}}catch{};Start-Sleep -Seconds 2}while((Get-Date) -lt $deadline)
 throw "Runtime not healthy: $url"
}
try {
 foreach($file in @("$dist\BUILD_ID",'artifacts\maps-reception-20261006\pwa-live\sw.js')){if(-not(Test-Path -LiteralPath (Join-Path $root $file))){throw "Prepared build missing: $file"}}
 $task=Get-ScheduledTask -TaskName $taskName
 if($task.Actions.Arguments -notlike '*dispatchpro-background.cjs*'){throw 'Unexpected frontend task action'}
 $protectedBefore=@(Protected-State)
 $previous | Set-Content -LiteralPath (Join-Path $report 'activation-previous-runtime.json') -Encoding UTF8
 $pwaBackup=Join-Path $report 'activation-previous-pwa'
 New-Item -ItemType Directory -Path $pwaBackup -Force | Out-Null
 Get-ChildItem -LiteralPath (Join-Path $root 'public') -File | Where-Object {$_.Name -eq 'sw.js' -or $_.Name -like 'workbox-*.js'} | Copy-Item -Destination $pwaBackup
 $next=$previous|ConvertFrom-Json;$next.webDist=$dist
 $next | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
 $activated=$true
 Stop-ScheduledTask -TaskName $taskName
 $deadline=(Get-Date).AddSeconds(20)
 do {$remaining=@(Get-NetTCPConnection -LocalPort 9005 -State Listen -ErrorAction SilentlyContinue);if($remaining.Count -eq 0){break};Start-Sleep -Seconds 1}while((Get-Date) -lt $deadline)
 if($remaining.Count -gt 0){throw '9005 did not release; no extra process launched'}
 Copy-Item -LiteralPath (Join-Path $report 'pwa-live\sw.js') -Destination (Join-Path $root 'public\sw.js')
 Get-ChildItem -LiteralPath (Join-Path $report 'pwa-live') -Filter 'workbox-*.js' | Copy-Item -Destination (Join-Path $root 'public')
 Start-ScheduledTask -TaskName $taskName
 Wait-Healthy 'http://127.0.0.1:9005/office/orders'
 Wait-Healthy 'http://127.0.0.1:9005/office/driver-map'
 Wait-Healthy 'http://127.0.0.1:9010/health/ready'
 $protectedAfter=@(Protected-State)
 if(($protectedBefore -join ',') -ne ($protectedAfter -join ',')){throw 'Protected service process changed'}
 @{buildId=[string](Get-Content -LiteralPath (Join-Path $root "$dist\BUILD_ID") -Raw).Trim();webDist=$dist;frontendPid=@(Get-NetTCPConnection -LocalPort 9005 -State Listen|Select-Object -ExpandProperty OwningProcess -Unique);protectedBefore=$protectedBefore;protectedAfter=$protectedAfter;checkedAt=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $report 'activation-result.json') -Encoding UTF8
 Write-Output 'FRONTEND 9005 ACTIVATED; protected services unchanged'
}catch {
 $_ | Out-String | Set-Content -LiteralPath (Join-Path $report 'activation-error.txt')
 if($activated){Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;Start-Sleep -Seconds 3;$previous|Set-Content -LiteralPath $config -Encoding UTF8;Get-ChildItem -LiteralPath $pwaBackup -File|Copy-Item -Destination (Join-Path $root 'public');Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue}
 throw
}
