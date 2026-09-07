const cheerio = require('cheerio');

const DEFAULTS = {
  playlistId: '',
  sourceService: 'Spotify Playlist',
  defaultCountry: 'Unknown'
};

function scoreRelease(trackTitle, artistName) {
    // Spotify playlists don't give us much context to score heavily,
    // so we give a base score.
    return 5;
}

function bucketFromScore(score) {
    if (score >= 7) return "Best matches";
    if (score >= 5) return "Worth checking";
    return "Manual review";
}

async function runSpotifyEmbedAgent(config = {}, exclusions = {}) {
    const options = { ...DEFAULTS, ...config };
    if (!options.playlistId) {
        console.error("[Spotify Embed Agent] No playlistId provided in config.");
        return [];
    }

    console.log(`[Spotify Embed Agent] Fetching embed for playlist: ${options.playlistId}...`);
    
    // We use the oembed trick to hit the public iframe
    const url = `https://open.spotify.com/embed/playlist/${options.playlistId}?utm_source=oembed`;
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`[Spotify Embed Agent] HTTP Error: ${res.status}`);
        return [];
    }
    const html = await res.text();
    
    const $ = cheerio.load(html);
    const scriptContent = $('#__NEXT_DATA__').html();
    
    if (!scriptContent) {
        console.error("[Spotify Embed Agent] Could not find __NEXT_DATA__ in HTML.");
        return [];
    }
    
    let data;
    try {
        data = JSON.parse(scriptContent);
    } catch (e) {
        console.error("[Spotify Embed Agent] Failed to parse JSON payload.", e);
        return [];
    }
    
    let tracks = [];
    try {
        tracks = data.props.pageProps.state.data.entity.trackList;
    } catch (e) {
        console.error("[Spotify Embed Agent] Could not locate trackList in payload.");
        return [];
    }

    const unifiedResults = [];
    
    for (const track of tracks) {
        if (!track || !track.title) continue;
        
        const title = track.title;
        const artist = track.subtitle || 'Unknown Artist';
        const url = track.uri ? `https://open.spotify.com/track/${track.uri.split(':').pop()}` : '';
        const previewUrl = track.audioPreview ? track.audioPreview.url : '';
        
        const score = scoreRelease(title, artist);
        const bucket = bucketFromScore(score);
        
        let description = `Score: ${score}`;
        if (previewUrl) description += ` | Preview: <audio controls src="${previewUrl}" style="height:20px"></audio>`;
        
        // Since we don't have a reliable uploadedAt date from the embed API,
        // we use today's date for the unified format, but rely on diffEngine
        // to filter out duplicates that we've already seen in previous runs!
        const today = new Date().toISOString().slice(0, 10);

        unifiedResults.push({
            title: `${artist} - ${title}`,
            channel: options.sourceService,
            url: url,
            views: bucket,
            uploadedAt: today, 
            description: description
        });
    }
    
    console.log(`[Spotify Embed Agent] Extracted ${unifiedResults.length} tracks.`);
    return unifiedResults;
}

module.exports = { runSpotifyEmbedAgent };
