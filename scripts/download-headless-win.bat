@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo Installing the Puppeteer-pinned chrome-headless-shell for Windows x64...

node scripts\install-pinned-headless-chrome.mjs win64
if errorlevel 1 exit /b !errorlevel!

echo Chrome headless shell downloaded and validated for Windows packaging.
exit /b 0
