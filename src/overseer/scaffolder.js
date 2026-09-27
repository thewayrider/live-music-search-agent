const fs = require('fs');
const path = require('path');

/**
 * Generates an agent implementation template conforming to the Unified Contract.
 */
function generateAgentCode({ id, name, url, rssUrl, region, genre, strategy = "rss_ai" }) {
    const fnName = `run${id.charAt(0).toUpperCase() + id.slice(1)}Agent`;

    return `const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");

const DEFAULTS = {
  baseUrl: "${url}",
  rssUrl: "${rssUrl || url + '/feed/'}",
  sourceService: "${name}",
  defaultCountry: "${region || 'Global'}",
  userAgent: "music-release-agent/1.0 (+https://kimrampling.com)",
  maxArticleAgeDays: 14,
  perPage: 6
};

function cleanText(value) {
  return String(value || "")
    .replace(/\\s+/g, " ")
    .replace(/[\\u200B-\\u200D\\uFEFF]/g, "")
    .trim();
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function ${fnName}(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const cutoffTime = Date.now() - (options.maxArticleAgeDays * 24 * 60 * 60 * 1000);

  console.log(\`[\${options.sourceService} Agent] Fetching feed from: \${options.rssUrl}\`);

  let xmlText = "";
  try {
    const res = await fetch(options.rssUrl, {
      headers: { "User-Agent": options.userAgent, Accept: "application/rss+xml, application/xml, text/xml" }
    });
    if (!res.ok) throw new Error(\`Feed request failed (\${res.status})\`);
    xmlText = await res.text();
  } catch (err) {
    console.error(\`[\${options.sourceService} Agent] Feed fetch error:\`, err.message);
    return [];
  }

  const $ = cheerio.load(xmlText, { xmlMode: true });
  const items = [];
  const articles = [];

  $("item").each((_, el) => {
    if (articles.length >= options.perPage) return;
    const title = cleanText($(el).find("title").text());
    const link = cleanText($(el).find("link").text());
    const pubDateStr = $(el).find("pubDate").text();
    const pubTime = new Date(pubDateStr).getTime();

    // Check age window
    if (Number.isFinite(pubTime) && pubTime < cutoffTime) return;

    // Read description or content
    const content = cleanText($(el).find("content\\\\:encoded").text() || $(el).find("description").text());
    const dateFormatted = Number.isFinite(pubTime) ? new Date(pubTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    articles.push({ title, link, date: dateFormatted, content });
  });

  console.log(\`[\${options.sourceService} Agent] Found \${articles.length} recent articles within window.\`);

  for (const art of articles) {
    console.log(\`[\${options.sourceService} Agent] Extracting releases from: \${art.title} (\${art.date})\`);
    const aiResults = await extractReleasesWithAI(art.title + "\\n" + art.content);

    for (const rel of aiResults) {
      if (!rel.artist || !rel.title) continue;

      const trackUrl = \`\${art.link}#\${slugify(rel.artist + '-' + rel.title)}\`;
      let desc = \`Type: \${rel.releaseType || 'single'} | Country: \${options.defaultCountry}\`;
      if (rel.genres) desc += \` | Genres: \${rel.genres}\`;

      items.push({
        title: \`\${rel.artist} - \${rel.title}\`,
        channel: options.sourceService,
        url: trackUrl,
        views: "Worth checking",
        uploadedAt: art.date,
        description: desc
      });
    }
  }

  console.log(\`[\${options.sourceService} Agent] Total tracks identified: \${items.length}\`);
  return items;
}

module.exports = {
  ${fnName}
};
`;
}

/**
 * Scaffolds all files required to onboard a new music source.
 */
function scaffoldCrawler({ id, name, url, rssUrl, region, genre, scheduleDays = ["Friday"], scheduleTime = "10:00AM" }) {
    const projectRoot = path.resolve(__dirname, '../../');
    const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Agent File: src/agents/<safeId>Agent.js
    const agentFilePath = path.join(projectRoot, `src/agents/${safeId}Agent.js`);
    const agentCode = generateAgentCode({ id: safeId, name, url, rssUrl, region, genre });
    fs.writeFileSync(agentFilePath, agentCode, 'utf8');

    // 2. Config File: configs/<safeId>_indie.json
    const configFilePath = path.join(projectRoot, `configs/${safeId}_indie.json`);
    const configData = {
        _comment: `Configuration for the ${name} Crawler`,
        [safeId]: {
            searchName: `${name} Indie Discovery`,
            targetGenres: ["Indie Rock", "Alt Rock", "Indie"],
            country: region || "Global"
        }
    };
    fs.writeFileSync(configFilePath, JSON.stringify(configData, null, 2), 'utf8');

    // 3. Batch Script: run_<safeId>.bat
    const batFilePath = path.join(projectRoot, `run_${safeId}.bat`);
    const batContent = `@echo off
cd /d "%~dp0"

echo Running ${name} Crawler...
node src/index.js configs/${safeId}_indie.json

echo ${name} crawler finished!
`;
    fs.writeFileSync(batFilePath, batContent, 'utf8');

    // 4. Update schedules.json
    const schedulesPath = path.join(projectRoot, 'configs/schedules.json');
    let schedules = [];
    if (fs.existsSync(schedulesPath)) {
        try {
            schedules = JSON.parse(fs.readFileSync(schedulesPath, 'utf8'));
        } catch (e) {
            schedules = [];
        }
    }

    const existingIdx = schedules.findIndex(s => s.id === safeId);
    const newTask = {
        id: safeId,
        name: `LiveMusicSearchAgent_${name.replace(/\s+/g, '')}`,
        description: `Runs the ${name} Crawler on ${scheduleDays.join(', ')} at ${scheduleTime}`,
        script: `run_${safeId}.bat`,
        days: scheduleDays,
        time: scheduleTime
    };

    if (existingIdx >= 0) {
        schedules[existingIdx] = newTask;
    } else {
        schedules.push(newTask);
    }

    fs.writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2), 'utf8');

    return {
        agentFile: agentFilePath,
        configFile: configFilePath,
        batFile: batFilePath,
        scheduled: newTask
    };
}

module.exports = {
    generateAgentCode,
    scaffoldCrawler
};
