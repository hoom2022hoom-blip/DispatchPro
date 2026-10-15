$ErrorActionPreference='Stop'
$target=Join-Path $env:LOCALAPPDATA 'Programs/OfficeCallsProfessional'
if(Test-Path -LiteralPath $target){
 $backup=Join-Path $env:LOCALAPPDATA ('OfficeCallsProfessionalBackups/'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
 New-Item -ItemType Directory -Path $backup -Force | Out-Null
 Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'program') -Recurse
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force}
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-ItemProperty -LiteralPath $runKey -Name OfficeCallsProfessional -PropertyType String -Value ('powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $target 'OfficeCallsReceiver.ps1')+'"') -Force | Out-Null
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'OfficeCalls Professional.lnk'))
$shortcut.TargetPath='powershell.exe';$shortcut.Arguments='-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+(Join-Path $target 'OfficeCallsReceiver.ps1')+'"';$shortcut.WorkingDirectory=$target;$shortcut.Save()
Write-Output "Installed OfficeCalls Office Bridge 3.2.5 at $target. Existing receivers and their data were preserved."
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $target 'OfficeCallsReceiver.ps1')+'"'))
