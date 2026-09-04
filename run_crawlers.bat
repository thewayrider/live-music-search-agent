@echo off
cd /d "%~dp0"



echo Running Bandcamp Crawler...
node src/index.js configs/bandcamp_indie.json

echo Running Futuremag Crawler...
node src/index.js configs/futuremag_indie.json

echo Running Happy Mag Crawler...
node src/index.js configs/happymag_indie.json

echo Running ListenBrainz Crawler...
node src/index.js configs/listenbrainz_indie.json

echo Sending Rolling Stone AU Weekly Reminder...
node src/sendRollingStoneReminder.js

echo Running Triple J Crawler...
node src/index.js configs/triplej_indie.json

echo All crawlers finished!
