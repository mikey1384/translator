@echo off
setlocal
cd /d "%~dp0"
echo === Inform Legacy Windows Users ===
echo This adds verified Windows updater assets to the canonical GitHub release.
echo Requires GitHub CLI (gh) and login (gh auth login).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\inform-windows-legacy.ps1" -NoPause
set "LEGACY_RELEASE_EXIT=%ERRORLEVEL%"
echo.
pause
endlocal & exit /b %LEGACY_RELEASE_EXIT%
