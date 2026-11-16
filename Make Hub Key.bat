@echo off
title Make a hub key
chcp 65001 >nul
cd /d "%~dp0"
echo This makes a hub's key, which signs its catalog. Run it once per hub, before that hub's first release; both hubs
echo have theirs already. It asks which hub, then for a password you choose. The private half is saved in "<hub name> key"
echo in your user folder (never in this repository, never on GitHub); keep a backup of that folder. The public half goes
echo into the hub's brand.json in the brands folder.
echo.
where node >nul 2>nul || (echo Node.js is not installed. Get it from nodejs.org, then run this again. & goto :end)
node tools\make-hub-key.mjs %*
:end
echo.
pause
