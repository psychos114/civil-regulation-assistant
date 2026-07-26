@echo off
setlocal
title Regulation Assistant - Internet Access
cd /d "%~dp0"

echo.
echo ============================================================
echo Regulation Assistant - Internet Access
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" goto no_python
if not exist "server.py" goto no_server

if not exist "tools" mkdir "tools"
if exist "tools\cloudflared.exe" goto tool_ready

call :find_download
if exist "tools\cloudflared.exe" goto tool_ready

echo The Internet access tool is not installed yet.
echo.
echo A browser download page will now open.
echo Wait until the download is completely finished.
echo Then return to this black window and press any key.
echo.
start "" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
pause >nul

call :find_download
if not exist "tools\cloudflared.exe" goto no_tool

:tool_ready
echo Internet access tool is ready.
echo.

netstat -ano | findstr /R /C:":5000 .*LISTENING" >nul
if errorlevel 1 (
    echo Starting the local website...
    start "Regulation Assistant Local Server" cmd /k ""%~dp0.venv\Scripts\python.exe" "%~dp0server.py""
    timeout /t 4 /nobreak >nul
) else (
    echo Port 5000 is already running.
)

echo.
echo ============================================================
echo Creating a temporary public HTTPS address...
echo.
echo Copy the https://...trycloudflare.com address shown below.
echo Send that address to the other person.
echo Keep this window open while they use the website.
echo ============================================================
echo.

"%~dp0tools\cloudflared.exe" tunnel --no-autoupdate --logfile "%~dp0public_tunnel.log" --url http://127.0.0.1:5000

echo.
echo The public connection has stopped.
pause
exit /b

:find_download
for %%F in ("%USERPROFILE%\Downloads\cloudflared-windows-amd64*.exe") do (
    if exist "%%~fF" if not exist "tools\cloudflared.exe" move /y "%%~fF" "tools\cloudflared.exe" >nul
)
exit /b

:no_python
echo ERROR: .venv\Scripts\python.exe was not found.
echo The Python environment needs to be installed first.
pause
exit /b 1

:no_server
echo ERROR: server.py was not found.
pause
exit /b 1

:no_tool
echo.
echo ERROR: The downloaded file was not found.
echo.
echo Check your Downloads folder for:
echo cloudflared-windows-amd64.exe
echo.
echo If the file is there, move it into:
echo %~dp0tools
echo.
echo Then rename it to:
echo cloudflared.exe
echo.
pause
exit /b 1
