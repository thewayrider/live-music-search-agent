// src/collectors/amrap.js
//
// AMRAP (Australian Music Radio Airplay Project) community-radio charts
// collector for the Music Release Agent.
//
// WHY AMRAP: amrap.org.au tracks what community radio across Australia is
// actually playing. Two properties make it uniquely valuable here:
//   1. Everything on it is Australian BY DEFINITION - it is the national
//      community-radio airplay system - so NO MusicBrainz origin resolution is
//      needed. We simply tag country = "Australia".
//   2. It is genre-segmented, so the Indie / Alternative chart is directly
//      addressable and already curated to our target genre.
//
// DATA SOURCE: a clean, unauthenticated JSON API sits behind the SPA at
//   GET https://amrap.org.au/api/charts/weekly
// which returns all charts keyed by name:
//   national, metro, regional, pop, indie, rock, hiphop, country, electronic
// Each chart: { chart_name, chart_slug, genre, week_start, week_end,
//               week_range, entries_count, entries[] }
// Each entry: { position, previous_position, position_change, weeks_on_chart,
//               highest_position, track:{ id, title, slug, album:{id,title},
//               performer:{id,name}, artist } }
//
// "NEW RELEASE" DEFINITION (debuts only): the chart API exposes NO release or
// upload date. The only in-feed freshness signal is weeks_on_chart. We keep
// entries with weeks_on_chart <= newMaxWeeksOnChart (default 1), i.e. tracks
// that just debuted on the chart this week. Note the caveat: a debut means
// "newly charting", which strongly correlates with - but is not identical to -
// "newly released". week_end is used as the item date (best available).
//
// Emits the SAME item shape as the other collectors so index.js
// globalDedupeAndSort() + applyPoolCap() work unchanged. Because community
// radio plays the same track across National/Metro/Regional/genre charts, the
// downstream dedupe handles any overlap.
//
// RELEASE-DATE ENRICHMENT (fresh drop vs re-release):
//   AMRAP's own date is an artist-declared upload date - for a re-release it
//   reflects the re-upload, NOT the original release, so it cannot reveal that
//   e.g. Huxton Creepers' "Autumn Leaves" is originally from 1986. The original
//   release date lives in MusicBrainz. For each kept debut we look up the
//   MusicBrainz recording first-release-date, then classify:
//     fresh      -> first-release-date within freshWindowDays of the chart week
//     catalogue  -> older than that (re-release / back-catalogue)
//     unverified -> no confident MusicBrainz match (leave for a manual look)
//   Results (including negatives) are cached to cacheFile so weekly runs stay
//   cheap and respect MusicBrainz's ~1 req/sec limit. This reuses the same
//   pattern as the ListenBrainz collector.
//
// ES module, Node 18+ (global fetch). Inject userOptions.fetchImpl for tests.

import fs from "fs/promises";
import path from "path";

const DEFAULTS = {
  sourceService: "AMRAP",
  weeklyEndpoint: "https://amrap.org.au/api/charts/weekly",

  // Which charts.<key> to read. Indie / Alternative only, for now.
  chartKeys: ["indie"],

  // Debut-only freshness: keep entries with weeks_on_chart <= this.
  newMaxWeeksOnChart: 1,
  // Additionally require a genuine debut (no previous chart position).
  requireDebut: true,

  // AMRAP is Australian by construction.
  country: "Australia",

  // Optional: request a specific past week (YYYY-MM-DD, matching a
  // /api/charts/available-dates "value"). null = current published week.
  date: null,

  // No per-track public page exists on AMRAP (tracks aren't hyperlinked;
  // browsing is via /search). Link back to the chart; track/performer ids are
  // retained on each item for future enrichment.
  sourceUrl: "https://amrap.org.au/charts",

  // Every chart entry is already genre-classified by AMRAP, so we seed the
  // mapped genre from the chart it came from rather than guessing from text.
  chartGenreLabels: {
    indie: ["Indie"],
    rock: ["Alt Rock"],
    pop: ["Indie"],
  },

  // A brand-new debut on a curated AU community-radio chart is a strong signal.
  debutBonus: 1,

  // --- MusicBrainz release-date enrichment ---------------------------------
  enrichReleaseDate: true,
  musicbrainzBase: "https://musicbrainz.org/ws/2",
  freshWindowDays: 90,        // <= this many days old (vs chart week) = "fresh"
  mbMinScore: 80,             // min MusicBrainz match score (0-100) to trust
  maxEnrich: 60,              // max NEW MB lookups per run (debuts are few)
  mbDelayMs: 1100,            // MusicBrainz rate limit (~1 req/sec)
  mbTimeoutMs: 15000,
  mbCacheFile: "cache/amrap-mb-release-date.json", // null to disable caching
  // MusicBrainz asks for a descriptive UA with contact info - edit to yours.
  mbUserAgent:
    "music-release-agent/1.0 ( https://kimrampling.com )",
  // Optional: demote back-catalogue re-releases so fresh drops rank above them.
  // Default 0 = purely informational (flag only, no score change).
  cataloguePenalty: 0,

  timeoutMs: 25000,
  userAgent: "NewIndieFriday/0.1 (music-release-agent; amrap collector)",
};

