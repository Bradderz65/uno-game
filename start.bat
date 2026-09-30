@echo off
title UNO Multiplayer
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install || goto :error
)

echo.
echo ========================================
echo    UNO Multiplayer
echo ========================================
echo.
echo  The game opens in your browser in a moment.
echo  Share the "Network" address below with players on your Wi-Fi.
echo  Close this window or press Ctrl+C to stop the server.
echo.

:: Open the browser once the server has had a moment to start.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

node server/index.js
goto :eof

:error
echo.
echo Something went wrong. Is Node.js installed? https://nodejs.org
pause
