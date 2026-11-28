// Pulls the RealCavsFans.com front page RSS feed and writes rcf.json for the site's RCF page.
// Runs on a schedule from .github/workflows/videos.yml. Node 20+, no dependencies.
// If the feed doesn't answer, it keeps the existing rcf.json and exits cleanly with a warning.
import { readFile, writeFile } from 'node:fs/promises';

const FEED = 'https://realcavsfans.com/index.php?forums/FrontPage/index.rss';
const OUT = new URL('../rcf.json', import.meta.url);
// first date each article was seen: the feed re-dates an article when it's bumped back onto the front page, so we keep the original
const FIRST = new URL('../data/rcf-first.json', import.meta.url);
const KEEP = 12;
const warn = m => console.log(`::warning::${m}`);
const ent = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';

let xml = null;
for (let i = 1; i <= 3 && !xml; i++) {
  try {
    const res = await fetch(FEED, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com RCF feed)' } });
    const body = await res.text();
    if (res.ok && body.includes('<item>')) xml = body; else warn(`attempt ${i}: HTTP ${res.status}`);
  } catch (e) { warn(`attempt ${i}: ${e.message}`) }
  if (!xml) await new Promise(r => setTimeout(r, 3000 * i));
}
if (!xml) { warn('RCF feed did not answer; keeping existing rcf.json'); process.exit(0); }

const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, KEEP).map(([, it]) => {
  const html = pick(it, 'content:encoded').replace(/<!\[CDATA\[|\]\]>/g, '');
  const img = ((html.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '').match(/^https:\/\//i) ? (html.match(/<img[^>]+src="([^"]+)"/) || [])[1] : null;
  const text = ent(html.replace(/<a[^>]*>Read more<\/a>/i, '').replace(/<[^>]+>/g, ' ')).replace(/[​]/g, '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)’”])/g, '$1').replace(/([(“‘])\s+/g, '$1').trim();
  return {
    title: ent(pick(it, 'title')).trim(),
    link: (l => /^https?:\/\//i.test(l) ? l : 'https://realcavsfans.com/')(ent(pick(it, 'link')).trim()),   // feed links must be http(s)
    date: new Date(pick(it, 'pubDate')).toISOString(),
    author: ent(pick(it, 'dc:creator')).trim(),
    img: img ? ent(img) : null,
    excerpt: text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text,
  };
}).filter(x => x.title && x.link);
if (!items.length) { warn('No items parsed; keeping existing rcf.json'); process.exit(0); }
let first = {}; try { first = JSON.parse(await readFile(FIRST, 'utf8')); } catch {}
for (const x of items) { if (!first[x.link] || x.date < first[x.link]) first[x.link] = x.date; else x.date = first[x.link]; }
items.sort((a, b) => a.date < b.date ? 1 : -1);
await writeFile(FIRST, JSON.stringify(first, null, 0).replace(/,"/g, ',\n"') + '\n');
/* only rewrite when the list changed, so a quiet run leaves the file (and the page rebuild hash) alone */
{ let prev = null; try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {} if (prev && JSON.stringify(prev.items) === JSON.stringify(items)) { console.log(`rcf.json: ${items.length} items, unchanged`); process.exit(0); } }
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), items }, null, 1) + '\n');
console.log(`rcf.json: ${items.length} items`);
