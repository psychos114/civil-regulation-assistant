@echo off
cd /d "%~dp0"
start "Civil Assistant - FastAPI Backend" cmd /k call "%~dp0start_backend.bat"
start "Civil Assistant - Frontend" cmd /k call "%~dp0start_frontend.bat"
echo Backend and frontend windows are starting.
