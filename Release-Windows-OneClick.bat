@echo off
rem Pulls, checks out the newest release tag, runs npm ci, then builds, signs,
rem uploads and publishes the Windows release (scripts\release-windows.ps1).
rem Everything below is one line on purpose: the checkout can replace this file,
rem and cmd.exe reads batch files line by line while they run. PSModulePath is
rem cleared so Windows PowerShell 5.1 loads its own modules (signature checks).
rem "call" expands %%ERRORLEVEL%% after PowerShell exits, not when the line is read.
cd /d "%~dp0" & set "PSModulePath=" & powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release-windows.ps1" & call set "RELEASE_EXIT=%%ERRORLEVEL%%" & pause & call cmd /c exit %%RELEASE_EXIT%% & exit /b
