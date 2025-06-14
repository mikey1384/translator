@echo off
echo Downloading chrome-headless-shell for Windows...

REM Create vendor directory if it doesn't exist
if not exist vendor mkdir vendor

REM Download chrome-headless-shell for Windows x64
npx @puppeteer/browsers install chrome-headless-shell@stable --path vendor

REM Create the expected directory structure
if not exist vendor\headless-x64 mkdir vendor\headless-x64

REM Copy to expected location
xcopy vendor\chrome-headless-shell vendor\headless-x64\chrome-headless-shell /E /I /Y

echo Chrome headless shell downloaded and organized for Windows packaging. 