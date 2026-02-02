@echo off
title UNO Multiplayer Game
cd /d "%~dp0"

echo.
echo ========================================
echo    UNO Multiplayer - Starting...
echo ========================================
echo.

:: Start the server in background
start /b node server/index.js > server.log 2>&1

:: Wait for server to be ready
echo Waiting for server to start...
:wait_loop
timeout /t 1 /nobreak > nul
findstr /c:"UNO Server Started" server.log > nul 2>&1
if errorlevel 1 goto wait_loop

echo Server is ready!
echo.

:: Get local IP from log
for /f "tokens=2 delims= " %%a in ('findstr /c:"Network:" server.log') do set NETWORK_URL=%%a

echo Opening browser...
echo.
echo ========================================
echo    Local:   http://localhost:3000
echo    Network: %NETWORK_URL%
echo ========================================
echo.
echo Share the Network URL with other players!
echo.
echo Press any key to stop the server and exit...
echo.

:: Open browser
start http://localhost:3000

:: Wait for user input
pause > nul

:: Kill node processes for this game
echo.
echo Stopping server...
taskkill /f /im node.exe > nul 2>&1

:: Clean up log file
del server.log > nul 2>&1

echo Done!
