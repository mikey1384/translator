@echo off
setlocal enabledelayedexpansion

set TARGET_ARCH=x64
echo 🔨  Rebuilding native modules for %TARGET_ARCH% …

REM Skip node_modules deletion to avoid file locks
echo Skipping node_modules removal to avoid file locks...

REM Rebuild native add-ons with explicit Electron version and module directory
echo Rebuilding native modules for Electron...
for /f "delims=" %%i in ('node -p "require('electron/package.json').version"') do set ELECTRON_VERSION=%%i
echo Targeting Electron %ELECTRON_VERSION%...
npx @electron/rebuild --arch %TARGET_ARCH% --parallel --force --version %ELECTRON_VERSION% --module-dir .

echo ✅  Native add-ons ready for %TARGET_ARCH% 
