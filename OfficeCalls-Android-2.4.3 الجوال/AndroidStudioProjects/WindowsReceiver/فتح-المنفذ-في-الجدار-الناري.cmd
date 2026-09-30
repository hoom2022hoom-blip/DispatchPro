@echo off
net session >nul 2>&1
if not %errorlevel%==0 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Office Calls Receiver" >nul 2>&1
netsh advfirewall firewall add rule name="Office Calls Receiver" dir=in action=allow protocol=TCP localport=5050 profile=any remoteip=localsubnet
echo.
echo Firewall rule added successfully for TCP port 5050.
pause
