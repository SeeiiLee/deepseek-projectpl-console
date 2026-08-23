@echo off
setlocal
chcp 65001 >nul
set NO_COLOR=1
set PYTHONUTF8=1
cd /d "%~dp0"

echo [1/3] AnySearch plugin gate...
call npx pnpm@11.19.0 run check:plugins
if errorlevel 1 goto fail

echo [2/3] Build beta portable package...
call npx pnpm@11.19.0 run pack:dev:portable
if errorlevel 1 goto fail

echo [3/3] Stage beta release folder...
call node scripts/stage-releases.js dev
if errorlevel 1 goto fail

echo.
echo DONE. The beta release folder has been refreshed.
pause
exit /b 0

:fail
echo.
echo FAILED. Do not package stable until this passes.
pause
exit /b 1
