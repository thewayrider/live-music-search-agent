#!/usr/bin/env node

const { auditHealth, formatAuditReport } = require('./auditor');
const { scoutSources } = require('./scout');
const { scaffoldCrawler } = require('./scaffolder');
const { testAgentModule } = require('./verifier');
const path = require('path');
const fs = require('fs');

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] ? args[0].toLowerCase() : 'help';

    if (command === 'health' || command === 'audit') {
        const report = auditHealth();
        console.log(formatAuditReport(report));
        return;
    }

    if (command === 'scout') {
        let genre = '';
        let region = '';

        for (let i = 1; i < args.length; i++) {
            if (args[i] === '--genre' && args[i + 1]) genre = args[++i];
            if (args[i] === '--region' && args[i + 1]) region = args[++i];
        }

        console.log(`\n[Overseer Scout] Searching for sources matching Genre: "${genre || 'Any'}", Region: "${region || 'Any'}"...`);
        const results = await scoutSources({ genre, region });

        if (results.length === 0) {
            console.log("\n[!] No candidates matched the specified criteria.");
            return;
        }

        console.log(`\n[+] Found ${results.length} candidate tastemaker sources:\n`);
        results.forEach((s, idx) => {
            console.log(`${idx + 1}. [${s.name}] (${s.country})`);
            console.log(`   ID: ${s.id} | Type: ${s.type} | Weekly Yield: ${s.estimatedWeeklyYield}`);
            console.log(`   URL: ${s.url} | RSS: ${s.rssUrl || 'None'}`);
            console.log(`   Live Probe: ${s.probe.online ? 'ONLINE (HTTP ' + s.probe.status + ')' : 'OFFLINE (' + s.probe.error + ')'}`);
            console.log(`   Description: ${s.description}\n`);
        });
        return;
    }

    if (command === 'scaffold') {
        let id = '';
        let name = '';
        let url = '';
        let rssUrl = '';
        let region = '';
        let genre = 'Indie Rock';

        for (let i = 1; i < args.length; i++) {
            if (args[i] === '--id' && args[i + 1]) id = args[++i];
            if (args[i] === '--name' && args[i + 1]) name = args[++i];
            if (args[i] === '--url' && args[i + 1]) url = args[++i];
            if (args[i] === '--rss' && args[i + 1]) rssUrl = args[++i];
            if (args[i] === '--region' && args[i + 1]) region = args[++i];
            if (args[i] === '--genre' && args[i + 1]) genre = args[++i];
        }

        if (!id || !name || !url) {
            console.error("\n[!] Error: --id, --name, and --url are required.");
            console.error("Usage: node src/overseer/cli.js scaffold --id nialler9 --name \"Nialler9\" --url \"https://nialler9.com\" --region \"Ireland\"\n");
            return;
        }

        console.log(`\n[Overseer Scaffolder] Scaffolding new crawler for ${name} (${id})...`);
        const result = scaffoldCrawler({ id, name, url, rssUrl, region, genre });
        console.log(`[+] Created Agent:  ${result.agentFile}`);
        console.log(`[+] Created Config: ${result.configFile}`);
        console.log(`[+] Created Runner: ${result.batFile}`);
        console.log(`[+] Registered in schedules.json for ${result.scheduled.days.join(', ')} at ${result.scheduled.time}`);
        console.log("\nNext Step: Run dry-run verification with:");
        console.log(`  node src/overseer/cli.js test ${id}\n`);
        return;
    }

    if (command === 'test') {
        const target = args[1];
        if (!target) {
            console.error("\n[!] Error: Specify agent name or ID to test.");
            console.error("Example: node src/overseer/cli.js test amrap\n");
            return;
        }

        const safeId = target.toLowerCase().replace(/[^a-z0-9]/g, '');
        const agentFile = path.resolve(__dirname, `../agents/${safeId}Agent.js`);

        if (!fs.existsSync(agentFile)) {
            console.error(`\n[!] Error: Agent file not found at ${agentFile}\n`);
            return;
        }

        console.log(`\n[Overseer Verifier] Running dry-run verification for '${safeId}'...`);
        const agentModule = require(agentFile);
        const exportKey = Object.keys(agentModule)[0];
        const agentFn = agentModule[exportKey];

        const exclusions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../exclusions.json'), 'utf8'));
        const configPath = path.resolve(__dirname, `../../configs/${safeId}_indie.json`);
        const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
        const agentConfig = config[safeId] || config;

        const outcome = await testAgentModule(agentFn, agentConfig, exclusions);

        console.log("------------------------------------------------------------");
        console.log(`Status:       ${outcome.passed ? "PASSED (Unified Contract Compliant)" : "FAILED"}`);
        console.log(`Tracks Found: ${outcome.totalTracks}`);
        console.log(`Execution:    ${outcome.durationMs}ms`);
        if (outcome.errors.length > 0) {
            console.log("\nValidation Errors:");
            outcome.errors.forEach(e => console.log(`  - ${e}`));
        }
        if (outcome.sampleTracks.length > 0) {
            console.log("\nSample Discoveries:");
            outcome.sampleTracks.forEach(t => {
                console.log(`  * ${t.title}`);
                console.log(`    URL: ${t.url} | Date: ${t.uploadedAt}`);
                console.log(`    ${t.description}`);
            });
        }
        console.log("------------------------------------------------------------\n");
        return;
    }

    // Default: Help
    console.log(`
============================================================
              MUSIC CRAWLER OVERSEER CLI
============================================================
Usage:
  node src/overseer/cli.js health
      Audits crawler health, identifies degraded crawlers,
      and prints 7-day and all-time discovery metrics.

  node src/overseer/cli.js scout --genre "<genre>" --region "<region>"
      Searches regional gatekeeper tastemakers matching criteria,
      probes live accessibility, and estimates release yield.

  node src/overseer/cli.js scaffold --id "<id>" --name "<name>" --url "<url>" [--rss "<rss>"] [--region "<reg>"]
      Generates agent module, config JSON, batch script, and
      appends to schedules.json.

  node src/overseer/cli.js test <agentId>
      Executes sandbox dry-run verification on an agent against
      the Unified Contract schema.
============================================================
`);
}

main().catch(console.error);
