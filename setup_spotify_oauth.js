const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const secretsPath = path.join(__dirname, 'configs', 'secrets.json');
let secrets = {};
try {
    secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
} catch (e) {
    console.error("Error reading secrets.json. Ensure it exists in the configs folder.");
    process.exit(1);
}

const CLIENT_ID = secrets.spotifyClientId;
const CLIENT_SECRET = secrets.spotifyClientSecret;
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing spotifyClientId or spotifyClientSecret in secrets.json.");
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/callback') {
        const code = parsedUrl.query.code;
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Error: No authorization code found.');
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<h1>Authorizing... please wait.</h1>');

        try {
            const authStr = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
            
            // Note: Since Node 24, global.fetch is available.
            const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authStr}`
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: REDIRECT_URI
                })
            });

            const data = await tokenResponse.json();

            if (data.error) {
                res.write(`<p>Error getting token: ${data.error_description}</p>`);
                res.end();
            } else {
                const refreshToken = data.refresh_token;
                secrets.spotifyRefreshToken = refreshToken;
                fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));

                res.write('<h2>Success!</h2>');
                res.write('<p>Your Spotify Refresh Token has been securely saved to secrets.json.</p>');
                res.write('<p>You can now close this browser window and return to your terminal.</p>');
                res.end();

                console.log('\n[SUCCESS] Refresh token captured and saved to secrets.json!');
                console.log('You can now use the Spotify OAuth Agent.');
                
                // Close server and exit
                server.close(() => process.exit(0));
            }
        } catch (err) {
            console.error(err);
            res.write(`<p>Internal Server Error: ${err.message}</p>`);
            res.end();
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(8888, '127.0.0.1', () => {
    const scope = 'playlist-read-private playlist-read-collaborative user-read-private user-library-read';
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    
    console.log('\n======================================================');
    console.log('Spotify OAuth Setup Started!');
    console.log('======================================================');
    console.log('\nWe need to authorize your app with Spotify.');
    console.log('\nPlease click the link below (or copy/paste into your browser):\n');
    console.log(authUrl);
    console.log('\nWaiting for you to log in and authorize...');
});
