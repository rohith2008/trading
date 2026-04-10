@echo off
title Claude TradingView Setup
color 0A
echo.
echo ============================================================
echo   CLAUDE x TRADINGVIEW x ANGELONE — ONE CLICK SETUP
echo ============================================================
echo.

set "ROOT=%~dp0.."
set "ROOT=%ROOT:\=/%"
cd /d "%~dp0.."

:: ── Step 1: Install dependencies ────────────────────────────────────────────
echo [1/5] Installing Node.js dependencies...
call npm install --silent 2>nul
if %errorlevel% neq 0 (
    echo      Installing... (this may take a minute)
    call npm install
)
echo      Done.
echo.

:: ── Step 2: Launch TradingView with CDP ─────────────────────────────────────
echo [2/5] Launching TradingView with CDP (port 9222)...
set "TV_EXE="
powershell -Command "(Get-AppxPackage -Name '*TradingView*' | Select -First 1).InstallLocation" > "%TEMP%\tv_path.txt" 2>nul
set /p TV_DIR=<"%TEMP%\tv_path.txt"
del "%TEMP%\tv_path.txt" 2>nul

if not "%TV_DIR%"=="" (
    set "TV_EXE=%TV_DIR%\TradingView.exe"
)
if "%TV_EXE%"=="" if exist "%LOCALAPPDATA%\TradingView\TradingView.exe" set "TV_EXE=%LOCALAPPDATA%\TradingView\TradingView.exe"
if "%TV_EXE%"=="" if exist "%PROGRAMFILES%\TradingView\TradingView.exe" set "TV_EXE=%PROGRAMFILES%\TradingView\TradingView.exe"

if "%TV_EXE%"=="" (
    echo      TradingView not found. Please launch manually with:
    echo      TradingView.exe --remote-debugging-port=9222
) else (
    taskkill /F /IM TradingView.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    start "" "%TV_EXE%" --remote-debugging-port=9222
    echo      TradingView launched. Waiting for CDP...
    timeout /t 8 /nobreak >nul
    curl -s http://localhost:9222/json/version >nul 2>&1
    if %errorlevel% equ 0 (
        echo      CDP ready at http://localhost:9222
    ) else (
        echo      CDP not ready yet — TV may still be loading.
    )
)
echo.

:: ── Step 3: Create trades output folder ─────────────────────────────────────
echo [3/5] Setting up trades folder...
if not exist "%~dp0..\trades" mkdir "%~dp0..\trades"
echo      Done.
echo.

:: ── Step 4: Brain briefing ───────────────────────────────────────────────────
echo [4/5] Running brain briefing (trade history + lessons)...
node "%~dp0brain_briefing.js"
echo.

:: ── Step 4b: Run first Excel update ──────────────────────────────────────────
echo [4b/5] Generating trade journal Excel...
node "%~dp0update_excel.js"
if %errorlevel% equ 0 (
    echo      Excel created: trades\trade-journal.xlsx
) else (
    echo      Excel generation failed — check TradingView is open.
)
echo.

:: ── Step 5: Start auto-update loop (every 10 min) ───────────────────────────
echo [5/5] Starting auto-updater (every 10 minutes)...
start "Trade Journal Auto-Updater" /min cmd /c "%~dp0auto_update.bat"
echo      Auto-updater running in background.
echo.

:: ── Open Excel ───────────────────────────────────────────────────────────────
echo Opening trade journal...
if exist "%~dp0..\trades\trade-journal.xlsx" (
    start "" "%~dp0..\trades\trade-journal.xlsx"
)

echo.
echo ============================================================
echo   ALL DONE! Claude is connected to TradingView.
echo   Trade journal auto-updates every 10 minutes.
echo   Excel saved at: %~dp0..\trades\trade-journal.xlsx
echo ============================================================
echo.
pause
