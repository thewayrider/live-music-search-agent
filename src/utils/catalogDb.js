const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'music_catalog.sqlite');

let _dbInstance = null;

function slugify(s) {
    return String(s || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100);
}

function normalizeKey(artist, title) {
    const cleanArtist = slugify(artist);
    const cleanTitle = slugify(title);
    return `${cleanArtist}::${cleanTitle}`;
}

function parseArtistTitle(rawTitle) {
    if (!rawTitle) return { artist: "Unknown Artist", title: "Unknown Track" };
    if (rawTitle.includes(" – ")) {
        const parts = rawTitle.split(" – ").map(s => s.trim());
        return { artist: parts[0], title: parts.slice(1).join(" – ") };
    }
    if (rawTitle.includes(" - ")) {
        const parts = rawTitle.split(" - ").map(s => s.trim());
        return { artist: parts[0], title: parts.slice(1).join(" - ") };
    }
    return { artist: "Unknown Artist", title: rawTitle.trim() };
}

/**
 * Returns a singleton instance of the SQLite database.
 */
function getDatabase() {
    if (_dbInstance) return _dbInstance;

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    _dbInstance = new DatabaseSync(DB_PATH);

    // Initialize Schema
    _dbInstance.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            first_seen_at TEXT NOT NULL,
            first_source TEXT NOT NULL,
            release_date TEXT,
            release_type TEXT,
            views TEXT,
            description TEXT,
            heat_score INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sightings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            source_name TEXT NOT NULL,
            source_url TEXT,
            seen_at TEXT NOT NULL,
            UNIQUE(song_id, source_name)
        );

        CREATE INDEX IF NOT EXISTS idx_songs_slug ON songs(slug);
        CREATE INDEX IF NOT EXISTS idx_songs_heat ON songs(heat_score DESC);
        CREATE INDEX IF NOT EXISTS idx_sightings_song ON sightings(song_id);
    `);

    return _dbInstance;
}

/**
 * Processes a song entry, determining if it is a brand-new discovery
 * or a new multi-source sighting (Tastemaker Heat consensus).
 */
function processSongEntry(item, sourceName = "Unknown") {
    const db = getDatabase();

    let artist = item.artist;
    let title = item.title;

    if (!artist) {
        const parsed = parseArtistTitle(item.title);
        artist = parsed.artist;
        title = parsed.title;
    }

    const slug = normalizeKey(artist, title);
    const nowIso = new Date().toISOString();
    const seenAt = item.uploadedAt || nowIso.slice(0, 10);
    const source = item.channel || sourceName;
    const url = item.url || "";
    const views = item.views || "Manual review";
    const desc = item.description || "";

    // 1. Check if song exists
    const findStmt = db.prepare(`SELECT * FROM songs WHERE slug = ?`);
    const existing = findStmt.get(slug);

    if (!existing) {
        // Brand-new global discovery
        const insertSong = db.prepare(`
            INSERT INTO songs (artist, title, slug, first_seen_at, first_source, release_date, views, description, heat_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const result = insertSong.run(artist, title, slug, seenAt, source, seenAt, views, desc);
        const songId = Number(result.lastInsertRowid);

        const insertSighting = db.prepare(`
            INSERT INTO sightings (song_id, source_name, source_url, seen_at)
            VALUES (?, ?, ?, ?)
        `);
        insertSighting.run(songId, source, url, seenAt);

        return {
            isNewGlobal: true,
            isNewSighting: true,
            heatScore: 1,
            sources: [source],
            songId
        };
    }

    // 2. Song already exists in database - check if this source is a new sighting
    const songId = existing.id;
    const findSighting = db.prepare(`SELECT id FROM sightings WHERE song_id = ? AND source_name = ?`);
    const existingSighting = findSighting.get(songId, source);

    if (!existingSighting) {
        // New sighting from a distinct tastemaker -> Consensus Heat increases!
        const insertSighting = db.prepare(`
            INSERT INTO sightings (song_id, source_name, source_url, seen_at)
            VALUES (?, ?, ?, ?)
        `);
        insertSighting.run(songId, source, url, seenAt);

        // Compute updated heat score
        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM sightings WHERE song_id = ?`);
        const heatCount = Number(countStmt.get(songId).count);

        const updateHeat = db.prepare(`UPDATE songs SET heat_score = ? WHERE id = ?`);
        updateHeat.run(heatCount, songId);

        const allSourcesStmt = db.prepare(`SELECT source_name FROM sightings WHERE song_id = ?`);
        const sources = allSourcesStmt.all(songId).map(s => s.source_name);

        return {
            isNewGlobal: false,
            isNewSighting: true,
            heatScore: heatCount,
            sources,
            songId
        };
    }

    // Already seen by this exact source
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM sightings WHERE song_id = ?`);
    const heatCount = Number(countStmt.get(songId).count);

    return {
        isNewGlobal: false,
        isNewSighting: false,
        heatScore: heatCount,
        sources: [source],
        songId
    };
}

