const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { slugify, normalizeKey, parseArtistTitle } = require('./normalizer');

/**
 * Resolves the path to the Unified Master SQLite database.
 * Supports Desktop PC, Mini PC, environment variable overrides, and local fallback.
 */
function resolveMasterDbPath() {
    if (process.env.MASTER_DB_PATH && fs.existsSync(process.env.MASTER_DB_PATH)) {
        return process.env.MASTER_DB_PATH;
    }

    const candidates = [
        // Desktop PC path to new-indie-live-twentyfour master catalog
        path.resolve(__dirname, '../../../../new-indie-live-twentyfour/data/master_catalog.sqlite'),
        path.resolve(__dirname, '../../../new-indie-live-twentyfour/data/master_catalog.sqlite'),
        // Mini PC path
        'C:/Antigravity Projects/new-indie-live-twentyfour/data/master_catalog.sqlite',
        // Local project fallbacks
        path.resolve(__dirname, '../../data/master_catalog.sqlite'),
        path.resolve(__dirname, '../../data/music_catalog.sqlite')
    ];

    for (const cand of candidates) {
        if (fs.existsSync(cand)) return cand;
    }

    // Default to sibling path or local data dir
    const defaultDataDir = path.resolve(__dirname, '../../data');
    if (!fs.existsSync(defaultDataDir)) {
        fs.mkdirSync(defaultDataDir, { recursive: true });
    }
    return path.join(defaultDataDir, 'master_catalog.sqlite');
}

const DB_PATH = resolveMasterDbPath();
let _dbInstance = null;

/**
 * Returns a singleton instance of the Unified Master SQLite database.
 */
function getDatabase() {
    if (_dbInstance) return _dbInstance;

    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    _dbInstance = new DatabaseSync(DB_PATH);

    // Initialize Schema (compatible with new-indie-live-twentyfour & Command Center)
    _dbInstance.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            first_seen_at TEXT NOT NULL,
            first_channel TEXT NOT NULL,
            first_url TEXT,
            release_date TEXT,
            release_type TEXT,
            description TEXT,
            heat_score INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sightings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            channel_name TEXT NOT NULL,
            source_url TEXT,
            seen_at TEXT NOT NULL,
            UNIQUE(song_id, channel_name)
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
    const releaseType = item.releaseType || "single";

    // 1. Check if song exists in unified catalog
    const findStmt = db.prepare(`SELECT * FROM songs WHERE slug = ?`);
    const existing = findStmt.get(slug);

    if (!existing) {
        // Brand-new global discovery
        const insertSong = db.prepare(`
            INSERT INTO songs (artist, title, slug, first_seen_at, first_channel, first_url, release_date, release_type, description, heat_score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const result = insertSong.run(artist, title, slug, seenAt, source, url, seenAt, releaseType, desc);
        const songId = Number(result.lastInsertRowid);

        const insertSighting = db.prepare(`
            INSERT INTO sightings (song_id, channel_name, source_url, seen_at)
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
    const findSighting = db.prepare(`SELECT id FROM sightings WHERE song_id = ? AND channel_name = ?`);
    const existingSighting = findSighting.get(songId, source);

    if (!existingSighting) {
        // New sighting from a distinct tastemaker -> Consensus Heat increases!
        const insertSighting = db.prepare(`
            INSERT INTO sightings (song_id, channel_name, source_url, seen_at)
            VALUES (?, ?, ?, ?)
        `);
        insertSighting.run(songId, source, url, seenAt);

        // Compute updated heat score
        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM sightings WHERE song_id = ?`);
        const heatCount = Number(countStmt.get(songId).count);

        const updateHeat = db.prepare(`UPDATE songs SET heat_score = ? WHERE id = ?`);
        updateHeat.run(heatCount, songId);

        const allSourcesStmt = db.prepare(`SELECT channel_name FROM sightings WHERE song_id = ?`);
        const sources = allSourcesStmt.all(songId).map(s => s.channel_name);

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
        SELECT s.id, s.artist, s.title, s.slug, s.first_seen_at, s.first_channel, s.heat_score
        FROM songs s
        WHERE s.heat_score > 1
        ORDER BY s.heat_score DESC, s.first_seen_at DESC
        LIMIT ?
    `).all(limit);

    return rows.map(r => {
        const sources = db.prepare(`SELECT channel_name, source_url, seen_at FROM sightings WHERE song_id = ?`).all(r.id);
        return {
            ...r,
            sightings: sources
        };
    });
}

module.exports = {
    getDatabase,
    processSongEntry,
    getCatalogStats,
    getTopConsensusTracks,
    slugify,
    normalizeKey,
    DB_PATH
};
