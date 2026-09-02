const cheerio = require("cheerio");

const DEFAULTS = {
  baseUrl: "https://happymag.tv",
  musicFeedUrl: "https://happymag.tv/music/",
  sourceService: "Happy Mag",
  requestDelayMs: 1500,
  maxFeedArticles: 12,
  maxRoundupArticles: 6,
  timeoutMs: 20000,
  userAgent: "music-release-agent/1.0 (+local-first personal release discovery)",
  roundupTitlePatterns: [
    /new music friday/i,
    /best new music/i,
    /bringing you the best new music/i,
    /featuring/i,
  ],
  excludedTitlePatterns: [
    /sexiest/i,
    /nsfw/i,
    /\bvideo\b/i,
    /\bvideos\b/i,
    /\bbooks\b/i,
    /\binterviews\b/i,
    /\bpodcast\b/i,
    /\blive\b/i,
    /\bpoetry\b/i,
    /\bcover of\b/i,
    /\bperforms\b/i,
    /\bbiography\b/i,
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
    independent: "Indie",
  },
};

async function runHappyMagAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const feedHtml = await fetchText(options.musicFeedUrl, http, options);
  const feedCards = parseMusicFeed(feedHtml, options);

  console.log("[HappyMag Agent] Feed cards found:", feedCards.length);

  const targetCards = feedCards
    .filter((card) => isRelevantFeedCard(card, options))
    .slice(0, options.maxRoundupArticles);

  console.log("[HappyMag Agent] Target cards found:", targetCards.length);

  const releases = [];

  for (const card of targetCards) {
    await delay(options.requestDelayMs);

    const articleHtml = await fetchText(card.url, http, options);
    const article = parseArticle(articleHtml, card.url, options);

    console.log(`[HappyMag Agent] Scraping Article: ${card.url}`);
    const extracted = extractReleaseItems(article, card, exclusions, options);
    releases.push(...extracted);
  }

  console.log("[HappyMag Agent] Total extracted before dedupe:", releases.length);
  const deduped = dedupeAndSort(releases, exclusions);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Happy Mag",
          url: r.sourceUrl, // Could be Spotify/Bandcamp link from within the article
          views: r.bucket,
          uploadedAt: r.articleDate,
          description: description
      };
  });

  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Scraping Logic
// ---------------------------------------------------------------------------

function parseMusicFeed(html, options) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const cards = [];

  $("a[href]").each((_, el) => {
    const href = absolutize($(el).attr("href"), options.baseUrl);
    const title = cleanText($(el).text());

    if (!href || !href.startsWith(options.baseUrl)) return;
    if (seen.has(href)) return;
    if (!isLikelyArticleUrl(href)) return;
    if (!title || title.length < 10) return;

    const container = $(el).closest("article, li, div, section");
    const contextText = cleanText(container.text());

    cards.push({
      url: href,
      title,
      excerpt: summarize(contextText.replace(title, ""), 220),
      isRoundup: isRoundupTitle(title, options),
    });

    seen.add(href);
  });

  return cards.slice(0, options.maxFeedArticles);
}

function parseArticle(html, articleUrl, options) {
  const $ = cheerio.load(html);

  const title =
    cleanText($("h1").first().text()) || cleanText($("title").first().text());

  const dateText =
    cleanText($("time").first().attr("datetime")) ||
    cleanText($("time").first().text()) ||
    extractDateFromText(cleanText($("body").text()));

  const articleRoot = $("main, article, #primary").first();
  const bodyRoot = articleRoot.length ? articleRoot : $("body");

  const sections = [];
  let current = null;

  bodyRoot.find("h2, h3, h4, p, a").each((_, el) => {
    const tag = (el.tagName || el.name || "").toLowerCase();
    const text = cleanText($(el).text());
    if (!text) return;

    if ((tag === "h2" || tag === "h3") && isLikelyArtistHeading(text)) {
      if (current && isUsableSection(current)) sections.push(current);
      current = { heading: text, paragraphs: [], links: [] };
      return;
    }

    if (!current) return;

    if (tag === "p") current.paragraphs.push(text);

    if (tag === "a") {
      const href = absolutize($(el).attr("href"), options.baseUrl);
      if (href) current.links.push({ text, href });
    }
  });

  if (current && isUsableSection(current)) sections.push(current);

  return {
    url: articleUrl,
    title,
    releaseDate: normalizeDate(dateText),
    sections,
  };
}

