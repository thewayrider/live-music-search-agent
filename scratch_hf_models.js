const { HfInference } = require('@huggingface/inference');
const fs = require('fs');
const path = require('path');

async function testModel(modelName) {
    const secrets = JSON.parse(fs.readFileSync(path.join(__dirname, 'configs/secrets.json'), 'utf8'));
    const hf = new HfInference(secrets.hfToken);
    
    console.log(`Testing model: ${modelName}`);
    try {
        const response = await hf.chatCompletion({
            model: modelName,
            messages: [
                { role: "user", content: "Extract songs." }
            ],
            max_tokens: 10
        });
        console.log(`SUCCESS with ${modelName}:`, response.choices[0].message.content);
    } catch (e) {
        console.log(`FAILED with ${modelName}:`, e);
    }
}

async function run() {
    await testModel('Qwen/Qwen2.5-7B-Instruct');
    await testModel('Qwen/Qwen2.5-72B-Instruct');
    await testModel('mistralai/Mistral-7B-Instruct-v0.2');
}

run();
