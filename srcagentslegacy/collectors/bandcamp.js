// src/collectors/bandcamp.js
//
// Bandcamp Discover collector for the Music Release Agent.
//
// WHY BANDCAMP: Discover is filterable by genre + LOCATION and sortable by
// "new arrivals". Location on Bandcamp is a tag the ARTIST applies to itself
// (their city), so it's an origin signal at the artist level rather than a
// distribution territory - exactly what Spotify's feeds can't give us. Coverage
// skews to emerging / pre-streaming indie, matching the listening-first goal.
//
// Emits the SAME item shape as triplej.js so index.js globalDedupeAndSort()
// and applyPoolCap() work unchanged:
//   { artist, title, releaseType, releaseDate, articleDate, sourceService,
//     sourceUrl, marketsAvailable, genresMapped, artistCountryMapped,
//     score, bucket }  (+ harmless extras: originConfidence, originSource)
//
// ES module, Node 18+ (global fetch). Inject userOptions.fetchImpl for tests.
//
// LIVE CONTRACT: Bandcamp has no official API and has changed the Discover
// backend before. The request/response contract is isolated in
// buildDiscoverRequest() + parseDiscoverResponse(). Run tools/probe-bandcamp.js
// locally and correct those two functions if the real shape differs.

const DEFAULTS = {
  sourceService: "Bandcamp",
  discoverEndpoint: "https://bandcamp.com/api/discover/1/discover_web", // VERIFY via probe
  slice: "new",
  pageSize: 60,
  maxPages: 2,
  maxItems: 120,
  requestDelayMs: 700,
  timeoutMs: 25000,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",

  // Bandcamp Discover keys location by GeoNames id. These are seeds - confirm
  // against probe output. `country` matches filters.json countryBuckets vocab.
  locations: [
    { name: "Melbourne",    geonameId: 2158177, country: "Australia" },
    { name: "Sydney",       geonameId: 2147714, country: "Australia" },
    { name: "Brisbane",     geonameId: 2174003, country: "Australia" },
    { name: "Perth",        geonameId: 2063523, country: "Australia" },
    { name: "Adelaide",     geonameId: 2078025, country: "Australia" },
    { name: "Auckland",     geonameId: 2193733, country: "New Zealand" },
    { name: "Wellington",   geonameId: 2179537, country: "New Zealand" },
    { name: "Christchurch", geonameId: 2192362, country: "New Zealand" },
  ],

  genreTags: ["rock", "punk", "indie", "garage", "psychedelic", "surf"],

  // Same spirit as triplej.js: map loose Bandcamp tags onto project labels.
  fallbackGenreLabels: {
    "garage rock": "Indie Rock",
    garage: "Indie Rock",
    psychedelic: "Alt Rock",
    psych: "Alt Rock",
    "alternative rock": "Alt Rock",
    alternative: "Alt Rock",
    "surf punk": "Surf Rock",
    "surf garage": "Surf Rock",
    surf: "Surf Rock",
    "bedroom pop": "Indie",
    "bedroom indie": "Indie",
    independent: "Indie",
    "dream pop": "Indie",
    shoegaze: "Alt Rock",
    "lo-fi": "Indie",
    "indie pop": "Indie",
    "power pop": "Indie Rock",
    "post-punk": "Alt Rock",
    grunge: "Alt Rock",
  },
};

// AU/NZ location-string hints (ASCII; input is de-accented before matching so
// dual / First Nations names like "Otautahi", "Poneke", "Naarm" still match).
const CITY_COUNTRY = {
  melbourne: "Australia", naarm: "Australia", sydney: "Australia", eora: "Australia",
  brisbane: "Australia", meanjin: "Australia", perth: "Australia", boorloo: "Australia",
  adelaide: "Australia", tarntanya: "Australia", canberra: "Australia",
  hobart: "Australia", nipaluna: "Australia", darwin: "Australia", "gold coast": "Australia",
  newcastle: "Australia", geelong: "Australia", wollongong: "Australia", australia: "Australia",
  auckland: "New Zealand", tamaki: "New Zealand", wellington: "New Zealand",
  "te whanganui": "New Zealand", poneke: "New Zealand", christchurch: "New Zealand",
  otautahi: "New Zealand", dunedin: "New Zealand", otepoti: "New Zealand",
  hamilton: "New Zealand", kirikiriroa: "New Zealand", "new zealand": "New Zealand",
  aotearoa: "New Zealand",
};

// ---------------------------------------------------------------------------
// Public entry - mirrors collectTripleJReleases(filters, userOptions)
// ---------------------------------------------------------------------------

