@echo off
title Prism Hub: build the installer
chcp 65001 >nul
cd /d "%~dp0"
set HUB_prism=prism
echo This builds Prism Hub and its installer (it installs for the person who runs it, with no administrator rights).
echo Both hubs are built from the same code; this one uses brands\prism. It takes a few minutes the first time.
echo.
echo   Double-click:                 an unsigned installer, for trying on this PC.
echo   With --sign (from a console):  the signed installer for a release (docs\releasing.md says how).
echo.
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & goto :end)
where cargo >nul 2>nul || (echo Rust is not installed. Get it from rustup.rs, then run this again. & goto :end)
if not exist node_modules (call npm.cmd install || goto :end)
node tools\build-installer.mjs --brand prism %* || (echo. & echo THE BUILD FAILED. Copy the red text above and send it to whoever is helping you with the hub. & goto :end)
echo.
echo Done. The installer is in src-tauri\target\release-files, with its SHA-256 beside it.
start "" "src-tauri\target\release-files"
:end
echo.
pause
