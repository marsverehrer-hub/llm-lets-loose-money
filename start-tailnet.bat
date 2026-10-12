@echo off
setlocal
title LLM: Lets Loose Money (tailnet)
cd /d "%~dp0"

rem Builds the game, serves it on 127.0.0.1:5381 and publishes it over HTTPS on this machine's tailnet name
rem (tailscale serve). Open the printed https://....ts.net address on any device in your tailnet, e.g. your phone.
rem Close this window to stop the local server. "tailscale serve --https=8443 off" removes the tailnet publish. Port 8443 keeps it apart from other apps on the root address.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed: https://nodejs.org
  pause
  exit /b 1
)
where tailscale >nul 2>nul
if errorlevel 1 (
  echo Tailscale is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies, first run only...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :fail
)
echo Building the game...
call npx vite build --logLevel warn
if errorlevel 1 goto :fail

rem PUBLIC=1 (start-public.bat) uses Tailscale Funnel so people outside your tailnet can open the link too.
if "%PUBLIC%"=="1" (
  echo Publishing on the public internet with Tailscale Funnel...
  tailscale funnel --bg --https=8443 5381
) else (
  echo Publishing on your tailnet...
  tailscale serve --bg --https=8443 5381
)
if errorlevel 1 goto :fail
echo.
tailscale serve status
echo.
echo Open the https address above on your phone. On iPhone: Share, then Add to Home Screen to install it.
echo.
node scripts\serve-dist.mjs 5381 dist
echo.
pause
exit /b 0

:fail
echo.
echo Something went wrong, see the messages above.
pause
exit /b 1
