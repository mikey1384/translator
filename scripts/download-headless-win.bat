@echo off
echo Downloading chrome-headless-shell for Windows...

REM Create vendor directory if it doesn't exist
if not exist vendor mkdir vendor

REM Download chrome-headless-shell for Windows x64
npx @puppeteer/browsers install chrome-headless-shell@stable --path vendor

REM Create the expected directory structure
if not exist vendor\headless-x64 mkdir vendor\headless-x64

REM Copy the entire chrome-headless-shell directory to maintain the nested structure
xcopy vendor\chrome-headless-shell vendor\headless-x64\chrome-headless-shell /E /I /Y

REM Also create fallback structure for compatibility
for /d %%d in (vendor\chrome-headless-shell\win64-*) do (
  for /d %%b in (%%d\chrome-headless-shell-win*) do (
    if exist "%%b\chrome-headless-shell.exe" (
      copy "%%b\chrome-headless-shell.exe" "vendor\headless-x64\headless_shell.exe"
      echo Copied binary to fallback location: vendor\headless-x64\headless_shell.exe
    )
  )
)

echo Chrome headless shell downloaded and organized for Windows packaging. 