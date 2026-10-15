param([switch]$Foreground)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$taskConfig=Join-Path $taskRoot '.dispatchpro-local\central-icall.json'
if(-not(Test-Path -LiteralPath $taskConfig)){throw 'Central iCall config is missing; configure an explicit Caller-ID source and office binding first.'}
$taskLogs=Join-Path $taskRoot '.dispatchpro-local\central-icall-logs'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
$taskNode=(Get-Command node.exe).Source
$taskScript=Join-Path $taskRoot 'scripts\central-icall.mjs'
if($Foreground){& $taskNode --experimental-strip-types $taskScript --config $taskConfig;exit $LASTEXITCODE}
$taskExisting=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($taskScript) -and $_.CommandLine.Contains($taskConfig)})
if($taskExisting.Count -gt 0){Write-Output "Central iCall already running: $($taskExisting.ProcessId -join ', ')";exit 0}
foreach($taskName in @('stdout','stderr')){
 $taskLog=Join-Path $taskLogs "$taskName.log"
 if(Test-Path -LiteralPath $taskLog){Move-Item -LiteralPath $taskLog -Destination (Join-Path $taskLogs "$taskName-$(Get-Date -Format yyyyMMdd-HHmmss-fff).log")}
}
$taskProcess=Start-Process -FilePath $taskNode -ArgumentList "--experimental-strip-types `"$taskScript`" --config `"$taskConfig`"" -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'stdout.log') -RedirectStandardError (Join-Path $taskLogs 'stderr.log') -PassThru
Write-Output "Central iCall started: PID $($taskProcess.Id). Readiness is verified separately; this is not a Live Call PASS."
