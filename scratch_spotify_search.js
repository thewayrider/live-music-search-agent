const fs = require('fs');

async function getAccessToken(clientId, clientSecret, refreshToken) {
    const authStr = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authStr}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });
    const data = await response.json();
    return data.access_token;
}

async function testSearch() {
    const secrets = JSON.parse(fs.readFileSync('./configs/secrets.json', 'utf-8'));
    const token = await getAccessToken(secrets.spotifyClientId, secrets.spotifyClientSecret, secrets.spotifyRefreshToken);
    
    const query = encodeURIComponent('tag:new');
    const url = `https://api.spotify.com/v1/search?q=${query}&type=album`;
    
    console.log(`Fetching: ${url}`);
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    
    if (data.albums && data.albums.items) {
        console.log(`Found ${data.albums.items.length} albums.`);
        // Let's print the first 5 with their release dates
        for (let i = 0; i < 5; i++) {
            if (data.albums.items[i]) {
                const album = data.albums.items[i];
                console.log(`${album.release_date} - ${album.name} by ${album.artists[0].name} (${album.album_type})`);
            }
        }
    } else {
        console.log("Error or no albums found:", JSON.stringify(data, null, 2));
    }
}
testSearch().catch(console.error);
