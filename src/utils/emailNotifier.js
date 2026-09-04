const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

async function sendEmailNotification(newSongs, baseHtmlPath, searchName) {
    // Load secrets
    const secretsPath = path.resolve(__dirname, '../../configs/secrets.json');
    if (!fs.existsSync(secretsPath)) {
        console.error(`ERROR: Secrets file not found at ${secretsPath}. Cannot send email.`);
        return;
    }

    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    if (!secrets.gmailUser || !secrets.gmailAppPassword) {
        console.error("ERROR: Invalid secrets.json. Missing gmailUser or gmailAppPassword.");
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: secrets.gmailUser,
            pass: secrets.gmailAppPassword
        }
    });

    let htmlContent;
    let subject;

    if (!newSongs || newSongs.length === 0) {
        subject = `[Music Release Alert - ${searchName}] Search Run Completed - No New Songs`;
        htmlContent = `
            <h2>Live Music Search Agent</h2>
            <p>A scheduled run was completed, but no new songs were discovered on ${searchName} today.</p>
        `;
    } else {
        subject = `[Music Release Alert - ${searchName}] ${newSongs.length} New Indie/Live Songs Discovered!`;
        htmlContent = `
            <h2>New Live Music Additions</h2>
            <p>The ${searchName} agent discovered <strong>${newSongs.length}</strong> new songs today!</p>
            <ul>
                ${newSongs.map(song => `
                    <li style="margin-bottom: 10px;">
                        <strong>${song.title}</strong><br>
                        Chart: <em>${song.channel}</em><br>
                        <a href="${song.url}">View Chart</a>
                    </li>
                `).join('')}
            </ul>
            <p>Happy listening!</p>
        `;
    }

    const mailOptions = {
        from: secrets.gmailUser,
        to: secrets.gmailUser,
        subject: subject,
        html: htmlContent
    };

    if (baseHtmlPath) {
        mailOptions.html += `
            <hr style="margin-top: 20px; border: none; border-top: 1px solid #ccc;">
            <p style="font-size: 0.9em; color: #555;">
                <a href="file://${baseHtmlPath.replace(/\\/g, '/')}">View Original Base Run</a>
            </p>
        `;
    }

    try {
        console.log("Sending email notification...");
        const info = await transporter.sendMail(mailOptions);
        console.log("Email sent successfully: " + info.response);
    } catch (error) {
        console.error("Error sending email:", error);
    }
}

async function sendReminderEmail(subject, htmlContent) {
    const secretsPath = path.resolve(__dirname, '../../configs/secrets.json');
    if (!fs.existsSync(secretsPath)) {
        console.error(`ERROR: Secrets file not found at ${secretsPath}. Cannot send email.`);
        return;
    }

    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    if (!secrets.gmailUser || !secrets.gmailAppPassword) {
        console.error("ERROR: Invalid secrets.json. Missing gmailUser or gmailAppPassword.");
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: secrets.gmailUser,
            pass: secrets.gmailAppPassword
        }
    });

    const mailOptions = {
        from: secrets.gmailUser,
        to: secrets.gmailUser,
        subject: subject,
        html: htmlContent
    };

    try {
        console.log(`Sending reminder email: ${subject}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log("Reminder email sent successfully: " + info.response);
    } catch (error) {
        console.error("Error sending reminder email:", error);
    }
}

module.exports = {
    sendEmailNotification,
    sendReminderEmail
};
