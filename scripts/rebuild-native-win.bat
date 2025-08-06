@echo off
setlocal enabledelayedexpansion

set TARGET_ARCH=x64
echo 🔨  Rebuilding native modules for %TARGET_ARCH% …

REM Skip node_modules deletion to avoid file locks
echo Skipping node_modules removal to avoid file locks...

REM Rebuild native add-ons with explicit Electron version and module directory
echo Rebuilding native modules for Electron...
npx @electron/rebuild --arch %TARGET_ARCH% --parallel --force --electron-version 35.5.1 --module-dir node_modules

echo ✅  Native add-ons ready for %TARGET_ARCH% 