const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const secrets = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs/secrets.json'), 'utf8'));
const genAI = new GoogleGenerativeAI(secrets.geminiToken);

async function listModels() {
    try {
        const response = await globalThis.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${secrets.geminiToken}`);
        const data = await response.json();
        console.log("Available Models:");
        data.models.forEach(m => console.log(m.name, m.supportedGenerationMethods));
    } catch (e) {
        console.error("Error fetching models:", e);
    }
}
listModels();
