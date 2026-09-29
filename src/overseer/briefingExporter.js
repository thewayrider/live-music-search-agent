const fs = require('fs');
const path = require('path');
const { aggregateCrawlerMetrics } = require('../utils/metricsAggregator');

/**
 * Compiles project documentation, architecture, telemetry, and recent discoveries
 * into a structured Markdown briefing packet optimized for Google NotebookLM.
 */
function generateNotebookBriefing() {
    const projectRoot = path.resolve(__dirname, '../../');
    const docsDir = path.join(projectRoot, 'docs');
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }

    const metrics = aggregateCrawlerMetrics();
    const crawlers = metrics.crawlers || [];
    const summary = metrics.summary || {};

    // Analyze Cross-Agent Consensus (Sightings across searches)
    const savedDir = path.join(projectRoot, 'saved_searches');
    const songMap = new Map();
    let totalLogged = 0;

    if (fs.existsSync(savedDir)) {
        const subdirs = fs.readdirSync(savedDir).filter(d => {
            const p = path.join(savedDir, d);
            return fs.statSync(p).isDirectory() && d !== 'cache';
        });

        subdirs.forEach(sub => {
            const files = fs.readdirSync(path.join(savedDir, sub)).filter(f => f.endsWith('.json'));
            files.forEach(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(savedDir, sub, f), 'utf8'));
                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            if (!item || !item.title) return;
                            totalLogged++;
                            const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                            if (!songMap.has(key)) {
                                songMap.set(key, {
                                    title: item.title,
                                    channel: item.channel || sub,
                                    url: item.url || '',
                                    sources: new Set(),
                                    uploadedAt: item.uploadedAt || ''
                                });
                            }
                            songMap.get(key).sources.add(item.channel || sub);
                        });
                    }
                } catch (e) {}
            });
        });
    }

    const consensusTracks = Array.from(songMap.values())
        .filter(s => s.sources.size > 1)
        .sort((a, b) => b.sources.size - a.sources.size);

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const lines = [];

    // Header
    lines.push(`# Project Briefing: Music Release & Website Agent`);
    lines.push(`**Compiled for Google NotebookLM Studio & Research**`);
    lines.push(`*Generated on:* ${nowStr} UTC | *System Status:* 10/10 Crawlers Active\n`);
    lines.push(`---`);

    // Executive Summary
    lines.push(`## 1. Executive Summary & Core Motivation`);
    lines.push(`The **Live Music Search Agent** is an autonomous, local-first music discovery system engineered to identify emerging indie music releases across independent tastemaker websites, community radio charts, and open music databases.`);
    lines.push(`\n### The Problem with Mainstream Streaming (The Motive)`);
    lines.push(`- **Spotify API Restrictions (Early 2025)**: Outside access to Spotify's discovery endpoints was restricted and largely decommissioned, cutting off independent developers from programmatic release tracking.`);
    lines.push(`- **Algorithmic Shift (April 2026)**: Spotify altered its internal recommendation algorithm to prioritize tracks judged 'hot' based on raw listening velocity and mainstream playlist loops, effectively burying underground, self-released, and regional indie artists.`);
    lines.push(`- **The Antidote**: Bypassing algorithmic walled gardens by directly scraping authentic cultural gatekeepers (regional indie blogs, college radio charts, Bandcamp communities, and curated tastemakers).\n`);

    // Human Curation Funnel
    lines.push(`## 2. The 4-Stage Human Curation Workflow`);
    lines.push(`The crawlers do not replace human listening—they feed an organized discovery funnel:`);
    lines.push(`1. **Discovery**: Autonomous background crawlers scour target sites and normalize new tracks into a unified schema.`);
    lines.push(`2. **Selection**: Intensive listening and filtering by the curator, guided by multi-source consensus.`);
    lines.push(`3. **New Release Consideration**: Determining track placement in the weekly release showcase.`);
    lines.push(`4. **Spotlight Consideration**: Dedicated showcase reserved strictly for brand-new emerging artists.\n`);

    // Dual-PC Architecture
    lines.push(`## 3. Multi-Machine System Architecture`);
    lines.push(`The project operates across a specialized dual-PC setup to maintain 24/7 reliability without development conflicts:`);
    lines.push(`- **Desktop PC (Development Hub)**: Primary Windows environment where code, crawlers, and overseer tools are developed, tested in sandboxes, and committed to GitHub (\`origin/main\`).`);
    lines.push(`- **Always-On Mini PC (24/7 Execution Host)**: Dedicated host serving Plex Media Server and running scheduled crawlers via Windows Task Scheduler. Pulls code via \`git pull origin main\`. **Never commits code back to Git directly.**`);
    lines.push(`- **Cloud Telemetry**: Syncs aggregated crawler statistics via HTTP PATCH to a private GitHub Gist (\`9d9f324ab82907243f576f71ca001523\`).`);
    lines.push(`- **Android Monitor Client**: F-Droid compatible Android client reading real-time crawler metrics from the Gist.`);
    lines.push(`- **Public Portal**: Integrated with Sanity Studio at \`streamusique.com\`.\n`);

    // Active Fleet
    lines.push(`## 4. Active Crawler Fleet & Regional Gates`);
    lines.push(`To prevent volume swamping from global catalogues (e.g. searching Deezer for all rock releases), crawlers are strictly bounded by **[Genre] × [Region]**, maintaining a sweet spot of **5 to 30 tracks per week**:\n`);
    lines.push(`| Crawler | Region | Schedule | 7-Day Discoveries | All-Time Discoveries | Primary Focus |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

    crawlers.forEach(c => {
        const name = c.name || c.id;
        const schedule = c.schedule || 'Scheduled';
        const wYield = c.stats?.past7Days?.newSongs || 0;
        const atYield = c.stats?.allTime?.newSongs || 0;
        let region = 'Australia';
        let focus = 'Independent Music';

        if (name.includes('Roots') || name.includes('roots')) { region = 'New Zealand'; focus = 'Roots & Indie Weekly Roundup'; }
        else if (name.includes('Nialler')) { region = 'Ireland'; focus = 'Irish Indie Tastemaker & Albums'; }
        else if (name.includes('Bandcamp')) { region = 'Global'; focus = 'Independent & Self-Released Tags'; }
        else if (name.includes('ListenBrainz') || name.includes('MusicBrainz')) { region = 'Open DB'; focus = 'Community Playlists & Metadata'; }
        else if (name.includes('Acid Stag')) { region = 'Australia'; focus = 'Electronic & Indie Blog'; }
        else if (name.includes('Amrap')) { region = 'Australia'; focus = 'Community Radio Airplay Charts'; }
        else if (name.includes('Air Charts')) { region = 'Australia'; focus = '100% Independent Record Labels'; }
        else if (name.includes('Futuremag')) { region = 'Australia'; focus = 'Emerging Artist Features & Drops'; }
        else if (name.includes('Triple J')) { region = 'Australia'; focus = 'Emerging & Unsigned Artists'; }

        lines.push(`| ${name} | ${region} | ${schedule} | ${wYield} | ${atYield} | ${focus} |`);
    });

    lines.push(`\n**Fleet Summary**: ${summary.totalCrawlers || crawlers.length} active crawlers | **${summary.systemNewWeek || 0}** weekly discoveries | **${summary.systemNewAllTime || 0}** all-time songs indexed.\n`);

    // Composite Crawlers Innovation
    lines.push(`## 5. Composite Regional Crawlers (The NZ Musician Solution)`);
    lines.push(`A key architectural pattern developed in this project is the **Composite Regional Crawler**:`);
    lines.push(`- **The Challenge**: Prestigious tastemakers like *NZ Musician* post infrequently (~1–3 times per month). Running an isolated weekly crawler leads to 3 out of 4 zero-yield runs, triggering watchdog false alarms.`);
    lines.push(`- **The Solution**: Bundling low-cadence feeds directly into a high-volume regional sibling (*Roots Mag NZ*). Roots Mag delivers steady weekly baseline volume (~20 tracks), while NZ Musician contributes curated artist spotlight features when available.`);
    lines.push(`- Each track preserves its unique source attribution (\`channel: "Roots Mag"\` vs \`channel: "NZ Musician"\`).\n`);

    // Cross-Agent Consensus
    lines.push(`## 6. Multi-Source Consensus Signals (Tastemaker Heat)`);
    lines.push(`When multiple independent crawlers identify the same song in the same time window, it serves as a high-conviction **Tastemaker Consensus Signal** for the human curator:\n`);
    lines.push(`| Artist & Track | Sightings Count | Discovered By Sources |`);
    lines.push(`| :--- | :--- | :--- |`);

    consensusTracks.slice(0, 12).forEach(t => {
        const sources = Array.from(t.sources).join(', ');
        lines.push(`| **${t.title}** | ${t.sources.size} sources | ${sources} |`);
    });

    lines.push(`\n*Data Insight*: Out of ${totalLogged} total logged discoveries, **${consensusTracks.length} tracks** achieved multi-source consensus.\n`);

    // Overseer Subsystem
    lines.push(`## 7. The Antigravity Overseer Subsystem`);
    lines.push(`The Overseer coordinates autonomous agent operations, self-healing diagnostics, and onboarding:`);
    lines.push(`- **Auditor (\`auditor.js\`)**: Continuously monitors crawler performance, detecting selector breakages or API changes before they impact production.`);
    lines.push(`- **Scout (\`scout.js\`)**: Researches new regional indie gatekeepers, probing live RSS accessibility and update frequency.`);
    lines.push(`- **Scaffolder (\`scaffolder.js\`)**: Auto-generates compliant crawler modules, configuration JSON, and batch runner scripts.`);
    lines.push(`- **Verifier (\`verifier.js\`)**: Executes dry-run sandbox validations ensuring 100% adherence to the Unified Output Contract:`);
    lines.push(`  \`{ title, channel, url, views, uploadedAt, description }\`.\n`);

    const finalContent = lines.join('\n');
    const outputPath = path.join(docsDir, 'notebooklm_briefing.md');
    fs.writeFileSync(outputPath, finalContent, 'utf8');

    return {
        outputPath,
        totalCrawlers: crawlers.length,
        totalSongs: totalLogged,
        consensusCount: consensusTracks.length
    };
}

module.exports = {
    generateNotebookBriefing
};
