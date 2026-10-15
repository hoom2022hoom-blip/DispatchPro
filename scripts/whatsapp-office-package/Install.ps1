$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 $elevated=Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"')) -WindowStyle Hidden -Wait -PassThru
 exit $elevated.ExitCode
}
$sourceRoot=[IO.Path]::GetFullPath($PSScriptRoot)
$installRoot=[IO.Path]::GetFullPath((Join-Path $env:ProgramData 'DispatchPro\WhatsApp-Receiver'))
$taskName='DispatchPro WhatsApp Receiver'
. (Join-Path $sourceRoot 'InstallerFiles.ps1')
foreach($name in @('config.json','credentials.json','runtime\node.exe','app\run.mjs')){
 if(-not(Test-Path -LiteralPath (Join-Path $sourceRoot $name))){throw "Missing package file: $name"}
}
$config=Read-ReceiverPrivateJson -Path (Join-Path $sourceRoot 'config.json')
Assert-ReceiverConfig $config
$packageCredentials=Read-ReceiverPrivateJson -Path (Join-Path $sourceRoot 'credentials.json')
Assert-ReceiverCredentials $packageCredentials
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing){
 if($existing.Actions.Count -ne 1 -or $existing.Actions.Execute -ne (Join-Path $installRoot 'runtime\node.exe') -or $existing.Actions.Arguments -ne ('"'+(Join-Path $installRoot 'app\run.mjs')+'"')){throw 'Unrecognized existing task; no task replaced'}
 Stop-ScheduledTask -TaskName $taskName
 for($attempt=0;$attempt -lt 20;$attempt++){
  $taskState=(Get-ScheduledTask -TaskName $taskName).State
  if($taskState -ne 'Running' -and -not(Get-NetTCPConnection -State Listen -LocalPort 5050 -ErrorAction SilentlyContinue)){break}
  Start-Sleep -Milliseconds 500
 }
 if((Get-ScheduledTask -TaskName $taskName).State -eq 'Running'){throw 'Existing receiver task did not stop; installation paused without starting another instance'}
}
if(Get-NetTCPConnection -State Listen -LocalPort 5050 -ErrorAction SilentlyContinue){throw 'TCP 5050 is already occupied; no process stopped. Close the previous manual WhatsApp receiver before installing.'}
if(-not(Test-Path -LiteralPath $installRoot)){New-Item -ItemType Directory -Path $installRoot | Out-Null}
Repair-ReceiverTreeAcl -Root $installRoot
foreach($name in @('config.json','credentials.json')){
 $target=Join-Path $installRoot $name
 if(Test-Path -LiteralPath $target){
  $current=Read-ReceiverPrivateJson -Path $target
  if($name -eq 'config.json'){
   Assert-ReceiverConfig $current
   if($current.tenant -ne $config.tenant -or $current.tenantId -ne $config.tenantId -or $current.siteId -ne $config.siteId){throw 'Existing office identity differs; files preserved without replacement'}
   $config=$current
  }else{Assert-ReceiverCredentials $current}
 }
}
if($sourceRoot -ne $installRoot){
 foreach($name in @('app','runtime')){
  $target=Join-Path $installRoot $name
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  foreach($programFile in @(Get-ChildItem -LiteralPath $target -Recurse -Force -File)){
   if($programFile.IsReadOnly){$programFile.IsReadOnly=$false}
  }
  Get-ChildItem -LiteralPath (Join-Path $sourceRoot $name) | Copy-Item -Destination $target -Recurse -Force
 }
 foreach($name in @('config.json','credentials.json')){
  $target=Join-Path $installRoot $name
  if(-not(Test-Path -LiteralPath $target)){
   Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $target
  }
 }
 Copy-Item -LiteralPath (Join-Path $sourceRoot 'README.txt') -Destination $installRoot -Force
 # Preserve journal and ACK checkpoints when migrating a manually run package.
 $sourceState=Join-Path $sourceRoot 'data'
 if(-not(Test-Path -LiteralPath $sourceState)){
  $previousRoot=Join-Path (Split-Path -Parent $sourceRoot) 'DispatchPro-WhatsApp-Receiver'
  $previousConfig=Join-Path $previousRoot 'config.json'
  if(Test-Path -LiteralPath $previousConfig){
   $previous=Read-ReceiverPrivateJson -Path $previousConfig
   Assert-ReceiverConfig $previous
   if($previous.tenant -ne $config.tenant -or $previous.tenantId -ne $config.tenantId -or $previous.siteId -ne $config.siteId){throw 'Previous portable office identity differs; data migration requires matching identity'}
   $sourceState=Join-Path $previousRoot 'data'
  }
 }
 $targetState=Join-Path $installRoot 'data'
 if((Test-Path -LiteralPath $sourceState) -and -not(Test-Path -LiteralPath $targetState)){
  Copy-Item -LiteralPath $sourceState -Destination $targetState -Recurse
 }
}
foreach($name in @('logs','data')){New-Item -ItemType Directory -Path (Join-Path $installRoot $name) -Force | Out-Null}
# SYSTEM and administrators only; no firewall/router changes.
Repair-ReceiverTreeAcl -Root $installRoot
$action=New-ScheduledTaskAction -Execute (Join-Path $installRoot 'runtime\node.exe') -Argument ('"'+(Join-Path $installRoot 'app\run.mjs')+'"') -WorkingDirectory $installRoot
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -Hidden -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
@('WhatsApp receiver installed.',"Path: $installRoot",'SYSTEM startup task; hidden session; failure restart every minute.','No network configuration changed. Restart field verification pending.') | Set-Content -LiteralPath (Join-Path $installRoot 'logs\installation.log') -Encoding UTF8
Write-Output "Installed: $installRoot"
