const DEFAULTS = {
  sourceService: 'Triple J Unearthed',
  defaultCountry: 'Australia',
};

async function getRecentPlays(limit = 100) {
    const url = `https://music.abcradio.net.au/api/v1/plays/search.json?station=unearthed&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ABC API Error: ${res.statusText}`);
    return await res.json();
}

function scoreRelease(item) {
    let score = 6; // Base score for Unearthed (higher baseline for discovery)
    if (item.recording && item.recording.artists && item.recording.artists.some(a => a.is_australian)) score += 2;
    return score;
}

function bucketFromScore(score) {
    if (score >= 7) return "Best matches";
    if (score >= 5) return "Worth checking";
    return "Manual review";
}

async function runTripleJUnearthedAgent(config = {}, exclusions = {}) {
    const options = { ...DEFAULTS, ...config };
    console.log(`[Triple J Unearthed Agent] Fetching recently played tracks from ABC API...`);
    
    const data = await getRecentPlays(100);
    const currentYear = new Date().getFullYear().toString();
    
    const unifiedResults = [];
    const seenSongs = new Set();
    
    for (const item of data.items) {
        if (!item.recording) continue; // Unearthed tracks often don't have 'release' objects
        
        const artist = item.recording.artists ? item.recording.artists.map(a => a.name).join(', ') : 'Unknown';
        const title = item.recording.title || 'Unknown';
        const songKey = `${artist}-${title}`.toLowerCase();
        
        if (seenSongs.has(songKey)) continue; // Deduplicate
        seenSongs.add(songKey);
        
        const score = scoreRelease(item);
        const bucket = bucketFromScore(score);
        
        // Artwork is sometimes in release, sometimes recording. Try recording first for Unearthed.
        let artworkUrl = '';
        if (item.recording.artwork && item.recording.artwork.length > 0) {
            artworkUrl = item.recording.artwork[0].url;
        } else if (item.release && item.release.artwork && item.release.artwork.length > 0) {
            artworkUrl = item.release.artwork[0].url;
        }
        
        const imgTag = artworkUrl ? `<img src="${artworkUrl}" style="height:50px">` : '';
        
        let description = `Score: ${score} | Played: ${item.played_time.slice(0,10)}`;
        if (imgTag) description += ` | Cover: ${imgTag}`;
        
        unifiedResults.push({
            title: `${artist} - ${title}`,
            channel: options.sourceService,
            url: `https://www.abc.net.au/triplejunearthed/`, 
            views: bucket,
            uploadedAt: item.played_time.slice(0,10),
            description: description
        });
    }
    
    console.log(`[Triple J Unearthed Agent] Found ${unifiedResults.length} tracks in the last 100 plays.`);
    return unifiedResults;
}

module.exports = { runTripleJUnearthedAgent };