function extractReleaseItems(article, card, filters, options) {
  const items = [];

  for (const section of article.sections) {
    const artist = normalizeArtist(section.heading);
    if (!artist || /^post navigation$/i.test(artist)) continue;

    const combinedText = cleanText([
      article.title,
      card.title,
      ...section.paragraphs,
      ...section.links.map((link) => link.text),
    ]).toLowerCase();

    const title = inferReleaseTitle(section, artist);
    const releaseType = inferReleaseType(combinedText);
    const genresMapped = inferGenresMapped(combinedText, filters, options);
    const artistCountryMapped = inferCountry(combinedText, artist, filters);
    const marketsAvailable = inferMarkets(artistCountryMapped, filters);
    const score = scoreRelease({
      card,
      combinedText,
      releaseType,
      genresMapped,
      artistCountryMapped,
    });
    const bucket = bucketFromScore(score);
    const sourceUrl = pickBestLink(section.links, article.url);

    items.push({
      artist: artist || "Unknown artist",
      title: title || "Unknown release",
      releaseType,
      releaseDate: article.releaseDate || "unknown", 
      articleDate: article.releaseDate || "unknown",
      sourceService: options.sourceService,
      sourceUrl,
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
// Inference + Scoring
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
  return Array.from(found).filter((genre) => allowed.has(genre));
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

function inferReleaseType(text) {
  if (/\b(album|record|lp|full-length)\b/.test(text)) return "album";
  if (/\b(ep|debut ep|upcoming ep)\b/.test(text)) return "ep";
  if (/\b(single|new single|latest single|debut single|track)\b/.test(text)) return "single";
  return "unknown";
}

function inferReleaseTitle(section, artist) {
  const mediaLink = section.links.find((link) =>
    /bandcamp\.com|spotify\.com|youtube\.com|youtu\.be|soundcloud\.com|apple\.com/.test(link.href)
  );

  if (mediaLink?.text && !sameish(mediaLink.text, artist)) {
    return cleanText(mediaLink.text);
  }

  for (const paragraph of section.paragraphs) {
    const quoted = paragraph.match(/['""]([^'""]{2,120})['""]/);
    if (quoted && !sameish(quoted[1], artist)) {
      return cleanText(quoted[1]);
    }
  }

  return null;
}

function scoreRelease({ card, combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;

  if (card.isRoundup) score += 4;
  else score += 1;

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
    /hip-hop|trap|drill|edm|dance|club-ready|rap/.test(combinedText) &&
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

function pickBestLink(links, fallbackUrl) {
  const media = links.find((link) =>
    /bandcamp\.com|spotify\.com|youtube\.com|youtu\.be|soundcloud\.com|apple\.com/.test(link.href)
  );
  return media?.href || fallbackUrl;
}

function isRelevantFeedCard(card, options) {
  const haystack = cleanText(`${card.title} ${card.excerpt}`).toLowerCase();

  if (options.excludedTitlePatterns.some((pattern) => pattern.test(haystack))) {
    return false;
  }

  if (isRoundupTitle(card.title, options)) return true;

  return (
    /new music this week|new releases this week|out now|dropping this friday|best new albums/.test(haystack) ||
    (/\b(ep|single)\b/.test(haystack) && /\bnew\b/.test(haystack))
  );
}

function isRoundupTitle(title, options) {
  return options.roundupTitlePatterns.some((pattern) => pattern.test(title || ""));
}

function isLikelyArticleUrl(url) {
  return (
    /^https:\/\/happymag\.tv\/.+\/$/.test(url) &&
    !/\/(tag|author|category|wp-content|about|contact|privacy-policy|terms|music|news|lists)\/?$/.test(url)
  );
}

function isLikelyArtistHeading(text) {
  if (!text || text.length > 80) return false;
  if (/play on spotify|related|trending|tags|read more|post navigation/i.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function isUsableSection(section) {
  const heading = cleanText(section?.heading);
  if (!heading) return false;
  if (/^post navigation$/i.test(heading)) return false;
  return true;
}

function normalizeArtist(value) {
  return cleanText(value)
    .replace(/[–—-].*$/, "")
    .replace(/\s+feat\..*$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// HTML / text utilities
// ---------------------------------------------------------------------------

async function fetchText(url, http, options) {
  const response = await http(url, {
    headers: {
      "user-agent": options.userAgent,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Happy Mag request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

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

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function extractDateFromText(text) {
  const match = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
  );
  return match ? match[0] : null;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function absolutize(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function summarize(text, max = 220) {
  const cleaned = cleanText(text);
  if (!cleaned) return "";
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trim()}…`;
}

function sameish(a, b) {
  return slugify(a) === slugify(b);
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

module.exports = {
  runHappyMagAgent
};
