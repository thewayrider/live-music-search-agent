const fs = require('fs');
const path = require('path');
const { processSongEntry, getCatalogStats, slugify } = require('./catalogDb');

/**
 * Reads all previous JSON files (including base and subsequent runs) 
 * for a specific crawler directory.
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

/**
 * Compares current results with previous reports and the central SQLite database.
 * Deduplicates across crawlers while tracking multi-source consensus Heat Scores.
 */
function getNewAdditions(currentResults, previousResults = []) {
    if (!Array.isArray(currentResults) || currentResults.length === 0) {
        return [];
    }

    // Tally URLs in previous results to identify unique track URLs vs multi-track collection/chart URLs
    const urlCounts = new Map();
    previousResults.forEach(item => {
        if (item.url) {
            const cleanUrl = item.url.split('?')[0].replace(/\/$/, "");
            urlCounts.set(cleanUrl, (urlCounts.get(cleanUrl) || 0) + 1);
        }
    });

    const previousKeys = new Set();
    const previousTrackUrls = new Set();
    
    previousResults.forEach(item => {
        previousKeys.add(`${item.channel}::${item.title}`);
        previousKeys.add(`${item.channel}::${slugify(item.title)}`);
        
        if (item.url) {
            const cleanUrl = item.url.split('?')[0].replace(/\/$/, "");
            if (urlCounts.get(cleanUrl) === 1 && !cleanUrl.endsWith('/charts')) {
                previousTrackUrls.add(cleanUrl);
            }
        }
    });

    const newAdditions = [];
    let consensusUpdates = 0;

    for (const item of currentResults) {
        if (!item || !item.title) continue;

        // 1. Check local crawler run duplicates
        const exactKey = `${item.channel}::${item.title}`;
        const slugKey = `${item.channel}::${slugify(item.title)}`;
        const cleanUrl = item.url ? item.url.split('?')[0].replace(/\/$/, "") : '';

        const isLocalDuplicate = previousKeys.has(exactKey) ||
                                previousKeys.has(slugKey) ||
                                (cleanUrl && previousTrackUrls.has(cleanUrl));

        // 2. Process against Central SQLite Database
        let dbOutcome = null;
        try {
            dbOutcome = processSongEntry(item, item.channel);
        } catch (dbErr) {
            // Graceful fallback if SQLite is temporarily locked
            console.warn(`[Diff Engine] Catalog DB warning:`, dbErr.message);
        }

        if (dbOutcome) {
            // Attach live consensus heat score to item description
            if (dbOutcome.heatScore > 1) {
                const heatTag = `[Heat: ${dbOutcome.heatScore} sources]`;
                if (!item.description.includes('[Heat:')) {
                    item.description = `${heatTag} ${item.description}`;
                }
            }

            if (!isLocalDuplicate && dbOutcome.isNewGlobal) {
                // Brand-new global discovery
                newAdditions.push(item);
            } else if (!isLocalDuplicate && dbOutcome.isNewSighting) {
                // Sighted by a new tastemaker source (Cross-crawler consensus)
                consensusUpdates++;
                console.log(`[Tastemaker Heat] "${item.title}" gained multi-source consensus! (Heat: ${dbOutcome.heatScore} sources: ${dbOutcome.sources.join(', ')})`);
                newAdditions.push(item);
            }
        } else {
            // Fallback to local-only deduplication
            if (!isLocalDuplicate) {
                newAdditions.push(item);
            }
        }
    }

    if (consensusUpdates > 0) {
        console.log(`[Diff Engine] ${consensusUpdates} track(s) achieved cross-agent tastemaker consensus.`);
    }

    return newAdditions;
}

module.exports = {
    getPreviousReport,
    getNewAdditions,
    slugify
};
