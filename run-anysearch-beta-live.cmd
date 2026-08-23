@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node scripts\run-anysearch-beta-gate.mjs
echo.
echo Log: %~dp0anysearch-build.log
pause
