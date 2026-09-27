const path = require('path');
const fs = require('fs');
const { aggregateCrawlerMetrics } = require('../utils/metricsAggregator');

/**
 * Performs a comprehensive health audit across all registered music crawlers.
 * Checks for consecutive zero-discovery runs, inactivity (>10 days), and scheduler health.
 */
function auditHealth() {
    const metrics = aggregateCrawlerMetrics();
    const crawlers = metrics.crawlers || [];
    const summary = metrics.summary || {};

    const healthy = [];
    const needsReview = [];
    const inactive = [];

    for (const crawler of crawlers) {
        const hStatus = crawler.health?.healthStatus || 'Healthy';
        if (hStatus === 'Healthy' || hStatus === 'High Yield' || hStatus === 'Moderate') {
            healthy.push(crawler);
        } else if (hStatus === 'Needs Review') {
            needsReview.push(crawler);
        } else if (hStatus === 'Inactive') {
            inactive.push(crawler);
        } else {
            healthy.push(crawler);
        }
    }

    return {
        timestamp: new Date().toISOString(),
        summary: {
            totalCrawlers: crawlers.length,
            healthyCount: healthy.length,
            reviewCount: needsReview.length,
            inactiveCount: inactive.length,
            todayDiscoveries: summary.systemNewToday || 0,
            weekDiscoveries: summary.systemNewWeek || 0,
            allTimeDiscoveries: summary.systemNewAllTime || 0
        },
        healthy: healthy.map(c => ({
            id: c.id,
            name: c.name,
            schedule: c.schedule,
            status: c.health?.healthStatus || 'Healthy',
            weekYield: c.stats?.past7Days?.newSongs || 0,
            allTimeYield: c.stats?.allTime?.newSongs || 0,
            recommendation: c.health?.recommendation || ''
        })),
        needsReview: needsReview.map(c => ({
            id: c.id,
            name: c.name,
            schedule: c.schedule,
            status: c.health?.healthStatus || 'Needs Review',
            weekYield: c.stats?.past7Days?.newSongs || 0,
            recommendation: c.health?.recommendation || ''
        })),
        inactive: inactive.map(c => ({
            id: c.id,
            name: c.name,
            schedule: c.schedule,
            daysSinceLastRun: c.health?.daysSinceLastRun || 0,
            recommendation: c.health?.recommendation || ''
        }))
    };
}

/**
 * Formats the audit results into a readable CLI report.
 */
function formatAuditReport(report) {
    let output = [];
    output.push("============================================================");
    output.push("         LIVE MUSIC CRAWLER OVERSEER - HEALTH AUDIT         ");
    output.push("============================================================");
    output.push(`Timestamp: ${report.timestamp}`);
    output.push(`Total Crawlers: ${report.summary.totalCrawlers} | Healthy: ${report.summary.healthyCount} | Needs Review: ${report.summary.reviewCount} | Inactive: ${report.summary.inactiveCount}`);
    output.push(`Discoveries: Today: ${report.summary.todayDiscoveries} | This Week: ${report.summary.weekDiscoveries} | All Time: ${report.summary.allTimeDiscoveries}`);
    output.push("------------------------------------------------------------");

    if (report.needsReview.length > 0) {
        output.push("\n[!] ACTION REQUIRED: CRAWLERS NEEDING REVIEW:");
        report.needsReview.forEach(c => {
            output.push(`  - ${c.name} (${c.schedule}): ${c.recommendation}`);
        });
    }

    if (report.inactive.length > 0) {
        output.push("\n[!] WARNING: INACTIVE CRAWLERS (>10 DAYS):");
        report.inactive.forEach(c => {
            output.push(`  - ${c.name} (${c.schedule}): ${c.recommendation}`);
        });
    }

    output.push("\n[+] HEALTHY PERFORMING CRAWLERS:");
    report.healthy.forEach(c => {
        output.push(`  - ${c.name.padEnd(22)} | Status: ${c.status.padEnd(12)} | 7-Day: ${String(c.weekYield).padStart(3)} | All-Time: ${String(c.allTimeYield).padStart(4)}`);
    });

    output.push("============================================================\n");
    return output.join("\n");
}

module.exports = {
    auditHealth,
    formatAuditReport
};
