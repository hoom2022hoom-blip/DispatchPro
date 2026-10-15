param([string]$StateDirectory,[int]$Port=5051)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
if(-not $StateDirectory){$StateDirectory=Join-Path $env:LOCALAPPDATA 'OfficeCallsProfessional'}
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
# Remove inherited access; only this user and SYSTEM can read history or the encrypted credential.
$directoryInfo=[IO.DirectoryInfo]::new($StateDirectory)
$acl=$directoryInfo.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true,$false)
foreach($existing in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($existing)}
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($identity in @($sid,[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
 $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
}
$directoryInfo.SetAccessControl($acl)
$configPath=Join-Path $StateDirectory 'receiver.json'
if(Test-Path -LiteralPath $configPath){
 $existing=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
 $existing.version='3.2.5'
 [IO.File]::WriteAllText($configPath,($existing | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
 return $existing
}
function New-RandomHex {
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
 return (($bytes | ForEach-Object {$_.ToString('x2')}) -join '')
}
$secret=@{token=(New-RandomHex);key=(New-RandomHex);password=(New-RandomHex)}
$cert=New-SelfSignedCertificate -Subject 'CN=OfficeCalls Local Receiver' -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5) -TextExtension @('2.5.29.19={critical}{text}ca=0','2.5.29.37={text}1.3.6.1.5.5.7.3.1')
$certificateFile=Join-Path $StateDirectory 'receiver.pfx'
[IO.File]::WriteAllBytes((Join-Path $StateDirectory 'receiver.cer'),$cert.RawData)
Export-PfxCertificate -Cert $cert -FilePath $certificateFile -Password (ConvertTo-SecureString $secret.password -AsPlainText -Force) | Out-Null
$sha=[Security.Cryptography.SHA256]::Create();try{$pin=(($sha.ComputeHash($cert.RawData) | ForEach-Object {$_.ToString('x2')}) -join '')}finally{$sha.Dispose()}
# Dedicated generated certificate only; never change another application's certificates.
Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)"
$raw=[Text.Encoding]::UTF8.GetBytes(($secret | ConvertTo-Json -Compress))
$protected=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path $StateDirectory 'credentials.dpapi'),$protected)
$config=@{directory=$StateDirectory;port=$Port;retentionDays=30;certificateFile=$certificateFile;pin=$pin;version='3.2.5'}
[IO.File]::WriteAllText($configPath,($config | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
return [pscustomobject]$config
