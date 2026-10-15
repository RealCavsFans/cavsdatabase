// Builds news.json for the scrolling news ticker: newest Cavs headlines from approved RSS feeds.
// Keeps the existing file if every feed fails. Not scheduled until Luka approves the sources.
import { readFile, writeFile } from 'node:fs/promises';
// [source, candidate URLs (first one that answers wins), required title pattern or null]
const CAV = /cav(s|aliers)\b|cleveland/i;
const FEEDS = [
  ['Cavs.com', ['https://www.nba.com/cavaliers/rss.xml', 'https://www.nba.com/cavaliers/news/rss.xml', 'https://www.nba.com/cavaliers/feed'], null],
  ['Hoops Rumors', ['https://www.hoopsrumors.com/cleveland-cavaliers/feed'], null],
  ['RealGM', ['https://basketball.realgm.com/rss/wiretap/5/0.xml', 'https://basketball.realgm.com/rss/wiretap/0/0.xml'], CAV],
  ['cleveland.com', ['https://www.cleveland.com/arc/outboundfeeds/rss/category/cavs/?outputType=xml'], null],
  ['Sports Illustrated', ['https://www.si.com/nba/cavaliers/rss', 'https://www.si.com/nba/cavaliers/.rss/full/', 'https://www.si.com/.rss/full/nba/cavaliers'], null],
  ['The Athletic', ['https://www.nytimes.com/athletic/rss/nba/cavaliers/', 'https://theathletic.com/rss/nba/cavaliers/'], null],
  ['WKYC', ['https://www.wkyc.com/feeds/syndication/rss/sports/nba/cavaliers', 'https://www.wkyc.com/feeds/syndication/rss/sports'], CAV],
  ['News 5 Cleveland', ['https://www.news5cleveland.com/sports/cavs.rss', 'https://www.news5cleveland.com/sports.rss'], CAV],
  ['Fear The Sword', ['https://www.fearthesword.com/rss/index.xml'], null],
  ['Cavs Nation', ['https://cavsnation.com/feed/', 'https://www.cavsnation.com/feed/'], null],
  ['Cavaliers Nation', ['https://cavaliersnation.com/feed/', 'https://www.cavaliersnation.com/feed/'], null],
  ['ClutchPoints', ['https://clutchpoints.com/nba/cleveland-cavaliers/feed', 'https://clutchpoints.com/feed'], CAV],
  ['HoopsHype', ['https://www.hoopshype.com/team/cleveland-cavaliers/feed/', 'https://www.hoopshype.com/feed/', 'https://www.hoopshype.com/rss/'], CAV]
];
const MAX_AGE_H = 72, MAX = 30;
const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]) : ''; };
let prev = [];
try { prev = JSON.parse(await readFile('news.json', 'utf8')); } catch {}
const out = []; let ok = 0; const status = {};
for (const [src, urls, must] of FEEDS) {
  let xml = null, used = null, errs = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cavsdatabase.com news ticker)', 'Accept': 'application/rss+xml, application/xml, text/xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text(); if (!/<item[\s>]/.test(t)) throw new Error('no items');
      xml = t; used = url; break;
    } catch (e) { errs.push(url + ' ' + e.message); }
  }
  if (!xml) { status[src] = { ok: false, errs }; console.warn(src, errs.join(' | ')); continue; }
  ok++; let n = 0;
  for (const it of xml.split(/<item[\s>]/).slice(1)) {
    const title = tag(it, 'title'); const link = tag(it, 'link') || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''; const d = new Date(tag(it, 'pubDate') || tag(it, 'dc:date'));
    if (!title || !link || isNaN(d)) continue;
    if (must && !must.test(title + ' ' + link)) continue;
    if (/\b(odds|betting|bets?|picks?|prediction|predictions|spread|parlay|props?|best bet)\b/i.test(title) || /game log|play-by-play|tabellino|statistiche|\bstats,/i.test(title)) continue;
    if (Date.now() - d > MAX_AGE_H * 3600e3) continue;
    out.push({ t: title, u: link, s: src, d: d.toISOString() }); n++;
  }
  status[src] = { ok: true, url: used, recent: n };
}
await writeFile('news-status.json', JSON.stringify({ at: new Date().toISOString(), status }, null, 1) + '\n');
if (!ok) { console.warn('All feeds failed; keeping existing news.json'); process.exit(0); }
const seen = new Set();
const items = out.sort((a, b) => b.d.localeCompare(a.d)).filter(x => { const k = x.t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX);
await writeFile('news.json', JSON.stringify(items, null, 1) + '\n');
console.log('news.json:', items.length);
