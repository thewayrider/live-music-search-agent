const cheerio = require('cheerio');

/**
 * Curated registry of trusted regional indie music gatekeepers and tastemakers.
 * Bounded by [Genre] x [Region] to avoid global catalogue swamping.
 */
const REGIONAL_SOURCES = [
    // Ireland
    {
        id: "nialler9",
        name: "Nialler9",
        region: "ireland",
        country: "Ireland",
        genres: ["Indie Rock", "Indie", "Alt Rock", "Electronic", "Post-Punk"],
        url: "https://nialler9.com",
        rssUrl: "https://nialler9.com/feed/",
        newMusicUrl: "https://nialler9.com/category/new-music/",
        type: "rss_article",
        estimatedWeeklyYield: "15-25 tracks",
        description: "The definitive Irish indie music tastemaker blog, featuring regular 'New Music Friday' and Irish release roundups."
    },
    {
        id: "goldenplec",
        name: "GoldenPlec",
        region: "ireland",
        country: "Ireland",
        genres: ["Indie", "Indie Rock", "Alternative", "Folk"],
        url: "https://www.goldenplec.com",
        rssUrl: "https://www.goldenplec.com/feed/",
        newMusicUrl: "https://www.goldenplec.com/category/new-music/",
        type: "rss_article",
        estimatedWeeklyYield: "10-20 tracks",
        description: "Premier independent Irish music magazine featuring new singles, EP drops, and track debuts."
    },
    {
        id: "thethinair",
        name: "The Thin Air",
        region: "ireland",
        country: "Ireland",
        genres: ["Indie Rock", "Post-Punk", "Alt Rock", "Psych"],
        url: "https://thethinair.net",
        rssUrl: "https://thethinair.net/feed/",
        newMusicUrl: "https://thethinair.net/category/features/tracks/",
        type: "rss_article",
        estimatedWeeklyYield: "5-15 tracks",
        description: "Irish underground and independent music publication with strong focus on post-punk and alternative debuts."
    },

    // New Zealand
    {
        id: "undertheradar",
        name: "UnderTheRadar NZ",
        region: "new zealand",
        country: "New Zealand",
        genres: ["Indie Rock", "Alternative", "Punk", "Indie"],
        url: "https://www.undertheradar.co.nz",
        rssUrl: "https://www.undertheradar.co.nz/rss/news.xml",
        newMusicUrl: "https://www.undertheradar.co.nz/news/index.html",
        type: "cheerio",
        estimatedWeeklyYield: "10-25 tracks",
        description: "The core platform for New Zealand independent, underground, and alternative release and gig tracking."
    },
    {
        id: "nzmusician",
        name: "NZ Musician",
        region: "new zealand",
        country: "New Zealand",
        genres: ["Indie", "Folk", "Rock", "Pop"],
        url: "https://nzmusician.co.nz",
        rssUrl: "https://nzmusician.co.nz/feed/",
        newMusicUrl: "https://nzmusician.co.nz/category/music/fresh-cut/",
        type: "rss_article",
        estimatedWeeklyYield: "5-15 tracks",
        description: "New Zealand's dedicated music industry magazine featuring regular 'Fresh Cut' emerging releases."
    },

    // Australia
    {
        id: "fbiradio",
        name: "FBi Radio (Soundcheck)",
        region: "australia",
        country: "Australia",
        genres: ["Indie Rock", "Indie", "Electronic", "Alt"],
        url: "https://fbiradio.com",
        rssUrl: null,
        newMusicUrl: "https://fbiradio.com/music/",
        type: "cheerio",
        estimatedWeeklyYield: "10-20 tracks",
        description: "Sydney's foremost 100% independent community radio station with curated new music playlists."
    },
    {
        id: "theaureview",
        name: "The AU Review",
        region: "australia",
        country: "Australia",
        genres: ["Indie Rock", "Alt Rock", "Indie", "Folk"],
        url: "https://www.theaureview.com",
        rssUrl: "https://www.theaureview.com/feed/",
        newMusicUrl: "https://www.theaureview.com/music/track-of-the-day/",
        type: "rss_article",
        estimatedWeeklyYield: "10-20 tracks",
        description: "Major Australian indie tastemaker covering Tracks of the Day and emerging local single drops."
    },

    // Scotland / UK
    {
        id: "tenementtv",
        name: "Tenement TV",
        region: "scotland",
        country: "United Kingdom",
        genres: ["Indie Rock", "Post-Punk", "Alt Rock"],
        url: "https://tenementtv.net",
        rssUrl: "https://tenementtv.net/feed/",
        newMusicUrl: "https://tenementtv.net/category/news/",
        type: "rss_article",
        estimatedWeeklyYield: "5-15 tracks",
        description: "Scotland's largest independent music platform, championing emerging Scottish rock and alternative."
    },
    {
        id: "diymag",
        name: "DIY Magazine",
        region: "uk",
        country: "United Kingdom",
        genres: ["Indie Rock", "Post-Punk", "Alt Rock"],
        url: "https://diymag.com",
        rssUrl: "https://diymag.com/feed",
        newMusicUrl: "https://diymag.com/music",
        type: "rss_article",
        estimatedWeeklyYield: "15-30 tracks",
        description: "UK-based independent music publication with daily tracks, EP previews, and album features."
    }
];

/**
 * Probes a candidate URL to check live accessibility and recent activity.
 */
async function probeCandidate(candidate) {
    const probeUrl = candidate.rssUrl || candidate.url;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(probeUrl, {
            headers: { "User-Agent": "music-release-agent/1.0 (+https://kimrampling.com)" },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
            return { online: false, status: res.status, error: `HTTP ${res.status}` };
        }

        const text = await res.text();
        const isRss = text.includes("<rss") || text.includes("<feed") || text.includes("xmlns");
        return {
            online: true,
            status: res.status,
            isRss,
            sizeBytes: text.length
        };
    } catch (err) {
        return { online: false, status: 0, error: err.message };
    }
}

/**
 * Searches and audits candidate music sources based on genre and country/region.
 */
async function scoutSources({ genre, region }) {
    const normGenre = (genre || "").toLowerCase().trim();
    const normRegion = (region || "").toLowerCase().trim();

    // 1. Filter candidates
    const matches = REGIONAL_SOURCES.filter(s => {
        const regionMatch = !normRegion || 
                            s.region.includes(normRegion) || 
                            s.country.toLowerCase().includes(normRegion);
        const genreMatch = !normGenre || 
                           s.genres.some(g => g.toLowerCase().includes(normGenre) || normGenre.includes(g.toLowerCase()));
        return regionMatch && genreMatch;
    });

    // 2. Perform live network accessibility probe
    const auditedCandidates = [];
    for (const candidate of matches) {
        const probeResult = await probeCandidate(candidate);
        auditedCandidates.push({
            ...candidate,
            probe: probeResult,
            recommendedScraperType: probeResult.isRss ? "rss_ai" : candidate.type
        });
    }

    return auditedCandidates;
}

module.exports = {
    scoutSources,
    probeCandidate,
    REGIONAL_SOURCES
};
