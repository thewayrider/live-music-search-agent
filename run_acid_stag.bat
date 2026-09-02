@echo off
cd /d "%~dp0"

echo Running Acid Stag Crawler...
node src/index.js configs/acidstag_indie.json

echo Acid Stag crawler finished!
