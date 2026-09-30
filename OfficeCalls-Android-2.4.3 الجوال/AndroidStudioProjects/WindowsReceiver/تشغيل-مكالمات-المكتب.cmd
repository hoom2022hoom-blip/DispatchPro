@echo off
cd /d "%~dp0"
start "Office Calls" powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0OfficeCallsReceiver.ps1"