// ---------------------------------------------------------------------------
// Public entry - mirrors collectBandcampReleases(filters, userOptions)
// ---------------------------------------------------------------------------

export async function collectAmrapReleases(filters = {}, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions, ...(filters.amrap || {}) };
  const http = options.fetchImpl || fetch;

  const data = await fetchWeekly(http, options);
  const charts = (data && data.charts) || {};
  const period = (data && data.period) || {};
  console.log(
    `[AMRAP] Weekly charts fetched: ${Object.keys(charts).length} charts` +
      (period.week_range ? ` (${period.week_range})` : "")
  );

  const releases = [];
  let scanned = 0;

  for (const key of options.chartKeys) {
    const chart = charts[key];
    if (!chart || !Array.isArray(chart.entries)) {
      console.warn(`[AMRAP] Chart "${key}" not present in response - skipping.`);
      continue;
    }

    const weekEnd = normalizeDate(chart.week_end) || normalizeDate(period.week_end);
    const baseGenres = options.chartGenreLabels[key] || [];

    for (const entry of chart.entries) {
      scanned++;
      const track = entry.track || {};
      const artist = cleanText(track.artist || (track.performer && track.performer.name));
      const title = cleanText(track.title);
      if (!artist || !title) continue;

      // Debut-only gate.
      const weeksOnChart = Number(entry.weeks_on_chart);
      const isDebut = entry.previous_position == null;
      const withinWeeks =
        Number.isFinite(weeksOnChart) && weeksOnChart <= options.newMaxWeeksOnChart;
      if (!withinWeeks) continue;
      if (options.requireDebut && !isDebut && weeksOnChart > 1) continue;

      const genresMapped = mergeGenres(baseGenres, `${artist} ${title}`, filters);
      const releaseType = guessReleaseType(track);
      const feat = detectFeat(title);
      const country = options.country;
      const score = scoreRelease({ releaseType, genresMapped, country, isDebut }, options);

      releases.push({
        artist,
        title,
        releaseType,
        releaseDate: weekEnd || "unknown",
        articleDate: weekEnd || "unknown",
        sourceService: options.sourceService,
        sourceUrl: options.sourceUrl,
        marketsAvailable: inferMarkets(country, filters),
        genresMapped,
        artistCountryMapped: country,
        score,
        bucket: bucketFromScore(score),
        originConfidence: 1,
        originSource: "amrap-chart",

        // "feat"/collab flag: a debut whose title credits another artist. Kim
        // treats these as likely non-originals worth a quick manual skip. It's
        // a FLAG only - the item is still kept and scored normally.
        featured: feat.featured,
        featuredWith: feat.featuredWith,

        // AMRAP-specific extras (harmless downstream; useful for later work).
        chart: chart.chart_slug || key,
        chartPosition: entry.position,
        weeksOnChart: Number.isFinite(weeksOnChart) ? weeksOnChart : null,
        trackId: track.id || null,
        trackSlug: track.slug || null,
        performerId: track.performer && track.performer.id,
      });
    }
  }

  console.log(
    `[AMRAP] scanned ${scanned} chart entries | kept debuts: ${releases.length} ` +
      `(charts: ${options.chartKeys.join(", ")}; weeks_on_chart <= ${options.newMaxWeeksOnChart})`
  );
  if (releases.length === 0 && scanned > 0) {
    console.log("[AMRAP] 0 debuts this week - all charted tracks are holdovers.");
  }

  const deduped = dedupeAndSort(releases, filters);

  if (options.enrichReleaseDate && deduped.length) {
    await enrichReleaseDates(deduped, http, options);
  }

  return deduped;
}

