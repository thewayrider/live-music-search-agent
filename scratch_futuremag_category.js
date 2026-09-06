async function checkFuturemag() {
    const url = "https://futuremagmusic.com/wp-json/wp/v2/article?search=New+Aussie+Releases";
    const res = await fetch(url, { headers: { "User-Agent": "music-release-agent/1.0" }});
    if (!res.ok) {
        console.log("Error:", res.status, res.statusText);
        return;
    }
    const posts = await res.json();
    console.log("Search result:", posts.length, "posts found");
    posts.slice(0, 5).forEach(p => {
        console.log(`Title: ${p.title.rendered} | Date: ${p.date}`);
    });
}
checkFuturemag();
