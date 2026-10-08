const fs = require('fs');
const path = require('path');
// Helper for resilient on-demand lazy loading of crawler agents
function loadAgentSafely(agentName, relativePath) {
    try {
        return require(relativePath);
    } catch (err) {
        console.error(`\n[Crawler Loader] Warning: Could not load agent '${agentName}' from '${relativePath}': ${err.message}\n`);
        return null;
    }
}

const { generateHTML } = require('./utils/htmlGenerator');
const { getPreviousReport, getNewAdditions } = require('./utils/diffEngine');
const { sendEmailNotification } = require('./utils/emailNotifier');
const { aggregateCrawlerMetrics } = require('./utils/metricsAggregator');
const { syncMetricsToGist } = require('./utils/gistSync');

async function main() {
    console.log("Initializing Live Music Search Agent...");

    // 1. Parse CLI argument for config file
    const configArg = process.argv[2];
    if (!configArg) {
        console.error("\nERROR: No configuration file provided.");
        console.error("Usage: node src/index.js <path-to-config-file>");
        console.error("Example: node src/index.js configs/indie_rock.json\n");
        process.exit(1);
    }

    const configPath = path.resolve(process.cwd(), configArg);
    if (!fs.existsSync(configPath)) {
        console.error(`\nERROR: Configuration file not found at ${configPath}\n`);
        process.exit(1);
    }

    const exclusionsPath = path.join(__dirname, 'exclusions.json');

    // Load files
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const exclusions = JSON.parse(fs.readFileSync(exclusionsPath, 'utf8'));

    let results = [];

    // Run agents with lazy-loading resilience
    if (config.airChart) {
        const agent = loadAgentSafely('airChart', './agents/airChartAgent');
        if (agent?.runAirChartAgent) {
            results = results.concat(await agent.runAirChartAgent(config.airChart, exclusions));
        }
    } else if (config.amrap) {
        const agent = loadAgentSafely('amrap', './agents/amrapAgent');
        if (agent?.runAmrapAgent) {
            results = results.concat(await agent.runAmrapAgent(config.amrap, exclusions));
        }
    } else if (config.bandcamp) {
        const agent = loadAgentSafely('bandcamp', './agents/bandcampAgent');
        if (agent?.runBandcampAgent) {
            results = results.concat(await agent.runBandcampAgent(config.bandcamp, exclusions));
        }
    } else if (config.futuremag) {
        const agent = loadAgentSafely('futuremag', './agents/futuremagAgent');
        if (agent?.runFuturemagAgent) {
            results = results.concat(await agent.runFuturemagAgent(config.futuremag, exclusions));
        }
    } else if (config.listenbrainz) {
        const agent = loadAgentSafely('listenbrainz', './agents/listenBrainzAgent');
        if (agent?.runListenBrainzAgent) {
            results = results.concat(await agent.runListenBrainzAgent(config.listenbrainz, exclusions));
        }
    } else if (config.musicbrainz) {
        const agent = loadAgentSafely('musicbrainz', './agents/musicBrainzAgent');
        if (agent?.runMusicBrainzAgent) {
            results = results.concat(await agent.runMusicBrainzAgent(config.musicbrainz, exclusions));
        }
    } else if (config.rootsmag) {
        const agent = loadAgentSafely('rootsmag', './agents/rootsMagAgent');
        if (agent?.runRootsMagAgent) {
            results = results.concat(await agent.runRootsMagAgent(config.rootsmag, exclusions));
        }
    } else if (configPath.includes('triplej_unearthed')) {
        const agent = loadAgentSafely('triplej_unearthed', './agents/tripleJUnearthedAgent');
        if (agent?.runTripleJUnearthedAgent) {
            results = results.concat(await agent.runTripleJUnearthedAgent(config.triplej_unearthed || {}, config));
        }
    } else if (configPath.includes('triplej')) {
        const agent = loadAgentSafely('triplej', './agents/tripleJApiAgent');
        if (agent?.runTripleJApiAgent) {
            results = results.concat(await agent.runTripleJApiAgent(config.triplej || {}, config));
        }
    } else if (config.deezer) {
        const agent = loadAgentSafely('deezer', './agents/deezerAgent');
        if (agent?.runDeezerAgent) {
            results = results.concat(await agent.runDeezerAgent(config.deezer, exclusions));
        }
    } else if (config.spotify_oauth) {
        const agent = loadAgentSafely('spotify_oauth', './agents/spotifyOAuthAgent');
        if (agent?.runSpotifyOAuthAgent) {
            results = results.concat(await agent.runSpotifyOAuthAgent(config.spotify_oauth, exclusions));
        }
    } else if (config.nialler9) {
        const agent = loadAgentSafely('nialler9', './agents/nialler9Agent');
        if (agent?.runNialler9Agent) {
            results = results.concat(await agent.runNialler9Agent(config.nialler9, exclusions));
        }
    } else {
        // Dynamic Agent Dispatch for Overseer-scaffolded crawlers
        for (const [key, val] of Object.entries(config)) {
            if (key.startsWith('_') || key === 'searchName') continue;
            const agentFileName = `${key}Agent.js`;
            const agentFilePath = path.join(__dirname, 'agents', agentFileName);
            if (fs.existsSync(agentFilePath)) {
                try {
                    const mod = require(agentFilePath);
                    const exportFn = Object.values(mod)[0];
                    if (typeof exportFn === 'function') {
                        console.log(`[Dynamic Dispatch] Running ${agentFileName}...`);
                        const dynResults = await exportFn(val, exclusions);
                        results = results.concat(dynResults);
                        break;
                    }
                } catch (e) {
                    console.error(`[Dynamic Dispatch] Error running ${agentFileName}:`, e.message);
                }
            }
        }
    }

    // 2. Save Timestamped HTML & JSON in saved_searches
    const savedSearchesDir = path.join(__dirname, '../saved_searches');

    const searchName = config.searchName || 
                       config.airChart?.searchName || 
                       config.acidStag?.searchName || 
                       config.amrap?.searchName ||
                       config.bandcamp?.searchName ||
                       config.futuremag?.searchName ||
                       config.listenbrainz?.searchName ||
                       config.musicbrainz?.searchName ||
                       config.rootsmag?.searchName ||
                       config.triplej_unearthed?.searchName ||
                       config.triplej?.searchName ||
                       config.deezer?.searchName ||
                       config.spotify_oauth?.searchName ||
                       Object.values(config).find(v => v && typeof v === 'object' && v.searchName)?.searchName ||
                       'search_results';
    const safeSearchName = searchName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    const searchSpecificDir = path.join(savedSearchesDir, safeSearchName);
    if (!fs.existsSync(searchSpecificDir)) {
        fs.mkdirSync(searchSpecificDir, { recursive: true });
    }

    const baseJsonPath = path.join(searchSpecificDir, `${safeSearchName}_base.json`);
    const baseHtmlPath = path.join(searchSpecificDir, `${safeSearchName}_base.html`);
    const isBaseRun = !fs.existsSync(baseJsonPath);

    let jsonPath, htmlPath, songsToSave;
    
    if (isBaseRun) {
        console.log("[Base Run] No base file found. Generating permanent base run files.");
        jsonPath = baseJsonPath;
        htmlPath = baseHtmlPath;
    } else {
        const now = new Date();
        const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
        const baseFilename = `${safeSearchName}_${ts}`;
        jsonPath = path.join(searchSpecificDir, `${baseFilename}.json`);
        htmlPath = path.join(searchSpecificDir, `${baseFilename}.html`);
    }

    // Diff Engine: Compare with the last run
    const previousResults = getPreviousReport(searchSpecificDir, path.basename(jsonPath));
    const newSongs = getNewAdditions(results, previousResults);
    
    console.log(`[Diff Engine] Found ${newSongs.length} totally new songs since the last run.`);

    songsToSave = isBaseRun ? results : newSongs;

    // Email Notifier: Send email with results of the run
    await sendEmailNotification(newSongs, baseHtmlPath, searchName);

    // Write JSON copy
    fs.writeFileSync(jsonPath, JSON.stringify(songsToSave, null, 2));
    
    // Generate and write HTML
    const htmlContent = generateHTML(searchName, songsToSave);
    fs.writeFileSync(htmlPath, htmlContent);

    console.log(`Archived JSON saved to ${jsonPath}`);
    console.log(`Interactive HTML report saved to ${htmlPath}`);

    // Update Dashboard Status
    const dashboardStatusPath = path.join(savedSearchesDir, 'dashboard_status.json');
    let dashboardStatus = {};
    if (fs.existsSync(dashboardStatusPath)) {
        dashboardStatus = JSON.parse(fs.readFileSync(dashboardStatusPath, 'utf8'));
    }
    
    dashboardStatus[safeSearchName] = {
        name: searchName,
        lastRun: new Date().toISOString(),
        totalSongsFound: results.length,
        newSongsEmailed: newSongs.length,
        status: "Success"
    };
    
    fs.writeFileSync(dashboardStatusPath, JSON.stringify(dashboardStatus, null, 2));
    
    // 3. Aggregate historical metrics & sync telemetry to GitHub Gist
    try {
        console.log("\n[Telemetry] Updating aggregated crawler statistics...");
        const aggregated = aggregateCrawlerMetrics();
        await syncMetricsToGist(aggregated);
    } catch (metricErr) {
        console.warn("[Telemetry] Warning updating analytics or Gist:", metricErr.message);
    }

    console.log("Search Agent finished execution.");
}

main().catch(console.error);
