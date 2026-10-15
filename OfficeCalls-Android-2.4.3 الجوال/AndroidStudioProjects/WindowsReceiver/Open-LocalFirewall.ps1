param([int]$Port=5051)
$ErrorActionPreference='Stop'
$configPath=Join-Path $env:LOCALAPPDATA 'OfficeCallsProfessional/receiver.json'
if(Test-Path -LiteralPath $configPath){$Port=[int](Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).port}
if($Port -lt 1 -or $Port -gt 65535){throw 'Invalid receiver port'}
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $admin){Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Port',$Port);exit}
# A distinct rule preserves existing Caller ID and the previous receiver's firewall settings.
$name="OfficeCalls Professional LAN TLS $Port"
if(-not(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)){
 New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
Write-Output "LAN-only Private-profile TLS port $Port configured."
