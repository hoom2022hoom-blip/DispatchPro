@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
 echo ERROR: Portable runtime is missing: runtime\node.exe
 pause >nul
 exit /b 1
)
"runtime\node.exe" --experimental-strip-types "start.mjs"
set "bridgeExit=%errorlevel%"
if not "%bridgeExit%"=="0" pause >nul
exit /b %bridgeExit%
