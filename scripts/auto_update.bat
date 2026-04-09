@echo off
title Trade Journal Auto-Updater (every 10 min)
echo Trade Journal Auto-Updater started.
echo Updates every 10 minutes. Keep this window open (minimized is fine).
echo.
:loop
echo [%date% %time%] Updating trade journal...
node "%~dp0update_excel.js"
echo [%date% %time%] Next update in 10 minutes.
echo.
timeout /t 600 /nobreak >nul
goto loop
