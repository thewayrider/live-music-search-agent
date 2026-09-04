const { extractReleasesWithAI } = require('./src/utils/aiScraper.js');

async function test() {
    const sampleText = "Welcome to our New Music Friday roundup! This week we have the incredible new single from Tame Impala called 'Lost in Yesterday'. Also, don't miss the debut EP from The Strokes titled 'Future Present Past'.";
    const results = await extractReleasesWithAI(sampleText);
    console.log("AI Results:", results);
}

test();
