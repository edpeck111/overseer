@echo off
REM Run the OVERSEER v3 Flask backend in development mode.
REM Assumes a venv at v3\app\.venv. Run setup_dev.bat first if not present.

cd /d %~dp0..
if not exist .venv\Scripts\activate.bat (
    echo [overseer] no venv found at v3\app\.venv — run scripts\setup_dev.bat first
    exit /b 1
)
call .venv\Scripts\activate.bat
set OVERSEER_DEBUG=1
python -m server.app
