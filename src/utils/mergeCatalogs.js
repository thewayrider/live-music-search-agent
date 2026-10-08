const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const sourceDbPath = path.resolve(__dirname, '../../data/music_catalog.sqlite');
const targetDbPath = path.resolve(__dirname, '../../../../new-indie-live-twentyfour/data/master_catalog.sqlite');

console.log('========================================================');
console.log('🔄 MERGING CATALOGS: music_catalog -> master_catalog');
console.log('========================================================');
console.log(`Source (Weekly Fleet): ${sourceDbPath}`);
console.log(`Target (Master Fleet): ${targetDbPath}`);

if (!fs.existsSync(sourceDbPath)) {
  console.error(`ERROR: Source database not found at ${sourceDbPath}`);
  process.exit(1);
}

if (!fs.existsSync(targetDbPath)) {
  console.error(`ERROR: Target database not found at ${targetDbPath}`);
  process.exit(1);
}

// 1. Backup target database before modifying
const backupPath = `${targetDbPath}.backup-${Date.now()}`;
fs.copyFileSync(targetDbPath, backupPath);
console.log(`✓ Safety backup created: ${backupPath}`);

const sourceDb = new DatabaseSync(sourceDbPath);
const targetDb = new DatabaseSync(targetDbPath);

// Ensure target tables exist
targetDb.exec(`
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

  CREATE INDEX IF NOT EXISTS idx_master_slug ON songs(slug);
  CREATE INDEX IF NOT EXISTS idx_master_heat ON songs(heat_score DESC);
`);

// Fetch all songs from source
const sourceSongs = sourceDb.prepare(`SELECT * FROM songs`).all();
const sourceSightings = sourceDb.prepare(`SELECT * FROM sightings`).all();

console.log(`Found ${sourceSongs.length} songs and ${sourceSightings.length} sightings in source.`);

// Index source sightings by song_id
const sightingsBySongId = new Map();
for (const s of sourceSightings) {
  if (!sightingsBySongId.has(s.song_id)) {
    sightingsBySongId.set(s.song_id, []);
  }
  sightingsBySongId.get(s.song_id).push(s);
}

let newSongsInserted = 0;
let existingSongsMatched = 0;
let newSightingsAdded = 0;

const findSongStmt = targetDb.prepare(`SELECT id, heat_score FROM songs WHERE slug = ?`);
const insertSongStmt = targetDb.prepare(`
  INSERT INTO songs (artist, title, slug, first_seen_at, first_channel, first_url, release_date, release_type, description, heat_score, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSightingStmt = targetDb.prepare(`
  INSERT OR IGNORE INTO sightings (song_id, channel_name, source_url, seen_at)
  VALUES (?, ?, ?, ?)
`);
const updateHeatStmt = targetDb.prepare(`UPDATE songs SET heat_score = ? WHERE id = ?`);
const countSightingsStmt = targetDb.prepare(`SELECT COUNT(*) as c FROM sightings WHERE song_id = ?`);

targetDb.exec('BEGIN TRANSACTION;');

try {
  for (const song of sourceSongs) {
    const existing = findSongStmt.get(song.slug);
    let targetSongId;

    const channelName = song.first_source || 'Weekly Crawler';
    const seenAt = song.first_seen_at || song.created_at || new Date().toISOString().slice(0, 10);
    const releaseType = song.release_type || 'single';
    const desc = song.description || '';
    const firstUrl = song.views || '';

    if (!existing) {
      const res = insertSongStmt.run(
        song.artist,
        song.title,
        song.slug,
        seenAt,
        channelName,
        firstUrl,
        song.release_date || seenAt,
        releaseType,
        desc,
        song.heat_score || 1,
        song.created_at || new Date().toISOString()
      );
      targetSongId = Number(res.lastInsertRowid);
      newSongsInserted++;
    } else {
      targetSongId = existing.id;
      existingSongsMatched++;
    }

    // Process sightings for this song
    const sightings = sightingsBySongId.get(song.id) || [];
    for (const st of sightings) {
      const sSource = st.source_name || channelName;
      const sUrl = st.source_url || '';
      const sSeenAt = st.seen_at || seenAt;

      const sRes = insertSightingStmt.run(targetSongId, sSource, sUrl, sSeenAt);
      if (sRes.changes > 0) {
        newSightingsAdded++;
      }
    }

    // Re-calculate heat score based on total unique sightings
    const totalSightings = Number(countSightingsStmt.get(targetSongId).c);
    if (totalSightings > 0) {
      updateHeatStmt.run(totalSightings, targetSongId);
    }
  }

  targetDb.exec('COMMIT;');
  console.log('✓ Transaction committed successfully.');
} catch (err) {
  targetDb.exec('ROLLBACK;');
  console.error('ERROR during merge:', err);
  process.exit(1);
}

// Final Stats
const totalSongsInTarget = Number(targetDb.prepare(`SELECT COUNT(*) as c FROM songs`).get().c);
const totalSightingsInTarget = Number(targetDb.prepare(`SELECT COUNT(*) as c FROM sightings`).get().c);
const consensusCount = Number(targetDb.prepare(`SELECT COUNT(*) as c FROM songs WHERE heat_score > 1`).get().c);

sourceDb.close();
targetDb.close();

console.log('========================================================');
console.log('📊 UNIFIED MASTER CATALOG SUMMARY:');
console.log(`- New songs migrated:       ${newSongsInserted}`);
console.log(`- Existing songs matched:   ${existingSongsMatched}`);
console.log(`- New sightings logged:     ${newSightingsAdded}`);
console.log('--------------------------------------------------------');
console.log(`🏆 Total Unique Songs:      ${totalSongsInTarget}`);
console.log(`🔥 Total Sightings:         ${totalSightingsInTarget}`);
console.log(`✨ Consensus Multi-Source:  ${consensusCount}`);
console.log('========================================================\n');
