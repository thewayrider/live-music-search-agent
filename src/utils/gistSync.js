const fs = require('fs');
const path = require('path');

function getGistConfig() {
    let gistId = process.env.GITHUB_GIST_ID;
    let token = process.env.GITHUB_TOKEN;

    const secretsPath = path.join(__dirname, '..', '..', 'configs', 'secrets.json');
    if (fs.existsSync(secretsPath)) {
        try {
            const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
            if (!gistId && secrets.githubGistId) gistId = secrets.githubGistId;
            if (!token && secrets.githubToken) token = secrets.githubToken;
        } catch (e) {
            console.warn('[Gist Sync] Warning: Unable to parse configs/secrets.json:', e.message);
        }
    }

    return { gistId, token };
}

async function syncMetricsToGist(metricsData) {
    const { gistId, token } = getGistConfig();

    if (!gistId || !token) {
        console.log('[Gist Sync] Notice: GITHUB_GIST_ID or GITHUB_TOKEN not configured. Skipping remote sync.');
        console.log('[Gist Sync] (Add githubGistId and githubToken to configs/secrets.json when ready).');
        return { success: false, skipped: true };
    }

    const payload = {
        description: 'Live Music Search Agent - Crawler Health & Metrics',
        files: {
            'crawler_metrics.json': {
                content: typeof metricsData === 'string' ? metricsData : JSON.stringify(metricsData, null, 2)
            }
        }
    };

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'LiveMusicSearchAgent-Telemetry',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error(`[Gist Sync] GitHub API Error (${response.status}):`, errBody);
            return { success: false, status: response.status, error: errBody };
        }

        const data = await response.json();
        console.log(`[Gist Sync] Successfully updated GitHub Gist (${gistId}) at ${data.updated_at}`);
        return { success: true, updatedAt: data.updated_at };
    } catch (err) {
        console.error('[Gist Sync] Network error connecting to GitHub API:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    syncMetricsToGist,
    getGistConfig
};
