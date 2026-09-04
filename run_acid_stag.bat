@echo off
cd /d "%~dp0"

echo Running Acid Stag Crawler...
node src/index.js configs/acid_stag.json

echo Acid Stag crawler finished!
