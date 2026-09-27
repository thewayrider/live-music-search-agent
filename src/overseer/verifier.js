const path = require('path');
const fs = require('fs');

/**
 * Validates an array of crawler results against the project's Unified Output Contract.
 */
function validateUnifiedContract(results) {
    const errors = [];
    if (!Array.isArray(results)) {
        return { valid: false, errors: ["Agent did not return a JavaScript array."] };
    }

    if (results.length === 0) {
        return { valid: false, errors: ["Agent returned 0 items (empty array)."] };
    }

    const requiredFields = ['title', 'channel', 'url', 'views', 'uploadedAt', 'description'];

    results.forEach((item, idx) => {
        if (!item || typeof item !== 'object') {
            errors.push(`Item at index ${idx} is not an object.`);
            return;
        }

        for (const field of requiredFields) {
            if (item[field] === undefined || item[field] === null || item[field] === '') {
                errors.push(`Item #${idx + 1} ('${item.title || "unknown"}') missing required field '${field}'.`);
            }
        }

        if (typeof item.title === 'string' && !item.title.includes(' - ') && !item.title.includes(' – ')) {
            // Informational warning: unified titles are typically "Artist - Title"
        }
    });

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Runs a dry-run test on a specific agent function.
 */
async function testAgentModule(agentFn, config = {}, exclusions = {}) {
    const startTime = Date.now();
    try {
        const results = await agentFn(config, exclusions);
        const durationMs = Date.now() - startTime;
        const validation = validateUnifiedContract(results);

        return {
            passed: validation.valid,
            totalTracks: results ? results.length : 0,
            durationMs,
            sampleTracks: (results || []).slice(0, 3),
            errors: validation.errors
        };
    } catch (err) {
        return {
            passed: false,
            totalTracks: 0,
            durationMs: Date.now() - startTime,
            sampleTracks: [],
            errors: [err.message]
        };
    }
}

module.exports = {
    validateUnifiedContract,
    testAgentModule
};
