$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$releaseRoot\DispatchPro-Icall-Test.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "$PSScriptRoot\Launcher.cs" "$PSScriptRoot\NpcapCapture.cs"
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
& $compiler /nologo /target:exe /platform:x64 "/out:$PSScriptRoot\CaptureTests.exe" "$PSScriptRoot\CaptureTests.cs" "$PSScriptRoot\NpcapCapture.cs"
if ($LASTEXITCODE -ne 0) { throw 'Capture test build failed' }
& "$PSScriptRoot\CaptureTests.exe"
if ($LASTEXITCODE -ne 0) { throw 'Capture tests failed' }
& "$releaseRoot\runtime\node.exe" --test --test-isolation=none "$PSScriptRoot\raw-debug.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'UDP fallback tests failed' }
& "$releaseRoot\runtime\node.exe" --test --test-isolation=none "$PSScriptRoot\caller.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Caller parser/integration tests failed' }
