@echo off
echo Testing Windows packaged application...

REM Check if the executable exists
if exist "dist\win-unpacked\Translator.exe" (
    echo Found Translator.exe
    
    REM Check file size (should be around 200MB)
    for %%A in ("dist\win-unpacked\Translator.exe") do (
        echo File size: %%~zA bytes
    )
    
    REM Check if headless binaries are included
    if exist "dist\win-unpacked\resources\headless-x64" (
        echo ✓ Headless binaries found
    ) else (
        echo ✗ Headless binaries missing
    )
    
    REM Check if chrome-headless-shell.exe exists
    if exist "dist\win-unpacked\resources\headless-x64\chrome-headless-shell\win64-*\chrome-headless-shell-win64\chrome-headless-shell.exe" (
        echo ✓ Chrome headless shell executable found
    ) else (
        echo ✗ Chrome headless shell executable missing
    )
    
    REM Launch the application
    echo Launching Translator.exe...
    start "" "dist\win-unpacked\Translator.exe"
    
) else (
    echo ✗ Translator.exe not found in dist\win-unpacked\
    echo Make sure to run 'npm run package:win' first
)

pause 