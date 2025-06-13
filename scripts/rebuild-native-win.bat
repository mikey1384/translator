@echo off
setlocal enabledelayedexpansion

set TARGET_ARCH=x64
echo 🔨  Rebuilding native modules for %TARGET_ARCH% …

REM 1. fresh production-only install
if exist node_modules (
    echo Removing existing node_modules...
    rmdir /s /q node_modules
)
npm ci --production --no-audit --fund=false

REM 2. rebuild native add-ons
npx @electron/rebuild --arch %TARGET_ARCH% --parallel --types prod,optional --force --module-dir node_modules

echo ✅  Native add-ons ready for %TARGET_ARCH% 