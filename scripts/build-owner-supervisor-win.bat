@echo off
setlocal EnableExtensions

set "REPO_ROOT=%~dp0.."
set "SOURCE_PATH=%REPO_ROOT%\packages\agent-server\native\translator-owner-supervisor-win.c"
set "OUTPUT_DIR=%REPO_ROOT%\packages\agent-server\bin"
set "OUTPUT_PATH=%OUTPUT_DIR%\translator-owner-supervisor.exe"
set "OBJECT_PATH=%OUTPUT_DIR%\translator-owner-supervisor-win.obj"

where cl.exe >nul 2>nul
if not errorlevel 1 goto :compile

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo translator-owner-supervisor: Visual Studio C++ build tools were not found. 1>&2
  exit /b 1
)

set "VS_INSTALL="
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_INSTALL=%%I"
if not defined VS_INSTALL (
  echo translator-owner-supervisor: Visual Studio C++ build tools were not found. 1>&2
  exit /b 1
)
call "%VS_INSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b %errorlevel%

:compile
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
cl.exe /nologo /O2 /W4 /WX /DUNICODE /D_UNICODE "%SOURCE_PATH%" /Fo:"%OBJECT_PATH%" /Fe:"%OUTPUT_PATH%" /link /SUBSYSTEM:CONSOLE
set "BUILD_EXIT=%errorlevel%"
if exist "%OBJECT_PATH%" del /q "%OBJECT_PATH%"
exit /b %BUILD_EXIT%
