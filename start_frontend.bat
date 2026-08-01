@echo off
chcp 65001 >nul
cd /d "%~dp0frontend"
echo Frontend: http://127.0.0.1:8000
python -m http.server 8000 --bind 0.0.0.0

echo.
echo Frontend stopped. Press any key to close.
pause >nul
