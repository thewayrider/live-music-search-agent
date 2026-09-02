const fs = require('fs');
const path = require('path');

/**
 * Reads all previous JSON files (including base and subsequent runs) 
 * to compile a full list of all previously seen songs.
 */
function getPreviousReport(savedSearchesDir, currentFilename) {
    if (!fs.existsSync(savedSearchesDir)) return [];

    const files = fs.readdirSync(savedSearchesDir)
        .filter(f => f.endsWith('.json') && f !== currentFilename);

    let allSeenSongs = [];
    
    for (const f of files) {
        try {
            const data = fs.readFileSync(path.join(savedSearchesDir, f), 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                allSeenSongs = allSeenSongs.concat(parsed);
            }
        } catch (e) {
            console.error(`Error reading report ${f}:`, e);
        }
    }

    return allSeenSongs;
}

function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

/**
 * Compares current results with previous results and returns only items that are new.
 * We uniquely identify a song by its 'title' and 'channel' (category), as well as its URL.
 */
function getNewAdditions(currentResults, previousResults) {
    if (!previousResults || previousResults.length === 0) {
        // If there's no previous run, everything is considered "new"
        return currentResults;
    }

    // Create a Set of previous identifiers
    const previousKeys = new Set();
    
    previousResults.forEach(item => {
        // Add exact match
        previousKeys.add(`${item.channel}::${item.title}`);
        
        // Add slugified match (handles minor formatting changes, invisible characters)
        previousKeys.add(`${item.channel}::${slugify(item.title)}`);
        
        // Add URL match (handles cases where title changes entirely but URL remains)
        if (item.url) {
            const cleanUrl = item.url.split('?')[0].replace(/\/$/, ""); // Strip query params & trailing slash
            previousKeys.add(cleanUrl);
        }
    });

    // Filter current results to find those not in the previous set
    return currentResults.filter(item => {
        const exactKey = `${item.channel}::${item.title}`;
        const slugKey = `${item.channel}::${slugify(item.title)}`;
        const cleanUrl = item.url ? item.url.split('?')[0].replace(/\/$/, "") : '';
        
        return !previousKeys.has(exactKey) && 
               !previousKeys.has(slugKey) && 
               !(cleanUrl && previousKeys.has(cleanUrl));
    });
}

module.exports = {
    getPreviousReport,
    getNewAdditions
};
