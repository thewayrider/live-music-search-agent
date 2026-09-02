import * as cheerio from "cheerio";
import { enrichOrigins } from "../utils/musicbrainz.js";

const DEFAULTS = {
  baseUrl: "https://acidstag.com",
  feedUrl: "https://acidstag.com/feed/",
  sourceService: "Acid Stag",
  requestDelayMs: 1500,
  maxFeedItems: 30,         // RSS items to consider per run
  maxRoundupFetches: 4,     // max roundup articles to fetch HTML for
  timeoutMs: 20000,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",

  // Titles matching these are multi-track roundup posts — fetch their HTML
  roundupTitlePatterns: [
    /friday faves/i,
    /newcomers/i,
    /acid stag radio/i,
    /sound escapes/i,
    /best new/i,
    /weekly/i,
  ],

  // Drop these entirely — not music releases
  excludedTitlePatterns: [
    /hump day mix/i,
    /\bmix\b/i,
    /\bpodcast\b/i,
    /\binterview\b/i,
    /\blive review\b/i,
    /\btour\b/i,
    /\bgig guide\b/i,
  ],

  // Loose text → mapped genre (mirrors happymag fallback labels)
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

export async function collectAcidStagReleases(filters = {}, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };
  const http = options.fetchImpl || fetch;

  const feedXml = await fetchText(options.feedUrl, http, options);
  const feedItems = parseRSSFeed(feedXml, options);

  console.log("[AcidStag] Feed items parsed:", feedItems.length);
  console.log("[AcidStag] Sample titles:", feedItems.slice(0, 5).map((i) => i.title));

  const releases = [];
  let roundupsFetched = 0;

  for (const item of feedItems) {
    // Single-release posts: extract directly from RSS, no HTTP fetch needed
    if (!item.isRoundup) {
      const candidate = extractFromRSSItem(item, filters, options);
      if (candidate) releases.push(candidate);
      continue;
    }

    // Roundup posts: fetch the article HTML and parse sections
    if (roundupsFetched >= options.maxRoundupFetches) continue;
    roundupsFetched++;

    await delay(options.requestDelayMs);
    const html = await fetchText(item.url, http, options).catch((err) => {
      console.warn("[AcidStag] Failed to fetch roundup:", item.url, err.message);
      return null;
    });
    if (!html) continue;

    const roundupItems = extractFromRoundup(html, item, filters, options);
    console.log(`[AcidStag] Roundup "${item.title}" → ${roundupItems.length} items`);
    releases.push(...roundupItems);
  }

  console.log("[AcidStag] Total extracted before dedupe:", releases.length);
  const enriched = await enrichOrigins(releases, http, options);
  return dedupeAndSort(enriched, filters);
}

// ---------------------------------------------------------------------------
// RSS parsing — no cheerio needed, plain regex on XML is fine for RSS
// ---------------------------------------------------------------------------

