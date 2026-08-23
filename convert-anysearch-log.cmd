@echo off
setlocal
cd /d "%~dp0"
node scripts\convert-anysearch-log.mjs
pause
