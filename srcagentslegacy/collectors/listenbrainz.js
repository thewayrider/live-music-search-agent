// src/collectors/listenbrainz.js
//
// ListenBrainz "fresh releases" collector for the Music Release Agent.
//
// ROLE: LB's site-wide fresh-releases endpoint is a bulk "what came out /
// what's coming" feed (global, NOT origin-filtered - a run can return several
// THOUSAND releases). This collector uses it as the discovery layer, resolves
// artist ORIGIN, and keeps only AU/NZ.
//
// ORIGIN, two ways:
//   1. filters.artistCountryHints            -> free, instant, no network
//   2. bounded MusicBrainz artist-MBID lookup -> capped at maxEnrich per run
//
// PERSISTENT CACHE (the thing that makes enrichment affordable weekly):
//   Every MB lookup result - INCLUDING "not AU/NZ" negatives - is written to
//   options.cacheFile. On later runs those artists are cache hits: they cost no
//   time and DON'T consume the maxEnrich budget, so the budget increasingly
//   goes to genuinely new artists. Because future=true surfaces upcoming
//   releases across several weekly windows, the same artists recur and get
//   cached quickly.
//
// TIMING: each NEW (uncached) lookup adds ~1.1s. maxEnrich=150 => ~2-3 min on a
// cold cache; much faster once the cache is warm. Runs weekly, so that's fine.
//
// Emits the same item shape as the other collectors. ES module, Node 18+.

import fs from "fs/promises";
import path from "path";

const DEFAULTS = {
  sourceService: "ListenBrainz",
  freshReleasesEndpoint: "https://api.listenbrainz.org/1/explore/fresh-releases",
  musicbrainzBase: "https://musicbrainz.org/ws/2",
  days: 14,
  future: true,
  sort: "release_date",
  maxEnrich: 150,       // NEW (uncached) MB lookups per run
  mbDelayMs: 1100,      // MusicBrainz rate limit (~1 req/sec)
  timeoutMs: 25000,
  includeUnresolved: false,
  allowedTypes: null,   // e.g. ["album","ep"] to skip singles; null = keep all
  cacheFile: "cache/listenbrainz-mb-origin.json", // set null to disable persistence
  userAgent: "NewIndieFriday/0.1 ( https://example.com/newindiefriday; contact you@example.com )",
};

const ISO_TO_COUNTRY = { AU: "Australia", NZ: "New Zealand" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function collectListenBrainzReleases(filters = {}, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions, ...(filters.listenbrainz || {}) };
  const http = options.fetchImpl || fetch;

  const raw = await fetchFreshReleases(http, options);
  console.log(`[ListenBrainz] Fresh releases fetched: ${raw.length}`);

  // Load persistent MB origin cache (MBID -> {country, confidence, field}).
  const mbCache = await loadCache(options);
  const cacheStart = mbCache.size;
  if (options.maxEnrich > 0) {
    console.log(`[ListenBrainz] MB enrichment ON (max ${options.maxEnrich} new lookups; ${cacheStart} cached origins loaded)`);
  } else {
    console.log(`[ListenBrainz] MB enrichment OFF (hints-only). ${cacheStart} cached origins loaded.`);
  }

  const hintMap = buildHintMap(filters);
  let enrichCount = 0;   // NEW network lookups this run
  let cacheHits = 0;     // resolved from cache (free)
  let hintMatches = 0;
  const releases = [];

  for (const r of raw) {
    const artist = firstDefined(r, ["artist_credit_name", "artist_name"]);
    const title = firstDefined(r, ["release_name", "title"]);
    if (!artist || !title) continue;

    const releaseType = mapReleaseType(firstDefined(r, ["release_group_primary_type", "primary_type"]));
    if (Array.isArray(options.allowedTypes) && !options.allowedTypes.includes(releaseType)) continue;

    let country = "unknown";
    let originConfidence = 0;
    let originSource = null;

    const hinted = hintMap.get(slugify(artist));
    if (hinted) {
      hintMatches++;
      country = hinted; originConfidence = 0.99; originSource = "hint";
    } else {
      const mbid = (r.artist_mbids || r.artist_credit_mbids || [])[0];
      if (mbid) {
        let mb = mbCache.get(mbid);
        if (mb) {
          cacheHits++;                       // free: no budget, no sleep
        } else if (options.maxEnrich > 0 && enrichCount < options.maxEnrich) {
          enrichCount++;
          mb = await resolveArtistCountryMB(mbid, http, options, mbCache);
          if (enrichCount < options.maxEnrich) await sleep(options.mbDelayMs);
        }
        if (mb && mb.country) {
          country = mb.country; originConfidence = mb.confidence;
          originSource = "musicbrainz:" + mb.field;
        }
      }
    }

    const isTarget = country === "Australia" || country === "New Zealand";
    if (!isTarget && !options.includeUnresolved) continue;

    const combinedText = `${artist} ${title}`.toLowerCase();
    const genresMapped = inferGenresMapped(combinedText, filters);
    const rgMbid = firstDefined(r, ["release_group_mbid"]);
    const relMbid = firstDefined(r, ["release_mbid"]);
    const score = scoreRelease({ releaseType, genresMapped, country });

    releases.push({
      artist: String(artist).trim(),
      title: String(title).trim(),
      releaseType,
      releaseDate: normalizeDate(firstDefined(r, ["release_date"])) || "unknown",
      articleDate: normalizeDate(firstDefined(r, ["release_date"])) || "unknown",
      sourceService: options.sourceService,
      sourceUrl: rgMbid
        ? `https://musicbrainz.org/release-group/${rgMbid}`
        : relMbid ? `https://musicbrainz.org/release/${relMbid}` : "#",
      marketsAvailable: inferMarkets(country, filters),
      genresMapped,
      artistCountryMapped: country,
      score,
      bucket: bucketFromScore(score),
      originConfidence,
      originSource,
    });
  }

  // Persist the (possibly grown) cache for next run.
  await saveCache(options, mbCache);

  console.log(
    `[ListenBrainz] hints: ${hintMatches} | cache hits: ${cacheHits} | new MB lookups: ${enrichCount}/${options.maxEnrich} | ` +
    `cache ${cacheStart}->${mbCache.size} | kept (AU/NZ): ${releases.length}`
  );
  if (releases.length === 0) {
    const sample = raw.slice(0, 8)
      .map((r) => firstDefined(r, ["artist_credit_name", "artist_name"]))
      .filter(Boolean);
    console.log(`[ListenBrainz] 0 kept. Feed fetched OK (${raw.length}). Sample feed artists: ${sample.join(" | ")}`);
    if (enrichCount >= options.maxEnrich) {
      console.log("[ListenBrainz] Budget was exhausted - raise listenbrainz.maxEnrich for wider coverage (cache makes later runs cheaper).");
    }
  }
  return dedupeAndSort(releases, filters);
}

