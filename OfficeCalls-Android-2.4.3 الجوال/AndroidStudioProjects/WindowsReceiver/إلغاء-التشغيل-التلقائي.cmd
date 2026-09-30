@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::Combine($env:APPDATA,'Microsoft\Windows\Start Menu\Programs\Startup','Office Calls.lnk'); if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force}"
echo Automatic startup has been disabled.
pause
