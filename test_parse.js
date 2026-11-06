const fs = require('fs');

const html = fs.readFileSync('page50.html', 'utf8');

// Simula DOMParser usando regex ou cheerio/jsdom ou parsing manual
const imgMatches = [...html.matchAll(/<img[^>]+>/gi)];
console.log('Total de imgs no html:', imgMatches.length);

imgMatches.forEach((m, idx) => {
    const tag = m[0];
    if (tag.includes('no_stamp.gif')) return;
    if (tag.includes('transparent_spacer')) return;
    if (tag.includes('theme') || tag.includes('navigation') || tag.includes('banner')) return;
    console.log(`Img ${idx}:`, tag);
});
