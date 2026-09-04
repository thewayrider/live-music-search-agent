const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('scratch_roots.html', 'utf8');
const $ = cheerio.load(html);

let headings = [];
$('h2').each((i, el) => {
    headings.push($(el).text().trim());
});
console.log("H2 tags:", headings);

let headings3 = [];
$('h3').each((i, el) => {
    headings3.push($(el).text().trim());
});
console.log("H3 tags:", headings3);
