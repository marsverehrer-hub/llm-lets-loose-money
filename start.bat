@echo off
setlocal
title LLM: Lets Loose Money
cd /d "%~dp0"

rem In the source folder (package.json + Node.js present) rebuild so the game is always current.
rem In a shared zip there is no package.json: the prebuilt dist folder is used and Node.js is not needed.
if exist "package.json" (
  where node >nul 2>nul
  if errorlevel 1 (
    if not exist "dist\index.html" goto :neednode
    echo Node.js not found, starting the last build.
  ) else (
    if not exist "node_modules" (
      echo Installing dependencies, first run only...
      call npm install --no-fund --no-audit
      if errorlevel 1 goto :fail
    )
    echo Building the game...
    call npx vite build --logLevel warn
    if errorlevel 1 goto :fail
  )
)

if not exist "dist\index.html" goto :neednode

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1" -Root "%~dp0dist"
if errorlevel 1 goto :fail
exit /b 0

:neednode
echo.
echo The game has not been built yet, and building it needs Node.js: https://nodejs.org
echo Or ask the host for the ready-made zip (npm run package) which runs without Node.js.
echo.
pause
exit /b 1

:fail
echo.
echo Something went wrong, see the messages above.
pause
exit /b 1
