const DEFAULTS = {
  baseUrl: "https://futuremagmusic.com",
  categoryId: 1410, // "Future Focus"
  perPage: 20,
  sourceService: "Futuremag Music",
  defaultCountry: "Australia", 
  userAgent: "music-release-agent/1.0 ( https://kimrampling.com )",

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
  },
};

async function runFuturemagAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const url =
    `${options.baseUrl}/wp-json/wp/v2/posts` +
    `?categories=${options.categoryId}&per_page=${options.perPage}&_fields=id,date,link,title,content`;

  const res = await http(url, {
    headers: { "User-Agent": options.userAgent, Accept: "application/json" },
  });
  
  if (!res || !res.ok) {
    throw new Error(`futuremag: WP API request failed (${res && res.status})`);
  }
  
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];

  const items = [];
  for (const post of posts) {
    const articleDate = (post.date || "").slice(0, 10) || "unknown";
    const articleUrl = post.link || options.baseUrl;
    const html = (post.content && post.content.rendered) || "";
    for (const rel of parseFutureFocusPost(html)) {
      items.push(buildItem(rel, { articleDate, articleUrl, filters: exclusions, options }));
    }
  }

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = items.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;
      if (r.embedUrl) description += ` | Embed: ${r.embedUrl}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Futuremag Music",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.articleDate,
          description: description
      };
  });

  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Post parsing
// ---------------------------------------------------------------------------

function parseFutureFocusPost(html) {
  if (!html) return [];
  const headingRe = /<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/gi;

  const heads = [];
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    const raw = decodeEntities(stripTags(m[1])).trim();
    if (!raw) continue; 
    heads.push({ raw, start: m.index, end: m.index + m[0].length });
  }

  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const parsed = parseHeading(heads[i].raw);
    if (!parsed) continue;
    const segment = html.slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].start : html.length);
    parsed.blurb = decodeEntities(stripTags(segment)).replace(/\s+/g, " ").trim();
    parsed.embedUrl = firstYouTube(segment);
    out.push(parsed);
  }
  return out;
}

function parseHeading(rawHeading) {
  const heading = rawHeading.replace(/\s+/g, " ").trim();
  if (!heading) return null;

  const dash = heading.match(/\s+[–—-]\s+/);
  let artistPart, titlePart;
  if (dash) {
    const idx = dash.index;
    artistPart = heading.slice(0, idx).trim();
    titlePart = heading.slice(idx + dash[0].length).trim();
  } else {
    artistPart = heading;
    titlePart = "";
  }

  let releaseType = "single";
  const typeMatch = titlePart.match(/\((EP|ALBUM|LP|SINGLE|MIXTAPE)\)/i);
  if (typeMatch) {
    const t = typeMatch[1].toUpperCase();
    releaseType = t === "EP" ? "ep" : t === "SINGLE" ? "single" : "album"; 
    titlePart = titlePart.replace(/\s*\((EP|ALBUM|LP|SINGLE|MIXTAPE)\)\s*/i, " ").trim();
  }

  let featured = false;
  let featuredWith = null;
  let artist = artistPart;
  const feat = artistPart.match(/\s+(?:ft\.?|feat\.?|featuring)\s+/i);
  if (feat) {
    featured = true;
    artist = artistPart.slice(0, feat.index).trim();
    featuredWith = titleCase(artistPart.slice(feat.index + feat[0].length).trim());
  }

  return {
    artist: titleCase(artist),
    featured,
    featuredWith,
    title: titleCase(titlePart) || "unknown",
    releaseType,
  };
}

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------
function buildItem(rel, { articleDate, articleUrl, filters, options }) {
  const combinedText = `${rel.artist} ${rel.title} ${rel.blurb || ""}`.toLowerCase();

  const genresMapped = inferGenresMapped(combinedText, filters, options);
  const inferred = inferCountry(combinedText, rel.artist, filters);
  const artistCountryMapped = inferred === "unknown" ? options.defaultCountry : inferred;
  const marketsAvailable = inferMarkets(artistCountryMapped, filters);

  const score = scoreRelease({
    isRoundup: true, 
    combinedText,
    releaseType: rel.releaseType,
    genresMapped,
    artistCountryMapped,
  });
  const bucket = bucketFromScore(score);

  return {
    artist: rel.artist,
    title: rel.title,
    releaseType: rel.releaseType, 
    releaseDate: "unknown", 
    articleDate, 
    sourceService: options.sourceService,
    sourceUrl: articleUrl,
    marketsAvailable,
    genresMapped, 
    artistCountryMapped,
    score,
    bucket,
    originConfidence: inferred === "unknown" ? "medium" : "high",
    originSource: inferred === "unknown" ? "editorial-default:futuremag-new-aussie-releases" : "editorial:futuremag",
    stream: "Future Focus",
    featured: rel.featured,
    featuredWith: rel.featuredWith,
    embedUrl: rel.embedUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Inference + scoring
// ---------------------------------------------------------------------------
function inferGenresMapped(text, filters, options) {
  const found = new Set();

  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) found.add(label);
    }
  }

  for (const [keyword, label] of Object.entries(options.fallbackGenreLabels || {})) {
    if (text.includes(keyword)) found.add(label);
  }

  const allowed = new Set(filters.targetGenres || []);
  return Array.from(found).filter((g) => allowed.has(g));
}

function inferCountry(text, artist, filters) {
  const artistHints = filters.artistCountryHints || {};
  for (const [name, country] of Object.entries(artistHints)) {
    if (slugify(name) === slugify(artist)) return country;
  }
  for (const [country, keywords] of Object.entries(filters.countryBuckets || {})) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) return country;
    }
  }
  return "unknown";
}

function inferMarkets(country, filters) {
  if (!Array.isArray(filters.markets)) return ["AU"];
  if (country === "Australia") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ isRoundup, combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;

  if (isRoundup) score += 4;
  else score += 2;

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
// HTML / text utilities
// ---------------------------------------------------------------------------
function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, " ");
}

function firstYouTube(html) {
  const m = String(html).match(/https?:\/\/www\.youtube\.com\/embed\/([\w-]+)/i);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}

const NAMED_ENTITIES = {
  amp: "&", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—",
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (mm, name) => (name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : mm));
}

function safeChar(code) {
  try { return String.fromCodePoint(code); } catch { return ""; }
}

const SMALL_WORDS = new Set(["a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "vs", "x"]);
function titleCase(s) {
  const str = String(s).trim();
  if (!str) return "";
  return str
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      const bare = lower.replace(/[^a-z0-9]/g, "");
      if (i !== 0 && SMALL_WORDS.has(bare)) return lower;
      return lower.replace(/[a-z]/, (c) => c.toUpperCase());
    })
    .join(" ");
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

module.exports = {
  runFuturemagAgent
};
