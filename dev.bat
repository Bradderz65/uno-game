@echo off
title UNO Dev Server (Live Reload)
cd /d "%~dp0"

echo.
echo ========================================
echo    UNO Dev Server - Live Code Updates
echo ========================================
echo.

:: Start dev server
echo Starting development server...
echo.
echo When ready, open: http://localhost:5173
echo.
echo Make changes to CSS/JS files and they will
echo update instantly without refreshing!
echo.
echo Press Ctrl+C to stop the server.
echo.

npm run dev
