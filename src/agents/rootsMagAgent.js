const cheerio = require("cheerio");

const DEFAULTS = {
  baseUrl: "https://www.rootsmag.nz/new-music-",
  sourceService: "Roots Mag",
  userAgent: "music-release-agent/1.0 (+local-first personal release discovery)",
  timeoutMs: 10000,
};

const TYPE_PATTERNS = [
  { re: /\(ALBUM\)/i,  type: "Album"  },
  { re: /\(EP\)/i,     type: "EP"     },
  { re: /\(SINGLE\)/i, type: "Single" },
];

function parseReleaseType(headingText) {
  for (const { re, type } of TYPE_PATTERNS) {
    if (re.test(headingText)) return type;
  }
  return "Single";
}

function cleanTitle(raw) {
  return raw.replace(/\s*\((ALBUM|EP|SINGLE)\)\s*$/i, "").trim();
}

function candidateSlugs(referenceDate = new Date()) {
  const slugs = [];
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    slugs.push(`${dd}-${mm}`);
  }
  return [...new Set(slugs)];
}

async function fetchText(url, options) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.userAgent,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} for ${url}`);
  }

  return response.text();
}

async function runRootsMagAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const slugs = candidateSlugs();
  let html = null;
  let sourceUrl = null;

  for (const slug of slugs) {
    const url = `${options.baseUrl}${slug}/`;
    try {
      html = await fetchText(url, options);
      if (html && html.length > 500) {
        console.log(`[RootsMag Agent] Found post at ${url}`);
        sourceUrl = url;
        break; // Stop at the first successful fetch
      }
    } catch (e) {
      // Ignore errors (404s) and try the next slug
    }
  }

  if (!html) {
    console.warn("[RootsMag Agent] No post found for any candidate slug this week.");
    return [];
  }

  const $ = cheerio.load(html);
  const candidates = [];

  $("h2").each((_, el) => {
    const headingText = $(el).text().trim();

    if (!headingText.includes("—") && !headingText.includes("–")) return;

    const sep   = headingText.includes("—") ? "—" : "–";
    const parts = headingText.split(sep);
    if (parts.length < 2) return;

    const artist   = parts[0].trim();
    const rawTitle = parts.slice(1).join(sep).trim();
    const releaseType = parseReleaseType(rawTitle);
    const title       = cleanTitle(rawTitle);

    if (!artist || !title) return;

    candidates.push({
      artist,
      title,
      releaseType,
      sourceUrl
    });
  });

  console.log(`[RootsMag Agent] Parsed ${candidates.length} candidates from ${sourceUrl}`);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = candidates.map(r => {
      let description = `Type: ${r.releaseType} | Genres: Roots/Indie (NZ)`;
      
      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Roots Mag",
          url: r.sourceUrl,
          views: "Manual review",
          uploadedAt: new Date().toISOString().split('T')[0],
          description: description
      };
  });

  return unifiedResults;
}

module.exports = {
  runRootsMagAgent
};
