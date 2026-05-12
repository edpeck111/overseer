@echo off
REM ============================================
REM  O.V.E.R.S.E.E.R. — Remote Deploy from Windows
REM  Pushes to GitHub then SSHs to OPi5 to pull + restart
REM
REM  Usage: deploy.bat
REM ============================================

echo ========================================
echo  O.V.E.R.S.E.E.R. REMOTE DEPLOYMENT
echo ========================================
echo.

set OPI_HOST=orangepi@192.168.0.124
set REMOTE_SCRIPT=~/overseer/deploy.sh

echo [1/2] Pushing to GitHub...
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo PUSH FAILED. Commit and try again.
    pause
    exit /b 1
)
echo.

echo [2/2] Deploying to Orange Pi 5...
ssh %OPI_HOST% "%REMOTE_SCRIPT%"
if %ERRORLEVEL% NEQ 0 (
    echo SSH FAILED. Check connection to %OPI_HOST%
    pause
    exit /b 1
)

echo.
echo DEPLOYMENT COMPLETE.
pause
