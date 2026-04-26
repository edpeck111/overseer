@echo off
REM First-time dev setup. Creates a venv and installs Python + Node deps.

cd /d %~dp0..

if not exist .venv (
    echo [overseer] creating venv at v3\app\.venv ...
    python -m venv .venv
    if errorlevel 1 exit /b 1
)
call .venv\Scripts\activate.bat
echo [overseer] installing python deps ...
pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo.
echo [overseer] setting up shell ...
cd shell
if not exist node_modules call npm install
if errorlevel 1 exit /b 1

echo.
echo [overseer] dev setup complete.
echo.
echo Next:
echo   1. Open one terminal and run:  scripts\dev_backend.bat
echo   2. Open a second terminal and run:  scripts\dev_shell.bat
echo   3. Visit http://127.0.0.1:5000/
