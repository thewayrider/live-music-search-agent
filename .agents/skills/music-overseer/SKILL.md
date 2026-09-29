---
name: music-overseer
description: Orchestrates health audits, source discovery, crawler scaffolding, and verification for the Live Music Search Agent across Antigravity and Antigravity IDE.
---

# Music Crawler Overseer Skill

Use this skill to audit, scout, scaffold, and verify music crawlers in `live-music-search-agent`.

## Core Commands

The Overseer subsystem is located at `src/overseer/cli.js`. Always run commands from the project root:
`C:\Users\kimra\Desktop\Projects\Music Crawler Stuff\live-music-search-agent`

### 1. Health & Performance Audit
Check all crawler statuses, consecutive zero-discovery runs, and weekly yields:
```powershell
node src/overseer/cli.js health
```
- If any crawler is flagged **Needs Review** ($\ge 4$ zero-yield runs), initiate diagnostic inspection.
- If any crawler is **Inactive** (>10 days without run), verify Windows Task Scheduler via `setup_task.ps1`.

### 2. Parameterized Source Scout
Search for regional indie tastemakers bounded by `[Genre]` and `[Country/Region]`:
```powershell
node src/overseer/cli.js scout --genre "<genre>" --region "<region>"
```
- Evaluates live accessibility (probes for HTTP 200 vs 403 blocks).
- Focuses on the sweet spot of **5 to 30 tracks per week** to prevent volume swamping and preserve human curation.

### 3. Scaffold New Crawler
Generate a fully compliant agent, configuration JSON, and batch script:
```powershell
node src/overseer/cli.js scaffold --id "<id>" --name "<name>" --url "<url>" --rss "<rssUrl>" --region "<region>" --genre "<genre>"
```
- Creates `src/agents/<id>Agent.js` conforming to the unified schema: `{ title, channel, url, views, uploadedAt, description }`.
- Creates `configs/<id>_indie.json`.
- Creates `run_<id>.bat`.
- Appends scheduled entry into `configs/schedules.json`.

### 4. Dry-Run Verification Sandbox
Test any crawler against the Unified Output Contract before committing:
```powershell
node src/overseer/cli.js test <agentId>
```
- Confirms array output, non-empty `title`, `url`, `channel`, and valid track yield.

### 5. NotebookLM Briefing Exporter
Compile the complete system architecture, active fleet registry, telemetry, and consensus discoveries into a briefing document for Google NotebookLM:
```powershell
node src/overseer/cli.js export-briefing
```
- Outputs to `docs/notebooklm_briefing.md`.
- Upload as a source in NotebookLM to unlock Mind Maps, Slide Decks, and Audio Overviews.

### 6. Multi-Machine Deployment (Dual-PC)
- **Desktop PC**: Authors, scaffolds, and tests in Antigravity / Antigravity IDE. Commits and pushes to GitHub `origin/main`.
- **Always-On Mini PC**: Pulls updates via `git pull origin main` and executes `setup_task.ps1`. Never commits code back to Git directly.
