@echo off
title Charon-Study Dev Preview
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo ============================================
echo   Charon-Study - Dev Preview
echo ============================================
echo   Frontend edits: hot-reload instantly
echo   Rust edits: auto-recompile (seconds)
echo   Only first launch / Rust dep change is slow
echo   Stop: press Ctrl+C or close this window
echo ============================================
echo.
if not exist "node_modules" (
  echo [first run] installing dependencies...
  call pnpm install
)
echo Starting Tauri dev preview...
echo.
call pnpm tauri dev
echo.
echo Preview exited. Press any key to close.
pause >nul