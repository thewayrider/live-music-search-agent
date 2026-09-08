@echo off
cd /d "%~dp0"

echo Running Spotify All New Indie Crawler...
node src/index.js configs/spotify_all_new_indie.json

echo Crawler finished!
