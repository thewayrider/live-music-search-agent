@echo off
cd /d "%~dp0"

echo Running Triple J ABC Crawler...
node src/index.js configs/triplej_indie.json

echo Triple J crawler finished!
