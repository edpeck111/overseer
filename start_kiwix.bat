@echo off
echo Starting kiwix-serve with all ZIM archives...
echo.

set KIWIX=%~dp0kiwix\kiwix-serve.exe
set ZIM_DIR=%~dp0zim

:: Build list of all .zim files
setlocal enabledelayedexpansion
set ZIMS=
for %%f in (%ZIM_DIR%\*.zim) do (
    echo   Loading: %%~nxf
    set ZIMS=!ZIMS! "%%f"
)

echo.
echo Starting server on port 8080...
%KIWIX% --port 8080 %ZIMS%
