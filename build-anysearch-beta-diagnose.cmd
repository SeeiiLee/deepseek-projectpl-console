@echo off
setlocal
chcp 65001 >nul
set NO_COLOR=1
set PYTHONUTF8=1
cd /d "%~dp0"
set LOG=%~dp0anysearch-build.log

echo === AnySearch beta diagnostic === > "%LOG%" 2>&1
echo Time: %DATE% %TIME% >> "%LOG%" 2>&1

echo [1/3] check:plugins >> "%LOG%" 2>&1
call npx pnpm@11.19.0 run check:plugins >> "%LOG%" 2>&1
set STEP1=%ERRORLEVEL%
echo step1_exit=%STEP1% >> "%LOG%" 2>&1
if not "%STEP1%"=="0" goto done

echo [2/3] pack:dev:portable >> "%LOG%" 2>&1
call npx pnpm@11.19.0 run pack:dev:portable >> "%LOG%" 2>&1
set STEP2=%ERRORLEVEL%
echo step2_exit=%STEP2% >> "%LOG%" 2>&1
if not "%STEP2%"=="0" goto done

echo [3/3] stage dev >> "%LOG%" 2>&1
call node scripts/stage-releases.js dev >> "%LOG%" 2>&1
set STEP3=%ERRORLEVEL%
echo step3_exit=%STEP3% >> "%LOG%" 2>&1

:done
echo.
echo Log written to: %LOG%
pause
exit /b 0
