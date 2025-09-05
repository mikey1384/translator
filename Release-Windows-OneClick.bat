@echo off
setlocal
cd /d "%~dp0"
echo === Translator Windows One-Click Release ===
echo This will build, upload to Cloudflare, and purge cache.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-windows-oneclick.ps1"
echo.
echo (If the window closes immediately, try running this from a terminal)
pause
endlocal
