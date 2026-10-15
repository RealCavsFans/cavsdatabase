// One-off: check which Cavs news feeds load from GitHub's servers. Writes data/feed-test.txt.
import { writeFile } from 'node:fs/promises';
const FEEDS = {
  'Hoops Rumors (Cavaliers)': 'https://www.hoopsrumors.com/cleveland-cavaliers/feed',
  'RealGM Wiretap (Cavaliers)': 'https://basketball.realgm.com/rss/wiretap/5/0.xml',
  'Fear The Sword': 'https://www.fearthesword.com/rss/index.xml',
  'cleveland.com Cavs': 'https://www.cleveland.com/arc/outboundfeeds/rss/category/cavs/?outputType=xml',
  'Google News: Cleveland Cavaliers': 'https://news.google.com/rss/search?q=%22Cleveland+Cavaliers%22+when:2d&hl=en-US&gl=US&ceid=US:en',
  'Cavs.com news': 'https://www.nba.com/cavaliers/rss.xml',
  'ESPN NBA': 'https://www.espn.com/espn/rss/nba/news',
  'Yahoo Cavaliers': 'https://sports.yahoo.com/nba/teams/cleveland/rss/',
  'CBS Sports NBA': 'https://www.cbssports.com/rss/headlines/nba/'
};
const out = [];
for (const [name, url] of Object.entries(FEEDS)) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cavsdatabase.com feed reader)' } });
    const t = await r.text();
    const items = (t.match(/<item[\s>]/g) || []).length + (t.match(/<entry[\s>]/g) || []).length;
    const first = (t.match(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || t.match(/<entry[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    out.push(`${name} | ${r.status} | items ${items} | ${first.trim().slice(0, 90)}`);
  } catch (e) { out.push(`${name} | ERR ${e.message}`); }
}
await writeFile('data/feed-test.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
