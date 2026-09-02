const cheerio = require("cheerio");

const DEFAULTS = {
  baseUrl: "https://www.abc.net.au",
  featureAlbumsUrl: "https://www.abc.net.au/triplej/featured-music/feature-albums",
  sourceService: "triple j",
  requestDelayMs: 2000,
  maxAlbums: 12,
  timeoutMs: 25000,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",

  // Known Australian artists that triple j features — supplement to artistCountryHints
  // This list catches AU artists even before the user adds them to filters.json
  knownAustralianArtists: [
    "ecca vandal",
    "genesis owusu",
    "the jungle giants",
    "ruby fields",
    "matt corby",
    "peach prc",
    "2charm",
    "tame impala",
    "pond",
    "courtney barnett",
    "amyl and the sniffers",
    "spacey jane",
    "the chats",
    "hockey dad",
    "skegss",
    "middle kids",
    "hatchie",
    "rvg",
    "slowly slowly",
    "confidence man",
    "pnau",
    "the avalanches",
    "rüfüs du sol",
    "rufus du sol",
    "boy soda",
    "lo'99",
    "vacations",
    "crvvcks",
    "arky waters",
    "south summit",
    "jigitz",
    "kid laroi",
    "the kid laroi",
    "flume",
    "parcels",
    "kllo",
    "mia wray",
    "didirri",
    "ali barter",
    "angie mcmahon",
    "julia jacklin",
    "rolling blackouts coastal fever",
    "alex lahey",
    "camp cope",
    "// royale",
    "royale",
    "harvey sutherland",
    "kaiit",
    "becca hatch",
    "nooky",
    "coda conduct",
    "allday",
    "mallrat",
    "golden features",
    "channel tres",
  ],

  fallbackGenreLabels: {
    "garage rock": "Indie Rock",
    garage: "Indie Rock",
    psychedelic: "Alt Rock",
    psych: "Alt Rock",
    "alternative rock": "Alt Rock",
    alternative: "Alt Rock",
    "surf punk": "Surf Rock",
    "surf garage": "Surf Rock",
    "bedroom indie": "Indie",
    "bedroom pop": "Indie",
    independent: "Indie",
    "dream pop": "Indie",
    shoegaze: "Alt Rock",
    "lo-fi": "Indie",
    "indie pop": "Indie",
    "guitar music": "Indie Rock",
    "guitar-driven": "Indie Rock",
    "rock music": "Alt Rock",
    grunge: "Alt Rock",
    "jangle pop": "Indie",
    "power pop": "Indie Rock",
  },
};

// ---------------------------------------------------------------------------
// Parse the feature albums listing page
// Structure: <a href="/triplej/featured-music/feature-albums/...">
//              <h2>Artist - Album Title</h2>
//              <p>Blurb text</p>
//            Published: DD Mon YYYY
// ---------------------------------------------------------------------------

function parseFeatureAlbums(html, options) {
  const $ = cheerio.load(html);
  const cards = [];
  const seen = new Set();

  $("a[href*='/triplej/featured-music/feature-albums/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || seen.has(href)) return;
    seen.add(href);

    const fullUrl = href.startsWith("http")
      ? href
      : `${options.baseUrl}${href}`;

    if (/feature-albums\/?$/.test(fullUrl)) return;

    const headingText = cleanText($(el).find("h2, h3").first().text());
    const blurb = cleanText($(el).find("p").first().text());

    if (!headingText) return;

    const { artist, albumTitle } = parseAlbumHeading(headingText);
    if (!artist || !albumTitle) return;

    const container = $(el).parent();
    const containerText = cleanText(container.text());
    const publishedDate = extractPublishedDate(containerText);

    cards.push({
      artist,
      albumTitle,
      blurb,
      url: fullUrl,
      publishedDate,
    });
  });

  return cards.slice(0, options.maxAlbums);
}

// ---------------------------------------------------------------------------
// Parse "Artist - Album Title" heading
// ---------------------------------------------------------------------------

function parseAlbumHeading(text) {
  const match = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (!match) return { artist: null, albumTitle: null };

  const artist = cleanText(match[1]);
  const albumTitle = cleanText(match[2]);

  if (!artist || !albumTitle) return { artist: null, albumTitle: null };
  return { artist, albumTitle };
}