/**
 * Returns summary statistics of the central music catalog.
 */
function getCatalogStats() {
    const db = getDatabase();
    const songCount = Number(db.prepare(`SELECT COUNT(*) as c FROM songs`).get().c);
    const sightingCount = Number(db.prepare(`SELECT COUNT(*) as c FROM sightings`).get().c);
    const consensusCount = Number(db.prepare(`SELECT COUNT(*) as c FROM songs WHERE heat_score > 1`).get().c);

    return {
        totalUniqueSongs: songCount,
        totalSightings: sightingCount,
        consensusSongsCount: consensusCount,
        databasePath: DB_PATH
    };
}

/**
 * Returns top consensus tracks sorted by heat score.
 */
function getTopConsensusTracks(limit = 20) {
    const db = getDatabase();
    const rows = db.prepare(`
        SELECT s.id, s.artist, s.title, s.slug, s.first_seen_at, s.first_source, s.heat_score
        FROM songs s
        WHERE s.heat_score > 1
        ORDER BY s.heat_score DESC, s.first_seen_at DESC
        LIMIT ?
    `).all(limit);

    return rows.map(r => {
        const sources = db.prepare(`SELECT source_name, source_url, seen_at FROM sightings WHERE song_id = ?`).all(r.id);
        return {
            ...r,
            sightings: sources
        };
    });
}

/**
 * Backfills the SQLite database from all historical saved_searches JSON files.
 */
function backfillFromHistory(savedSearchesDir) {
    const db = getDatabase();
    if (!fs.existsSync(savedSearchesDir)) return { processed: 0, imported: 0 };

    const subdirs = fs.readdirSync(savedSearchesDir).filter(d => {
        const p = path.join(savedSearchesDir, d);
        return fs.statSync(p).isDirectory() && d !== 'cache';
    });

    let totalProcessed = 0;
    let totalImported = 0;

    for (const sub of subdirs) {
        const subPath = path.join(savedSearchesDir, sub);
        const files = fs.readdirSync(subPath).filter(f => f.endsWith('.json')).sort();

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(subPath, file), 'utf8');
                const items = JSON.parse(content);
                if (Array.isArray(items)) {
                    for (const item of items) {
                        if (!item || !item.title) continue;
                        totalProcessed++;
                        const res = processSongEntry(item, item.channel || sub);
                        if (res.isNewGlobal) totalImported++;
                    }
                }
            } catch (err) {
                console.warn(`[Backfill] Error reading ${file}:`, err.message);
            }
        }
    }

    return {
        processed: totalProcessed,
        uniqueImported: totalImported,
        stats: getCatalogStats()
    };
}

module.exports = {
    getDatabase,
    processSongEntry,
    getCatalogStats,
    getTopConsensusTracks,
    backfillFromHistory,
    slugify,
    normalizeKey,
    DB_PATH
};