export async function collectBandcampReleases(filters = {}, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions, ...(filters.bandcamp || {}) };
  const http = options.fetchImpl || fetch;

  const cards = await harvestDiscover(http, options);
  console.log("[Bandcamp] Discover cards found:", cards.length);
  console.log("[Bandcamp] Sample:", cards.slice(0, 4).map((c) => `${c.artist} - ${c.title}`));

  const releases = [];
  for (const card of cards) {
    const combinedText = cleanText(
      `${card.artist} ${card.title} ${card.genreTag || ""} ${card.queryGenre || ""} ${card.location || ""}`
    ).toLowerCase();

    const artistCountryMapped = resolveCountry(card, combinedText, filters);
    const genresMapped = inferGenresMapped(combinedText, filters, options);
    const marketsAvailable = inferMarkets(artistCountryMapped, filters);
    const releaseType = card.releaseType || "album";
    const score = scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped });
    const bucket = bucketFromScore(score);

    releases.push({
      artist: card.artist,
      title: card.title,
      releaseType,
      releaseDate: card.releaseDate || "unknown",
      articleDate: card.releaseDate || "unknown",
      sourceService: options.sourceService,
      sourceUrl: card.url,
      marketsAvailable,
      genresMapped,
      artistCountryMapped,
      score,
      bucket,
      originConfidence: card.originConfidence,
      originSource: "bandcamp-location",
    });
  }

  console.log("[Bandcamp] Total extracted before dedupe:", releases.length);
  return dedupeAndSort(releases, filters);
}

export { collectBandcampReleases as collect };

// ---------------------------------------------------------------------------
// Discover harvesting
// ---------------------------------------------------------------------------

