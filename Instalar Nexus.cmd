@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Start %*
set "NEXUS_EXIT=%ERRORLEVEL%"
if not "%NEXUS_EXIT%"=="0" pause
exit /b %NEXUS_EXIT%
