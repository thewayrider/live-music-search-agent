const fs = require('fs');
const path = require('path');
const { runAirChartAgent } = require('./agents/airChartAgent');
const { runAcidStagAgent } = require('./agents/acidStagAgent');
const { runAmrapAgent } = require('./agents/amrapAgent');
const { runBandcampAgent } = require('./agents/bandcampAgent');
const { runFuturemagAgent } = require('./agents/futuremagAgent');
const { runListenBrainzAgent } = require('./agents/listenBrainzAgent');
const { runRootsMagAgent } = require('./agents/rootsMagAgent');
const { runSpotifyOAuthAgent } = require('./agents/spotifyOAuthAgent');
const { runTripleJApiAgent } = require('./agents/tripleJApiAgent');
const { generateHTML } = require('./utils/htmlGenerator');
const { getPreviousReport, getNewAdditions } = require('./utils/diffEngine');
const { sendEmailNotification } = require('./utils/emailNotifier');

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

    // Run agents
    if (config.airChart) {
        const airChartResults = await runAirChartAgent(config.airChart, exclusions);
        results = results.concat(airChartResults);
    }
    
    if (config.acidStag) {
        const acidStagResults = await runAcidStagAgent(config.acidStag, exclusions);
        results = results.concat(acidStagResults);
    }
    
    if (config.amrap) {
        const amrapResults = await runAmrapAgent(config.amrap, exclusions);
        results = results.concat(amrapResults);
    }
    
    if (config.bandcamp) {
        const bandcampResults = await runBandcampAgent(config.bandcamp, exclusions);
        results = results.concat(bandcampResults);
    }
    
    if (config.futuremag) {
        const futuremagResults = await runFuturemagAgent(config.futuremag, exclusions);
        results = results.concat(futuremagResults);
    }
    
    if (config.listenbrainz) {
        const listenbrainzResults = await runListenBrainzAgent(config.listenbrainz, exclusions);
        results = results.concat(listenbrainzResults);
    }
    
    if (config.rootsmag) {
        const rootsmagResults = await runRootsMagAgent(config.rootsmag, exclusions);
        results = results.concat(rootsmagResults);
    } else if (configPath.includes('triplej')) {
        const triplejResults = await runTripleJApiAgent(config.triplej || {}, config);
        results = results.concat(triplejResults);
    } else if (config.spotify_oauth) {
        const spotifyResults = await runSpotifyOAuthAgent(config.spotify_oauth, exclusions);
        results = results.concat(spotifyResults);
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
                       config.rootsmag?.searchName ||
                       config.triplej?.searchName ||
                       config.spotify_oauth?.searchName ||
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

    console.log("Search Agent finished execution.");
}

main().catch(console.error);
