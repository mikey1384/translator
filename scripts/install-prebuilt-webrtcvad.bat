@echo off
echo Installing prebuilt webrtcvad for Windows...

REM Remove the old webrtcvad package
npm uninstall webrtcvad

REM Install the prebuilt version
npm install @stage5/webrtcvad@1.0.1-stage5.1

echo.
echo ✅ Prebuilt webrtcvad installed successfully!
echo ✅ No Visual Studio Build Tools required!
echo.
echo You can now run subtitle generation without compilation issues.
pause 