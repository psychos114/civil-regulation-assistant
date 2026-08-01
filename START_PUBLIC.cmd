@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Civil Regulation Assistant - Public Access
cd /d "%~dp0"

echo.
echo ============================================================
echo Civil Regulation Assistant - Public Access
echo ============================================================
echo.

if not exist "backend\.venv\Scripts\python.exe" goto no_python
if not exist "backend\run.py" goto no_backend
if not exist "frontend\dist\client\index.html" goto no_frontend

if not exist "tools" mkdir "tools"
if exist "tools\cloudflared.exe" goto tool_ready

if exist "..\regulations_backend\tools\cloudflared.exe" (
    echo Copying the installed public access tool...
    copy /Y "..\regulations_backend\tools\cloudflared.exe" "tools\cloudflared.exe" >nul
)
if exist "tools\cloudflared.exe" goto tool_ready

echo The cloudflared public access tool was not found.
echo A browser download page will now open.
start "" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
echo.
echo After the download finishes, move the file into:
echo %~dp0tools
echo Rename it to cloudflared.exe, then run this file again.
pause
exit /b 1

:tool_ready
echo [1/3] Public access tool is ready.

netstat -ano | findstr /R /C:":5000 .*LISTENING" >nul
if errorlevel 1 (
    echo [2/3] Starting FastAPI and the new frontend...
    start "Civil Assistant - FastAPI" cmd /k call "%~dp0start_backend.bat"
    timeout /t 6 /nobreak >nul
) else (
    echo [2/3] Port 5000 is already running.
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 'http://127.0.0.1:5000/'; if ($r.StatusCode -ne 200) { exit 1 } } catch { exit 1 }"
if errorlevel 1 goto backend_failed

echo [3/3] Creating a trycloudflare.com HTTPS address...
del /Q "public_tunnel_current.log" 2>nul
del /Q "PUBLIC_URL.txt" 2>nul

start "Civil Assistant - Public Tunnel" cmd /k ""%~dp0tools\cloudflared.exe" tunnel --no-autoupdate --protocol http2 --logfile "%~dp0public_tunnel_current.log" --url http://127.0.0.1:5000"

set "PUBLIC_URL="
for /L %%I in (1,1,40) do (
    timeout /t 1 /nobreak >nul
    for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$text = Get-Content -Raw -ErrorAction SilentlyContinue '%~dp0public_tunnel_current.log'; $matches = [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com'); if ($matches.Count -gt 0) { $matches[$matches.Count - 1].Value }"`) do set "PUBLIC_URL=%%U"
    if defined PUBLIC_URL goto public_ready
)
goto tunnel_failed

:public_ready
>"PUBLIC_URL.txt" echo !PUBLIC_URL!
echo.
echo ============================================================
echo PUBLIC LINK READY
echo.
echo !PUBLIC_URL!
echo.
echo The address has been copied to your clipboard and saved in
echo PUBLIC_URL.txt. Send it to the other person.
echo Keep the FastAPI and Public Tunnel windows open while sharing.
echo Closing the Public Tunnel window will stop the public link.
echo ============================================================
echo !PUBLIC_URL!| clip
start "" "!PUBLIC_URL!"
echo.
pause
exit /b 0

:no_python
echo ERROR: backend\.venv\Scripts\python.exe was not found.
echo Run start_all.bat first to install the backend.
pause
exit /b 1

:no_backend
echo ERROR: backend\run.py was not found.
pause
exit /b 1

:no_frontend
echo ERROR: frontend\dist\client\index.html was not found.
echo Build the frontend before starting public access.
pause
exit /b 1

:backend_failed
echo ERROR: Port 5000 did not return the assistant page.
echo Check the FastAPI window for details.
pause
exit /b 1

:tunnel_failed
echo ERROR: A public address was not created within 40 seconds.
echo Check the Civil Assistant - Public Tunnel window for details.
pause
exit /b 1
