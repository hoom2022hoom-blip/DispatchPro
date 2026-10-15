param([string]$Workspace)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Upgrade test requires elevation'}
$runId=[Guid]::NewGuid().ToString('N')
$testRoot=Join-Path $env:ProgramData ('DispatchPro-Installer-Tests\WhatsApp-'+$runId)
$taskName='DispatchPro WhatsApp Installer Test '+$runId
$source=Join-Path $testRoot 'package'
$target=Join-Path $testRoot 'installed'
$reportRoot=Join-Path $Workspace 'artifacts\whatsapp-office\upgrade-acl-test'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $reportRoot 'test.log') -Force | Out-Null
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$probe.Start();$testPort=$probe.LocalEndpoint.Port;$probe.Stop()
try{
 foreach($folder in @($source,$target,(Join-Path $source 'runtime'),(Join-Path $source 'app'),(Join-Path $target 'runtime'),(Join-Path $target 'app\DispatchPro-Site-Bridge\scripts\lib'),(Join-Path $target 'data'),(Join-Path $target 'logs'))){New-Item -ItemType Directory -Path $folder -Force | Out-Null}
 $config=@{apiUrl='https://api.nablustaxi.com';tenant='fixture';tenantId='11111111-1111-1111-1111-111111111111';siteId='fixture';whatsappTcpPort=5050;stateDirectory='data';credentialsFile='credentials.json'} | ConvertTo-Json
 foreach($root in @($source,$target)){[IO.File]::WriteAllText((Join-Path $root 'config.json'),$config)}
 [IO.File]::WriteAllText((Join-Path $source 'credentials.json'),'{"username":"package-fixture","password":"package-fixture"}')
 [IO.File]::WriteAllText((Join-Path $target 'credentials.json'),'{"username":"existing-fixture","password":"existing-fixture"}')
 [IO.File]::WriteAllText((Join-Path $target 'data\preserved.json'),'fixture journal')
 foreach($root in @($source,$target)){
  Copy-Item -LiteralPath (Join-Path $Workspace 'artifacts\whatsapp-office\DispatchPro-WhatsApp-Receiver-Background\runtime\node.exe') -Destination (Join-Path $root 'runtime\node.exe')
  [IO.File]::WriteAllText((Join-Path $root 'app\run.mjs'),('import net from "node:net"; net.createServer(s=>s.end()).listen('+$testPort+',"127.0.0.1");'))
 }
 New-Item -ItemType Directory -Path (Join-Path $source 'app\DispatchPro-Site-Bridge\scripts\lib') -Force | Out-Null
 [IO.File]::WriteAllText((Join-Path $source 'app\DispatchPro-Site-Bridge\scripts\lib\officecalls-mirror.mjs'),'upgraded fixture')
 $mirror=Join-Path $target 'app\DispatchPro-Site-Bridge\scripts\lib\officecalls-mirror.mjs'
 [IO.File]::WriteAllText($mirror,'old fixture')
 [IO.File]::WriteAllText((Join-Path $source 'README.txt'),'isolated upgrade fixture')
 foreach($name in @('InstallerFiles.ps1','INSTALL.cmd')){Copy-Item -LiteralPath (Join-Path (Join-Path $Workspace 'scripts\whatsapp-office-package') $name) -Destination $source}
 $installer=[IO.File]::ReadAllText((Join-Path $Workspace 'scripts\whatsapp-office-package\Install.ps1'))
 $rootLine='$installRoot=[IO.Path]::GetFullPath((Join-Path $env:ProgramData ''DispatchPro\WhatsApp-Receiver''))'
 if(-not $installer.Contains($rootLine)){throw 'Test substitution failed'}
 $installer=$installer.Replace($rootLine,('$installRoot='''+$target.Replace("'","''")+''''))
 $installer=$installer.Replace('$taskName=''DispatchPro WhatsApp Receiver''',('$taskName='''+$taskName+''''))
 $installer=$installer.Replace('-LocalPort 5050',('-LocalPort '+$testPort))
 [IO.File]::WriteAllText((Join-Path $source 'Install.ps1'),$installer)
 foreach($name in @('Install.ps1','InstallerFiles.ps1')){
  $tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile((Join-Path $source $name),[ref]$tokens,[ref]$errors) | Out-Null
  if($errors.Count){throw 'Installer parse failed'}
 }
 $action=New-ScheduledTaskAction -Execute (Join-Path $target 'runtime\node.exe') -Argument ('"'+(Join-Path $target 'app\run.mjs')+'"') -WorkingDirectory $target
 $identity=New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $identity -Force | Out-Null
 Start-ScheduledTask -TaskName $taskName
 for($wait=0;$wait -lt 40;$wait++){if(Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 250}
 if(-not(Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue)){throw 'Old test receiver did not start'}
 $hashConfig=(Get-FileHash -LiteralPath (Join-Path $target 'config.json')).Hash
 $hashCredentials=(Get-FileHash -LiteralPath (Join-Path $target 'credentials.json')).Hash
 # Real protected NTFS child ACLs with SYSTEM ownership: parent repair alone
 # cannot remove these denies. Test exact field failure on the mirror file.
 foreach($item in @(Get-ChildItem -LiteralPath $target -Recurse -Force | Sort-Object {$_.FullName.Length} -Descending)){
  $acl=Get-Acl -LiteralPath $item.FullName
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-18'))
  $deny=[Security.AccessControl.FileSystemAccessRule]::new('BUILTIN\Administrators','ReadData,WriteData,AppendData,WriteAttributes,WriteExtendedAttributes,ChangePermissions','Deny')
  $acl.AddAccessRule($deny)
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
 }
 $blocked=$false;try{[IO.File]::WriteAllText($mirror,'must fail')}catch{$blocked=$true}
 if(-not $blocked){throw 'Upgrade fixture is not actually write denied'}
 for($iteration=0;$iteration -lt 2;$iteration++){
  # Run the entire INSTALL.cmd, real task cmdlets, real copy and real ACL repair.
  $process=Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/c',('""'+(Join-Path $source 'INSTALL.cmd')+'""')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $reportRoot ('install-'+$iteration+'.out.log')) -RedirectStandardError (Join-Path $reportRoot ('install-'+$iteration+'.err.log')) -PassThru -Wait
  if($process.ExitCode -ne 0){throw 'Full INSTALL.cmd failed'}
  for($wait=0;$wait -lt 40;$wait++){if(Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 250}
  $task=Get-ScheduledTask -TaskName $taskName
  if($task.State -ne 'Running' -or $task.Principal.UserId -notin @('SYSTEM','S-1-5-18') -or -not $task.Settings.Hidden -or $task.Settings.MultipleInstances -ne 'IgnoreNew' -or -not $task.Triggers){throw 'Installed background task settings incorrect'}
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue)
  if($listeners.Count -ne 1){throw 'Duplicate/missing test receiver'}
 }
 if([IO.File]::ReadAllText($mirror) -ne 'upgraded fixture'){throw 'Restricted child program file was not upgraded'}
 if((Get-FileHash -LiteralPath (Join-Path $target 'config.json')).Hash -ne $hashConfig -or (Get-FileHash -LiteralPath (Join-Path $target 'credentials.json')).Hash -ne $hashCredentials){throw 'Existing private files changed'}
 if([IO.File]::ReadAllText((Join-Path $target 'data\preserved.json')) -ne 'fixture journal'){throw 'Existing state changed'}
 foreach($item in @((Get-Item -LiteralPath $target)) + @(Get-ChildItem -LiteralPath $target -Recurse -Force)){
  $acl=Get-Acl -LiteralPath $item.FullName
  $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
  if(-not $acl.AreAccessRulesProtected -or $rules.Count -ne 2 -or @($rules | Where-Object {$_.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -or $_.AccessControlType -ne 'Allow'}).Count){throw 'Installed ACL not restricted to SYSTEM and Administrators'}
 }
 @('PASS: full INSTALL.cmd upgrade twice on real ProgramData restricted child ACLs and SYSTEM ownership.', 'PASS: old real SYSTEM task stopped, locked executable updated, one isolated test listener.', 'PASS: exact mirror path upgraded, config/credentials/journal byte content preserved.', 'PASS: installer parse and final restricted ACL for every node; hidden SYSTEM startup/restart task settings.', 'Isolated task and alternate port used; production 5050 and real receivers untouched. Restart Live PASS not claimed.',('Test folder: '+$testRoot)) | Set-Content -LiteralPath (Join-Path $reportRoot 'PASS.txt')
}catch{
 ($_ | Out-String) | Set-Content -LiteralPath (Join-Path $reportRoot 'failure.log')
 if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){Get-ScheduledTaskInfo -TaskName $taskName | Out-String | Add-Content -LiteralPath (Join-Path $reportRoot 'failure.log')}
 throw
}finally{
 if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $taskName;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
 Stop-Transcript | Out-Null
}
