@echo off
REM Watch-mode build of the OVERSEER v3 shell. Rebuilds shell\dist on save.

cd /d %~dp0..\shell
if not exist node_modules (
    echo [overseer] installing shell deps...
    call npm install
    if errorlevel 1 exit /b 1
)
call npm run dev
