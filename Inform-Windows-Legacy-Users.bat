@echo off
setlocal
cd /d "%~dp0"
echo === Inform Legacy Windows Users ===
echo This uploads latest.yml and the Windows installer to the correct GitHub release tag.
echo Requires GitHub CLI (gh) and login (gh auth login).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\inform-windows-legacy.ps1"
echo.
pause
endlocal
