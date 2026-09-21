# Live Music Search Agent & Ecosystem Guidelines

## Multi-Machine Architecture (Dual-PC Setup)
- **Desktop PC**: Primary development environment (Windows). Not always on.
- **Always-On Mini PC**: Dedicated 24/7 host serving Plex Media Server in Tailscale exit node mode. Runs scheduled crawlers via Windows Task Scheduler (`setup_task.ps1` / `run_*.bat`).
- **Git Sync Rule**: Code changes must always be developed/tested on Desktop, committed and pushed to GitHub `origin/main`, then pulled on the Mini PC (`git pull`).
- **Conflict Prevention**: Automated background jobs on the Mini PC must NEVER commit or push directly to the Git repository.

## Telemetry & Cloud Synchronization (GitHub Gist)
- **Gist ID**: `9d9f324ab82907243f576f71ca001523`
- Telemetry, crawler run metrics, and health diagnostics are synced to GitHub Gist using HTTP REST calls (`PATCH https://api.github.com/gists/<GIST_ID>`).
- Credentials (`githubGistId`, `githubToken`) must ALWAYS reside in `configs/secrets.json` (which is `.gitignore`d). Never commit tokens or secrets to Git.
- At the end of every crawler run (`src/index.js`), `metricsAggregator.js` computes fresh stats and `gistSync.js` updates the Gist.

## Crawler Health & Diagnostics Criteria
- **9 Crawlers**: Air Charts, Acid Stag, Amrap, Bandcamp, ListenBrainz, MusicBrainz, Futuremag, Roots Mag, Triple J Unearthed.
- **Evaluation Metrics**: Today, past 7 days, and all-time new song additions vs. baseline pool.
- **Non-Performing Alerts**: Flag crawlers with >= 4 consecutive zero-discovery runs or >= 10 days of inactivity for review, filter modification, or elimination.
- **Local Dashboard**: [`view_dashboard.bat`](file:///C:/Users/kimra/Desktop/Projects/live-music-search-agent/view_dashboard.bat) runs `dashboardGenerator.js` to compile [`dashboard.html`](file:///C:/Users/kimra/Desktop/Projects/live-music-search-agent/dashboard.html).

## Related Projects
- **`NewIndieFriday`**: Public music portal & Sanity Studio (`streamusique.com`).
- **`live-music-crawler-monitor-android`**: F-Droid compatible Android client displaying live metrics from the Gist.

## Google API Billing & GenAI App Builder
- **Scraper Billing (Google AI Studio)**: The custom Node.js web scrapers in this project (e.g., `aiScraper.js`) rely on standard Gemini API calls via Google AI Studio. This usage is billed to your AI Studio prepayment balance.
- **GenAI App Builder Credits**: Promotional credits for "GenAI App Builder" (now Vertex AI Agent Builder) are **exclusively** for building conversational AI search engines grounded in enterprise data (e.g., querying your `saved_searches` database via a chat UI). 
- **Exclusions**: Agent Builder credits **do not** cover standard Gemini API scraping tasks, nor do they cover the hosting/infrastructure required to build standard web applications (like a React-based Master Control Panel).
