# Music Crawler Overseer & Source Expansion Guidelines

## 1. System Role & Overseer Pattern
- The agent functions as an **Overseer** linking and coordinating both **Antigravity** (autonomous research, web discovery, background audits) and **Antigravity IDE** (interactive coding, visual diff reviews, manual approval).
- Single source of truth is the local repository: `src/agents`, `configs/`, `schedules.json`, and `dashboard.html`.

## 2. Multi-Machine (Dual-PC) Deployment Rules
- **Desktop PC**: Primary development, testing, and Overseer scouting workbench. All new crawlers, fixes, and schedule changes are authored and tested here, then committed and pushed to GitHub `origin/main`.
  - **Background Task Isolation**: The Desktop PC must **never** run active Windows Task Scheduler background tasks simultaneously with the Mini PC. Run `disable_desktop_tasks.ps1` on the Desktop PC if tasks are ever mistakenly registered.
- **Always-On Mini PC**: Dedicated 24/7 host running scheduled crawlers via Windows Task Scheduler. Runs `git pull origin main` to receive updates. **Never commits or pushes code back to Git directly.**
- **Batch Script Hygiene**: Automated runner scripts (`.bat`) executed by Windows Task Scheduler must **never contain interactive commands such as `pause`**, which cause headless background jobs to hang indefinitely.

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
  2. Create executable runner batch file `run_<source>.bat` (ensure no `pause` command).
  3. Append task definition into `configs/schedules.json`.
  4. On the Mini PC, trigger `setup_task.ps1` in Administrator PowerShell to register the Windows Task Scheduler job.

## 6. Telemetry & Crawler Diagnostics (Self-Healing)
- Every run logs to `saved_searches/` and updates `dashboard.html` via `metricsAggregator.js` and syncs to GitHub Gist for the Android monitor app.
- **Health Watchdog Threshold**: Crawlers yielding 0 new songs across $\ge 4$ consecutive runs (e.g., Amrap, Futuremag) or inactive for $\ge 10$ days are flagged for diagnostic inspection (DOM selector updates, API endpoint changes, or 403 header bypasses).

## 7. Composite Regional Crawlers (Low-Cadence Sources)
- High-quality tastemakers that publish irregularly or infrequently (~1–3 posts per month, e.g. NZ Musician) should be **bundled into an existing high-volume regional crawler** (e.g. Roots Mag NZ) rather than isolated into their own weekly scheduled task.
- This creates a unified regional digest (e.g. New Zealand Indie Digest), preserves source attribution per track via `channel: "<Source>"`, and avoids false-positive zero-discovery alerts on the health watchdog.

## 8. Central Catalog (`node:sqlite`) & Multi-Source Consensus (Tastemaker Heat)
- **Embedded Database Architecture**: Utilizes Node 24 native SQLite (`DatabaseSync`) located at `data/music_catalog.sqlite` (ignored by Git to prevent merge conflicts during `git pull`).
- **Scale & Performance**: 25,000 unique song records occupy <8 MB on disk and take <2ms for indexed lookups on normalized title keys (`slug`).
- **Email Alerting vs. Consensus Logging Rule**:
  - **Email Alerts**: Only send email notifications for brand-new global discoveries (`isNewGlobal === true`).
  - **Consensus Sighting Updates**: When an existing track is sighted by an additional tastemaker (`isNewSighting === true`), increment `heat_score` and log to the `sightings` table **silently** without spamming duplicate emails.
  - **Intra-Run Deduplication**: `diffEngine.js` must maintain an active `seenInCurrentRun` set to prevent duplicate entries within multi-genre queries of the same crawler run.

## 9. Google NotebookLM Studio Bridge & Briefing Versioning
- Project briefings exported via `node src/overseer/cli.js export-briefing` generate dated files: `docs/briefing_YYYY-MM-DD.md`.
- Every briefing markdown file must include an explicit **Version Callout Banner** on Line 2 (`> [!NOTE] Version Date: ...`) and in the top `# Heading` so that outdated sources in NotebookLM can be instantly identified and pruned when uploading fresh updates.
