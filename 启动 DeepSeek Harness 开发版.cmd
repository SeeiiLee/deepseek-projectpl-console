@echo off
rem Dev direct start (no packaging): rebuild plugins, verify, then launch from the source tree.
rem Fully isolated from the stable/test clients: dev identity, separate data dir and DSH_HOME.
setlocal
set "DSH_DESKTOP_FLAVOR=dev"
set "DSH_DESKTOP_USER_DATA=%APPDATA%\DeepSeek Harness Personal Dev"
set "DSH_HOME=%USERPROFILE%\.dsh"
echo [dev-direct-start] rebuilding and verifying plugins...
call npx.cmd -y pnpm@11.19.0 run start
if errorlevel 1 (
  echo [dev-direct-start] failed: send the build/verify errors above to DeepSeek.
  pause
  exit /b 1
)
endlocal