function parseRSSFeed(xml, options) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const block of itemBlocks.slice(0, options.maxFeedItems)) {
    const title = decodeXmlEntities(extractTag(block, "title"));
    const url = decodeXmlEntities(extractTag(block, "link") || extractTag(block, "guid"));
    const pubDate = extractTag(block, "pubDate");
    const description = decodeXmlEntities(stripHtml(extractTag(block, "description") || ""));

    if (!title || !url) continue;

    // Exclude immediately
    if (options.excludedTitlePatterns.some((p) => p.test(title))) continue;

    const isRoundup = options.roundupTitlePatterns.some((p) => p.test(title));
    const articleDate = normalizeDate(pubDate);

    items.push({ title, url, description, pubDate, articleDate, isRoundup });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Single-release extraction directly from RSS item (no HTML fetch)
// ---------------------------------------------------------------------------

function extractFromRSSItem(item, filters, options) {
  // Acid Stag titles are reliably: "Artist – Title" or "ARTIST – Title (LP)"
  const { artist, releaseTitle } = parseArtistTitle(item.title);
  if (!artist) return null;

  const combinedText = cleanText(`${item.title} ${item.description}`).toLowerCase();
  const releaseType = inferReleaseType(combinedText, item.title);
  const genresMapped = inferGenresMapped(combinedText, filters, options);
  const artistCountryMapped = inferCountry(combinedText, artist, filters);
  const marketsAvailable = inferMarkets(artistCountryMapped, filters);
  const score = scoreRelease({
    isRoundup: false,
    combinedText,
    releaseType,
    genresMapped,
    artistCountryMapped,
  });
  const bucket = bucketFromScore(score);

  return {
    artist,
    title: releaseTitle || "Unknown release",
    releaseType,
    releaseDate: item.articleDate || "unknown",
    articleDate: item.articleDate || "unknown",
    sourceService: options.sourceService,
    sourceUrl: item.url,
    marketsAvailable,
    genresMapped,
    artistCountryMapped,
    score,
    bucket,
  };
}

// ---------------------------------------------------------------------------
// Roundup article extraction (HTML fetch + section parsing)
// Acid Stag roundups list tracks as headings or bold text: "Artist – Title"
// ---------------------------------------------------------------------------

function extractFromRoundup(html, item, filters, options) {
  // Dynamically import cheerio — already installed in project
  const $ = cheerio.load(html);
  if (!$) return [];

  const items = [];
  const articleDate = item.articleDate || "unknown";

  // Acid Stag roundup posts list entries as <p><strong>Artist – Title</strong></p>
  // or as <h2>/<h3> headings — scan both
  const candidates = new Set();

  $("h2, h3, h4, p strong, p b").each((_, el) => {
    const text = cleanText($(el).text());
    if (!text || text.length > 100) return;
    if (/friday faves|newcomers|acid stag|sound escapes/i.test(text)) return;
    candidates.add(text);
  });

  for (const heading of candidates) {
    const { artist, releaseTitle } = parseArtistTitle(heading);
    if (!artist) continue;

    // Gather surrounding paragraph text for scoring context
    const combinedText = cleanText(`${item.title} ${item.description} ${heading}`).toLowerCase();
    const releaseType = inferReleaseType(combinedText, heading);
    const genresMapped = inferGenresMapped(combinedText, filters, options);
    const artistCountryMapped = inferCountry(combinedText, artist, filters);
    const marketsAvailable = inferMarkets(artistCountryMapped, filters);
    const score = scoreRelease({
      isRoundup: true,
      combinedText,
      releaseType,
      genresMapped,
      artistCountryMapped,
    });
    const bucket = bucketFromScore(score);

    items.push({
      artist,
      title: releaseTitle || "Unknown release",
      releaseType,
      releaseDate: articleDate,
      articleDate,
      sourceService: options.sourceService,
      sourceUrl: item.url,
      marketsAvailable,
      genresMapped,
      artistCountryMapped,
      score,
      bucket,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Parse "Artist – Title" or "ARTIST – Title (LP)" from RSS/heading text
// ---------------------------------------------------------------------------

function parseArtistTitle(text) {
  // Split on em-dash, en-dash, or spaced hyphen
  const match = text.match(/^(.+?)\s*[–—]\s*['"]?(.+?)['"]?\s*(\(LP\)|\(EP\))?\s*$/);
  if (!match) return { artist: null, releaseTitle: null };

  const artist = cleanText(match[1]);
  // Strip surrounding quotes from title
  const releaseTitle = cleanText(match[2]).replace(/^['""']|['""']$/g, "");

  if (!artist || artist.length < 1) return { artist: null, releaseTitle: null };
  return { artist, releaseTitle };
}

// ---------------------------------------------------------------------------
// Inference helpers (mirrors happymag.js pattern)
// ---------------------------------------------------------------------------

function inferReleaseType(text, rawTitle = "") {
  const t = `${text} ${rawTitle}`.toLowerCase();
  if (/\b(lp)\b/.test(rawTitle) || /\b(album|record|lp|full-length)\b/.test(t)) return "album";
  if (/\b(ep)\b/.test(rawTitle) || /\b(ep|debut ep|upcoming ep)\b/.test(t)) return "ep";
  if (/\b(single|new single|latest single|debut single|track)\b/.test(t)) return "single";
  return "unknown";
}

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
  if (!Array.isArray(filters.markets)) return [];
  if (country === "Australia") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ isRoundup, combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;

  if (isRoundup) score += 4;
  else score += 2;   // single-release posts on Acid Stag are editorially chosen — worth more than HM non-roundups

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
// Dedupe + sort (same logic as happymag.js)
// ---------------------------------------------------------------------------

function dedupeAndSort(items, filters) {
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

function loadCheerio(html) {
  return cheerio.load(html);
}

async function fetchText(url, http, options) {
  const response = await http(url, {
    headers: {
      "user-agent": options.userAgent,
      accept: "text/html,application/xhtml+xml,application/rss+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Acid Stag request failed: ${response.status} for ${url}`);
  }
  return response.text();
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ||
                xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function decodeXmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}