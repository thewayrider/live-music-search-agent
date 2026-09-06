const cheerio = require('cheerio');

function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
}

async function testFuturemag() {
    const url = "https://futuremagmusic.com/wp-json/wp/v2/posts?categories=1410&per_page=1&_fields=id,date,link,title,content";
    const res = await fetch(url, { headers: { "User-Agent": "music-release-agent/1.0" }});
    const posts = await res.json();
    
    for (const post of posts) {
        console.log(`Title: ${post.title.rendered}`);
        const html = post.content.rendered;
        const $ = cheerio.load(html);
        $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b').append(' ');
        const bodyText = cleanText($.text());
        console.log(`Text preview: ${bodyText.substring(0, 500)}`);
    }
}

testFuturemag();
