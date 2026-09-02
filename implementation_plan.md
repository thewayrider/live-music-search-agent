# Live Music Search Agent (Standalone)

This document outlines the architecture for a standalone project (`live-music-search-agent`) dedicated solely to **Source Discovery**. 

Separating this from the release collector is a brilliant architectural decision. It allows this agent to act as a focused "scout" that can be run with highly specific, tweakable parameters across different platforms (YouTube now, blogs/websites later). It will output validated, fresh sources that your `music-release-agent` can then confidently scrape for new music.

## User Review Required
> [!IMPORTANT]
> Please review the standalone architecture below. If this looks like the right foundation for the new project at `C:\Users\kimra\Desktop\Projects\live-music-search-agent`, click **Proceed**, and I will initialize the project and write the initial YouTube agent.

## Open Questions
> [!WARNING]
> 1. **Configuration:** How would you like to pass parameters to the agent? Would you prefer a simple config file (e.g., `config.json` where you can easily tweak search terms and thresholds) or command-line arguments? (I recommend a config file for easier tweaking and saving states).

## Proposed Architecture

This will be a modular Node.js project designed to support multiple platforms in the future.

### Directory Structure

```text
live-music-search-agent/
├── src/
│   ├── index.js              # Main entry point and orchestrator
│   ├── config.json           # Central place to tweak parameters (queries, thresholds)
│   ├── exclusions.json       # Master list of major labels/keywords to ignore
│   ├── agents/
│   │   └── youtubeAgent.js   # The YouTube-specific search and validation logic
│   └── utils/
│       └── filterEngine.js   # Reusable logic to check recency and exclude major labels
├── output/                   # Directory where the validated sources will be saved
│   └── active_youtube_channels.json
└── package.json
```

### Core Pipeline

1. **Configuration Load:** The app reads `config.json` to get the target platform, search queries, and the "recency threshold" (e.g., max 30 days since last activity).
2. **Platform Routing:** The app routes the request to the correct agent (starting with `youtubeAgent.js`).
3. **Discovery & Validation:** 
    - The agent uses `youtube-sr` to search for channels based on the queries.
    - It fetches the latest video for each channel.
    - It passes the channel data (upload date, description) through the `filterEngine.js`.
    - Channels failing the recency test or matching the `exclusions.json` list are dropped.
4. **Output Generation:** The agent saves the resulting list of highly active, independent channels to the `output/` directory, ready to be ingested by your main release collector.

## Proposed First Steps (Execution)

1. Run `npm init -y` in `C:\Users\kimra\Desktop\Projects\live-music-search-agent`.
2. Install necessary dependencies (e.g., `youtube-sr`).
3. Create the directory structure, config files, and the `filterEngine.js`.
4. Build the `youtubeAgent.js` to perform the actual discovery.
5. Provide a test run with a sample query to demonstrate it works.
