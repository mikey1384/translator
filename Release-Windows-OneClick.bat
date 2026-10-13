@echo off
setlocal
cd /d "%~dp0"
echo === Translator Windows One-Click Release ===
echo This will build, upload to Cloudflare, and purge cache.
echo.
rem Windows PowerShell 5.1 must load its own modules. Started from a PowerShell 7
rem window it inherits PSModulePath and cannot load Microsoft.PowerShell.Security
rem (Get-AuthenticodeSignature); clearing it lets 5.1 rebuild its default path.
set "PSModulePath="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-windows-oneclick.ps1" -NoPause
set "RELEASE_EXIT=%ERRORLEVEL%"
echo.
echo (If the window closes immediately, try running this from a terminal)
pause
endlocal & exit /b %RELEASE_EXIT%
