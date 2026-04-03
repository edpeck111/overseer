@echo off
echo ========================================
echo  O.V.E.R.S.E.E.R. Startup
echo ========================================
echo.

:: Start Kiwix in background
echo [1/2] Starting knowledge base server...
start /B "" cmd /c "%~dp0start_kiwix.bat"
timeout /t 3 /nobreak >nul

:: Start Flask server
echo [2/2] Starting OVERSEER web interface...
echo.
echo   Open http://localhost:6100 in your browser
echo   Press Ctrl+C to shut down
echo.
python "%~dp0server.py"
