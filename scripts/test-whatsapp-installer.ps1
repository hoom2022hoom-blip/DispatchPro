param([string]$TestRoot)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run this isolated ACL test elevated'}
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $TestRoot 'test.log') -Force | Out-Null
$source=Join-Path $TestRoot 'package'
$target=Join-Path $TestRoot 'installed'
foreach($folder in @($source,$target,(Join-Path $source 'runtime'),(Join-Path $source 'app'))){New-Item -ItemType Directory -Path $folder -Force | Out-Null}
$config=@{apiUrl='https://api.nablustaxi.com';tenant='fixture';tenantId='11111111-1111-1111-1111-111111111111';siteId='fixture';whatsappTcpPort=5050;stateDirectory='data';credentialsFile='credentials.json'} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $source 'config.json'),$config)
[IO.File]::WriteAllText((Join-Path $target 'config.json'),$config)
[IO.File]::WriteAllText((Join-Path $source 'credentials.json'),'{"username":"new-fixture","password":"new-fixture"}')
[IO.File]::WriteAllText((Join-Path $target 'credentials.json'),'{"username":"existing-fixture","password":"existing-fixture"}')
foreach($name in @('runtime\node.exe','app\run.mjs','README.txt')){[IO.File]::WriteAllText((Join-Path $source $name),'fixture')}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'whatsapp-office-package\InstallerFiles.ps1') -Destination $source
$installer=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'whatsapp-office-package\Install.ps1'))
$original='$installRoot=[IO.Path]::GetFullPath((Join-Path $env:ProgramData ''DispatchPro\WhatsApp-Receiver''))'
if(-not $installer.Contains($original)){throw 'Test root substitution failed'}
$installer=$installer.Replace($original,('$installRoot='''+$target.Replace("'","''")+''''))
[IO.File]::WriteAllText((Join-Path $source 'Install.ps1'),$installer)
$configFile=Join-Path $target 'config.json'
$credentialFile=Join-Path $target 'credentials.json'
$hashes=@((Get-FileHash -LiteralPath $configFile).Hash,(Get-FileHash -LiteralPath $credentialFile).Hash)
foreach($file in @($configFile,$credentialFile)){
 $acl=Get-Acl -LiteralPath $file
 $acl.SetAccessRuleProtection($true,$false)
 $deny=New-Object Security.AccessControl.FileSystemAccessRule('Everyone','ReadData','Deny')
 $acl.AddAccessRule($deny)
 Set-Acl -LiteralPath $file -AclObject $acl
}
$blocked=$false
try{[IO.File]::ReadAllText($configFile) | Out-Null}catch{$blocked=$true}
if(-not $blocked){throw 'Restricted ACL fixture did not deny reading'}
$global:registered=0;$global:started=0;$global:stopped=0;$global:occupied=$false;$global:existing=$null
function Get-ScheduledTask {param($TaskName,$ErrorAction) return $global:existing}
function Stop-ScheduledTask {param($TaskName) $global:stopped++;$global:existing.State='Ready'}
function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction) if($global:occupied){return @{OwningProcess=123}}}
function New-ScheduledTaskAction {param($Execute,$Argument,$WorkingDirectory) return @{Execute=$Execute;Arguments=$Argument}}
function New-ScheduledTaskTrigger {param([switch]$AtStartup) return @{Startup=$AtStartup.IsPresent}}
function New-ScheduledTaskSettingsSet {param([switch]$Hidden,$RestartCount,$RestartInterval,$ExecutionTimeLimit,$MultipleInstances,[switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries)
 if(-not $Hidden -or $MultipleInstances -ne 'IgnoreNew' -or $RestartCount -ne 999){throw 'Task settings incorrect'};return @{}
}
function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel) if($UserId -ne 'SYSTEM' -or $LogonType -ne 'ServiceAccount'){throw 'Principal incorrect'};return @{UserId=$UserId}}
function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Settings,$Principal,[switch]$Force) $global:registered++;$global:existing=@{Actions=@($Action);State='Ready'}}
function Start-ScheduledTask {param($TaskName) $global:started++;$global:existing.State='Running'}
& (Join-Path $source 'Install.ps1') | Out-Null
& (Join-Path $source 'Install.ps1') | Out-Null
if($global:registered -ne 2 -or $global:started -ne 2 -or $global:stopped -ne 1){throw 'Idempotent task lifecycle failed'}
if((Get-FileHash -LiteralPath $configFile).Hash -ne $hashes[0] -or (Get-FileHash -LiteralPath $credentialFile).Hash -ne $hashes[1]){throw 'Private file content changed'}
foreach($file in @($configFile,$credentialFile)){
 $acl=Get-Acl -LiteralPath $file
 if(-not $acl.AreAccessRulesProtected){throw 'Private ACL inheritance remains enabled'}
 $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
 if($rules.Count -ne 2 -or @($rules | Where-Object {$_.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -or $_.AccessControlType -ne 'Allow'}).Count){throw 'Private ACL is not restricted'}
}
$global:occupied=$true
$rejected=$false
try{& (Join-Path $source 'Install.ps1') | Out-Null}catch{$rejected=$_.Exception.Message -like 'TCP 5050 is already occupied*'}
if(-not $rejected -or $global:started -ne 2){throw 'Occupied port guard failed'}
$global:occupied=$false
$global:existing=@{Actions=@(@{Execute='unrelated.exe';Arguments=''});State='Running'}
$rejected=$false
try{& (Join-Path $source 'Install.ps1') | Out-Null}catch{$rejected=$_.Exception.Message -like 'Unrecognized existing task*'}
if(-not $rejected -or $global:started -ne 2){throw 'Unrecognized task guard failed'}
@('PASS: actual NTFS read-denied fixture repaired; private files unchanged.', 'PASS: restricted SYSTEM/Administrators ACL retained.', 'PASS: repeated installer with mocked task lifecycle and occupied-port guards.', 'Scheduled Task operations were mocked; no operational task or receiver changed. Restart Live PASS not claimed.') | Set-Content -LiteralPath (Join-Path $TestRoot 'PASS.txt')
Stop-Transcript | Out-Null
