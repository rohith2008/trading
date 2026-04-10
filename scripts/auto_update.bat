@echo off
title Trade Journal Price Watcher (every 30s)
echo Trade Journal Price Watcher started.
echo Checks prices every 30 seconds. Keep this window open (minimized is fine).
echo Press Ctrl+C to stop.
echo.
node "%~dp0price_watcher.js"
if %errorlevel% neq 0 (
  echo.
  echo ERROR: price_watcher.js exited with code %errorlevel%.
  echo Make sure TradingView is open with the debug port enabled.
  pause
)
