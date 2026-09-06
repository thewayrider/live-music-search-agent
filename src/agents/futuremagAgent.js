const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");

const DEFAULTS = {
  baseUrl: "https://futuremagmusic.com",
  categoryId: 1410, // "Future Focus"
  perPage: 5,
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

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

async function runFuturemagAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const url =
    `${options.baseUrl}/wp-json/wp/v2/article` +
    `?search=New+Aussie+Releases&per_page=${options.perPage}&_fields=id,date,link,title,content`;

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
    
    const $ = cheerio.load(html);
    $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b').append(' ');
    const bodyText = cleanText($.text());

    console.log(`[Futuremag Agent] AI extracting from: ${post.title && post.title.rendered}`);
    const aiResults = await extractReleasesWithAI(bodyText);

    for (const rel of aiResults) {
      // The AI doesn't give us embeds, so embedUrl will be null unless we fetch it manually
      // We pass bodyText so buildItem can infer genres
      items.push(buildItem(rel, { articleDate, articleUrl, filters: exclusions, options, bodyText }));
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

// ---------------------------------------------------------------------------
// Post parsing
// ---------------------------------------------------------------------------
// Manual parsing removed in favor of AI Scraper

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------
function buildItem(rel, { articleDate, articleUrl, filters, options, bodyText }) {
  const combinedText = `${rel.artist} ${rel.title} ${bodyText || ""}`.toLowerCase();

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
// ---------------------------------------------------------------------------
// HTML / text utilities
// ---------------------------------------------------------------------------

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

module.exports = {
  runFuturemagAgent
};
