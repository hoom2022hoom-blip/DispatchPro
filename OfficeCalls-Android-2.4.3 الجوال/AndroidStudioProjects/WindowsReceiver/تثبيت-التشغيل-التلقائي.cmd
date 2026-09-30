@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $p=[IO.Path]::Combine($env:APPDATA,'Microsoft\Windows\Start Menu\Programs\Startup','Office Calls.lnk'); $s=$w.CreateShortcut($p); $s.TargetPath='%~dp0تشغيل-مكالمات-المكتب.cmd'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if errorlevel 1 (
  echo Failed to enable automatic startup.
) else (
  echo Office Calls will start automatically after Windows sign-in.
)
pause
