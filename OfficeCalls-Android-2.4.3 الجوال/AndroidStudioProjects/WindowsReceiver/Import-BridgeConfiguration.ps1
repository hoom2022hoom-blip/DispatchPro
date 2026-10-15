param([Parameter(Mandatory=$true)][string]$BridgeConfigFile,[Parameter(Mandatory=$true)][string]$ReceiverConfigFile)
$ErrorActionPreference='Stop'
$file=(Resolve-Path -LiteralPath $BridgeConfigFile).Path
$bridge=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
$root=Split-Path -Parent $file
$uri=[Uri]$bridge.apiUrl
if(-not $bridge.tenant -or $bridge.tenantId -notmatch '^[a-f0-9-]{36}$' -or ($bridge.officeId -and $bridge.officeId -ne $bridge.tenantId)){throw 'هوية المكتب غير مكتملة في ملف الجسر'}
if($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('127.0.0.1','localhost','[::1]'))){throw 'عنوان DispatchPro غير آمن'}
if(-not $bridge.credentials){
 if(-not $bridge.credentialsFile){throw 'ملف صلاحيات الجسر غير محدد'}
 $credentialFile=if([IO.Path]::IsPathRooted($bridge.credentialsFile)){$bridge.credentialsFile}else{Join-Path $root $bridge.credentialsFile}
 $credential=Get-Content -LiteralPath $credentialFile -Raw | ConvertFrom-Json
}else{$credential=$bridge.credentials}
if(-not $credential.username -or -not $credential.password){throw 'صلاحيات الجسر غير مكتملة'}
$config=Get-Content -LiteralPath $ReceiverConfigFile -Raw | ConvertFrom-Json
$config | Add-Member -NotePropertyName bridgeConfigFile -NotePropertyValue $file -Force
# Keep the old capture, binding, credentials, and inbox at their existing paths.
# Starting capture is an explicit installation choice after the office field check.
if(Test-Path -LiteralPath (Join-Path $root 'DispatchPro-Icall-Test.exe')){
 $config | Add-Member -NotePropertyName capturePackageDirectory -NotePropertyValue $root -Force
 if(-not $config.PSObject.Properties['startLandlineCapture']){$config | Add-Member -NotePropertyName startLandlineCapture -NotePropertyValue $false}
}
Copy-Item -LiteralPath $ReceiverConfigFile -Destination ($ReceiverConfigFile+'.before-bridge-'+(Get-Date -Format yyyyMMddHHmmss))
[IO.File]::WriteAllText($ReceiverConfigFile,($config | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
return $config
