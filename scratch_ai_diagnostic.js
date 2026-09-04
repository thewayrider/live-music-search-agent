const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
}

function getHfToken() {
    try {
        const secrets = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs/secrets.json'), 'utf8'));
        return secrets.hfToken;
    } catch (e) {
        return null;
    }
}

async function testAI() {
    console.log("1. Fetching Acid Stag Friday Faves...");
    const htmlRes = await fetch("https://acidstag.com/2026/09/friday-faves-164/", {
        headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36"
        }
    });
    const html = await htmlRes.text();

    console.log("2. Parsing HTML...");
    const $ = cheerio.load(html);
    $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b').append(' ');
    const bodyText = cleanText($('.entry-content, main, article, body').text()).substring(0, 4000);
    
    console.log("--------------------------------------------------");
    console.log("TEXT SENT TO AI (First 500 chars):");
    console.log(bodyText.substring(0, 500));
    console.log("--------------------------------------------------");

    const token = getHfToken();
    if (!token) {
        console.log("ERROR: HF Token not found in configs/secrets.json");
        return;
    }

    const prompt = `[INST] You are a music data extraction bot.
Extract all the new music releases mentioned in the following article text.
Return ONLY a valid JSON array of objects. Do not include any other text, markdown formatting, or explanations.
Each object must have these exact keys:
- "artist": The name of the artist/band (string)
- "title": The name of the song/album/EP (string)
- "releaseType": Either "single", "ep", or "album" (string)

Article Text:
${bodyText} [/INST]`;

    console.log("3. Sending to Hugging Face API using https module...");
    const https = require('https');
    const data = JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 1024, return_full_text: false, temperature: 0.1 }
    });

    const req = https.request('https://router.huggingface.co/hf-inference/models/mistralai/Mixtral-8x7B-Instruct-v0.1', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) {
                console.log("API HTTP ERROR:", res.statusCode, res.statusMessage);
                console.log(responseData);
                return;
            }
            try {
                const result = JSON.parse(responseData);
                console.log("--------------------------------------------------");
                console.log("RAW AI RESPONSE:");
                console.log(result[0].generated_text);
                console.log("--------------------------------------------------");
            } catch (err) {
                console.log("JSON PARSE ERROR:", err.message);
                console.log("Raw output:", responseData);
            }
        });
    });

    req.on('error', (e) => {
        console.log("NETWORK ERROR:", e.message);
    });

    req.write(data);
    req.end();
}

testAI();
