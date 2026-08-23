@echo off
setlocal
"%~dp0translator-owner-supervisor.exe" --supervise 2 -- node "%~dp0..\src\mcp.mjs" %*
exit /b %errorlevel%
