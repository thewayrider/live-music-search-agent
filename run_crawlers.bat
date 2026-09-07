@echo off
cd /d "%~dp0"



echo Running Bandcamp Crawler...
node src/index.js configs/bandcamp_indie.json

echo Running Happy Mag Crawler...
node src/index.js configs/happymag_indie.json

echo Running ListenBrainz Crawler...
node src/index.js configs/listenbrainz_indie.json

echo Sending Rolling Stone AU Weekly Reminder...
node src/sendRollingStoneReminder.js

echo All crawlers finished!
