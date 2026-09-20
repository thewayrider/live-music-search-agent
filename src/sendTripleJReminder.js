const fs = require('fs');
const path = require('path');
const { sendReminderEmail } = require('./utils/emailNotifier');

async function main() {
    console.log("Checking if Weekly Triple J reminder should be sent...");

    const statePath = path.resolve(__dirname, '../configs/last_triplej_reminder.json');
    let lastSent = 0;

    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            lastSent = state.lastSentTimestamp || 0;
        } catch (e) {
            console.error("Could not parse last_triplej_reminder.json", e);
        }
    }

    const now = Date.now();
    const daysSinceLastSent = (now - lastSent) / (1000 * 60 * 60 * 24);

    // If it's been at least 6.5 days since we last sent the reminder
    if (daysSinceLastSent > 6.5) {
        console.log("Sending weekly reminder...");
        const subject = "Remember to check out Triple J / Double J";
        const htmlContent = `
            <h2>Triple J & Double J Reminder</h2>
            <p>This is your weekly reminder to manually check the Triple J and Double J websites for any new releases, as their layout is difficult to automate.</p>
            <p><a href="https://www.abc.net.au/triplej">View Triple J</a></p>
            <p><a href="https://www.abc.net.au/listen/doublej">View Double J</a></p>
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
