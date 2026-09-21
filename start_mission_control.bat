@echo off
echo Starting Mission Control Dashboard...
echo Opening your browser...
start http://localhost:3000
cd /d "%~dp0mission-control"
call npm run dev
pause
