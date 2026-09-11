const fs = require('fs');
const path = require('path');

const SCHEDULES = {
    'air_charts_discovery': 'Mon 16:00',
    'acid_stag_discovery': 'Fri 16:00',
    'amrap_indie_discovery': 'Thu 16:00',
    'bandcamp_indie_discovery': 'Mon, Wed, Fri, Sat 09:00',
    'listenbrainz_indie_discovery': 'Mon, Fri 09:00',
    'futuremag_indie_discovery': 'Fri 09:00',
    'roots_mag': 'Fri 09:00',
    'triple_j_hitlist_discovery': 'Mon, Wed, Fri 12:00',
    'triple_j_unearthed_discovery': 'Mon, Wed, Fri 14:00'
};

function generateDashboard() {
    const dashboardStatusPath = path.join(__dirname, '..', '..', 'saved_searches', 'dashboard_status.json');
    let statusData = {};
    if (fs.existsSync(dashboardStatusPath)) {
        statusData = JSON.parse(fs.readFileSync(dashboardStatusPath, 'utf8'));
    }

    const agents = [
        { id: 'air_charts_discovery', name: 'Air Charts' },
        { id: 'acid_stag_discovery', name: 'Acid Stag' },
        { id: 'amrap_indie_discovery', name: 'Amrap' },
        { id: 'bandcamp_indie_discovery', name: 'Bandcamp' },
        { id: 'listenbrainz_indie_discovery', name: 'ListenBrainz' },
        { id: 'futuremag_indie_discovery', name: 'Futuremag' },
        { id: 'roots_mag', name: 'Roots Mag' },
        { id: 'triple_j_hitlist_discovery', name: 'Triple J' },
        { id: 'triple_j_unearthed_discovery', name: 'Triple J Unearthed' }
    ];

    let rows = '';

    for (const agent of agents) {
        const data = statusData[agent.id] || {};
        const schedule = SCHEDULES[agent.id] || 'Unknown';
        
        let lastRun = 'Never';
        if (data.lastRun) {
            const d = new Date(data.lastRun);
            lastRun = d.toLocaleString();
        }

        const statusLabel = data.status === 'Success' 
            ? '<span style="color: #4ade80; font-weight: bold;">Success</span>' 
            : (lastRun === 'Never' ? '<span style="color: #94a3b8;">Pending</span>' : '<span style="color: #f87171;">Failed</span>');

        rows += `
            <tr>
                <td><strong>${agent.name}</strong></td>
                <td>${schedule}</td>
                <td>${lastRun}</td>
                <td>${data.totalSongsFound !== undefined ? data.totalSongsFound : '-'}</td>
                <td>${data.newSongsEmailed !== undefined ? data.newSongsEmailed : '-'}</td>
                <td>${statusLabel}</td>
            </tr>
        `;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Live Music Search Agent - Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }
            h1 { color: #38bdf8; text-align: center; margin-bottom: 40px; }
            table { width: 100%; border-collapse: collapse; background-color: #1e293b; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
            th, td { padding: 15px 20px; text-align: left; border-bottom: 1px solid #334155; }
            th { background-color: #0f172a; color: #94a3b8; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.05em; }
            tr:last-child td { border-bottom: none; }
            tr:hover { background-color: #334155; }
            .refresh-btn { display: block; width: 200px; margin: 30px auto; padding: 12px; text-align: center; background-color: #38bdf8; color: #0f172a; text-decoration: none; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; }
            .refresh-btn:hover { background-color: #0ea5e9; }
        </style>
    </head>
    <body>
        <h1>Live Music Search Agent Overview</h1>
        <table>
            <thead>
                <tr>
                    <th>Crawler Name</th>
                    <th>Expected Schedule</th>
                    <th>Last Run Time</th>
                    <th>Total Songs Found</th>
                    <th>New Additions</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        <button class="refresh-btn" onclick="location.reload()">Refresh Page</button>
    </body>
    </html>
    `;

    const outPath = path.join(__dirname, '..', '..', 'dashboard.html');
    fs.writeFileSync(outPath, html);
    console.log(`[Dashboard] Generated successfully at: ${outPath}`);
}

generateDashboard();
