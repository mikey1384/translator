@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0translator-owner-supervisor.exe" --supervise 2 -- "%~dp0..\Translator.exe" "%~dp0packaged-mcp.mjs" %*
exit /b %errorlevel%
