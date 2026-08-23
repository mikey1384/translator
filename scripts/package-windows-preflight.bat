@echo off
setlocal EnableExtensions EnableDelayedExpansion

call npm run test:release
if errorlevel 1 exit /b !errorlevel!

call npm run clean:win
if errorlevel 1 exit /b !errorlevel!

call npm run create:icon-win
if errorlevel 1 exit /b !errorlevel!

call npm run download:headless-win
if errorlevel 1 exit /b !errorlevel!

call npm run build:owner-supervisor
if errorlevel 1 exit /b !errorlevel!

set "ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

call npm run build:all:win
if errorlevel 1 exit /b !errorlevel!

call npx electron-builder --config electron-builder.win.preflight.json --win --x64 --publish never
if errorlevel 1 exit /b !errorlevel!

call scripts\test-windows-package.bat --no-launch --allow-unsigned
if errorlevel 1 exit /b !errorlevel!

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts\test-windows-updater-metadata.ps1
if errorlevel 1 exit /b !errorlevel!

echo Complete unsigned Windows package preflight passed.
exit /b 0
