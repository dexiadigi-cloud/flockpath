@echo off
REM Stops the Flockpath worker started by start-flockpath.bat.
taskkill /FI "WINDOWTITLE eq Flockpath worker" /F >nul 2>nul
echo Flockpath worker stopped, if it was running.
