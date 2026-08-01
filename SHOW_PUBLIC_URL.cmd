@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "PUBLIC_URL.txt" (
    echo No public address has been generated yet.
    echo Run start_internet_access.bat first.
    pause
    exit /b 1
)
echo.
echo Current saved public address:
echo.
type "PUBLIC_URL.txt"
echo.
type "PUBLIC_URL.txt" | clip
echo The address has been copied to your clipboard.
pause
