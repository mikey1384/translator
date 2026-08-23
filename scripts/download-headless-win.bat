@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo Downloading the Puppeteer-pinned chrome-headless-shell for Windows x64...

if not exist "vendor" mkdir "vendor"
if errorlevel 1 exit /b %errorlevel%

REM Never let a failed download fall back to a stale packaged browser.
if exist "vendor\headless-x64" rmdir /s /q "vendor\headless-x64"
if exist "vendor\headless-x64" (
  echo Failed to clear vendor\headless-x64 before download. 1>&2
  exit /b 1
)

set "HEADLESS_REVISION="
for /f "usebackq delims=" %%V in (`node scripts\resolve-puppeteer-headless-revision.mjs`) do (
  if not defined HEADLESS_REVISION set "HEADLESS_REVISION=%%V"
)
if not defined HEADLESS_REVISION (
  echo Unable to resolve Puppeteer's pinned headless-shell revision. 1>&2
  exit /b 1
)

call npx puppeteer browsers install chrome-headless-shell@!HEADLESS_REVISION! --platform win64 --path vendor\headless-x64
if errorlevel 1 (
  echo chrome-headless-shell download failed. 1>&2
  exit /b !errorlevel!
)

set "HEADLESS_BINARY="
for /r "vendor\headless-x64" %%F in (chrome-headless-shell.exe) do (
  if not defined HEADLESS_BINARY set "HEADLESS_BINARY=%%~fF"
)

if not defined HEADLESS_BINARY (
  echo Download completed without a chrome-headless-shell.exe payload. 1>&2
  exit /b 1
)

copy /y "!HEADLESS_BINARY!" "vendor\headless-x64\headless_shell.exe" >nul
if errorlevel 1 (
  echo Failed to create vendor\headless-x64\headless_shell.exe. 1>&2
  exit /b !errorlevel!
)

echo Chrome headless shell downloaded and validated for Windows packaging.
exit /b 0
