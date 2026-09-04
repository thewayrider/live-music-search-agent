const fs = require('fs');
const path = require('path');
const { sendReminderEmail } = require('./utils/emailNotifier');

async function main() {
    console.log("Checking if Weekly Rolling Stone AU reminder should be sent...");

    const statePath = path.resolve(__dirname, '../configs/last_rs_reminder.json');
    let lastSent = 0;

    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            lastSent = state.lastSentTimestamp || 0;
        } catch (e) {
            console.error("Could not parse last_rs_reminder.json", e);
        }
    }

    const now = Date.now();
    const daysSinceLastSent = (now - lastSent) / (1000 * 60 * 60 * 24);

    // If it's been at least 6.5 days since we last sent the reminder
    if (daysSinceLastSent > 6.5) {
        console.log("Sending weekly reminder...");
        const subject = "Remember to check out Rolling Stone AU";
        const htmlContent = `
            <h2>Rolling Stone AU Reminder</h2>
            <p>This is your weekly reminder to manually check the Rolling Stone AU Music Lists page for any new releases.</p>
            <p><a href="https://au.rollingstone.com/music/music-lists/">View Rolling Stone AU Music Lists</a></p>
        `;

        await sendReminderEmail(subject, htmlContent);

        // Update state
        fs.writeFileSync(statePath, JSON.stringify({ lastSentTimestamp: now }, null, 2));
        console.log("State updated. Next reminder in 7 days.");
    } else {
        console.log(`Reminder already sent recently (${daysSinceLastSent.toFixed(1)} days ago). Skipping.`);
    }
}

main().catch(console.error);