export { collectListenBrainzReleases as collect };

// ---------------------------------------------------------------------------
// Persistent cache
// ---------------------------------------------------------------------------

async function loadCache(options) {
  const map = new Map();
  if (!options.cacheFile) return map;
  try {
    const text = await fs.readFile(options.cacheFile, "utf8");
    const obj = JSON.parse(text);
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
  } catch {
    /* no cache yet / unreadable -> start empty */
  }
  return map;
}

async function saveCache(options, map) {
  if (!options.cacheFile || map.size === 0) return;
  try {
    await fs.mkdir(path.dirname(options.cacheFile), { recursive: true });
    const obj = Object.fromEntries(map);
    await fs.writeFile(options.cacheFile, JSON.stringify(obj), "utf8");
  } catch (e) {
    console.error("[ListenBrainz] cache write failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// ListenBrainz fetch
// ---------------------------------------------------------------------------

async function fetchFreshReleases(http, options) {
  const url =
    `${options.freshReleasesEndpoint}?days=${options.days}` +
    `&future=${options.future}&sort=${encodeURIComponent(options.sort)}`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`ListenBrainz request failed: ${res.status}`);
  const data = await res.json();
  const releases =
    (data && data.payload && data.payload.releases) ||
    (data && data.releases) || [];
  return Array.isArray(releases) ? releases : [];
}

// ---------------------------------------------------------------------------
// MusicBrainz artist -> country (direct MBID lookup; begin-area preferred)
// ---------------------------------------------------------------------------

async function resolveArtistCountryMB(mbid, http, options, cache) {
  let result = { country: null, confidence: 0, field: null };
  try {
    const url = `${options.musicbrainzBase}/artist/${mbid}?fmt=json`;
    const res = await http(url, {
      headers: { accept: "application/json", "user-agent": options.userAgent },
      signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    if (res.ok) result = originFromArtist(await res.json());
  } catch {
    /* leave unresolved */
  }
  cache.set(mbid, result); // cache negatives too, so we never re-look-up
  return result;
}

function isoFromArea(area) {
  if (!area) return null;
  const codes = area["iso-3166-1-codes"];
  return Array.isArray(codes) && codes.length ? codes[0] : null;
}

function originFromArtist(a) {
  const beginArea = a["begin-area"] || a["begin_area"];
  const candidates = [
    { field: "begin-area", iso: isoFromArea(beginArea), conf: 0.9 },
    { field: "area", iso: isoFromArea(a.area), conf: 0.8 },
    { field: "country", iso: a.country || null, conf: 0.75 },
  ];
  for (const c of candidates) {
    if (c.iso && ISO_TO_COUNTRY[c.iso]) {
      return { country: ISO_TO_COUNTRY[c.iso], confidence: c.conf, field: c.field };
    }
  }
  return { country: null, confidence: 0, field: null };
}

// ---------------------------------------------------------------------------
// Shared inference + scoring
// ---------------------------------------------------------------------------

function buildHintMap(filters) {
  const m = new Map();
  for (const [name, country] of Object.entries(filters.artistCountryHints || {})) {
    m.set(slugify(name), country);
  }
  return m;
}

function inferGenresMapped(text, filters) {
  const found = new Set();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  const allowed = new Set(filters.targetGenres || []);
  return Array.from(found).filter((g) => allowed.has(g));
}

function inferMarkets(country, filters) {
  if (!Array.isArray(filters.markets)) return [];
  if (country === "Australia" || country === "New Zealand") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ releaseType, genresMapped, country }) {
  let score = 0;
  score += 2;
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
  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
}

function mapReleaseType(rgType) {
  const t = String(rgType || "").toLowerCase();
  if (t === "album") return "album";
  if (t === "ep") return "ep";
  if (t === "single") return "single";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Dedupe + sort
// ---------------------------------------------------------------------------

function dedupeAndSort(items, filters) {
  const runWindowDays = filters.runWindowDays || 14;
  const cutoff = Date.now() - runWindowDays * 24 * 60 * 60 * 1000;
  const map = new Map();
  for (const item of items) {
    const parsed = new Date(item.releaseDate).getTime();
    const dateOk = item.releaseDate === "unknown" || Number.isNaN(parsed) || parsed >= cutoff;
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

function firstDefined(obj, keys) {
  for (const k of keys) if (obj[k] != null && obj[k] !== "") return obj[k];
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const _internal = { originFromArtist, mapReleaseType, scoreRelease, buildHintMap, loadCache, saveCache };
