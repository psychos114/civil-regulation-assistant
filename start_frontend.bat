@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "frontend\dist\client\index.html" (
    echo ERROR: Frontend build not found.
    echo Please run npm install and npm run build inside the frontend folder.
    pause
    exit /b 1
)
copy /Y "frontend\public\config.js" "frontend\dist\client\config.js" >nul
echo Frontend: http://127.0.0.1:8000
python -m http.server 8000 --bind 0.0.0.0 --directory "frontend\dist\client"

echo.
echo Frontend stopped. Press any key to close.
pause >nul