// ---------------------------------------------------------------------------
// Country resolution — triple j specific
// ---------------------------------------------------------------------------

function resolveCountry(artist, combinedText, filters, options) {
  const artistSlug = slugify(artist);

  const artistHints = filters.artistCountryHints || {};
  for (const [name, country] of Object.entries(artistHints)) {
    if (slugify(name) === artistSlug) return country;
  }

  if (options.knownAustralianArtists.some((name) => slugify(name) === artistSlug)) {
    return "Australia";
  }

  for (const [country, keywords] of Object.entries(filters.countryBuckets || {})) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword.toLowerCase())) return country;
    }
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

function inferGenresMapped(text, filters, options) {
  const found = new Set();

  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) found.add(label);
    }
  }

  for (const [keyword, label] of Object.entries(options.fallbackGenreLabels)) {
    if (text.includes(keyword)) found.add(label);
  }

  const allowed = new Set(filters.targetGenres || []);
  return Array.from(found).filter((g) => allowed.has(g));
}

function scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;

  score += 4;

  if (artistCountryMapped === "Australia") score += 3;

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
// Dedupe
// ---------------------------------------------------------------------------

function dedupeAndFilter(items, filters) {
  const runWindowDays = filters.runWindowDays || 14;
  const cutoff = Date.now() - runWindowDays * 24 * 60 * 60 * 1000;
  const map = new Map();

  for (const item of items) {
    const articleParsed = new Date(item.articleDate).getTime();
    const articleOk =
      item.articleDate === "unknown" ||
      Number.isNaN(articleParsed) ||
      articleParsed >= cutoff;
    if (!articleOk) continue;

    const parsed = new Date(item.releaseDate).getTime();
    const dateOk =
      item.releaseDate === "unknown" ||
      Number.isNaN(parsed) ||
      parsed >= cutoff;
    if (!dateOk) continue;

    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) {
      map.set(key, item);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.artist.localeCompare(b.artist)
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractPublishedDate(text) {
  const match = text.match(
    /Published:\s*(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i
  );
  if (match) return normalizeDate(match[1]);

  const bare = text.match(
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i
  );
  if (bare) return normalizeDate(bare[1]);

  return null;
}

async function fetchText(url, options) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.userAgent,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`triple j request failed: ${response.status} for ${url}`);
  }
  return response.text();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function runTripleJAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };

  const html = await fetchText(options.featureAlbumsUrl, options);
  const albumCards = parseFeatureAlbums(html, options);

  console.log(`[TripleJ Agent] Feature albums found: ${albumCards.length}`);

  const candidates = [];

  for (const card of albumCards) {
    const combinedText = cleanText(
      `${card.artist} ${card.albumTitle} ${card.blurb}`
    ).toLowerCase();

    const artistCountryMapped = resolveCountry(card.artist, combinedText, exclusions, options);
    const genresMapped = inferGenresMapped(combinedText, exclusions, options);
    const releaseType = "album"; // triple j feature albums are always albums
    const score = scoreRelease({
      combinedText,
      releaseType,
      genresMapped,
      artistCountryMapped,
    });
    const bucket = bucketFromScore(score);

    candidates.push({
      artist: card.artist,
      title: card.albumTitle,
      releaseType,
      releaseDate: card.publishedDate || "unknown",
      articleDate: card.publishedDate || "unknown",
      sourceService: options.sourceService,
      sourceUrl: card.url,
      genresMapped,
      artistCountryMapped,
      score,
      bucket,
    });
  }

  const deduped = dedupeAndFilter(candidates, exclusions);
  console.log(`[TripleJ Agent] Retained ${deduped.length} albums after date cutoff deduplication.`);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.artistCountryMapped && r.artistCountryMapped !== "unknown") description += ` | Loc: ${r.artistCountryMapped}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "triple j",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.articleDate === "unknown" ? new Date().toISOString().split("T")[0] : r.articleDate,
          description: description
      };
  });

  return unifiedResults;
}

module.exports = {
  runTripleJAgent
};