export { collectAmrapReleases as collect };

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchWeekly(http, options) {
  let url = options.weeklyEndpoint;
  if (options.date) url += `?date=${encodeURIComponent(options.date)}`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`AMRAP request failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MusicBrainz release-date enrichment
// ---------------------------------------------------------------------------

// Mutates each item in place, adding:
//   originalReleaseDate : "YYYY" | "YYYY-MM" | "YYYY-MM-DD" | null
//   freshness           : "fresh" | "catalogue" | "unverified"
//   freshnessNote       : short human-readable explanation
async function enrichReleaseDates(items, http, options) {
  const cache = await loadCache(options);
  const cacheStart = cache.size;
  let newLookups = 0;
  let hits = 0;

  for (const item of items) {
    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    let orig = cache.get(key); // string date, "" for confirmed-no-match, or undefined

    if (orig === undefined) {
      if (newLookups >= options.maxEnrich) {
        applyFreshness(item, null, options, "budget exhausted");
        continue;
      }
      newLookups++;
      try {
        orig = await mbFirstReleaseDate(item.artist, item.title, http, options);
      } catch {
        orig = undefined; // transient failure: don't poison the cache
      }
      if (orig !== undefined) cache.set(key, orig || ""); // cache negatives as ""
      if (newLookups < options.maxEnrich) await sleep(options.mbDelayMs);
    } else {
      hits++;
    }

    const dateStr = orig && orig !== "" ? orig : null;
    applyFreshness(item, dateStr, options);
  }

  await saveCache(options, cache);
  const counts = tallyFreshness(items);
  console.log(
    `[AMRAP] release-date enrichment | cache hits: ${hits} | new MB lookups: ` +
      `${newLookups}/${options.maxEnrich} | cache ${cacheStart}->${cache.size} | ` +
      `fresh: ${counts.fresh}, catalogue: ${counts.catalogue}, unverified: ${counts.unverified}`
  );
}

function applyFreshness(item, origDate, options, unresolvedReason) {
  item.originalReleaseDate = origDate;
  const weekEnd = item.releaseDate && item.releaseDate !== "unknown" ? item.releaseDate : null;
  const res = classifyFreshness(origDate, weekEnd, options.freshWindowDays, unresolvedReason);
  item.freshness = res.freshness;
  item.freshnessNote = res.note;
  if (res.freshness === "catalogue" && options.cataloguePenalty) {
    item.score = Math.round((item.score - options.cataloguePenalty) * 10) / 10;
    item.bucket = bucketFromScore(item.score);
  }
}

function classifyFreshness(origDate, weekEnd, windowDays, unresolvedReason) {
  if (!origDate) {
    return { freshness: "unverified", note: unresolvedReason || "no MusicBrainz match" };
  }
  const orig = parseLooseDate(origDate);
  const ref = weekEnd ? new Date(weekEnd) : new Date();
  if (!orig || Number.isNaN(orig.getTime())) {
    return { freshness: "unverified", note: `unparseable date ${origDate}` };
  }
  const ageDays = (ref.getTime() - orig.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= windowDays) {
    return { freshness: "fresh", note: `released ${origDate}` };
  }
  return { freshness: "catalogue", note: `originally ${String(origDate).slice(0, 4)}` };
}

// MusicBrainz recording search -> earliest confident first-release-date.
// Earliest is deliberate: for a reissue we want the ORIGINAL date (e.g. 1986),
// not the newest release the recording appears on.
async function mbFirstReleaseDate(artist, title, http, options) {
  const q = `artist:"${mbEscape(artist)}" AND recording:"${mbEscape(title)}"`;
  const url = `${options.musicbrainzBase}/recording?query=${encodeURIComponent(q)}&fmt=json&limit=8`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.mbUserAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.mbTimeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  const data = await res.json();
  const recs = Array.isArray(data.recordings) ? data.recordings : [];
  const wantArtist = slugify(artist);
  const wantTitle = slugify(title);

  let best = null; // earliest first-release-date among confident matches
  for (const r of recs) {
    if ((r.score || 0) < options.mbMinScore) continue;
    if (!titleMatches(wantTitle, slugify(r.title))) continue;
    if (!artistCreditMatches(wantArtist, r["artist-credit"])) continue;
    const frd = r["first-release-date"];
    if (!frd) continue;
    if (best === null || frd < best) best = frd; // ISO strings sort chronologically
  }
  return best; // null if none matched
}

function artistCreditMatches(wantArtistSlug, credit) {
  if (!Array.isArray(credit)) return false;
  for (const c of credit) {
    const name = (c.artist && c.artist.name) || c.name;
    const s = slugify(name);
    if (!s) continue;
    if (s === wantArtistSlug || s.includes(wantArtistSlug) || wantArtistSlug.includes(s)) return true;
  }
  return false;
}

function titleMatches(wantTitleSlug, gotTitleSlug) {
  if (!gotTitleSlug) return false;
  return (
    gotTitleSlug === wantTitleSlug ||
    gotTitleSlug.includes(wantTitleSlug) ||
    wantTitleSlug.includes(gotTitleSlug)
  );
}

function tallyFreshness(items) {
  const c = { fresh: 0, catalogue: 0, unverified: 0 };
  for (const i of items) if (c[i.freshness] !== undefined) c[i.freshness]++;
  return c;
}

// ISO-ish partial dates: "1986", "1986-05", "1986-05-14".
function parseLooseDate(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01`);
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mbEscape(value) {
  // Escape Lucene special chars so quoted phrase queries stay valid.
  return String(value || "").replace(/(["\\])/g, "\\$1");
}

async function loadCache(options) {
  const map = new Map();
  if (!options.mbCacheFile) return map;
  try {
    const text = await fs.readFile(options.mbCacheFile, "utf8");
    for (const [k, v] of Object.entries(JSON.parse(text))) map.set(k, v);
  } catch {
    /* no cache yet -> start empty */
  }
  return map;
}

async function saveCache(options, map) {
  if (!options.mbCacheFile || map.size === 0) return;
  try {
    await fs.mkdir(path.dirname(options.mbCacheFile), { recursive: true });
    await fs.writeFile(options.mbCacheFile, JSON.stringify(Object.fromEntries(map)), "utf8");
  } catch (e) {
    console.error("[AMRAP] release-date cache write failed:", e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Inference + scoring (aligned with bandcamp.js / listenbrainz.js buckets)
// ---------------------------------------------------------------------------

// Trust AMRAP's own genre classification (baseGenres from the chart), then add
// any extra target-genre keywords found in the artist/title text.
function mergeGenres(baseGenres, text, filters) {
  const allowed = new Set(filters.targetGenres || []);
  const found = new Set(baseGenres.filter((g) => allowed.has(g)));
  const lower = String(text).toLowerCase();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    if (!allowed.has(label)) continue;
    for (const keyword of keywords) {
      if (lower.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  return Array.from(found);
}

function inferMarkets(country, filters) {
  if (!Array.isArray(filters.markets)) return [];
  if (country === "Australia" || country === "New Zealand") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ releaseType, genresMapped, country, isDebut }, options) {
  let score = 0;
  score += 2; // base, matching the other algorithmic/aggregated sources
  if (country === "Australia" || country === "New Zealand") score += 3;

  const direct = genresMapped.filter((g) =>
    ["Indie", "Indie Rock", "Alt Rock", "Surf Rock"].includes(g)
  ).length;
  if (direct >= 2) score += 3;
  else if (direct === 1) score += 2;
  else if (genresMapped.length > 0) score += 1;

  if (releaseType === "album") score += 2;
  else if (releaseType === "ep") score += 2;
  else if (releaseType === "single") score += 2;
  else if (releaseType === "unknown") score -= 1;

  if (isDebut) score += options.debutBonus;

  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
}

function guessReleaseType(track) {
  const album = track.album || {};
  const title = String(track.title || "").toLowerCase();
  const albumTitle = String(album.title || "").toLowerCase();
  if (/\bep\b/.test(title) || /\bep\b/.test(albumTitle)) return "ep";
  // On AMRAP a chart entry is an individual played track. If the album title
  // matches the track title it's a standalone single; otherwise still treat the
  // charted item as a single (the unit of airplay), not the parent album.
  return "single";
}

// ---------------------------------------------------------------------------
// Dedupe + sort (mirrors the other collectors; index.js re-dedupes globally)
// ---------------------------------------------------------------------------

function dedupeAndSort(items, filters) {
  const runWindowDays = filters.runWindowDays || 14;
  const cutoff = Date.now() - runWindowDays * 24 * 60 * 60 * 1000;
  const map = new Map();

  for (const item of items) {
    const parsed = new Date(item.releaseDate).getTime();
    const dateOk =
      item.releaseDate === "unknown" || Number.isNaN(parsed) || parsed >= cutoff;
    if (!dateOk) continue;

    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) map.set(key, item);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.artist.localeCompare(b.artist)
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Detect a featured/collab credit in a track title, e.g.
//   "These Alarms [Feat. Kylie Minogue]"  -> Kylie Minogue
//   "Time To Burn [Feat.Pete Murray]"     -> Pete Murray
//   "Some Song (feat. X & Y)"             -> X & Y
//   "Track ft. Someone"                   -> Someone
function detectFeat(title) {
  const s = String(title || "");
  const bracket = s.match(/[[(]\s*feat\.?\s*([^\])]+?)\s*[\])]/i);
  if (bracket) return { featured: true, featuredWith: cleanText(bracket[1]) };
  const trailing = s.match(/\b(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
  if (trailing) return { featured: true, featuredWith: cleanText(trailing[1]) };
  return { featured: false, featuredWith: null };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const _internal = {
  mergeGenres, inferMarkets, scoreRelease, bucketFromScore, guessReleaseType,
  normalizeDate, dedupeAndSort, classifyFreshness, parseLooseDate,
  mbFirstReleaseDate, artistCreditMatches, titleMatches, enrichReleaseDates,
  detectFeat,
};
