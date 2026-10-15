function Set-ReceiverPrivateAcl {
 param([Parameter(Mandatory=$true)][string]$Path)
 # Replace only the named receiver file/directory DACL, never parent/system ACLs.
 $item=Get-Item -LiteralPath $Path -Force
 $acl=if($item.PSIsContainer){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){
  $identity=New-Object Security.Principal.SecurityIdentifier($sid)
  $rule=if($item.PSIsContainer){New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')}
  $acl.AddAccessRule($rule)
 }
 try{Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop}
 catch {
  # Ownership recovery only when DACL repair itself is denied; one exact path.
  & takeown.exe /F $Path /A 2>&1 | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Could not recover receiver file ownership'}
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
 }
}

function Repair-ReceiverTreeAcl {
 param([Parameter(Mandatory=$true)][string]$Root)
 $resolved=[IO.Path]::GetFullPath($Root).TrimEnd('\')
 function Repair-ReceiverNode {
  param([string]$Path)
  $full=[IO.Path]::GetFullPath($Path)
  if($full -ne $resolved -and -not $full.StartsWith($resolved+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ACL target is outside the receiver installation'}
  $item=Get-Item -LiteralPath $full -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Receiver installation contains a link; no link target modified'}
  Set-ReceiverPrivateAcl -Path $full
  if($item.PSIsContainer){
   # Repair each directory before enumerating it; protected child DACLs do not
   # inherit a repaired parent, so every existing node must be handled.
   foreach($child in @(Get-ChildItem -LiteralPath $full -Force)){
    Repair-ReceiverNode -Path $child.FullName
   }
  }
 }
 Repair-ReceiverNode -Path $resolved
}

function Read-ReceiverPrivateJson {
 param([Parameter(Mandatory=$true)][string]$Path)
 try{$raw=[IO.File]::ReadAllText($Path)}
 catch [UnauthorizedAccessException]{
  Set-ReceiverPrivateAcl -Path $Path
  try{$raw=[IO.File]::ReadAllText($Path)}catch{throw 'Protected receiver file remains unreadable after ACL repair'}
 }
 try{return ($raw | ConvertFrom-Json -ErrorAction Stop)}catch{throw 'Existing receiver JSON is invalid; preserved without replacement'}
}

function Assert-ReceiverConfig {
 param($Config)
 if($Config.apiUrl -ne 'https://api.nablustaxi.com' -or $Config.whatsappTcpPort -ne 5050 -or $Config.stateDirectory -ne 'data' -or $Config.credentialsFile -ne 'credentials.json' -or -not $Config.tenant -or $Config.tenantId -notmatch '^[a-fA-F0-9-]{36}$' -or -not $Config.siteId){throw 'Existing receiver configuration is invalid; preserved without replacement'}
}

function Assert-ReceiverCredentials {
 param($Credentials)
 if(-not ($Credentials.username -is [string]) -or -not $Credentials.username -or -not ($Credentials.password -is [string]) -or -not $Credentials.password){throw 'Existing receiver credentials are invalid; preserved without replacement'}
}
