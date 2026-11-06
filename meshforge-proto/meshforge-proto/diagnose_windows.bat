@echo off
rem MeshForge: double-click me. Runs scripts\diagnose_windows.ps1 without changing your PowerShell policy.
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnose_windows.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Something went wrong ^(code %RC%^). See WINDOWS.md, Troubleshooting.
pause
exit /b %RC%
