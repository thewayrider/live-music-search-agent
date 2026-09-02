// collectors/rootsonlineCollector.js
// Roots Online NZ — weekly new music roundup scraper
// URL pattern: https://www.rootsonline.nz/new-music-DD-MM/
// All artists are NZ-based by editorial mandate.

import axios from "axios";
import * as cheerio from "cheerio";
import { enrichOrigins } from "../utils/musicbrainz.js";

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

// ── URL construction ──────────────────────────────────────────────────────
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

// ── Fetch with fallback across candidate slugs ────────────────────────────
async function fetchLatestPost() {
  const BASE = "https://www.rootsonline.nz/new-music-";
  const slugs = candidateSlugs();

  for (const slug of slugs) {
    const url = `${BASE}${slug}/`;
    try {
      const { data, status } = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MusicReleaseAgent/1.0)" },
        validateStatus: () => true,
      });
      if (status === 200 && data.length > 500) {
        console.log(`[rootsonline] Found post at ${url}`);
        return { html: data, sourceUrl: url };
      }
    } catch {
      // 404 or network error — try next slug
    }
  }

  console.warn("[rootsonline] No post found for any candidate slug this week.");
  return null;
}

// ── Parse HTML → candidate array ─────────────────────────────────────────
function parsePost({ html, sourceUrl }) {
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

    let bodyText = "";
    let sibling = $(el).next();
    while (sibling.length && sibling[0].tagName !== "h2") {
      bodyText += " " + sibling.text();
      sibling = sibling.next();
    }

    candidates.push({
      artist,
      title,
      releaseType,
      releaseDate:         null,
      sourceService:       "Roots Online NZ",
      sourceUrl,
      genresMapped:        [],
      artistCountryMapped: "NZ",
      marketsAvailable:    ["NZ"],
      score:               0,
      _bodyText:           bodyText.trim(),
    });
  });

  console.log(`[rootsonline] Parsed ${candidates.length} candidates from ${sourceUrl}`);
  return candidates;
}

// ── Public API ────────────────────────────────────────────────────────────
export async function collect(_filters, userOptions = {}) {
  console.log("[rootsonline] collect() called");
  const post = await fetchLatestPost();
  if (!post) return [];
  const candidates = parsePost(post);
  
  const http = userOptions.fetchImpl || fetch;
  const enriched = await enrichOrigins(candidates, http, userOptions);
  return enriched;
}