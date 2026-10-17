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
const status = [];
const YT = process.env.YT_API_KEY;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' };
const get = async (u, accept) => { const r = await fetch(u, { headers: { ...UA, ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r; };
// a YouTube playlist (a channel's uploads are playlist UU + channel id minus "UC")
async function youtube(channel, playlist, pages = 1) {
  const pl = playlist || 'UU' + channel.slice(2);
  if (YT) {
    const items = []; let tok = '';
    for (let n = 0; n < pages; n++) {
      const j = await (await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${pl}&key=${YT}${tok ? '&pageToken=' + tok : ''}`)).json();
      items.push(...(j.items || [])); tok = j.nextPageToken; if (!tok) break;
    }
    return items.map(i => ({ id: i.snippet?.resourceId?.videoId, title: i.snippet?.title || '', date: i.snippet?.publishedAt }));
  }
  // YouTube's public feed often answers GitHub with a 404; try a few times before giving up
  let xml = '', err;
  for (let i = 0; i < 3 && !xml; i++) { try { xml = await (await get(playlist ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${pl}` : `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`)).text(); } catch (e) { err = e; await new Promise(r => setTimeout(r, 2500 * (i + 1))); } }
  if (!xml) throw err;
  return xml.split(/<entry[\s>]/).slice(1).map(x => ({ id: un(tag(x, 'yt:videoId')), title: used.includes('news.google.com') ? un(tag(x, 'title')).replace(/\s+-\s+[^-]+$/, '') : un(tag(x, 'title')), date: un(tag(x, 'published')) }));
}
async function channelOf(handle) {
  if (YT) { const j = await (await get(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${YT}`)).json(); if (j.items?.[0]?.id) return j.items[0].id; }
  const h = await (await get('https://www.youtube.com/' + handle)).text();
  const m = h.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || h.match(/channel\/(UC[\w-]{22})/); if (!m) throw new Error('no channel id for ' + handle); return m[1];
}
async function playlistName(pl) {
  try { if (YT) { const j = await (await get(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${pl}&key=${YT}`)).json(); return j.items?.[0]?.snippet?.title || ''; }
    return un(tag(await (await get(`https://www.youtube.com/feeds/videos.xml?playlist_id=${pl}`)).text(), 'title')); } catch { return ''; }
}
// find a site's RSS feed: the page's <link rel="alternate">, then the usual spots
async function feedsFor(s) {
  const c = []; if (s.url) c.push(s.url);
  if (s.apple) { const j = await (await get('https://itunes.apple.com/lookup?id=' + s.apple)).json(); if (j.results?.[0]?.feedUrl) c.push(j.results[0].feedUrl); }
  if (s.site) {
    try { const h = await (await get(s.site)).text(); for (const m of h.matchAll(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/gi)) { const u = (m[0].match(/href="([^"]+)"/) || [])[1]; if (u) c.push(new URL(u.replace(/&amp;/g, '&'), s.site).href); } } catch (e) { console.log(`${s.name}: page ${e.message}`); }
    const b = s.site.replace(/\/$/, ''); c.push(b + '/feed', b + '/rss', b + '/rss/index.xml', new URL('/rss/index.xml', s.site).href);
  }
  if (s.google) c.push('https://news.google.com/rss/search?q=' + encodeURIComponent(s.google) + '&hl=en-US&gl=US&ceid=US:en');
  return [...new Set(c)];
}
const vid = (src, v) => ({ src, title: un(v.title), link: 'https://www.youtube.com/watch?v=' + v.id, date: new Date(v.date).toISOString(), id: v.id });
const NBA_CHANNEL = 'UCWJ2lWNubArHWmf3FIHbfcQ';
try {
  /* the NBA uploads dozens of videos a day, so read the last 150; the Cavs' own channel is the backup (preseason games often only appear there) */
  const nba = (await youtube(NBA_CHANNEL, null, 3)).filter(v => v.id && /cavaliers/i.test(v.title) && /full game highlights/i.test(v.title) && !/shorts/i.test(v.title)).map(v => vid('NBA', v));
  let cav = []; try { cav = (await youtube(await channelOf('@cavs'))).filter(v => v.id && /highlights/i.test(v.title) && !/shorts|#/i.test(v.title)).map(v => vid('Cavs', v)); } catch (e) { status.push('Cavs channel highlights: FAILED ' + e.message); }
  const got = [...nba, ...cav];
  const seen = new Set(got.map(x => x.id));
  out.highlights = [...got, ...(prev.highlights || []).filter(x => !seen.has(x.id))].filter(x => Date.parse(x.date) > cutoff);
  console.log('NBA highlights:', got.length); status.push(`NBA highlights: ${got.length} new (${YT ? 'YouTube API' : 'YouTube RSS'})`);
} catch (e) { status.push('NBA highlights: FAILED ' + e.message); console.log(`::warning::NBA highlights: ${e.message}, keeping last run`); out.highlights = prev.highlights || []; }
for (const s of cfg.sources || []) {
  const bucket = s.type === 'podcast' ? 'podcasts' : s.type === 'video' ? 'videos' : 'articles';
  const old = (prev[bucket] || []).filter(x => x.src === s.name);
  try {
    if (s.channel || s.handle || s.playlist) {
      const re = s.filter ? new RegExp(s.filter, 'i') : null;
      if (s.playlist && !s.name) s.name = (await playlistName(s.playlist)) || 'YouTube';
      const ch = s.channel || (s.handle ? await channelOf(s.handle) : null);
      const got = (await youtube(ch, s.playlist)).filter(v => v.id && v.title && !/#shorts/i.test(v.title) && (!re || re.test(v.title))).map(v => vid(s.name, v)).filter(x => Date.parse(x.date) > cutoff).slice(0, 10);
      out[bucket].push(...got); console.log(s.name + ':', got.length); status.push(`${s.name}: ${got.length} (${YT ? 'YouTube API' : 'YouTube RSS'})`); continue;
    }
    let xml = '', used = '';
    for (const u of await feedsFor(s)) { try { const t = await (await get(u, 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8')).text(); if (/<(item|entry)[\s>]/i.test(t)) { xml = t; used = u; break; } } catch {} }
    if (!xml) throw new Error('no working feed found');
    const items = xml.includes('<item') ? xml.split(/<item[\s>]/i).slice(1) : xml.split(/<entry[\s>]/i).slice(1);
    const re = s.filter ? new RegExp(s.filter, 'i') : null;
    const got = items.map(x => ({ src: s.name, title: used.includes('news.google.com') ? un(tag(x, 'title')).replace(/\s+-\s+[^-]+$/, '') : un(tag(x, 'title')), link: un(tag(x, 'link')) || attr(x, 'link', 'href') || attr(x, 'enclosure', 'url'), date: new Date(un(tag(x, 'pubDate')) || un(tag(x, 'published')) || un(tag(x, 'updated')) || un(tag(x, 'dc:date'))).toISOString(), ...(bucket === 'podcasts' ? { dur: dur(tag(x, 'itunes:duration')) } : {}) }))
      .filter(x => x.title && x.link && Date.parse(x.date) > cutoff && (!re || re.test(x.title))).slice(0, 15);
    out[bucket].push(...got); console.log(s.name + ':', got.length, 'from', used); status.push(`${s.name}: ${got.length} from ${used}`);
  } catch (e) { console.log(`::warning::${s.name}: ${e.message}, keeping last run`); status.push(`${s.name}: FAILED ${e.message}`); out[bucket].push(...old); }
}
for (const k of ['articles', 'podcasts', 'videos', 'highlights']) out[k].sort((a, b) => b.date.localeCompare(a.date));
await writeFile(new URL('news-status.txt', root), new Date().toISOString() + '\n' + status.join('\n') + '\n');
await writeFile(new URL('news.json', root), JSON.stringify(out, null, 1) + '\n');
