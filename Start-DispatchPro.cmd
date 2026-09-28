@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-DispatchPro.ps1"
if errorlevel 1 echo DispatchPro startup failed. Review the message above.
endlocal
