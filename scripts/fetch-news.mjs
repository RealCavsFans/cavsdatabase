// Builds news.json for the scrolling news ticker: newest Cavs headlines from approved RSS feeds.
// Keeps the existing file if every feed fails. Not scheduled until Luka approves the sources.
import { readFile, writeFile } from 'node:fs/promises';
const FEEDS = [
  ['Hoops Rumors', 'https://www.hoopsrumors.com/cleveland-cavaliers/feed', null],
  ['cleveland.com', 'https://www.cleveland.com/arc/outboundfeeds/rss/category/cavs/?outputType=xml', null],
  ['Fear The Sword', 'https://www.fearthesword.com/rss/index.xml', null],
  ['Google News', 'https://news.google.com/rss/search?q=%22Cleveland+Cavaliers%22+when:2d&hl=en-US&gl=US&ceid=US:en', /cav(s|aliers)\b/i]
];
const MAX_AGE_H = 72, MAX = 30;
const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]) : ''; };
let prev = [];
try { prev = JSON.parse(await readFile('news.json', 'utf8')); } catch {}
const out = []; let ok = 0;
for (const [src, url, must] of FEEDS) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cavsdatabase.com news ticker)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text(); ok++;
    for (const it of xml.split(/<item[\s>]/).slice(1)) {
      let title = tag(it, 'title'); const link = tag(it, 'link'); const d = new Date(tag(it, 'pubDate'));
      let from = src;
      if (src === 'Google News') { const m = title.match(/^(.*) - ([^-]+)$/); if (m) { title = m[1]; from = m[2].trim(); } }
      if (!title || !link || isNaN(d)) continue;
      if (must && !must.test(title)) continue;
      if (/sportsbook|draftkings|fanduel|betmgm|caesars|bet365|odds shark|covers\.com|action network|pickswise/i.test(from) || /\b(odds|betting|bets?|picks?|prediction|predictions|spread|parlay|props?|best bet)\b/i.test(title)) continue;
      if (Date.now() - d > MAX_AGE_H * 3600e3) continue;
      out.push({ t: title, u: link, s: from, d: d.toISOString() });
    }
  } catch (e) { console.warn(src, e.message); }
}
if (!ok) { console.warn('All feeds failed; keeping existing news.json'); process.exit(0); }
const seen = new Set();
const items = out.sort((a, b) => b.d.localeCompare(a.d)).filter(x => { const k = x.t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX);
await writeFile('news.json', JSON.stringify(items, null, 1) + '\n');
console.log('news.json:', items.length);
