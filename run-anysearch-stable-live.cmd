@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Stable packaging will run ONLY after beta search is verified.
node scripts\run-anysearch-stable-release.mjs
echo.
echo Log: %~dp0anysearch-stable.log
pause
