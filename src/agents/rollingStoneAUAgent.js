const cheerio = require("cheerio");

const DEFAULTS = {
  sourceService: "Rolling Stone AU/NZ",
  rssUrl: "https://au.rollingstone.com/feed/",
  titleRe: /best (australian (and new zealand|&amp; new zealand)?|new zealand) music of the week/i,
  userAgent: "music-release-agent/1.0",
  timeoutMs: 15000,
};

// ── Country signals ───────────────────────────────────────────────────────
const NZ_SIGNALS = [
  "aotearoa", "new zealand", "kiwi", " nz ", "nz music month",
  "tāmaki makaurau", "ōtautahi", "ōtepoti", "pōneke",
  "auckland-based", "wellington-based", "dunedin-based", "christchurch-based",
  "auckland singer", "auckland band", "auckland rapper", "nz on air",
];

const AU_SIGNALS = [
  "australian", "australia", "sydney", "melbourne", "brisbane",
  "perth", "adelaide", "canberra", "hobart", "darwin",
  "sydney-based", "melbourne-based", "brisbane-based", "perth-based",
  "nsw", "victoria", "queensland", "south australia", "western australia",
  "northern territory", "nt rapper", "nt musician",
];

function detectCountry(bodyText, artistName, filters) {
  const hint = filters?.artistCountryHints?.[artistName];
  if (hint) return hint === "New Zealand" ? "NZ" : hint === "Australia" ? "AU" : hint;

  const lower = bodyText.toLowerCase();

  for (const s of NZ_SIGNALS) {
    if (lower.includes(s)) return "New Zealand";
  }
  for (const s of AU_SIGNALS) {
    if (lower.includes(s)) return "Australia";
  }

  return "unknown";
}

// ── Release type detection ────────────────────────────────────────────────
function detectReleaseType(headingText, bodyText) {
  const combined = (headingText + " " + bodyText).toLowerCase();
  if (/\balbum\b/.test(combined)) return "album";
  if (/\bep\b/.test(combined))    return "ep";
  return "single";
}

// ── Parse artist + title from <h3> heading ────────────────────────────────
function parseHeading(raw) {
  const text = raw.trim();

  const commaMatch = text.match(/^(.+?),\s+[\u2018\u2019\u201C\u201D"'](.+?)[\u2018\u2019\u201C\u201D"']$/);
  if (commaMatch) return { artist: commaMatch[1].trim(), title: commaMatch[2].trim() };

  const dashMatch = text.match(/^(.+?)\s+[\u2013\u2014]\s+(.+)$/);
  if (dashMatch) return { artist: dashMatch[1].trim(), title: dashMatch[2].trim() };

  const slashMatch = text.match(/^(.+?)\s+\/\s+[\u2018\u2019"'](.+?)[\u2018\u2019"']$/);
  if (slashMatch) return { artist: slashMatch[1].trim(), title: slashMatch[2].trim() };

  return { artist: text, title: "unknown" };
}

// ── Scoring Logic ─────────────────────────────────────────────────────────
function inferGenresMapped(text, filters) {
  const found = new Set();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) found.add(label);
    }
  }
  const allowed = new Set(filters.targetGenres || []);
  return Array.from(found).filter((genre) => allowed.has(genre));
}

function scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;

  // Source quality: Rolling Stone editorial roundup is high quality
  score += 4;

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

// ── Step 1: Find the latest roundup post URL via RSS ─────────────────────
async function findLatestRoundupUrl(options) {
  const res = await fetch(options.rssUrl, {
    headers: { "User-Agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const text = await res.text();

  const $ = cheerio.load(text, { xmlMode: true });
  let foundUrl = null;

  $("item").each((_, el) => {
    if (foundUrl) return;
    const title = $(el).find("title").text();
    const link  = $(el).find("link").text() || $(el).find("guid").text();
    if (options.titleRe.test(title)) {
      foundUrl = link.trim();
    }
  });

  if (foundUrl) {
    console.log(`[Rolling Stone AU Agent] Found roundup via RSS: ${foundUrl}`);
  } else {
    console.warn("[Rolling Stone AU Agent] No matching roundup found in RSS feed.");
  }

  return foundUrl;
}

// ── Step 2: Scrape the roundup post ──────────────────────────────────────
async function scrapeRoundupPost(url, options) {
  const res = await fetch(url, {
    headers: { "User-Agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`Article fetch failed: ${res.status}`);
  return await res.text();
}

// ── Step 3: Parse HTML → candidates ──────────────────────────────────────
function parsePost(html, sourceUrl, filters) {
  const $ = cheerio.load(html);
  const candidates = [];

  const articleDateMatch = html.match(/"datePublished":"(.*?)"/);
  const articleDate = articleDateMatch ? articleDateMatch[1].split("T")[0] : new Date().toISOString().split("T")[0];

  $("h3").each((_, el) => {
    const headingRaw = $(el).text().trim();
    if (!headingRaw || headingRaw.length > 120) return;
    if (/^(love music|trending|get the magazine|subscribe)/i.test(headingRaw)) return;

    let bodyText = "";
    let sibling = $(el).next();
    while (sibling.length && sibling[0].tagName !== "h3") {
      if (sibling.hasClass("in-this-article") || sibling.text().includes("In This Article")) break;
      bodyText += " " + sibling.text();
      sibling = sibling.next();
    }
    bodyText = bodyText.trim();

    const { artist, title }   = parseHeading(headingRaw);
    if (!artist) return;

    const releaseType         = detectReleaseType(headingRaw, bodyText);
    const artistCountryMapped = detectCountry(bodyText, artist, filters);
    
    const combinedText = (headingRaw + " " + bodyText).toLowerCase();
    const genresMapped = inferGenresMapped(combinedText, filters);
    const score = scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped });

    candidates.push({
      artist,
      title,
      releaseType,
      releaseDate:         articleDate,
      articleDate:         articleDate,
      sourceService:       DEFAULTS.sourceService,
      sourceUrl,
      genresMapped,
      artistCountryMapped,
      score,
      bucket:              bucketFromScore(score),
    });
  });

  console.log(`[Rolling Stone AU Agent] Parsed ${candidates.length} candidates from ${sourceUrl}`);
  return candidates;
}

// ── Public API ────────────────────────────────────────────────────────────
async function runRollingStoneAUAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  
  const url = await findLatestRoundupUrl(options);
  if (!url) return [];
  
  const html = await scrapeRoundupPost(url, options);
  const candidates = parsePost(html, url, exclusions);
  
  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = candidates.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.artistCountryMapped) description += ` | Loc: ${r.artistCountryMapped}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Rolling Stone AU/NZ",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.articleDate,
          description: description
      };
  });

  return unifiedResults;
}

module.exports = {
  runRollingStoneAUAgent
};
