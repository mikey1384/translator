@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"

set "APP_DIR=dist\win-unpacked"
set "RESOURCES=%APP_DIR%\resources"
set "TEST_EXIT=0"
set "NO_LAUNCH=0"
set "REQUIRE_SIGNATURES=1"

:parse_args
if "%~1"=="" goto :args_parsed
if /i "%~1"=="--no-launch" (
  set "NO_LAUNCH=1"
) else if /i "%~1"=="--allow-unsigned" (
  set "REQUIRE_SIGNATURES=0"
) else (
  echo [FAIL] Unknown argument: %~1 1>&2
  exit /b 2
)
shift
goto :parse_args

:args_parsed

echo Testing Windows packaged application...

if not exist "%APP_DIR%\Translator.exe" (
  echo [FAIL] Translator.exe not found in %APP_DIR%\ 1>&2
  echo Run npm run package:win first. 1>&2
  exit /b 1
)

for %%A in ("%APP_DIR%\Translator.exe") do echo Translator.exe size: %%~zA bytes

for %%F in (
  packaged-mcp.mjs
  transport-bound-lifecycle.mjs
  native-owner-monitor.mjs
  packaged-agent-protocol.mjs
  stream-codecs.mjs
  packaged-tool-map.mjs
  canonical-json.mjs
  job-store.mjs
  job-owner-lease.mjs
  mcp-v2-contract.mjs
  mcp-v2-service.mjs
  render-checkpoint-recovery.mjs
  srt.mjs
  subtitle-quality.mjs
  tool-schema-validator.mjs
  packaged-socket-path.mjs
  translator-mcp.cmd
  translator-owner-supervisor.exe
) do (
  if not exist "%RESOURCES%\%%F" (
    echo [FAIL] Missing packaged agent runtime: %%F 1>&2
    set "TEST_EXIT=1"
  )
)

if not "!TEST_EXIT!"=="0" exit /b !TEST_EXIT!

node "%SCRIPT_DIR%verify-packaged-runtime.cjs" "%APP_DIR%" win32 x64
if errorlevel 1 exit /b !errorlevel!

node "%SCRIPT_DIR%verify-windows-media.cjs" "%APP_DIR%"
if errorlevel 1 exit /b !errorlevel!

if "!REQUIRE_SIGNATURES!"=="1" (
  powershell -NoProfile -NonInteractive -Command "$paths=@('%APP_DIR%\Translator.exe','%RESOURCES%\translator-owner-supervisor.exe'); foreach($path in $paths){$signature=Get-AuthenticodeSignature -LiteralPath $path; if($signature.Status -ne 'Valid'){Write-Error ('Invalid Authenticode signature: '+$path+' ('+$signature.Status+')'); exit 1}; if((-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)CN=Stage5 Tools LLC(?:,|$)')){Write-Error ('Unexpected Authenticode signer: '+$path+' ('+$signature.SignerCertificate.Subject+')'); exit 1}}"
  if errorlevel 1 set "TEST_EXIT=1"
) else (
  echo Skipping Authenticode validation for the unsigned CI preflight.
)

if not "!TEST_EXIT!"=="0" exit /b !TEST_EXIT!

echo Windows package validation passed.
if "%NO_LAUNCH%"=="1" exit /b 0

echo Launching Translator.exe for the interactive smoke test...
start "" "%APP_DIR%\Translator.exe"
if errorlevel 1 exit /b %errorlevel%

exit /b 0
