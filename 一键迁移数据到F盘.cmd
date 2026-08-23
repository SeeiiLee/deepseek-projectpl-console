@echo off
setlocal
cd /d "%~dp0"

rem One-time lossless migration into the installed stable data home:
rem   F:\documents\Cyrus Deepseek Harness Data
rem Close BOTH the stable and the test clients before running this.

set "ELECTRON_EXE=%CD%\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo [ERROR] Desktop dependencies are not installed.
  pause
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
"%ELECTRON_EXE%" "scripts\migrate-to-fdrive.js"
set "MIGRATE_EXIT=%ERRORLEVEL%"
set "ELECTRON_RUN_AS_NODE="

if not "%MIGRATE_EXIT%"=="0" (
  echo.
  echo [ERROR] Migration did not complete. See the message above.
) else (
  echo.
  echo [OK] Migration complete. Now run the stable installer from
  echo      the stable release folder and choose D:\Cyrus Deepseek Harness.
)
pause
exit /b 0
