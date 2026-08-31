@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
  echo Node.js 24 or later is required. Current:
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call pnpm install
  )
  if errorlevel 1 goto :failed
)

if not exist dist\index.html (
  echo Building the application...
  where pnpm >nul 2>nul
  if errorlevel 1 (
    call npm run build
  ) else (
    call pnpm build
  )
  if errorlevel 1 goto :failed
)

node desktop\start-browser.js
exit /b %errorlevel%

:failed
echo Startup failed. Review the message above.
pause
exit /b 1
