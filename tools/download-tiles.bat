@echo off
REM OVERSEER — Download UK OSM tiles for offline map use
REM Run from the repo root: tools\download-tiles.bat
REM
REM Quick mode (z0-8, ~230 tiles, ~30 seconds):
REM   set MBTILES_MAX_ZOOM=8 && tools\download-tiles.bat
REM
REM Full UK map (z0-14, ~40,000 tiles, several hours):
REM   tools\download-tiles.bat

echo OVERSEER tile downloader
echo.
python tools\download_tiles.py