async function harvestDiscover(http, options) {
  const seen = new Set();
  const cards = [];

  outer: for (const location of options.locations) {
    for (const genre of options.genreTags) {
      let cursor = "*";
      for (let page = 0; page < options.maxPages; page++) {
        const req = buildDiscoverRequest({
          location, genre, slice: options.slice, pageSize: options.pageSize, cursor,
        });

        let data;
        try {
          data = await fetchJson(req, http, options);
        } catch (err) {
          console.error(`[Bandcamp] ${location.name}/${genre} failed: ${err.message}`);
          break;
        }

        const { results, cursor: nextCursor } = parseDiscoverResponse(data);
        for (const raw of results) {
          const card = toCard(raw, location, genre);
          if (!card) continue;
          const key = `${slugify(card.artist)}::${slugify(card.title)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cards.push(card);
          if (cards.length >= options.maxItems) break outer;
        }

        if (!nextCursor || nextCursor === cursor || results.length === 0) break;
        cursor = nextCursor;
        await sleep(options.requestDelayMs);
      }
      await sleep(options.requestDelayMs);
    }
  }
  return cards;
}

// ---- Live contract (correct these after probing) --------------------------

function buildDiscoverRequest({ location, genre, slice, pageSize, cursor }) {
  const body = {
    category_id: 0,
    slice,
    cursor: cursor || "*",
    size: pageSize,
    tag_norm_names: genre ? [genre] : [],
    geoname_id: location ? location.geonameId : 0,
    include_result_types: ["a"],
  };
  return { url: DEFAULTS.discoverEndpoint, body };
}

function parseDiscoverResponse(data) {
  const results =
    (data && (data.results || data.items)) ||
    (data && data.discover && data.discover.results) ||
    [];
  const cursor =
    (data && (data.cursor || data.next_cursor)) ||
    (data && data.discover && data.discover.cursor) ||
    null;
  return { results: Array.isArray(results) ? results : [], cursor };
}

// ---- Raw item -> intermediate "card" --------------------------------------

function toCard(raw, locationCtx, queryGenre) {
  const artist = firstDefined(raw, ["band_name", "artist", "artist_name", "band"]);
  const title = firstDefined(raw, ["title", "album_title", "name", "item_title"]);
  if (!artist || !title) return null;

  let url = firstDefined(raw, ["item_url_path", "tralbum_url", "url", "item_url"]);
  if (!url) {
    const bandUrl = firstDefined(raw, ["band_url"]);
    const path = firstDefined(raw, ["item_url", "slug"]);
    if (bandUrl && path) {
      url = String(bandUrl).replace(/\/$/, "") + "/" + String(path).replace(/^\//, "");
    }
  }

  const rawLocation = firstDefined(raw, ["band_location", "location", "geo"]);
  const releaseDate = normalizeDate(
    firstDefined(raw, ["release_date", "new_date", "publish_date", "added_date"])
  );

  return {
    artist: cleanText(artist),
    title: cleanText(title),
    url: url || null,
    location: rawLocation || (locationCtx ? locationCtx.name : null),
    hasOwnLocation: !!rawLocation,
    queryLocationCountry: locationCtx ? locationCtx.country : null,
    genreTag: firstDefined(raw, ["genre", "primary_genre", "tag"]) || null,
    queryGenre,
    releaseDate,
    releaseType: guessReleaseType(raw),
  };
}

// ---------------------------------------------------------------------------
// Country resolution - Bandcamp specific.
// Priority: 1) filters.artistCountryHints  2) item's own location string
//           3) (guard) explicit non-AU/NZ own location -> unknown
//           4) queried location's country   5) countryBuckets keyword scan
// ---------------------------------------------------------------------------

function resolveCountry(card, combinedText, filters) {
  const artistSlug = slugify(card.artist);

  const artistHints = filters.artistCountryHints || {};
  for (const [name, country] of Object.entries(artistHints)) {
    if (slugify(name) === artistSlug) {
      card.originConfidence = 0.99;
      return country;
    }
  }

  const fromItem = countryFromLocationString(card.location);
  if (fromItem) {
    card.originConfidence = 0.85;
    return fromItem;
  }

  // The item states its OWN location but it isn't AU/NZ (e.g. "Berlin, Germany"):
  // trust that and do NOT inherit the queried location's country. This is the
  // origin-vs-territory guard - an item surfaced under a Melbourne query can
  // still be a Berlin act.
  if (card.hasOwnLocation) {
    card.originConfidence = 0;
    return "unknown";
  }

  // No location of its own: fall back to the location bucket we queried under.
  if (card.queryLocationCountry) {
    card.originConfidence = 0.6;
    return card.queryLocationCountry;
  }

  for (const [country, keywords] of Object.entries(filters.countryBuckets || {})) {
    for (const keyword of keywords) {
      if (combinedText.includes(String(keyword).toLowerCase())) {
        card.originConfidence = 0.6;
        return country;
      }
    }
  }

  card.originConfidence = 0;
  return "unknown";
}

function countryFromLocationString(loc) {
  if (!loc) return null;
  const l = deaccent(String(loc).toLowerCase());
  for (const key of Object.keys(CITY_COUNTRY)) {
    if (l.includes(key)) return CITY_COUNTRY[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inference + scoring (aligned with triplej.js so buckets are comparable)
// ---------------------------------------------------------------------------

function inferGenresMapped(text, filters, options) {
  const found = new Set();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  for (const [keyword, label] of Object.entries(options.fallbackGenreLabels)) {
    if (text.includes(keyword)) found.add(label);
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

function scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;
  score += 2; // algorithmic source: lower base than triple j editorial (+4)
  if (artistCountryMapped === "Australia" || artistCountryMapped === "New Zealand") score += 3;

  const directGenreCount = genresMapped.filter((g) =>
    ["Indie", "Indie Rock", "Alt Rock", "Surf Rock"].includes(g)
  ).length;
  if (directGenreCount >= 2) score += 3;
  else if (directGenreCount === 1) score += 2;
  else if (genresMapped.length > 0) score += 1;

  if (releaseType === "album") score += 2;
  else if (releaseType === "ep") score += 2;
  else if (releaseType === "single") score += 2;
  else if (releaseType === "unknown") score -= 1;

  if (
    /hip-hop|trap|drill|edm|dance|club-ready|rap|house|techno|disco/.test(combinedText) &&
    genresMapped.length === 0
  ) {
    score -= 2;
  }
  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
}

// ---------------------------------------------------------------------------
// Dedupe + sort (mirrors triplej.js; index.js re-dedupes globally afterwards)
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

async function fetchJson(req, http, options) {
  const response = await http(req.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": options.userAgent,
    },
    body: JSON.stringify(req.body),
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!response.ok) throw new Error(`Bandcamp request failed: ${response.status}`);
  return response.json();
}

function guessReleaseType(raw) {
  const t = String(firstDefined(raw, ["item_type", "type"]) || "").toLowerCase();
  if (t.includes("track") || t === "t") return "single";
  const title = String(firstDefined(raw, ["title", "album_title"]) || "").toLowerCase();
  if (/\bep\b/.test(title)) return "ep";
  if (/\bsingle\b/.test(title)) return "single";
  return "album";
}

function firstDefined(obj, keys) {
  for (const k of keys) if (obj[k] != null && obj[k] !== "") return obj[k];
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deaccent(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const d = new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .trim();
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
  buildDiscoverRequest, parseDiscoverResponse, toCard, resolveCountry,
  countryFromLocationString, scoreRelease, bucketFromScore, deaccent,
};
