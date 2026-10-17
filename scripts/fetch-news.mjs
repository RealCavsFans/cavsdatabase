// Pulls the RSS/Atom feeds listed in data/news-sources.json and writes news.json for the newsletter:
// { articles: [{src, title, link, date}], podcasts: [{src, title, link, date, dur}], videos: [{src, title, link, date, id}], highlights: [...] }
// Sources: type article | podcast (RSS/Atom url) or video (YouTube channel id in "channel", or a feed url).
// highlights: the NBA's own YouTube channel, Cavs full-game highlights only (built in).
// YouTube uses the Data API when YT_API_KEY is set (reliable from GitHub), else the channel's RSS feed.
// Each feed is tried once; a feed that fails keeps its items from the last run. No dependencies.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const KEEP_DAYS = 10;
let cfg = { sources: [] }; try { cfg = JSON.parse(await readFile(new URL('data/news-sources.json', root), 'utf8')); } catch {}
let prev = { articles: [], podcasts: [], videos: [], highlights: [] }; try { prev = JSON.parse(await readFile(new URL('news.json', root), 'utf8')); } catch {}
const un = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&#8216;|&lsquo;/g, "'").replace(/&#822[01];|&[lr]dquo;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—').replace(/\s+/g, ' ').trim();
const tag = (x, t) => (x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')) || [])[1] || '';
const attr = (x, t, a) => (x.match(new RegExp(`<${t}[^>]*\\s${a}="([^"]+)"`, 'i')) || [])[1] || '';
const dur = s => { s = un(s); if (!s) return ''; if (/^\d+$/.test(s)) { const m = Math.round(+s / 60); return m >= 60 ? Math.floor(m / 60) + ' hr ' + (m % 60) + ' min' : m + ' min'; } const p = s.split(':').map(Number); const m = p.length === 3 ? p[0] * 60 + p[1] : p[0]; return m >= 60 ? Math.floor(m / 60) + ' hr ' + (m % 60) + ' min' : m + ' min'; };
const cutoff = Date.now() - KEEP_DAYS * 864e5;
const out = { articles: [], podcasts: [], videos: [], highlights: [] };
const YT = process.env.YT_API_KEY;
async function youtube(channel) {
  if (YT) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=UU${channel.slice(2)}&key=${YT}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('YouTube API HTTP ' + r.status);
    return ((await r.json()).items || []).map(i => ({ id: i.snippet?.resourceId?.videoId, title: i.snippet?.title || '', date: i.snippet?.publishedAt }));
  }
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cavsdatabase.com newsletter)' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.text()).split(/<entry[\s>]/).slice(1).map(x => ({ id: un(tag(x, 'yt:videoId')), title: un(tag(x, 'title')), date: un(tag(x, 'published')) }));
}
const vid = (src, v) => ({ src, title: un(v.title), link: 'https://www.youtube.com/watch?v=' + v.id, date: new Date(v.date).toISOString(), id: v.id });
const NBA_CHANNEL = 'UCWJ2lWNubArHWmf3FIHbfcQ';
try {
  const got = (await youtube(NBA_CHANNEL)).filter(v => v.id && /cavaliers/i.test(v.title) && /full game highlights/i.test(v.title) && !/shorts/i.test(v.title)).map(v => vid('NBA', v));
  const seen = new Set(got.map(x => x.id));
  out.highlights = [...got, ...(prev.highlights || []).filter(x => !seen.has(x.id))].filter(x => Date.parse(x.date) > cutoff);
  console.log('NBA highlights:', got.length);
} catch (e) { console.log(`::warning::NBA highlights: ${e.message}, keeping last run`); out.highlights = prev.highlights || []; }
for (const s of cfg.sources || []) {
  const bucket = s.type === 'podcast' ? 'podcasts' : s.type === 'video' ? 'videos' : 'articles';
  const old = (prev[bucket] || []).filter(x => x.src === s.name);
  try {
    if (s.channel) {
      const re = s.filter ? new RegExp(s.filter, 'i') : null;
      const got = (await youtube(s.channel)).filter(v => v.id && v.title && !/#shorts/i.test(v.title) && (!re || re.test(v.title))).map(v => vid(s.name, v)).filter(x => Date.parse(x.date) > cutoff).slice(0, 10);
      out[bucket].push(...got); console.log(s.name + ':', got.length); continue;
    }
    const r = await fetch(s.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cavsdatabase.com newsletter)', Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    const items = xml.includes('<item') ? xml.split(/<item[\s>]/i).slice(1) : xml.split(/<entry[\s>]/i).slice(1);
    const re = s.filter ? new RegExp(s.filter, 'i') : null;
    const got = items.map(x => ({ src: s.name, title: un(tag(x, 'title')), link: un(tag(x, 'link')) || attr(x, 'link', 'href') || attr(x, 'enclosure', 'url'), date: new Date(un(tag(x, 'pubDate')) || un(tag(x, 'published')) || un(tag(x, 'updated')) || un(tag(x, 'dc:date'))).toISOString(), ...(bucket === 'podcasts' ? { dur: dur(tag(x, 'itunes:duration')) } : {}) }))
      .filter(x => x.title && x.link && Date.parse(x.date) > cutoff && (!re || re.test(x.title))).slice(0, 15);
    out[bucket].push(...got); console.log(s.name + ':', got.length);
  } catch (e) { console.log(`::warning::${s.name}: ${e.message}, keeping last run`); out[bucket].push(...old); }
}
for (const k of ['articles', 'podcasts', 'videos', 'highlights']) out[k].sort((a, b) => b.date.localeCompare(a.date));
await writeFile(new URL('news.json', root), JSON.stringify(out, null, 1) + '\n');
