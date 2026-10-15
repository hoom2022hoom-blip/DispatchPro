param([switch]$Activate)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
foreach($envFile in @('.env','.env.local')) {
 foreach($line in Get-Content -LiteralPath $envFile) {
  if($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
   $envKey=$Matches[1];$envValue=$Matches[2]
   if($envValue.Length -ge 2 -and (($envValue[0] -eq '"' -and $envValue[-1] -eq '"') -or ($envValue[0] -eq "'" -and $envValue[-1] -eq "'"))) {$envValue=$envValue.Substring(1,$envValue.Length-2)}
   [Environment]::SetEnvironmentVariable($envKey,$envValue,'Process')
  }
 }
}
$buildDir=Join-Path $projectRoot 'artifacts\reception-continuous-session\api'
$env:NEXT_DIST_DIR='.next-reception-continuous-20261004'
$env:ASPNETCORE_URLS='http://127.0.0.1:9010'
$env:DISPATCHPRO_API_URL='http://127.0.0.1:9010'
if(-not $Activate) {
 & dotnet.exe build backend/DispatchPro.Api --no-restore --output $buildDir --nologo
 if($LASTEXITCODE -ne 0){throw 'API build failed; running services unchanged'}
 & node.exe node_modules/next/dist/bin/next build
 if($LASTEXITCODE -ne 0){throw 'Web build failed; running services unchanged'}
 Write-Output 'PREPARED'
 exit
}
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot "$env:NEXT_DIST_DIR\BUILD_ID")) -or -not (Test-Path -LiteralPath (Join-Path $buildDir 'DispatchPro.Api.dll'))){throw 'Prepared builds missing'}
function Listener([int]$port) {
 $ids=@(& netstat.exe -ano -p tcp | ForEach-Object {if($_ -match "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$"){[int]$Matches[1]}} | Select-Object -Unique)
 if($ids.Count -ne 1){throw "Unexpected listener count on $port"}
 return Get-CimInstance Win32_Process -Filter "ProcessId=$($ids[0])"
}
$api=Listener 9010;$web=Listener 9005
if($api.CommandLine -notlike '*DispatchPro\.dispatchpro-local\central-icall-api\DispatchPro.Api.dll*'){throw 'API identity changed; nothing stopped'}
if($web.CommandLine -notlike '*DispatchPro\node_modules*next* start *'){throw 'Web identity changed; nothing stopped'}
$logDir=Join-Path $projectRoot 'artifacts\reception-continuous-session'
Stop-Process -Id $api.ProcessId -Force
$newApi=Start-Process dotnet.exe -ArgumentList @(('"'+(Join-Path $buildDir 'DispatchPro.Api.dll')+'"'),'--contentRoot',('"'+(Join-Path $projectRoot 'backend\DispatchPro.Api')+'"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'api.stdout.log') -RedirectStandardError (Join-Path $logDir 'api.stderr.log') -PassThru
$ready=$false
for($attempt=0;$attempt -lt 20;$attempt++) {try{if((Invoke-WebRequest 'http://127.0.0.1:9010/health/ready' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Seconds 1}
if(-not $ready){throw 'New API did not become ready; web left running'}
Stop-Process -Id $web.ProcessId -Force
$newWeb=Start-Process node.exe -ArgumentList @('node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','9005') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'web.stdout.log') -RedirectStandardError (Join-Path $logDir 'web.stderr.log') -PassThru
$ready=$false
for($attempt=0;$attempt -lt 30;$attempt++) {try{if((Invoke-WebRequest 'http://127.0.0.1:9005/office/reception' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Seconds 1}
if(-not $ready){throw 'New web did not become ready'}
Write-Output "DEPLOYED API=$($newApi.Id) WEB=$($newWeb.Id)"
