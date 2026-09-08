@echo off
cd /d "%~dp0"

echo Running Spotify New Music Friday AU NZ Crawler...
node src/index.js configs/spotify_new_music_au_nz.json

echo Crawler finished!
