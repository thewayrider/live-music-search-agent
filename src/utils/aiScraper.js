const fs = require('fs');
const path = require('path');

function getHfToken() {
    try {
        const secretsPath = path.join(__dirname, '../../configs/secrets.json');
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        return secrets.hfToken;
    } catch (e) {
        console.error("Could not read hfToken from configs/secrets.json");
        return null;
    }
}

async function extractReleasesWithAI(articleText) {
    const token = getHfToken();
    if (!token) return [];

    const prompt = `[INST] You are a music data extraction bot.
Extract all the new music releases mentioned in the following article text.
Return ONLY a valid JSON array of objects. Do not include any other text, markdown formatting, or explanations.
Each object must have these exact keys:
- "artist": The name of the artist/band (string)
- "title": The name of the song/album/EP (string)
- "releaseType": Either "single", "ep", or "album" (string)

Article Text:
${articleText.substring(0, 4000)} [/INST]`;

    const { HfInference } = require('@huggingface/inference');
    const hf = new HfInference(token);

    try {
        const response = await hf.chatCompletion({
            model: 'Qwen/Qwen2.5-72B-Instruct',
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1024,
            temperature: 0.1
        });

        let generatedText = response.choices[0].message.content.trim();
        const jsonMatch = generatedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[0]);
            return Array.isArray(parsedData) ? parsedData : [];
        } else {
            console.warn("AI did not return a valid JSON array. RAW AI OUTPUT:", generatedText.substring(0, 500));
            return [];
        }
    } catch (e) {
        console.error("Failed to extract releases with AI (SDK Error):", e.message);
        return [];
    }
}

module.exports = { extractReleasesWithAI };
