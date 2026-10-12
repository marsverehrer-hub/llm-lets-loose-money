@echo off
setlocal
title LLM: Lets Loose Money (Cloudflare link)
cd /d "%~dp0"

rem Builds the game, serves it on 127.0.0.1:5381 and opens a temporary public https://....trycloudflare.com link.
rem No account needed. The link changes every time and stops working when you close this window.

set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=cloudflared"
where node >nul 2>nul || (echo Node.js is needed: https://nodejs.org & pause & exit /b 1)

if not exist "node_modules" call npm install --no-fund --no-audit
echo Building the game...
call npx vite build --logLevel warn || goto :fail

rem The game server runs in its own minimised window; it says so and exits if it is already running.
start "LLM game server" /min cmd /c "node scripts\serve-dist.mjs 5381 dist & pause"
echo.
echo Starting the tunnel. Look for the line with https://....trycloudflare.com below and send that link.
echo It can take up to a minute before the link opens for others.
echo.
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:5381
echo.
pause
exit /b 0

:fail
echo Something went wrong, see the messages above.
pause
exit /b 1
