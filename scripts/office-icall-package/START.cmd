@echo off
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0app\run.mjs"
if errorlevel 1 pause
