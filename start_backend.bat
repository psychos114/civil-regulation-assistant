@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install -r requirements.txt

if not exist ".env" copy ".env.example" ".env" >nul
python init_db.py
python run.py

echo.
echo Backend stopped. Press any key to close.
pause >nul
