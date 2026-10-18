@echo off
rem One line on purpose: checking out an older release tag removes this file,
rem and cmd.exe reads batch files line by line while they run.
cd /d "%~dp0" & set "PSModulePath=" & powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-windows-release.ps1" & pause & exit /b
