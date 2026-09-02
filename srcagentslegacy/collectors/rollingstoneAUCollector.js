// collectors/rollingstoneAUCollector.js
// Rolling Stone AU/NZ — weekly ANZ music roundup scraper
// RSS feed:  https://au.rollingstone.com/feed/
// Target:    "Best Australian and New Zealand Music of the Week" (and older AU-only variant)

import axios from "axios";
import * as cheerio from "cheerio";
import { enrichOrigins } from "../utils/musicbrainz.js";

const RSS_URL  = "https://au.rollingstone.com/feed/";
const TITLE_RE = /best (australian (and new zealand|&amp; new zealand)?|new zealand) music of the week/i;

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
    if (lower.includes(s)) return "NZ";
  }
  for (const s of AU_SIGNALS) {
    if (lower.includes(s)) return "AU";
  }

  return null;
}

// ── Release type detection ────────────────────────────────────────────────
function detectReleaseType(headingText, bodyText) {
  const combined = (headingText + " " + bodyText).toLowerCase();
  if (/\balbum\b/.test(combined)) return "Album";
  if (/\bep\b/.test(combined))    return "EP";
  return "Single";
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

  return { artist: text, title: "" };
}

// ── Step 1: Find the latest roundup post URL via RSS ─────────────────────
async function findLatestRoundupUrl() {
  const { data } = await axios.get(RSS_URL, {
    timeout: 12000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MusicReleaseAgent/1.0)" },
  });

  const $ = cheerio.load(data, { xmlMode: true });
  let foundUrl = null;

  $("item").each((_, el) => {
    if (foundUrl) return;
    const title = $(el).find("title").text();
    const link  = $(el).find("link").text() || $(el).find("guid").text();
    if (TITLE_RE.test(title)) {
      foundUrl = link.trim();
    }
  });

  if (foundUrl) {
    console.log(`[rollingstoneAU] Found roundup via RSS: ${foundUrl}`);
  } else {
    console.warn("[rollingstoneAU] No matching roundup found in RSS feed.");
  }

  return foundUrl;
}

// ── Step 2: Scrape the roundup post ──────────────────────────────────────
async function scrapeRoundupPost(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MusicReleaseAgent/1.0)" },
  });
  return data;
}

// ── Step 3: Parse HTML → candidates ──────────────────────────────────────
function parsePost(html, sourceUrl, filters) {
  const $ = cheerio.load(html);
  const candidates = [];

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

    candidates.push({
      artist,
      title,
      releaseType,
      releaseDate:         null,
      sourceService:       "Rolling Stone AU/NZ",
      sourceUrl,
      genresMapped:        [],
      artistCountryMapped,
      marketsAvailable:    artistCountryMapped ? [artistCountryMapped] : [],
      score:               0,
      _bodyText:           bodyText,
    });
  });

  console.log(`[rollingstoneAU] Parsed ${candidates.length} candidates from ${sourceUrl}`);
  return candidates;
}

// ── Public API ────────────────────────────────────────────────────────────
export async function collect(filters, userOptions = {}) {
  console.log("[rollingstoneAU] collect() called");
  const url = await findLatestRoundupUrl();
  if (!url) return [];
  const html = await scrapeRoundupPost(url);
  const candidates = parsePost(html, url, filters);
  
  const http = userOptions.fetchImpl || fetch;
  const enriched = await enrichOrigins(candidates, http, userOptions);
  return enriched;
}