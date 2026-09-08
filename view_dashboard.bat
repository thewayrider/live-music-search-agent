@echo off
cd /d "%~dp0"

echo Generating latest dashboard...
node src/utils/dashboardGenerator.js

echo Opening dashboard in your browser...
start dashboard.html
