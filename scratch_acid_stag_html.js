const cheerio = require('cheerio');

async function test() {
    const response = await fetch("https://acidstag.com/2026/09/friday-faves-164/", {
        headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/rss+xml"
        }
    });
    console.log("STATUS:", response.status);
    const html = await response.text();
    const $ = cheerio.load(html);
    $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong').append(' ');
    
    let text = $('.entry-content, main, article, body').text();
    text = text.replace(/\s+/g, ' ').trim();
    console.log("BETTER TEXT START:", text.substring(0, 500));
}

test();
