@echo off
TITLE MediaHub PRO - High-Speed Universal Downloader
cd /d "%~dp0"

echo ========================================================
echo     MediaHub PRO - Fast YouTube, TikTok & IG Engine     
echo ========================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b
)

:: Install npm packages if needed
if not exist "node_modules\" (
    echo [INFO] Installing required dependencies...
    call npm install
)

:: Check and download yt-dlp.exe if missing
if not exist "bin\yt-dlp.exe" (
    echo [INFO] Setting up yt-dlp core binary...
    node scripts\setup-tools.js
)

echo.
echo [INFO] Launching MediaHub PRO Server at http://localhost:3000 ...
start http://localhost:3000
node server.js

pause
