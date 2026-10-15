$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 $elevated=Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"')) -WindowStyle Hidden -Wait -PassThru
 exit $elevated.ExitCode
}
$sourceRoot=$PSScriptRoot
$installRoot=Join-Path $env:ProgramData 'DispatchPro\Office-iCall'
$taskName='DispatchPro Office iCall Receiver'
foreach($name in @('config.json','credentials.json','runtime\node.exe','app\run.mjs')){
 if(-not(Test-Path -LiteralPath (Join-Path $sourceRoot $name))){throw "Missing package file: $name"}
}
$config=Get-Content -LiteralPath (Join-Path $sourceRoot 'config.json') -Raw | ConvertFrom-Json
if($config.apiUrl -ne 'https://api.nablustaxi.com' -or $config.udpPort -ne 3520 -or $config.sources.Count -ne 1 -or $config.sources[0].sourceIp -ne '192.168.0.90' -or $config.sources[0].sourcePort -ne 3520){throw 'Office network binding is invalid'}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
foreach($name in @('config.json','credentials.json')){
 $target=Join-Path $installRoot $name
 if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath (Join-Path $sourceRoot $name)).Hash){throw "Existing $name differs; preserved without replacement"}
}
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing){
 if($existing.Actions.Execute -ne (Join-Path $installRoot 'runtime\node.exe')){throw 'Unrecognized existing task; no task replaced'}
 Stop-ScheduledTask -TaskName $taskName
 Start-Sleep -Seconds 2
}
if([IO.Path]::GetFullPath($sourceRoot) -ne [IO.Path]::GetFullPath($installRoot)){
 foreach($name in @('app','runtime')){Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $installRoot -Recurse -Force}
 foreach($name in @('config.json','credentials.json','START.cmd','README.txt')){Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $installRoot -Force}
}
New-Item -ItemType Directory -Path (Join-Path $installRoot 'logs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $installRoot 'data') -Force | Out-Null
& icacls.exe $installRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not secure installation directory'}
foreach($name in @('credentials.json','data')){
 $systemGrant=if($name -eq 'data'){'*S-1-5-18:(OI)(CI)F'}else{'*S-1-5-18:F'}
 $adminGrant=if($name -eq 'data'){'*S-1-5-32-544:(OI)(CI)F'}else{'*S-1-5-32-544:F'}
 & icacls.exe (Join-Path $installRoot $name) /inheritance:r /grant:r $systemGrant $adminGrant | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Could not secure private receiver state'}
}
# Dedicated inbound LAN rule; no router/NAT change or internet UDP exposure.
$ruleName='DispatchPro-Office-iCall-LAN-3520'
$rule=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if($rule){Remove-NetFirewallRule -Name $ruleName}
New-NetFirewallRule -Name $ruleName -DisplayName 'DispatchPro Office iCall LAN source only' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 3520 -RemotePort 3520 -RemoteAddress '192.168.0.90' -Program (Join-Path $installRoot 'runtime\node.exe') -Profile Any | Out-Null
$action=New-ScheduledTaskAction -Execute (Join-Path $installRoot 'runtime\node.exe') -Argument ('"'+(Join-Path $installRoot 'app\run.mjs')+'"') -WorkingDirectory $installRoot
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
@('Installed Office iCall Receiver.',"Path: $installRoot", "Logs: $installRoot\logs",'Auto-start: SYSTEM task at Windows startup; retry after process failure.','GridCMS and Caller-ID configuration were not changed.','Live call acceptance remains pending.') | Set-Content -LiteralPath (Join-Path $installRoot 'logs\installation.log') -Encoding UTF8
Write-Output ("Installed: {0} - Live call acceptance remains pending." -f $installRoot)
