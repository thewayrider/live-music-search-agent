# Music Crawler Overseer & Source Expansion Guidelines

## 1. System Role & Overseer Pattern
- The agent functions as an **Overseer** linking and coordinating both **Antigravity** (autonomous research, web discovery, background audits) and **Antigravity IDE** (interactive coding, visual diff reviews, manual approval).
- Single source of truth is the local repository: `src/agents`, `configs/`, `schedules.json`, and `dashboard.html`.

## 2. Multi-Machine (Dual-PC) Deployment Rules
- **Desktop PC**: Primary development and testing environment. All new crawlers, fixes, and schedule changes are authored and tested here, then committed and pushed to GitHub `origin/main`.
- **Always-On Mini PC**: Dedicated 24/7 host running scheduled crawlers via Windows Task Scheduler. Runs `git pull` to receive updates. **Never commits or pushes code back to Git directly.**

## 3. Targeted Source Discovery Funnel (`[Genre]` × `[Region]`)
- **Anti-Swamping Principle**: Never scrape global catalogs (e.g. Deezer/Spotify general queries) for broad genres, which flood the system with unusable noise.
- **Regional & Cultural Gatekeeping**: Bound searches by `[Genre]` and `[Country/Region]` (e.g., Australian/NZ Indie, Irish Post-Punk, UK Alternative).
- **Target Sources**: Regional independent chart bodies (AIR Charts, IRMA), community/college radio playlists (FBi, 4ZZZ, RTRFM, RTE 2XM), local tastemaker blogs (Roots Mag NZ, Acid Stag, Nialler9, UnderTheRadar NZ), and localized Bandcamp tags.
- **Yield Sweet Spot**: Target 5 to 30 tracks per week to preserve the user's manual 4-stage curation workflow (*Discovery → Selection → New Release → Spotlight*).

## 4. Unified Crawler Output Contract
Every crawler agent in `src/agents/` must resolve to an array of objects matching this exact schema:
```javascript
{
  title: `${artist} - ${title}`,
  channel: "Source Name",
  url: sourceUrl,
  views: "Manual review",
  uploadedAt: "YYYY-MM-DD",
  description: "Type: Single/EP/Album | Genres: ..."
}
```
- Must use existing error-handling patterns, respect `src/exclusions.json`, and utilize `src/utils/aiScraper.js` when extracting from unstructured article text.

## 5. Automated Scheduling & Task Registration
- When onboarding a new crawler:
  1. Add configuration file to `configs/<source>_<genre>.json`.
  2. Create executable runner batch file `run_<source>.bat`.
  3. Append task definition into `configs/schedules.json`.
  4. Trigger `setup_task.ps1` to update Windows Task Scheduler.

## 6. Telemetry & Crawler Diagnostics (Self-Healing)
- Every run logs to `saved_searches/` and updates `dashboard.html` via `metricsAggregator.js` and syncs to GitHub Gist for the Android monitor app.
- **Health Watchdog Threshold**: Crawlers yielding 0 new songs across $\ge 4$ consecutive runs (e.g., Amrap, Futuremag) or inactive for $\ge 10$ days are flagged for diagnostic inspection (DOM selector updates, API endpoint changes, or 403 header bypasses).
